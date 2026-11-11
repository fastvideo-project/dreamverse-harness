"""Run inside `blender -b --factory-startup --python <this file> -- <add-on parent folder> <output> <kind>`: sets the
scene's output to `<output>` (`png16`, `exr32`, `jpeg` or `qtrle`), renders a still or a two-frame animation (`<kind>`)
with the add-on's `commands.render` and prints, as one `CHANGED <json>` line, every render, FFmpeg and image setting the
render left different from the scene's own."""
import json
import sys

import bpy

package, output, kind = sys.argv[sys.argv.index("--") + 1:]
sys.path.insert(0, package)
from addon import commands  # noqa: E402

scene = bpy.context.scene
render_settings = scene.render
render_settings.engine = "BLENDER_WORKBENCH"
render_settings.resolution_x = render_settings.resolution_y = 64
render_settings.resolution_percentage = 100
scene.frame_start, scene.frame_end, scene.frame_current = 1, 2, 1
# The user's own output, which differs from the 8-bit PNG or MPEG-4/H.264 output that the render switches to.
image = render_settings.image_settings
if output == "qtrle":
    if hasattr(image, "media_type"):
        image.media_type = "VIDEO"
    image.file_format = "FFMPEG"
    render_settings.ffmpeg.format = "QUICKTIME"
    render_settings.ffmpeg.codec = "QTRLE"
else:
    image.file_format = {"png16": "PNG", "exr32": "OPEN_EXR", "jpeg": "JPEG"}[output]
    image.color_depth = {"png16": "16", "exr32": "32", "jpeg": "8"}[output]


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
commands.render({"kind": kind, "frame_start": 1, "frame_end": 2})
after = snapshot()
print("CHANGED " + json.dumps({name: [before[name], after[name]] for name in before if before[name] != after[name]}))
