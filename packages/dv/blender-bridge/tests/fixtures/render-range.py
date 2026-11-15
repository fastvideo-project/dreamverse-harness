"""Run inside `blender -b --factory-startup --python <this file> -- <add-on parent folder> <params json>`: gives the
scene the frame range 1 to 2, renders an animation with the add-on's `commands.render` and `<params json>`, and prints
one `RESULT <json>` line with the render's result or one `ERROR <message>` line with the error it raised."""
import json
import sys

import bpy

package, params = sys.argv[sys.argv.index("--") + 1:]
sys.path.insert(0, package)
from addon import commands  # noqa: E402

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.render.resolution_x = scene.render.resolution_y = 64
scene.render.resolution_percentage = 100
scene.frame_start, scene.frame_end, scene.frame_current = 1, 2, 1
try:
    result, _data = commands.render({"kind": "animation", **json.loads(params)})
    print("RESULT " + json.dumps(result))
except Exception as error:  # noqa: BLE001 - the spec reads any error the render raises
    print(f"ERROR {error}")
