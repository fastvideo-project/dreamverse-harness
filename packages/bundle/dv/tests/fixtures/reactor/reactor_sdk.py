"""Replace the external Reactor SDK transport in the DreamVerse bundle test."""

import asyncio
import io
import json
import os
import sys
from pathlib import Path


def log(event, **data):
    with open(os.environ["DV_REACTOR_TRACE"], "a", encoding="utf8") as stream:
        stream.write(json.dumps({"event": event, **data}) + "\n")


class Progress(dict):
    def __getitem__(self, key):
        value = super().__getitem__(key)
        if key in {"frames_emitted", "current_frame"}:
            log("read_progress", field=key, frames=value)
        return value


class Reactor:
    def __init__(self, *, model_name, api_key, api_url, max_session_duration_seconds):
        assert api_key == "rk_fixture"
        assert "REACTOR_API_KEY" not in os.environ
        log("init", model=model_name, lifetime=max_session_duration_seconds, api_url=api_url)
        self.clip = {"clip_id": "fixture", "seconds": 5.875}
        self.model = model_name
        self.api_url = api_url
        self.seconds = None
        self.session_id = "fixture-session"
        if self.model == "reactor/pixverse-r2-director":
            sys.modules["__main__"].urlopen = self.open_url

    def open_url(self, request, *, timeout):
        assert timeout == 10
        if isinstance(request, str):
            assert request == "https://files.example.test/output.mp4?signed=fixture"
            log("download_saved_output")
            data = Path(os.environ["DV_REACTOR_RECORDING"]).read_bytes()
        else:
            assert request.full_url == f"{self.api_url}/sessions/fixture-session/steps/1"
            assert request.get_header("Authorization") == "Bearer rk_fixture"
            log("get_saved_step")
            data = json.dumps({"files": [{
                "name": "output.mp4", "url": "https://files.example.test/output.mp4?signed=fixture",
            }]}).encode()
        response = io.BytesIO(data)
        response.status = 200
        return response

    def on_message(self, handler):
        self.message = handler
        return handler

    def on_status(self, status):
        assert status == "disconnected"
        return lambda handler: handler

    async def connect(self):
        log("connect")

    async def send_command(self, command, data):
        log(command, **data)
        if command == "set_duration_seconds":
            self.seconds = data["duration_seconds"]
        if command == "start":
            if self.model == "reactor/ltx2":
                self.message({"type": "generation_complete", "data": {"seconds_sent": self.seconds}})
            else:
                mode = os.environ.get("DV_REACTOR_MODE")
                if self.model == "reactor/helios":
                    self.message({"type": "state", "data": Progress(current_frame=0)})
                    for index, total in enumerate(range(33, 199, 33)):
                        emitted = 33 if mode == "helios-per-chunk" else total
                        self.message({"type": "chunk_complete", "data": Progress(chunk_index=index, frames_emitted=emitted)})
                        self.message({"type": "state", "data": Progress(current_frame=total)})
                    self.message({"type": "generation_failed"})
                elif mode == "chunks":
                    counts = (33, 66, 99, 132) if self.model == "reactor/longlive-v2" else (0, 44, 44, 44)
                    for count in counts:
                        self.message({"type": "chunk_complete", "data": Progress(frames_emitted=count)})
                    self.message({"type": "generation_failed"})
                else:
                    self.message({"type": "chunk_complete", "data": {"frames_emitted": 192}})
                return {"type": "generation_started", "data": {"fps": 24}}
        if command == "enqueue":
            self.clip["seconds"] = data["seconds"]
            if os.environ.get("DV_REACTOR_MODE") == "wait":
                await asyncio.Future()
            self.message({"type": "clip_generated", "data": {"clip": {"clip_id": "other"}}})
            kind = "clip_failed" if os.environ.get("DV_REACTOR_MODE") == "fail" else "clip_generated"
            self.message({"type": kind, "data": {"clip": self.clip}})
            return {"type": "clip_queued", "data": {"clip": self.clip}}
        return None

    async def upload_file(self, path, *, name, mime_type):
        assert Path(path).is_file()
        ref = {"name": name, "mime_type": mime_type}
        log("upload", **ref)
        return ref

    async def request_clip(self, seconds):
        log("capture", seconds=seconds)
        return "fixture recording"

    async def download(self, clip, path, *, ready_timeout):
        assert clip == "fixture recording"
        assert ready_timeout == 360
        Path(path).write_bytes(Path(os.environ["DV_REACTOR_RECORDING"]).read_bytes())

    async def disconnect(self):
        log("disconnect")

    def close(self):
        log("close")
