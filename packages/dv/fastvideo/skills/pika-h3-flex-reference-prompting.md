# Pika H3 Flex reference prompts

Task `ref2v` uses the separately configured Pika reference pipeline (`transformer_ref/`). Supply reference media through the `reference` role in prompt order. At least one image or video is required; audio alone is insufficient. Read the configured schema for total and per-media limits, duration and resolution. This task accepts no first-frame or last-frame input.

Cite images, videos and audio as `@[label](dv:asset/<asset ID>)`. The provider numbers each type in backend order as `<Picture N>`, `<Video N>` and `<Audio N>`. A video with sound also takes an audio number before explicit audio files. Describe scene action, camera movement, dialogue, soundscape and music, and state how each reference contributes to the output.

An unavailable reference task means the deployment has not enabled it. Model capability and server startup configuration are separate: the text/keyframe pipeline cannot serve native reference requests.
