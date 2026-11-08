"""The viewport stream and one-shot captures of the main 3D view (the largest 3D viewport of the active screen).

A POST_PIXEL draw handler reads the pixels of that region while Blender draws it, which is exactly what the user sees
and costs no second render; it only runs when Blender redraws, so frames follow changes. Blender forbids writing data
blocks while drawing, so the handler only copies the pixels, and a timer encodes and sends them right after.

Streaming sends a frame when the harness has acknowledged the previous one and the frame interval has passed; a redraw
that comes too early marks the view dirty, and a timer redraws it once the next frame may go.
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
_stream = {"on": False, "awaiting_ack": False, "last": 0.0, "dirty": False, "seq": 0, "redraw_queued": False}
_settings = {"send": None, "max_fps": 10.0, "max_width": 1280, "quality": 70}


def configure(send, max_fps, max_width, quality):
    """Set the frame sender ``send(header, payload)`` and the stream limits from the add-on preferences."""
    _settings.update(send=send, max_fps=max(1.0, float(max_fps)), max_width=max(160, int(max_width)), quality=int(quality))


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
    _stream.update(on=bool(on), awaiting_ack=False, dirty=bool(on))
    if on:
        _redraw()


def ack(seq):
    """The harness relayed frame ``seq``; the next frame may go."""
    if seq == _stream["seq"]:
        _stream["awaiting_ack"] = False
        if _stream["dirty"]:
            _queue_redraw(0.0)


def capture_once(view, max_width, done, fail):
    """Capture the viewport (``view == "viewport"``) or the camera view at the next redraw.

    ``done(rows, width, height)`` receives top-down RGBA bytes; ``fail(message)`` an error. Returns False when no 3D
    viewport is open.
    """
    if _main_view() is None:
        return False
    _captures.append({"view": view, "max_width": max_width, "done": done, "fail": fail})
    start()
    _redraw()
    return True


def _main_view():
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
    target = _main_view()
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


def _read_region(region):
    width, height = region.width, region.height
    framebuffer = gpu.state.active_framebuffer_get()
    buffer = framebuffer.read_color(0, 0, width, height, 4, 0, "UBYTE")
    buffer.dimensions = width * height * 4
    try:
        pixels = np.frombuffer(buffer, dtype=np.uint8)
    except (TypeError, ValueError):
        pixels = np.array(buffer.to_list(), dtype=np.uint8)
    return pixels.reshape(height, width, 4)[::-1]


def _read_camera(region, max_width):
    context = bpy.context
    scene = context.scene
    render = scene.render
    full_w = max(1, int(render.resolution_x * render.resolution_percentage / 100))
    full_h = max(1, int(render.resolution_y * render.resolution_percentage / 100))
    scale = min(1.0, max_width / full_w)
    width, height = max(1, int(full_w * scale)), max(1, int(full_h * scale))
    offscreen = gpu.types.GPUOffScreen(width, height)
    try:
        view_matrix = scene.camera.matrix_world.inverted()
        projection = scene.camera.calc_matrix_camera(
            context.evaluated_depsgraph_get(), x=width, y=height, scale_x=render.pixel_aspect_x, scale_y=render.pixel_aspect_y)
        offscreen.draw_view3d(scene, context.view_layer, context.space_data, region, view_matrix, projection,
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
        offscreen.free()


def _shrink(pixels, max_width):
    step = max(1, math.ceil(pixels.shape[1] / max_width))
    shrunk = pixels[::step, ::step].copy()
    shrunk[:, :, 3] = 255
    return shrunk


def _draw():
    context = bpy.context
    target = _main_view()
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
                    pixels = _shrink(_read_region(region), capture["max_width"])
            except Exception as error:  # A GPU or camera error fails this capture only.
                capture["fail"]("Blender could not take the picture: %s" % error)
                continue
            height, width = pixels.shape[0], pixels.shape[1]
            bpy.app.timers.register(lambda c=capture, p=pixels, w=width, h=height: c["done"](p.tobytes(), w, h), first_interval=0.0)
    if not _stream["on"] or _settings["send"] is None:
        return
    interval = 1.0 / _settings["max_fps"]
    now = time.monotonic()
    if _stream["awaiting_ack"] or now - _stream["last"] < interval:
        _stream["dirty"] = True
        if not _stream["awaiting_ack"]:
            _queue_redraw(interval - (now - _stream["last"]))
        return
    pixels = _shrink(_read_region(region), _settings["max_width"])
    _stream.update(last=now, awaiting_ack=True, dirty=False, seq=_stream["seq"] + 1)
    seq = _stream["seq"]
    bpy.app.timers.register(lambda: _send_frame(seq, pixels), first_interval=0.0)


def _send_frame(seq, pixels):
    send = _settings["send"]
    if send is None or not _stream["on"]:
        return None
    height, width = pixels.shape[0], pixels.shape[1]
    try:
        payload = _jpeg(pixels)
        mime = "image/jpeg"
    except Exception:  # A failed JPEG save falls back to PNG, which needs no data block.
        payload = encode_png(pixels.tobytes(), width, height, 4)
        mime = "image/png"
    send({"kind": "frame", "seq": seq, "width": width, "height": height, "mime": mime}, payload)
    return None


def _jpeg(pixels):
    height, width = pixels.shape[0], pixels.shape[1]
    image = bpy.data.images.get(FRAME_IMAGE)
    if image is None:
        image = bpy.data.images.new(FRAME_IMAGE, width, height, alpha=False)
    elif tuple(image.size) != (width, height):
        image.scale(width, height)
    # Blender images store rows bottom-up.
    image.pixels.foreach_set((pixels[::-1].astype(np.float32) / 255.0).ravel())
    image.file_format = "JPEG"
    handle, path = tempfile.mkstemp(suffix=".jpg", prefix="dreamverse-frame-")
    os.close(handle)
    try:
        image.save(filepath=path, quality=_settings["quality"])
        with open(path, "rb") as stream:
            return stream.read()
    finally:
        os.remove(path)
