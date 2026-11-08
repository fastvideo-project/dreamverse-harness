"""The requests the harness sends to Blender: ``scene``, ``run``, ``look`` and ``render``. Every function here runs on
Blender's main thread (the add-on drains the link's messages with a bpy.app.timers timer).

A command finishes through ``reply(result, file_bytes=None, error=None)``. ``look`` finishes later, from a draw
handler, because the viewport's pixels can only be read while Blender draws it.
"""

import contextlib
import io
import json
import math
import os
import tempfile
import traceback

import bpy
import mathutils

from . import viewport
from .protocol import encode_png

LOOK_MAX_WIDTH = 1280


def _vector(values):
    return [round(float(v), 4) for v in values]


def scene_info():
    """The scene facts that ``dv_blender_scene`` returns."""
    scene = bpy.context.scene
    render = scene.render
    selected = [obj.name for obj in getattr(bpy.context, "selected_objects", None) or []]
    objects = []
    for obj in scene.objects:
        entry = {
            "name": obj.name,
            "type": obj.type,
            "parent": obj.parent.name if obj.parent else None,
            "location": _vector(obj.location),
            "rotation_deg": [round(math.degrees(a), 2) for a in obj.rotation_euler],
            "scale": _vector(obj.scale),
            "dimensions": _vector(obj.dimensions),
            "visible": obj.visible_get(),
            "hidden_in_render": obj.hide_render,
        }
        materials = [slot.material.name for slot in getattr(obj, "material_slots", []) if slot.material]
        if materials:
            entry["materials"] = materials
        if obj.type == "CAMERA":
            entry["lens_mm"] = round(obj.data.lens, 2)
        elif obj.type == "LIGHT":
            entry["light"] = {"type": obj.data.type, "energy": round(obj.data.energy, 3), "color": _vector(obj.data.color)}
        objects.append(entry)
    return {
        "file": bpy.path.basename(bpy.data.filepath),
        "scene": scene.name,
        "frame_current": scene.frame_current,
        "frame_start": scene.frame_start,
        "frame_end": scene.frame_end,
        "fps": round(render.fps / render.fps_base, 3),
        "engine": render.engine,
        "resolution": [render.resolution_x, render.resolution_y, render.resolution_percentage],
        "active_camera": scene.camera.name if scene.camera else None,
        "active_object": bpy.context.view_layer.objects.active.name if bpy.context.view_layer.objects.active else None,
        "selected": selected,
        "objects": objects,
    }


def run_code(code):
    """Run Python with bpy, mathutils and math; returns stdout and the JSON value of ``result``."""
    namespace = {"bpy": bpy, "mathutils": mathutils, "math": math, "result": None}
    stdout = io.StringIO()
    try:
        with contextlib.redirect_stdout(stdout):
            exec(compile(code, "<dreamverse>", "exec"), namespace)
    except Exception:
        printed = stdout.getvalue()
        raise RuntimeError(("stdout:\n" + printed + "\n" if printed else "") + traceback.format_exc(limit=8))
    finally:
        _push_undo()
    value = namespace.get("result")
    try:
        json.dumps(value)
    except (TypeError, ValueError):
        value = repr(value)
    return {"stdout": stdout.getvalue()[-20000:], "result": value}


def _push_undo():
    try:
        bpy.ops.ed.undo_push(message="DreamVerse")
    except RuntimeError:
        # No window context for an undo step (Blender in the background); the change simply has no undo step.
        pass


def look(view, reply):
    """Capture the viewport or the camera view as a PNG, at the next redraw of the main 3D view."""
    if view == "camera" and bpy.context.scene.camera is None:
        reply(None, error="The scene has no active camera; set one first, or look at the viewport.")
        return

    def done(rows, width, height):
        reply({"view": view, "width": width, "height": height}, file_bytes=encode_png(rows, width, height, 4))

    if not viewport.capture_once(view, LOOK_MAX_WIDTH, done, lambda message: reply(None, error=message)):
        reply(None, error="Blender has no 3D viewport open to look at; ask the user to open one.")


def _restore(target, saved):
    for name, value in saved.items():
        try:
            setattr(target, name, value)
        except (AttributeError, TypeError):
            pass


def render(params):
    """Render a still (PNG) or an animation (MP4) with the scene camera; returns (result, file bytes)."""
    scene = bpy.context.scene
    if scene.camera is None:
        raise RuntimeError("The scene has no active camera to render with.")
    render_settings = scene.render
    image = render_settings.image_settings
    saved_render = {"filepath": render_settings.filepath, "use_file_extension": render_settings.use_file_extension}
    saved_image = {name: getattr(image, name) for name in ("media_type", "file_format", "color_mode") if hasattr(image, name)}
    saved_frames = (scene.frame_current, scene.frame_start, scene.frame_end)
    width = int(render_settings.resolution_x * render_settings.resolution_percentage / 100)
    height = int(render_settings.resolution_y * render_settings.resolution_percentage / 100)
    with tempfile.TemporaryDirectory(prefix="dreamverse-render-") as folder:
        try:
            if params.get("kind") == "animation":
                start = int(params.get("frame_start", scene.frame_start))
                end = int(params.get("frame_end", scene.frame_end))
                scene.frame_start, scene.frame_end = start, end
                if hasattr(image, "media_type"):
                    image.media_type = "VIDEO"
                image.file_format = "FFMPEG"
                render_settings.ffmpeg.format = "MPEG4"
                render_settings.ffmpeg.codec = "H264"
                render_settings.use_file_extension = True
                render_settings.filepath = os.path.join(folder, "dreamverse_")
                bpy.ops.render.render(animation=True)
                files = [name for name in os.listdir(folder) if name.endswith(".mp4")]
                if not files:
                    raise RuntimeError("Blender wrote no MP4 file; check that its FFmpeg video output works.")
                with open(os.path.join(folder, files[0]), "rb") as handle:
                    data = handle.read()
                fps = render_settings.fps / render_settings.fps_base
                frames = end - start + 1
                return ({"mime": "video/mp4", "width": width, "height": height, "frame_start": start, "frame_end": end,
                         "fps": round(fps, 3), "duration_sec": round(frames / fps, 3), "engine": render_settings.engine}, data)
            frame = int(params.get("frame", scene.frame_current))
            scene.frame_set(frame)
            if hasattr(image, "media_type"):
                image.media_type = "IMAGE"
            image.file_format = "PNG"
            image.color_mode = "RGBA"
            render_settings.use_file_extension = False
            path = os.path.join(folder, "still.png")
            render_settings.filepath = path
            bpy.ops.render.render(write_still=True)
            with open(path, "rb") as handle:
                data = handle.read()
            return ({"mime": "image/png", "width": width, "height": height, "frame": frame, "engine": render_settings.engine}, data)
        finally:
            _restore(image, saved_image)
            _restore(render_settings, saved_render)
            scene.frame_start, scene.frame_end = saved_frames[1], saved_frames[2]
            scene.frame_set(saved_frames[0])
