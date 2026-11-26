"""Run one shot through Reactor's headless SDK."""

import asyncio
import json
import os
import re
import shutil
import sys
import threading
from time import monotonic
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen


class ClipError(Exception):
    """A bridge failure that can be shown in DreamVerse."""


async def download_saved_clip(session_id, request):
    """PixVerse saves the MP4 as step 1 because each DreamVerse shot queues one clip."""
    endpoint = Request(f"{request['apiBaseUrl']}/sessions/{quote(session_id, safe='')}/steps/1")
    endpoint.add_unredirected_header("Authorization", f"Bearer {request['apiKey']}")

    def files():
        with urlopen(endpoint, timeout=10) as response:
            if response.status == 202:
                return None
            return json.load(response)["files"]

    def download(url):
        if urlsplit(url).scheme != "https":
            raise ClipError("Reactor returned a non-HTTPS clip URL.")
        # The signed URL carries its own authorization.
        with urlopen(url, timeout=10) as response, open(request["output"], "wb") as output:
            shutil.copyfileobj(response, output)

    while True:
        saved = await asyncio.to_thread(files)
        if saved is not None:
            for entry in saved:
                if entry["name"] == "output.mp4":
                    await asyncio.to_thread(download, entry["url"])
                    return
            raise ClipError("Reactor finished the saved step without an MP4.")
        await asyncio.sleep(1)


async def render(request, phase):
    """Play the requested model and download its recording while its session is open."""
    from reactor_sdk import Reactor

    reactor = Reactor(
        model_name=request["model"],
        api_key=request["apiKey"],
        api_url=request["apiBaseUrl"],
        max_session_duration_seconds=request["timeoutSeconds"],
    )
    messages = asyncio.Queue()
    workflow = request["workflow"]
    events = {
        "clip_generated", "clip_failed", "clip_stopped",
        "generation_complete", "generation_failed",
    }
    if workflow["kind"] == "chunks":
        events.add("state" if workflow["frameCount"] == "session-state" else "chunk_complete")

    @reactor.on_message
    def on_message(message):
        if message.get("type") in events:
            messages.put_nowait(message)

    @reactor.on_status("disconnected")
    def on_disconnect(_status):
        messages.put_nowait({"type": "disconnected"})

    async def next_message():
        message = await messages.get()
        if message["type"] == "disconnected":
            raise ClipError("Reactor disconnected before the clip was ready.")
        return message["type"], message.get("data") or {}

    async def wait_for_clip(kind, clip_id):
        while True:
            event, data = await next_message()
            if (data.get("clip") or {}).get("clip_id") != clip_id:
                continue
            if event in {"clip_failed", "clip_stopped"}:
                raise ClipError("Reactor could not finish the queued clip.")
            if event == kind:
                return data["clip"]

    async def upload(asset):
        return await reactor.upload_file(asset["path"], name=asset["name"], mime_type=asset["mime"])

    async def queue():
        """PixVerse builds a world, queues one clip, and saves the finished MP4 as a step of the session."""
        data = {"prompt": request["prompt"], "seconds": request["seconds"]}
        world = {
            "prompt": request.get("scene") or request["prompt"],
            "aspect_ratio": request["aspect"],
        }
        if request["images"]:
            world["reference_images"] = [await upload(asset) for asset in request["images"]]
        await reactor.send_command("create_world", world)

        phase("generation")
        queued = await reactor.send_command("enqueue", data)
        if not queued or queued["type"] != "clip_queued":
            raise ClipError("Reactor did not confirm the clip enqueue.")
        await wait_for_clip("clip_generated", queued["data"]["clip"]["clip_id"])
        phase("download")
        await download_saved_clip(reactor.session_id, request)

    async def take():
        await reactor.send_command("set_avatar_image", {"avatar_image": await upload(request["firstFrame"])})
        await reactor.send_command("set_script", {"script": request["prompt"]})
        if request.get("scene"):
            await reactor.send_command("set_prompt", {"prompt": request["scene"]})
        await reactor.send_command("set_seed", {"seed": request["seed"]})
        await reactor.send_command("set_duration_seconds", {"duration_seconds": request["seconds"]})
        phase("generation")
        await reactor.send_command("start", {})
        while True:
            event, data = await next_message()
            if event == "generation_failed":
                raise ClipError("Reactor could not finish the take.")
            if event == "generation_complete":
                return data["seconds_sent"]

    async def chunks(workflow):
        await reactor.send_command("set_seed", {"seed": request["seed"]})
        if workflow.get("resolution"):
            await reactor.send_command("set_resolution", {"resolution": request["resolution"]})
        conditioning = {"prompt": request["prompt"]}
        if workflow.get("image") == "set_conditioning" and "firstFrame" in request:
            conditioning["image"] = await upload(request["firstFrame"])
            await reactor.send_command("set_conditioning", conditioning)
        else:
            await reactor.send_command(workflow["prompt"], conditioning)
            if "firstFrame" in request:
                await reactor.send_command("set_image", {"image": await upload(request["firstFrame"])})

        phase("generation")
        started = await reactor.send_command("start", {})
        fps = ((started or {}).get("data") or {}).get("fps") or workflow.get("fps")
        if not isinstance(fps, (int, float)) or fps <= 0:
            raise ClipError("Reactor did not report the frame rate of the stream.")
        cumulative = workflow["frameCount"] == "cumulative"
        frames = 0
        while frames / fps < request["seconds"]:
            event, data = await next_message()
            if event == "state":
                frames = data["current_frame"]
            elif event == "chunk_complete":
                emitted = data["frames_emitted"]
                frames = emitted if cumulative else frames + emitted
            elif event in {"generation_complete", "generation_failed"}:
                raise ClipError("The Reactor stream ended before the requested duration.")
        return request["seconds"]

    try:
        await reactor.connect()
        phase("setup")
        if workflow["kind"] == "queue":
            await queue()
            seconds = None
        elif workflow["kind"] == "take":
            seconds = await take()
        else:
            seconds = await chunks(workflow)
        if seconds is not None:
            phase("capture")
            clip = await reactor.request_clip(seconds)
            phase("download")
            await reactor.download(clip, request["output"], ready_timeout=request["timeoutSeconds"])
        phase("closing")
    finally:
        try:
            await asyncio.wait_for(reactor.disconnect(), timeout=10)
        finally:
            reactor.close()


async def run(request):
    """Treat closure of DreamVerse's stdin pipe as a request to cancel."""
    loop = asyncio.get_running_loop()
    stage = "connection"
    since = monotonic()
    timings = {}

    def phase(next_stage):
        nonlocal stage, since
        now = monotonic()
        timings[f"reactor_{stage}_s"] = round(now - since, 3)
        stage, since = next_stage, now

    task = asyncio.create_task(render(request, phase))

    def watch_parent():
        os.read(sys.stdin.fileno(), 1)
        if not loop.is_closed():
            loop.call_soon_threadsafe(task.cancel)

    threading.Thread(target=watch_parent, daemon=True).start()
    try:
        await asyncio.wait_for(task, timeout=request["timeoutSeconds"])
    except (asyncio.TimeoutError, TimeoutError) as error:
        raise ClipError(f"Reactor timed out during {stage}.") from error
    phase("done")
    return timings


def main():
    """Return provider error codes without logging prompts, credentials or signed URLs."""
    try:
        timings = asyncio.run(run(json.loads(sys.stdin.buffer.readline())))
    except ModuleNotFoundError:
        message = "Install reactor-sdk in the Python environment configured for Reactor."
    except asyncio.CancelledError:
        return 1
    except ClipError as error:
        message = str(error)
    except Exception as error:
        code = getattr(error, "code", None)
        if isinstance(code, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,80}", code):
            message = f"Reactor SDK failed with code {code}."
        else:
            message = "Reactor SDK failed during clip generation or capture."
    else:
        print(f"DV_REACTOR_TIMINGS {json.dumps(timings)}", flush=True)
        return 0
    print(f"DV_REACTOR_ERROR {message}", flush=True)
    return 1


if __name__ == "__main__":
    sys.exit(main())
