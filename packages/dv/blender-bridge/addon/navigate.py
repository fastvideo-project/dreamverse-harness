"""View changes that a viewer of the harness sends for the main 3D view (the largest 3D viewport across all Blender
windows): orbit, pan, zoom, the standard views and framing. They move only the view, never the scene, and run on
Blender's main thread. ``orbit`` and ``pan`` take the drag as fractions of the shown picture's width (``dx``, rightward)
and height (``dy``, downward).
"""

import math

import bpy
from bpy_extras import view3d_utils
from mathutils import Euler, Quaternion, Vector

from . import viewport

# A drag across the whole picture width orbits half a turn, as a drag across Blender's viewport roughly does.
ORBIT_PER_WIDTH = math.pi
ZOOM_PER_STEP = 1.2
MIN_DISTANCE = 1e-3

# View rotations (view to world) of the standard views, as Blender's numpad views look at the scene.
PRESETS = {
    "front": (math.pi / 2, 0.0, 0.0),
    "back": (math.pi / 2, 0.0, math.pi),
    "right": (math.pi / 2, 0.0, math.pi / 2),
    "left": (math.pi / 2, 0.0, -math.pi / 2),
    "top": (0.0, 0.0, 0.0),
    "bottom": (math.pi, 0.0, 0.0),
}


def orbit_rotation(rotation, dx, dy):
    """Turntable orbit: turn about the world Z axis by the horizontal drag and about the view's X axis by the vertical
    drag, so dragging right or down turns the scene with the pointer, as in Blender."""
    yaw = Quaternion((0.0, 0.0, 1.0), -dx * ORBIT_PER_WIDTH)
    pitch = Quaternion((1.0, 0.0, 0.0), -dy * ORBIT_PER_WIDTH)
    return (yaw @ rotation @ pitch).normalized()


def _leave_camera(view):
    # Orbiting or panning the camera view leaves it, as in Blender, instead of moving the scene camera.
    if view.view_perspective == "CAMERA":
        view.view_perspective = "PERSP"


def apply(command):
    """Apply one view change; returns an error sentence when it cannot apply, else None."""
    target = viewport.main_view()
    if target is None:
        return "Blender has no 3D viewport open."
    window, area, region = target
    view = region.data
    action = command.get("action")
    if action == "orbit":
        _leave_camera(view)
        view.view_rotation = orbit_rotation(view.view_rotation, float(command["dx"]), float(command["dy"]))
    elif action == "pan":
        _leave_camera(view)
        center = Vector((region.width / 2, region.height / 2))
        moved = center + Vector((float(command["dx"]) * region.width, -float(command["dy"]) * region.height))
        start = view3d_utils.region_2d_to_location_3d(region, view, center, view.view_location)
        end = view3d_utils.region_2d_to_location_3d(region, view, moved, view.view_location)
        view.view_location = view.view_location + (start - end)
    elif action == "zoom":
        view.view_distance = max(MIN_DISTANCE, view.view_distance * ZOOM_PER_STEP ** float(command["steps"]))
    elif action == "preset":
        preset = command.get("preset")
        if preset == "camera":
            if bpy.context.scene.camera is None:
                return "The scene has no active camera."
            view.view_perspective = "CAMERA"
        elif preset in PRESETS:
            _leave_camera(view)
            view.view_rotation = Euler(PRESETS[preset]).to_quaternion()
        else:
            return "Unknown view %r." % preset
    elif action == "frame":
        with bpy.context.temp_override(window=window, area=area, region=region):
            if command.get("target") == "selected":
                bpy.ops.view3d.view_selected()
            else:
                bpy.ops.view3d.view_all()
    else:
        return "Unknown view change %r." % action
    area.tag_redraw()
    return None
