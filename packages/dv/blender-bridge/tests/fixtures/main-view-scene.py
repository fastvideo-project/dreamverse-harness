"""Run inside a Blender with a window, `blender --factory-startup --python <this file> -- <add-on parent folder>` under
`xvfb-run`: opens a second main Blender window that shows a new scene without a camera, switches the first window's 3D
view to Quad View so that the second window holds the main 3D view, asks the add-on for a look of the camera view and
for the camera preset view while the timer's context scene keeps its camera, and prints one `RESULT <json>` line with
the look's error and the view change's error; it prints `ERROR <text>` instead when a step fails. Blender quits after
the line."""
import json
import sys
import traceback

import bpy

package = sys.argv[sys.argv.index("--") + 1]
sys.path.insert(0, package)
from addon import commands, navigate, viewport  # noqa: E402

step = {"index": 0}
answers = {}


def run():
    """Advance one step of the scenario per timer call; return the delay to the next step, or None after quitting."""
    index = step["index"]
    step["index"] += 1
    try:
        windows = bpy.context.window_manager.windows
        if index == 0:
            with bpy.context.temp_override(window=windows[0]):
                bpy.ops.wm.window_new_main()
            return 0.5
        if index == 1:
            area = next(area for area in windows[0].screen.areas if area.type == "VIEW_3D")
            region = next(region for region in area.regions if region.type == "WINDOW")
            with bpy.context.temp_override(window=windows[0], area=area, region=region):
                bpy.ops.screen.region_quadview()
            windows[1].scene = bpy.data.scenes.new("No camera")
            return 0.5
        if index == 2:
            if viewport.main_view()[0] != windows[1] or bpy.context.scene.camera is None:
                raise RuntimeError("The main 3D view must show the scene without a camera while the context scene has one.")
            viewport.start()
            commands.look("camera", lambda result, file_bytes=None, error=None: answers.update(look=error))
            answers["preset"] = navigate.apply({"action": "preset", "preset": "camera"})
        if "look" not in answers and index < 30:
            for window in windows:
                for area in window.screen.areas:
                    area.tag_redraw()
            return 0.1
        print("RESULT " + json.dumps({"look": answers.get("look"), "preset": answers["preset"]}), flush=True)
    except Exception:  # Any failure ends the run with its traceback on the ERROR line.
        print("ERROR " + traceback.format_exc().replace("\n", " | "), flush=True)
    viewport.stop()
    bpy.ops.wm.quit_blender()
    return None


bpy.app.timers.register(run, first_interval=1.5)
