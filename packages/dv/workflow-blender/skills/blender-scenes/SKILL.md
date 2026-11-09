---
name: blender-scenes
description: "The procedure for building, checking and rendering a 3D scene in the Blender that the user connected to the harness: read the scene, change it in small Python steps, look at the result, and render stills or animations into the project. For requests such as 'build a scene in Blender', 'add a camera move', 'light this set', or 'render this shot from Blender'."
---

# Blender scenes

The user's own Blender is connected to the harness through the DreamVerse add-on, and the user watches its viewport in the Blender tab of the right Sidebar while you work. `dv_blender_scene` reads the scene, `dv_blender_run` runs Python in Blender, `dv_blender_look` shows you the viewport or the camera view, and `dv_blender_render` and `dv_blender_animation_render` put renders into the project. When the user wants to watch Blender on the canvas, `dv_blender_viewport` puts the live viewport there as a node, and `dv_canvas_node_remove` takes that node off; opening it lets the user orbit, pan and zoom the view.

## When to use it

The user asks for something built, changed or rendered in Blender. When a Blender tool says that no Blender is connected, ask the user to connect it in the Blender tab and wait; do not describe the scene from memory.

## 1. Read before you change

- Call `dv_blender_scene` first, and again whenever the user may have changed the scene by hand. Use the object names it returns; never guess names.
- Note the render engine, the resolution, the frame range and the frames per second before you plan a render.

## 2. Change in small steps

- One `dv_blender_run` call per visible change: add an object, set a material, place a light, key a camera move. Keep each script short, and name every object you create.
- Use `bpy.data` and object properties rather than `bpy.ops` where both work; operators depend on the selection and the active area.
- Return what you need with `result = {...}`; a traceback means the call failed after the lines before the error ran, so read the scene again before you retry.
- Each call is one undo step in Blender, so the user can take a change back with Ctrl+Z.
- When the tool says that code from the harness is switched off, you can still read and look; ask the user to switch it on in the add-on's panel if they want you to make changes.

## 3. Look after visible changes

- Call `dv_blender_look` after a change the user will see; check the shapes, the framing and the light, and fix what looks wrong before you report.
- Use `view: camera` to check the framing of a shot before any render.

## 4. Render into the project

- `dv_blender_render` renders one frame as an image; use it for a still or for the reference image of a shot.
- `dv_blender_animation_render` renders a frame range as an MP4 video that the timeline can use. Keep ranges short and the resolution modest unless the user asks for more, because Blender is busy until it finishes and a long render can take many minutes.
- Report each render's record to the user; ask before re-rendering a long animation.
