"""Run inside `blender -b --factory-startup --python <this file> -- <add-on parent folder> <connection string>`: enables
the add-on, connects it to the harness, and calls its timer callback by hand, because Blender in the background runs no
timers, until the harness closes the link or 50 s pass."""
import sys
import time

import addon_utils

parent, connection = sys.argv[sys.argv.index("--") + 1:][:2]
sys.path.insert(0, parent)
import addon  # noqa: E402

# Blender before 4.2 enables only add-ons with bl_info; the add-on ships the 4.2 extension manifest instead.
addon.bl_info = {"name": "DreamVerse", "blender": (4, 0, 0)}
module = addon_utils.enable("addon", default_set=True, handle_error=None)
preferences = module._prefs()
preferences.connection = connection
preferences.auto_connect = False
controller = module.controller
controller.connect()
linked = False
deadline = time.time() + 50
while time.time() < deadline:
    interval = controller.tick()
    linked = linked or controller.link is not None
    if linked and controller.link is None:
        break
    time.sleep(min(interval, 0.05))
