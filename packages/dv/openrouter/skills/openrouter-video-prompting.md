# OpenRouter video prompts

OpenRouter video models (provider `openrouter`) render a shot in the cloud through OpenRouter, billed by the provider. Each configured model offers task `t2v`; `ref2v` (one or more reference images) when OpenRouter lists image input for it; and `i2v` (one `first_frame` image) and `fl2v` (a `first_frame` and a `last_frame` image) when OpenRouter lists endpoint images for it. A `ref2v` shot takes no first or last frame.

## No audio or video references for now

OpenRouter video models take no audio or video references for now; a shot render with an audio or video reference is refused before anything is sent. When the user wants a shot that follows a voice, a sound or a clip, tell the user that OpenRouter video models cannot take audio or video references yet. Image references work with task `ref2v`.

## Writing the prompt

- Describe the subject, the action, the setting, the camera and the light in plain sentences.
- Cite a reference image as `@[<label>](dv:asset/<AssetId>)`, such as `@[Mia front](dv:asset/a1b2)`, and put every cited asset in `inputs.reference`; the provider sends the citation's label in its place, so give each image a label that names what it shows.
- Cite an endpoint image as `@[first frame](dv:input/first_frame)` or `@[last frame](dv:input/last_frame)`; the provider sends the citation's label in its place, and the image conditions the endpoint even when the prompt does not cite it.
- Choose the duration, aspect ratio and resolution from the model's schema (`dv_models_get`); OpenRouter models take only the listed durations. Set `extra.generate_audio` only when the schema lists it.
- Stopping a render stops local monitoring only; the paid cloud job keeps running.
