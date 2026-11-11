"""Run inside a Blender with a window, `blender --factory-startup --python <this file> -- <add-on parent folder> [quad]`
under `xvfb-run`: opens a second Blender window (with `quad`, switches the first window's 3D view to Quad View instead),
streams the add-on's viewport while the windows redraw, orbits the main 3D view with the add-on's `navigate.apply`, and
prints one `RESULT <json>` line with the number of windows, the 3D view areas and regions that the streamed frames came
from, and the 3D view areas and regions whose view the orbit turned; it prints `ERROR <text>` instead when a step fails.
Blender quits after the line."""
import json
import sys
import traceback

import bpy

package = sys.argv[sys.argv.index("--") + 1]
quad = sys.argv[sys.argv.index("--") + 2:] == ["quad"]
sys.path.insert(0, package)
from addon import navigate, viewport  # noqa: E402

frame_areas = []
frame_regions = []
read_view = viewport._read_view


def spy(region, max_width):
    """Record the area and region that the draw handler streams a frame from, then draw the frame as the add-on does."""
    frame_areas.append(bpy.context.area.as_pointer())
    frame_regions.append(region.as_pointer())
    return read_view(region, max_width)


viewport._read_view = spy


def view_areas():
    """Return every 3D view area of every window."""
    return [area for window in bpy.context.window_manager.windows for area in window.screen.areas if area.type == "VIEW_3D"]


def view_regions():
    """Return every ``WINDOW`` region of every 3D view area, which holds one view each."""
    return [region for area in view_areas() for region in area.regions if region.type == "WINDOW"]


step = {"index": 0}


def run():
    """Advance one step of the scenario per timer call; return the delay to the next step, or None after quitting."""
    index = step["index"]
    step["index"] += 1
    try:
        if index == 0:
            window = bpy.context.window_manager.windows[0]
            if quad:
                area = next(area for area in window.screen.areas if area.type == "VIEW_3D")
                region = next(region for region in area.regions if region.type == "WINDOW")
                with bpy.context.temp_override(window=window, area=area, region=region):
                    bpy.ops.screen.region_quadview()
            else:
                with bpy.context.temp_override(window=window):
                    bpy.ops.wm.window_new()
            return 0.5
        if index == 1:
            viewport.configure(lambda header, _payload: viewport.ack(header["seq"]), 30, 320, 50, 30, 320, 50)
            viewport.start()
            viewport.set_streaming(True)
            return 0.1
        if index < 20:
            for area in view_areas():
                area.tag_redraw()
            return 0.1
        before = {area.as_pointer(): tuple(area.spaces.active.region_3d.view_rotation) for area in view_areas()}
        before_regions = {region.as_pointer(): tuple(region.data.view_rotation) for region in view_regions()}
        error = navigate.apply({"action": "orbit", "dx": 0.25, "dy": 0.0})
        if error is not None:
            raise RuntimeError(error)
        moved = sorted(area.as_pointer() for area in view_areas()
                       if tuple(area.spaces.active.region_3d.view_rotation) != before[area.as_pointer()])
        moved_regions = sorted(region.as_pointer() for region in view_regions()
                               if tuple(region.data.view_rotation) != before_regions[region.as_pointer()])
        print("RESULT " + json.dumps({
            "windows": len(bpy.context.window_manager.windows), "frames": len(frame_areas),
            "frame_areas": sorted(set(frame_areas)), "moved_areas": moved,
            "frame_regions": sorted(set(frame_regions)), "moved_regions": moved_regions,
        }), flush=True)
    except Exception:  # Any failure ends the run with its traceback on the ERROR line.
        print("ERROR " + traceback.format_exc().replace("\n", " | "), flush=True)
    viewport.stop()
    bpy.ops.wm.quit_blender()
    return None


bpy.app.timers.register(run, first_interval=1.5)
