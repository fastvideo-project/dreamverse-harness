# Video model selection

Each shot of a plan renders with one video model. Each video model has a key of four fields: `modality`, `task`, `provider` and `model`. Do this procedure for each shot.

## Procedure

1. Find the task of the shot.
   - Use `t2v` when the shot has only a prompt.
   - Use `ref2v` when the shot has reference media and a prompt. A `ref2v` shot can also have a first frame.
2. If the user named a model, call `dv_models_list` with the task of the shot. Use the entry of that model. If that model has no entry for the task, tell the user. Go to step 9.
3. Call `dv_models_list` with the task of the shot. Each model that `dv_models_list` returns is a candidate.
4. Call `dv_models_get` for each candidate.
5. Remove each candidate that cannot render the shot. Compare the shot with the facts and the schema of the candidate:
   - duration;
   - aspect ratio;
   - resolution;
   - number of references and media type of each reference;
   - a first frame, when the shot continues the previous shot.
6. If one candidate remains, use it. Go to step 9.
7. If more than one candidate remains, compare their descriptions. If the choice depends on a preference of the user, ask the user. Show the provider, the model and the description of each option.
8. Else, choose the candidate that fits the shot best.
9. Write the four key fields of the chosen model on the plan shot.

## Problems

- If no model can render the shot, tell the user. This occurs when `dv_models_list` returns no model, or when step 5 removes all of the candidates.
- If a render is refused, read the problems that the refusal lists. Change the inputs of the shot, or choose a different model.
