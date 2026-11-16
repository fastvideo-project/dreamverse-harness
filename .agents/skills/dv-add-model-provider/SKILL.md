---
name: dv-add-model-provider
description: Use to add a provider plugin, a model, or a server to the DreamVerse model catalog @dv/models. For coding agents.
---

# Add a DreamVerse model provider

This skill is for coding agents that change this repository. The app agent uses the runtime skill `video-model-selection`.

Use this skill to connect a provider to the DreamVerse model catalog `@dv/models`. A provider plugin registers model entries into `ctx.dvModels`. Do not edit `@dv/models` to add a provider, a model, or a server.

This skill uses these terms:

- **Provider**: a video generation system, such as FastVideo, fal, or SGLang.
- **Server**: one running backend of a provider.
- **Provider plugin**: a DSH plugin package that connects one provider to `ctx.dvModels`.
- **Entry**: one `ModelEntry`. An entry is one model of one provider for one task.
- **Key**: the four entry fields `modality`, `task`, `provider` and `model`.

The example is the provider plugin `@dv/fastvideo` in `packages/dv/fastvideo/`. Use its files as the example. Do not copy its model data. FastVideo publishes the durations, frame counts and frame sizes of each server as `video_output_capabilities` on `GET /v1/model_info`, so `@dv/fastvideo` reads them from the server; it reads the served alias and the reference limits of each server from the validated `modelFacts` config of that server. `@dv/uniserve` in `packages/dv/uniserve/` reads the limits from its server.

## No compatibility code

`@dv/models` has one key format and one entry type. Do not add aliases, adapters, or fallback code for other catalog formats.

## Read first

1. Read `packages/dv/models/README.md`.
2. In that README, read the sections "Model keys", "Model entries", and "Render requests and render streams".
3. Read the sections "The `dvModels` service", "What a provider plugin owns", and "Add a provider or a model".
4. Read the section "Known Limitations and Deferred Work".
5. Read `packages/dv/models/src/types.ts`. The JSDoc of `ModelEntry` is the contract that each entry must obey.
6. Read `packages/dv/fastvideo/src/index.ts` and `packages/dv/fastvideo/tests/fastvideo.spec.ts`.
7. Read `packages/AGENTS.md` and `docs/cookbook/adding-a-package.md` before you create a package.

## What a provider must supply

A provider plugin can implement an entry only when the provider supplies the items in this section. Examine the provider before you write code. If the provider does not supply an item, tell the user before you continue.

1. **Model limits.** The provider must give the limits of each model for each task:
   - The shortest and the longest shot duration, in whole seconds.
   - The frame count for each supported duration, or exact `durationsSec` choices when the API accepts seconds without publishing frame counts. Do not invent frame rates.
   - The aspect ratios and the resolutions, with a default value for each.
   - The frame size in pixels for each supported pair when published; duration-based APIs may omit unknown `frameSizes`. Do not invent pixel geometry.
   - The input limits: the minimum and maximum count of references and of first frames.
   - The media types that each input accepts, such as `image`, `video`, or `audio`, with a maximum count for each media type.
2. **Access to the limits.** The provider must give the limits through an endpoint or in its documentation. When the provider has an endpoint for the limits, read the limits from that endpoint. Then `facts()` and `schema()` give the values that the running server uses. When the provider has no endpoint for the limits, put the documented limits in a validated config field of each server, such as `modelFacts` of `@dv/fastvideo`. Refuse a config whose limits are not consistent when the plugin loads.
3. **Model parameters.** The provider must document the name, the type, and the range of each model parameter. These parameters go into `extra`.
4. **Model ID.** The provider must give a stable ID for each served model. `facts()` returns this ID as `modelId`.
5. **Render endpoint.** The provider must accept one request with these values, or values that the plugin can translate into them:
   - The prompt.
   - The reference media, in order, with the media type of each item.
   - An optional first frame image.
   - The frame width and the frame height.
   - The frame count.
   - The seed.
   - The values of the model parameters.
6. **Media transfer.** The provider must accept the media bytes in the request, or a URL that the plugin can create for each asset.
7. **Output.** The provider must return the video bytes and the media type of the video.
8. **Last frame.** The provider must return the last frame of the video, or the plugin must have a way to extract it as PNG bytes.
9. **Errors.** The provider must report a failed render as an error that the plugin can detect, with a message.
10. **Cancellation.** Use the documented remote cancellation contract. If the provider has none, explicitly expose monitoring-only cancellation in the schema, model description, UI, and documentation; do not invent a cancellation endpoint or claim that local abort stops provider billing.

## What the provider plugin must implement

Do these steps to add a provider.

### Create the package

1. Create the package `packages/dv/<provider>/`, where `<provider>` is the provider name.
2. Follow `docs/cookbook/adding-a-package.md` for the manifest, the `tsconfig.json`, and the root registrations.
3. Export the function plugin members `name`, `inject`, `Config`, and `apply`. Do not add a default export.
4. Set `inject` to `['dvModels', 'dvAssetPool']`.
5. Choose one provider name in lowercase letters. Do not use `/` in the provider name or in a model name.

### Put deployment values in `Config`

1. Put each deployment value in the plugin `Config`. Use a validated `schemastery` schema.
2. Configure the models to enable and their server location. Fixed-task servers can use the model/task map of `@dv/fastvideo`; catalog-driven providers can map local aliases to native model IDs and discover their supported tasks.
3. For each model and task, give the server URL. When the provider has no endpoint for some limits, also give those limits of the served model, such as the reference limits in `modelFacts` of `@dv/fastvideo`.
4. In `apply`, throw an error for a model or a task that the plugin does not serve. Name the value in the message.
5. Do not put a server URL or the models to register in a code constant.

### Register one entry for each model and task

1. In `apply`, build one `ModelEntry` for each configured model and task.
2. Register each entry with `ctx.effect(() => ctx.dvModels.register(entry), '<label>')`.
3. Set `modality` to the modality that `TaskMap` gives for the task.
4. Set `provider` to the provider name, and set `model` to the model name.

When you dispose the plugin, the effect removes the entry. `register` throws when an entry with the same key exists.

### Implement each member

1. **`description`**: Write the strengths and the weaknesses of the model for this task. Name the inputs that the model needs. Write for an agent that chooses between similar models.
2. **`facts()`**: Read the limits from the server, or from the config when the server has no endpoint for them. Return all `RenderModelFacts` fields. Put the default aspect ratio and the default resolution first.
3. **`facts()`**: Give native frame counts or exact `durationsSec` choices. Duration-based requests use `durationSec`, `resolution`, and `aspectRatio`; unknown frame counts and pixel dimensions stay absent. Reject when the server cannot be reached.
4. **`schema()`**: Return JSON with the limits, `inputs` and `extra`. Use the `dv_shot_render` input roles `reference` and `first_frame` as the keys of `inputs`. `@dv/models` does not check this JSON. `dv_models_get` returns this JSON to the agent and does not read `facts()`.
5. **`schema()`**: Give the limits as `duration_sec` with `min` and `max`, `aspect_ratios`, and `resolutions`. Give each input its minimum count, its maximum count, and its media types with their limits.
6. **`schema()`**: Describe each `extra` parameter with its type and range. Reject when the server cannot be reached.
7. **`validateGenerationRequest(request)`**: Return every problem of the request as one agent-facing sentence. Return an empty list for a valid request.
8. **`validateGenerationRequest(request)`**: Check the count of each input against the limits. Read the media type of each asset with `ctx.dvAssetPool.mediaType(id)`.
9. **`validateGenerationRequest(request)`**: Refuse each unknown `extra` name in one sentence that lists the known names. Check each known `extra` value against its schema.
10. **`validateGenerationRequest(request)`**: For an invalid request, resolve with the problems. Reject only when the server cannot be reached.
11. **`render(request, signal)`**: Read the bytes of each asset from the file at `ctx.dvAssetPool.path(id)`. Read the media type of each asset with `ctx.dvAssetPool.mediaType(id)`.
12. **`render(request, signal)`**: Translate each asset ID into the format of the provider. The server cannot read asset IDs.
13. **`render(request, signal)`**: Send the references in the order that the provider reads them. For example, FastVideo reads the images, then the videos, then the audio files, each in input order. Send the first frame as the provider requires. Give each reference the prompt label that the model gives it in that order.
14. **`render(request, signal)`**: Yield one `video_start` event, then the `chunk` events, then one `done` event.
15. **`render(request, signal)`**: Yield exactly one `last_frame` event before `video_start` or after the last `chunk`. Give `done` the timings of the server, or an empty object.
16. **`render(request, signal)`**: Reject for each server failure. Do not yield `done` after a failure.
17. **`render(request, signal)`**: Pass `signal` to the server request. When `signal` aborts, stop the render and reject with `signal.reason`.

### Add a task or a modality only when necessary

1. When a task name in `TaskMap` describes the work of the model, use that task name.
2. If no task name fits, declare the name in the provider plugin through declaration merging.
3. Use this form: `declare module '@dv/models' { interface TaskMap { v2v: 'video' } }`.
4. Before you add a task, tell the user these facts:
   - The tool text and the skill in `@dv/models` name only `t2v` and `ref2v`.
   - Consumers such as `@dv/shot-render` contain logic for each task.

### Add prompt skills when the model needs them

1. Write a prompt skill when the model needs its own prompt rules.
2. Put the skill file in `packages/dv/<provider>/skills/`.
3. Set `promptSkill` on the entry of the model and task: `name`, `description`, and `content` with the text of the skill file. `dvModels.register` registers the skill for the agent while the entry lives. Do not register the skill in the provider plugin.
4. In `description`, name the model and the task. Do not name a tool.
5. Do not copy limits into the skill. The `@dv/fastvideo` prompt skills state fixed limits. Do not copy that part of the example. Tell the agent to read the limits with `dv_models_get`.

### Complete the package

1. Add a row for the plugin to the composition that must serve the models, such as `packages/bundle/dv/cordis.patch.yml`.
2. Write `README.md` and `README.zh.md` with the `dsh-doc` skill and the `package-reference` template.
3. In the README Model Experience section, document the entry descriptions, the prompt skills, and the refusal sentences.
4. Do not edit `@dv/models`.

## Add a model to a provider plugin

1. Make sure that the provider supplies each item in "What a provider must supply" for the model.
2. If the plugin code supports the model, add the model to the plugin `Config` in the composition. Then go to step 7.
3. If the plugin code lists its supported models, add the model and its tasks to that list. `SERVED` in `@dv/fastvideo` is such a list.
4. Write a `description` for each task of the model.
5. Add the `extra` parameters of the model for each task.
6. Add a prompt skill if the model needs its own prompt rules.
7. Update the plugin tests and the plugin README.
8. Do not edit `@dv/models`.

## Add a server

1. Find the row of the provider plugin in the composition, such as `packages/bundle/dv/cordis.patch.yml`.
2. In the `config` of the row, add or change the server URL of the model and task. When the plugin reads limits from the config, such as the reference limits in `modelFacts` of `@dv/fastvideo`, also give those limits of the served model.
3. Do not change the plugin code.
4. If you can start the composition, call `dv_models_get` for the key. Make sure that the limits in the schema agree with the served model.

## Verify

Add the tests to `packages/dv/<provider>/tests/<provider>.spec.ts`. Boot a test-only `cordis.yml` through the Loader, as `packages/dv/fastvideo/tests/fastvideo.spec.ts` does. Replace only the server with a fake HTTP server.

1. Test registration. Make sure that `ctx.dvModels.list({ provider })` returns one entry for each configured model and task. Make sure that each entry has the correct key.
2. Test disposal. Dispose the plugin fiber. Make sure that `ctx.dvModels.list({ provider })` returns an empty list.
3. Test the config. Make sure that an unsupported model or task fails the load with the error message.
4. Test `facts()` and `schema()`. Make sure that the values come from the fake server, or from the config when the plugin reads the limits from the config. Make sure that both reject when the server cannot be reached.
5. Test `validateGenerationRequest` with one case for each refusal sentence. Include a missing input, too many inputs, and a wrong media type.
6. Test `validateGenerationRequest` with an unknown `extra` name, an invalid `extra` value, and a valid request.
7. Test `render`. Make sure that the events come in the contract order. Make sure that the fake server receives the translated request.
8. Test `render` failures. Make sure that a server error rejects the stream. Make sure that an abort rejects with the abort reason.
9. Run the tests of the package with `pnpm exec vitest run packages/dv/<provider>/tests`.
10. Measure coverage with `--coverage` and `--coverage.include='packages/dv/<provider>/src/**/*.ts'`.
11. If you changed `@dv/models`, run `pnpm exec vitest run packages/dv/models/tests/models.spec.ts`.
12. If you changed a composition row, run the test of that composition, such as `packages/bundle/dv/tests/composition.spec.ts`.
13. After you edit the README pair, run `pnpm run verify-translation-pairing --write packages/dv/<provider>/README.md`.
14. Run `pnpm run test:docs`, and then run `pnpm run doc-sync`.
15. For a package manifest or exports that you added, run `pnpm run build` and `pnpm run hygiene`.
16. If the provider credentials are available, run the opt-in test against a real server.

Use `.agents/skills/dsh-pre-push-checks/SKILL.md` to select the checks before a push. Use `.agents/skills/dsh-ci-test-reliability/SKILL.md` for the fake server, its port, and its teardown.
