"""DreamVerse add-on: connects this Blender to a DreamVerse harness, so the harness's agent can read the scene, run
Python, look at the viewport and render into a project, and the harness's Blender tab shows the viewport live.

Blender opens the connection to the harness (the link), so it works when Blender runs on another machine than the
harness, through the same SSH tunnel as the browser, and on the harness's own machine. Paste the connection string
that the harness's Blender tab shows into the add-on's panel (3D viewport sidebar, DreamVerse tab) and press Connect.
"""

import json
import queue
import threading

import bpy
from bpy.app.handlers import persistent

from . import commands, viewport
from .link import HandshakeError, Link
from .protocol import ConnectionStringError, encode_binary, is_local_host, parse_connection

ADDON_VERSION = "0.1.0"
CHUNK_BYTES = 1 << 20
# Close codes after which reconnecting would only repeat the refusal.
FINAL_CLOSE_CODES = {4000, 4001}


def _prefs():
    return bpy.context.preferences.addons[__package__].preferences


class _Controller:
    """The link and its state; every method runs on Blender's main thread except the link's callbacks."""

    def __init__(self):
        self.link = None
        self.status = "Not connected"
        self.inbox = queue.Queue()
        self.connecting = False
        self.retry = False

    # Link callbacks, on the link's reader thread.
    def on_message(self, kind, data):
        self.inbox.put(("message", kind, data))

    def on_close(self, code, reason):
        self.inbox.put(("closed", code, reason))

    def connect(self):
        if self.link is not None or self.connecting:
            return
        prefs = _prefs()
        try:
            target = parse_connection(prefs.connection)
        except ConnectionStringError as error:
            self.status = str(error)
            return
        if not is_local_host(target["host"]) and not bpy.app.online_access:
            self.status = "Allow Online Access in Preferences > System to connect to %s." % target["host"]
            return
        self.connecting = True
        self.retry = prefs.auto_connect
        self.status = "Connecting to %s:%d..." % (target["host"], target["port"])
        link = Link(target["host"], target["port"], target["path"], target["token"], target["secure"], self.on_message, self.on_close)

        def open_link():
            try:
                link.connect()
                self.inbox.put(("connected", link))
            except HandshakeError as error:
                self.inbox.put(("failed", error.status, str(error)))
            except OSError as error:
                self.inbox.put(("failed", 0, "Cannot reach the harness: %s" % error))

        threading.Thread(target=open_link, name="dreamverse-connect", daemon=True).start()

    def disconnect(self):
        self.retry = False
        if self.link is not None:
            self.link.close(1000, "disconnected in Blender")
        self._drop("Not connected")

    def _drop(self, status):
        self.link = None
        self.connecting = False
        self.status = status
        viewport.stop()
        _redraw_panels()

    def send_state(self, kind="state"):
        if self.link is None:
            return
        self.link.send_text(json.dumps({
            "type": kind, "blender_version": bpy.app.version_string, "addon_version": ADDON_VERSION,
            "file": bpy.path.basename(bpy.data.filepath), "allow_code": bool(_prefs().allow_code),
        }))

    def send_frame(self, header, payload):
        if self.link is not None:
            self.link.send_binary(encode_binary(header, payload))

    def tick(self):
        """Drain the link's events; returns the next timer interval."""
        while True:
            try:
                event = self.inbox.get_nowait()
            except queue.Empty:
                break
            kind = event[0]
            if kind == "connected":
                self.link, self.connecting = event[1], False
                self.status = "Connected"
                prefs = _prefs()
                viewport.configure(self.send_frame, prefs.max_fps, prefs.max_width, prefs.jpeg_quality)
                viewport.start()
                self.send_state("hello")
                _redraw_panels()
            elif kind == "failed":
                self.connecting = False
                self.status = "Wrong pairing token: copy the connection string again." if event[1] == 401 else event[2]
                if event[1] in (401, 403):
                    self.retry = False
                _redraw_panels()
            elif kind == "closed":
                code, reason = event[1], event[2]
                if code in FINAL_CLOSE_CODES:
                    self.retry = False
                self._drop("Disconnected: %s" % (reason or "the connection ended"))
            elif kind == "message" and self.link is not None:
                self._handle(event[1], event[2])
        if self.retry and self.link is None and not self.connecting:
            self.connect()
            return 3.0
        return 0.05

    def _handle(self, kind, data):
        if kind != "text":
            return
        try:
            message = json.loads(data)
        except ValueError:
            return
        if message.get("type") == "stream":
            viewport.set_streaming(bool(message.get("on")))
        elif message.get("type") == "frame_ack":
            viewport.ack(message.get("seq"))
        elif message.get("type") == "request":
            self._request(str(message.get("id")), message.get("op"), message.get("params") or {})

    def _request(self, request_id, op, params):
        link = self.link

        def reply(result, file_bytes=None, error=None):
            if link is not self.link:
                return
            if error is not None:
                link.send_text(json.dumps({"type": "response", "id": request_id, "ok": False, "error": error}))
                return
            if file_bytes is not None:
                for offset in range(0, len(file_bytes), CHUNK_BYTES):
                    link.send_binary(encode_binary({"kind": "chunk", "id": request_id}, file_bytes[offset:offset + CHUNK_BYTES]))
            link.send_text(json.dumps({"type": "response", "id": request_id, "ok": True, "result": result}))

        try:
            if op == "scene":
                reply(commands.scene_info())
            elif op == "run":
                if not _prefs().allow_code:
                    reply(None, error="Code from the harness is switched off in the DreamVerse add-on.")
                else:
                    reply(commands.run_code(str(params.get("code", ""))))
            elif op == "look":
                commands.look("camera" if params.get("view") == "camera" else "viewport", reply)
            elif op == "render":
                result, data = commands.render(params)
                reply(result, file_bytes=data)
            else:
                reply(None, error="This add-on version does not know the request %r; update the add-on." % op)
        except Exception as error:  # Every failure goes back to the harness as the call's error.
            reply(None, error=str(error))


controller = _Controller()


def _redraw_panels():
    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type == "VIEW_3D":
                area.tag_redraw()


def _tick():
    return controller.tick()


def _on_prefs_change(_self, _context):
    controller.send_state()
    prefs = _prefs()
    viewport.configure(controller.send_frame if controller.link else None, prefs.max_fps, prefs.max_width, prefs.jpeg_quality)


@persistent
def _on_file_change(_dummy):
    controller.send_state()


class DreamVersePreferences(bpy.types.AddonPreferences):
    bl_idname = __package__

    connection: bpy.props.StringProperty(
        name="Connection string", subtype="PASSWORD",
        description="The connection string from the harness's Blender tab: the harness address, #, and the pairing token")
    auto_connect: bpy.props.BoolProperty(
        name="Reconnect automatically", default=True,
        description="Connect when Blender starts and reconnect when the connection drops")
    allow_code: bpy.props.BoolProperty(
        name="Allow code from the harness", default=True, update=_on_prefs_change,
        description="Let the harness's agent run Python in this Blender. Python can do anything your user account can")
    max_fps: bpy.props.IntProperty(name="Viewport frames per second", default=10, min=1, max=30, update=_on_prefs_change)
    max_width: bpy.props.IntProperty(name="Viewport frame width", default=1280, min=320, max=3840, update=_on_prefs_change)
    jpeg_quality: bpy.props.IntProperty(name="Viewport JPEG quality", default=70, min=10, max=95, update=_on_prefs_change)

    def draw(self, _context):
        layout = self.layout
        layout.prop(self, "connection")
        layout.prop(self, "auto_connect")
        layout.prop(self, "allow_code")
        column = layout.column(heading="Viewport stream")
        column.prop(self, "max_fps")
        column.prop(self, "max_width")
        column.prop(self, "jpeg_quality")


class DREAMVERSE_OT_connect(bpy.types.Operator):
    bl_idname = "dreamverse.connect"
    bl_label = "Connect"
    bl_description = "Connect this Blender to the DreamVerse harness"

    def execute(self, _context):
        controller.connect()
        return {"FINISHED"}


class DREAMVERSE_OT_disconnect(bpy.types.Operator):
    bl_idname = "dreamverse.disconnect"
    bl_label = "Disconnect"
    bl_description = "Disconnect this Blender from the DreamVerse harness"

    def execute(self, _context):
        controller.disconnect()
        return {"FINISHED"}


class DREAMVERSE_PT_panel(bpy.types.Panel):
    bl_label = "DreamVerse"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "DreamVerse"

    def draw(self, _context):
        layout = self.layout
        prefs = _prefs()
        layout.label(text=controller.status, icon="LINKED" if controller.link else "UNLINKED")
        layout.prop(prefs, "connection", text="")
        row = layout.row()
        if controller.link is None:
            row.operator(DREAMVERSE_OT_connect.bl_idname, icon="PLAY")
        else:
            row.operator(DREAMVERSE_OT_disconnect.bl_idname, icon="CANCEL")
        layout.prop(prefs, "allow_code")
        if prefs.allow_code:
            box = layout.box()
            box.label(text="The harness's agent can run Python here.", icon="INFO")


CLASSES = (DreamVersePreferences, DREAMVERSE_OT_connect, DREAMVERSE_OT_disconnect, DREAMVERSE_PT_panel)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)
    bpy.app.timers.register(_tick, first_interval=1.0, persistent=True)
    bpy.app.handlers.load_post.append(_on_file_change)
    bpy.app.handlers.save_post.append(_on_file_change)
    prefs = _prefs()
    if prefs.auto_connect and prefs.connection:
        controller.retry = True


def unregister():
    controller.disconnect()
    if bpy.app.timers.is_registered(_tick):
        bpy.app.timers.unregister(_tick)
    for handlers in (bpy.app.handlers.load_post, bpy.app.handlers.save_post):
        if _on_file_change in handlers:
            handlers.remove(_on_file_change)
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)
