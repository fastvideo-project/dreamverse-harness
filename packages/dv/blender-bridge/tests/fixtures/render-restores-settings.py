"""Run inside `blender -b --factory-startup --python <this file> -- <add-on parent folder>`: renders a two-frame animation
with the add-on's `commands.render` and prints, as one `CHANGED <json>` line, every render, FFmpeg and image setting the
render left different from the scene's own."""
import json
import sys

import bpy

sys.path.insert(0, sys.argv[sys.argv.index("--") + 1])
from addon import commands  # noqa: E402

scene = bpy.context.scene
render_settings = scene.render
render_settings.engine = "BLENDER_WORKBENCH"
render_settings.resolution_x = render_settings.resolution_y = 64
render_settings.resolution_percentage = 100
scene.frame_start, scene.frame_end, scene.frame_current = 1, 2, 1
# The user's own video output, which differs from the MPEG-4/H.264 output that the render switches to.
if hasattr(render_settings.image_settings, "media_type"):
    render_settings.image_settings.media_type = "VIDEO"
render_settings.image_settings.file_format = "FFMPEG"
render_settings.ffmpeg.format = "QUICKTIME"
render_settings.ffmpeg.codec = "QTRLE"


def snapshot():
    """Return every plain render, FFmpeg and image setting, keyed by `<group>.<property>`."""
    values = {}
    for group, target in (("render", render_settings), ("ffmpeg", render_settings.ffmpeg), ("image", render_settings.image_settings)):
        for prop in target.bl_rna.properties:
            if prop.identifier == "rna_type" or prop.type in ("POINTER", "COLLECTION"):
                continue
            value = getattr(target, prop.identifier)
            values[f"{group}.{prop.identifier}"] = value if isinstance(value, (str, int, float, bool)) else repr(tuple(value))
    return values


before = snapshot()
commands.render({"kind": "animation", "frame_start": 1, "frame_end": 2})
after = snapshot()
print("CHANGED " + json.dumps({name: [before[name], after[name]] for name in before if before[name] != after[name]}))
