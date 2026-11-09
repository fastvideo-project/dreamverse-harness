"""The viewport stream and one-shot captures of the main 3D view (the largest 3D viewport of the active screen).

A POST_PIXEL draw handler on that region draws its view again into an offscreen buffer, at the stream width, with the
region's view and projection matrices, shading, overlays and color management: the framebuffer active in the handler
holds only overlays and UI, because Blender composites the shaded scene into the window after the handlers run. The
handler only runs when Blender redraws, so frames follow changes. Blender forbids writing data blocks while drawing,
so the handler only copies the pixels, and a timer encodes and sends them right after.

Streaming sends a frame while fewer than ``MAX_IN_FLIGHT`` sent frames wait for the harness's acknowledgement and the
frame interval has passed; a redraw that comes too early marks the view dirty, and a timer or the next acknowledgement
redraws it once the next frame may go. While the harness moves the view (``note_move``), frames are smaller, coarser
and more frequent (the "while moving" preferences), and ``MOVING_SECONDS`` after the last move one frame at the full
settings follows. Each frame header carries the milliseconds the frame took to draw and to encode.
"""

import math
import os
import tempfile
import time

import bpy
import gpu
import numpy as np

from .protocol import encode_png

FRAME_IMAGE = ".dreamverse_frame"

_handle = None
_captures = []
# Frames sent and not yet acknowledged before the next one waits: two keep one frame crossing the network while the
# next is drawn, instead of a full round trip of idle time per frame.
MAX_IN_FLIGHT = 2
# How long after the last move of the view the stream counts as moving.
MOVING_SECONDS = 0.3

_stream = {
    "on": False, "acked": 0, "last": 0.0, "dirty": False, "seq": 0, "redraw_queued": False,
    "moving_until": 0.0, "settle_queued": False,
}
_drawing = {"offscreen": False}
_settings = {
    "send": None, "max_fps": 10.0, "max_width": 1280, "quality": 70,
    "moving_fps": 24.0, "moving_width": 640, "moving_quality": 50,
}


def configure(send, max_fps, max_width, quality, moving_fps, moving_width, moving_quality):
    """Set the frame sender ``send(header, payload)`` and the stream limits from the add-on preferences: frames per
    second, frame width and JPEG quality at rest and while the view moves."""
    _settings.update(
        send=send, max_fps=max(1.0, float(max_fps)), max_width=max(160, int(max_width)), quality=int(quality),
        moving_fps=max(1.0, float(moving_fps)), moving_width=max(160, int(moving_width)), moving_quality=int(moving_quality),
    )


def streaming():
    """Whether the harness asked for frames."""
    return _stream["on"]


def moving(now=None):
    """Whether the harness moved the view within the last ``MOVING_SECONDS``."""
    return (time.monotonic() if now is None else now) < _stream["moving_until"]


def note_move():
    """The harness moved the view: stream the moving frames until ``MOVING_SECONDS`` pass without a move, then one frame
    at the full settings."""
    _stream["moving_until"] = time.monotonic() + MOVING_SECONDS
    if _stream["settle_queued"]:
        return
    _stream["settle_queued"] = True

    def settle():
        remaining = _stream["moving_until"] - time.monotonic()
        if remaining > 0:
            return remaining + 0.01
        _stream["settle_queued"] = False
        _stream["dirty"] = True
        _redraw()
        return None

    bpy.app.timers.register(settle, first_interval=MOVING_SECONDS + 0.01)


def start():
    """Add the draw handler; safe to call twice."""
    global _handle
    if _handle is None:
        _handle = bpy.types.SpaceView3D.draw_handler_add(_draw, (), "WINDOW", "POST_PIXEL")


def stop():
    """Remove the draw handler, end the stream and fail pending captures."""
    global _handle
    if _handle is not None:
        bpy.types.SpaceView3D.draw_handler_remove(_handle, "WINDOW")
        _handle = None
    set_streaming(False)
    for capture in _captures[:]:
        capture["fail"]("Blender disconnected before the picture was taken.")
    _captures.clear()
    image = bpy.data.images.get(FRAME_IMAGE)
    if image is not None:
        bpy.data.images.remove(image)


def set_streaming(on):
    """Start or stop streaming frames, as the harness asks while viewers watch."""
    _stream.update(on=bool(on), acked=_stream["seq"], dirty=bool(on))
    if on:
        _redraw()


def ack(seq):
    """The harness relayed frame ``seq`` and every frame before it."""
    if isinstance(seq, int) and _stream["acked"] < seq <= _stream["seq"]:
        _stream["acked"] = seq
        if _stream["dirty"]:
            _queue_redraw(0.0)


def capture_once(view, max_width, done, fail):
    """Capture the viewport (``view == "viewport"``) or the camera view at the next redraw.

    ``done(rows, width, height)`` receives top-down RGBA bytes; ``fail(message)`` an error. Returns False when no 3D
    viewport is open.
    """
    if main_view() is None:
        return False
    _captures.append({"view": view, "max_width": max_width, "done": done, "fail": fail})
    start()
    _redraw()
    return True


def main_view():
    """The main 3D view as (area, region): the largest 3D viewport region of the active window, or None."""
    window = bpy.context.window or (bpy.context.window_manager.windows[0] if bpy.context.window_manager.windows else None)
    if window is None:
        return None
    best = None
    for area in window.screen.areas:
        if area.type != "VIEW_3D":
            continue
        for region in area.regions:
            if region.type == "WINDOW" and (best is None or region.width * region.height > best[1].width * best[1].height):
                best = (area, region)
    return best


def _redraw():
    target = main_view()
    if target is not None:
        target[0].tag_redraw()


def _queue_redraw(delay):
    if _stream["redraw_queued"]:
        return
    _stream["redraw_queued"] = True

    def fire():
        _stream["redraw_queued"] = False
        _redraw()
        return None

    bpy.app.timers.register(fire, first_interval=delay)


def _read_offscreen(region, width, height, view_matrix, projection):
    """Draw the scene from ``view_matrix``/``projection`` into a ``width`` x ``height`` buffer and return top-down RGBA.

    The draw uses the 3D view's shading and overlay settings with color management, so it matches what the user sees.
    """
    context = bpy.context
    offscreen = gpu.types.GPUOffScreen(width, height)
    _drawing["offscreen"] = True
    try:
        offscreen.draw_view3d(context.scene, context.view_layer, context.space_data, region, view_matrix, projection,
                              do_color_management=True)
        with offscreen.bind():
            buffer = gpu.state.active_framebuffer_get().read_color(0, 0, width, height, 4, 0, "UBYTE")
        buffer.dimensions = width * height * 4
        try:
            pixels = np.frombuffer(buffer, dtype=np.uint8)
        except (TypeError, ValueError):
            pixels = np.array(buffer.to_list(), dtype=np.uint8)
        return pixels.reshape(height, width, 4)[::-1]
    finally:
        _drawing["offscreen"] = False
        offscreen.free()


def _scaled(full_w, full_h, max_width):
    scale = min(1.0, max_width / full_w)
    return max(1, int(full_w * scale)), max(1, int(full_h * scale))


def _read_view(region, max_width):
    # The framebuffer active in a POST_PIXEL handler holds only overlays and UI; Blender composites the shaded scene
    # into the window after the handlers run, so the view is drawn again offscreen with the region's own matrices.
    view = bpy.context.region_data
    width, height = _scaled(region.width, region.height, max_width)
    return _read_offscreen(region, width, height, view.view_matrix, view.window_matrix)


def _read_camera(region, max_width):
    context = bpy.context
    scene = context.scene
    render = scene.render
    full_w = max(1, int(render.resolution_x * render.resolution_percentage / 100))
    full_h = max(1, int(render.resolution_y * render.resolution_percentage / 100))
    width, height = _scaled(full_w, full_h, max_width)
    projection = scene.camera.calc_matrix_camera(
        context.evaluated_depsgraph_get(), x=width, y=height, scale_x=render.pixel_aspect_x, scale_y=render.pixel_aspect_y)
    return _read_offscreen(region, width, height, scene.camera.matrix_world.inverted(), projection)


def _shrink(pixels, max_width):
    step = max(1, math.ceil(pixels.shape[1] / max_width))
    shrunk = pixels[::step, ::step].copy()
    shrunk[:, :, 3] = 255
    return shrunk


def _draw():
    context = bpy.context
    if _drawing["offscreen"]:
        return
    target = main_view()
    if target is None or context.region != target[1]:
        return
    region = context.region
    if _captures:
        pending = _captures[:]
        _captures.clear()
        for capture in pending:
            try:
                if capture["view"] == "camera":
                    pixels = _shrink(_read_camera(region, capture["max_width"]), capture["max_width"])
                else:
                    pixels = _shrink(_read_view(region, capture["max_width"]), capture["max_width"])
            except Exception as error:  # A GPU or camera error fails this capture only.
                capture["fail"]("Blender could not take the picture: %s" % error)
                continue
            height, width = pixels.shape[0], pixels.shape[1]
            bpy.app.timers.register(lambda c=capture, p=pixels, w=width, h=height: c["done"](p.tobytes(), w, h), first_interval=0.0)
    if not _stream["on"] or _settings["send"] is None:
        return
    now = time.monotonic()
    fast = moving(now)
    interval = 1.0 / (_settings["moving_fps"] if fast else _settings["max_fps"])
    waiting = _stream["seq"] - _stream["acked"] >= MAX_IN_FLIGHT
    if waiting or now - _stream["last"] < interval:
        _stream["dirty"] = True
        if not waiting:
            _queue_redraw(interval - (now - _stream["last"]))
        return
    width = min(_settings["moving_width"], _settings["max_width"]) if fast else _settings["max_width"]
    quality = _settings["moving_quality"] if fast else _settings["quality"]
    started = time.perf_counter()
    pixels = _shrink(_read_view(region, width), width)
    draw_ms = (time.perf_counter() - started) * 1000.0
    _stream.update(last=now, dirty=False, seq=_stream["seq"] + 1)
    seq = _stream["seq"]
    bpy.app.timers.register(lambda: _send_frame(seq, pixels, quality, draw_ms), first_interval=0.0)


def _send_frame(seq, pixels, quality, draw_ms):
    send = _settings["send"]
    if send is None or not _stream["on"]:
        return None
    height, width = pixels.shape[0], pixels.shape[1]
    started = time.perf_counter()
    try:
        payload = _jpeg(pixels, quality)
        mime = "image/jpeg"
    except Exception:  # A failed JPEG save falls back to PNG, which needs no data block.
        payload = encode_png(pixels.tobytes(), width, height, 4)
        mime = "image/png"
    timing = {"draw_ms": round(draw_ms, 1), "encode_ms": round((time.perf_counter() - started) * 1000.0, 1)}
    send({"kind": "frame", "seq": seq, "width": width, "height": height, "mime": mime, "timing": timing}, payload)
    return None


def _jpeg(pixels, quality):
    height, width = pixels.shape[0], pixels.shape[1]
    image = bpy.data.images.get(FRAME_IMAGE)
    if image is None:
        image = bpy.data.images.new(FRAME_IMAGE, width, height, alpha=False)
    elif tuple(image.size) != (width, height):
        image.scale(width, height)
    # Blender images store rows bottom-up; the scaling happens in place on the one float copy.
    floats = pixels[::-1].astype(np.float32)
    floats *= 1.0 / 255.0
    image.pixels.foreach_set(floats.ravel())
    image.file_format = "JPEG"
    handle, path = tempfile.mkstemp(suffix=".jpg", prefix="dreamverse-frame-")
    os.close(handle)
    try:
        image.save(filepath=path, quality=quality)
        with open(path, "rb") as stream:
            return stream.read()
    finally:
        os.remove(path)
