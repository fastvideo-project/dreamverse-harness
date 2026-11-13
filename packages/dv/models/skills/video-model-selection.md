# Video model selection

Each shot renders with one video model. Each video model has a key of four fields: `modality`, `task`, `provider` and `model`. The chat input's model choices apply to subsequent generations in that conversation, one per modality. Read `video_model` in project state, this conversation's choice: a named provider and model is the default for every shot; null (Auto) lets you choose. The same holds for `image` and `audio` generations with `image_model` and `audio_model`, which are absent for Auto. Do not ask the user to pick again for each generation. When they request a switch, call `dv_models_select` with the modality and the new provider and model before generating. Existing generations retain their recorded model.

Providers may expose `dv_models_status`, `dv_models_load` and `dv_models_unload`. These operate on installed weights and GPU memory; they never download weights. Generation loads its requested model automatically, serializes switching with inference, and retains compatible shared components when supported. Do not unload a running generation. Do this procedure for each shot.

## Independent workers

When the model and render tools accept `worker`, use the IDs of enabled workers to select a device explicitly. For example, load Pika on a chosen worker, render its assigned clip there, then unload that worker only after its generation finishes. Omit `worker` only when automatic placement is intended. Never say you cannot control placement when `worker_selection` is available. Independent shots with all inputs available can run together: emit their render calls in the same tool batch. The provider reserves one worker per generation, prefers an already loaded model, and queues when eligible workers are busy.

## Procedure

1. Find the task of the shot.
   - Use `i2v` when the shot begins at one first-frame image, or `l2v` when it ends at one last-frame image. Neither accepts reference media.
   - Use `fl2v` when the shot must connect explicit first and last images. Both endpoint image inputs are required; general reference media are not accepted.
   - Use `t2v` when the shot has only a prompt. A model registered only for `ref2v` can also serve a prompt-only shot if its schema permits zero references; check that entry before rejecting the conversation's selected model.
   - Use `ref2v` when the shot has reference media and a prompt. A `ref2v` shot can also have a first frame.
2. If the user named a model or this conversation has a video default, call `dv_models_list` with the task of the shot. Use the entry of that model. If that model has no entry for the task, tell the user and offer a model switch. Go to step 9.
3. Call `dv_models_list` with the task of the shot. Each model that `dv_models_list` returns is a candidate.
4. Call `dv_models_get` for each candidate.
5. Remove each candidate that cannot render the shot. Compare the shot with the schema of the candidate:
   - duration;
   - aspect ratio;
   - resolution;
   - number of references and media type of each reference;
   - a first frame, when the shot continues the previous shot.
6. If one candidate remains, use it. Go to step 9.
7. If more than one candidate remains, compare their descriptions. If the choice depends on a preference of the user, ask the user. Show the provider, the model and the description of each option.
8. Else, choose the candidate that fits the shot best.
9. Give the shot the four key fields of the chosen model.

## Problems

- If no model can render the shot, tell the user. This occurs when `dv_models_list` returns no model, or when step 5 removes all of the candidates.
- If a render is refused, read the problems that the refusal lists. Change the inputs of the shot, or choose a different model.
