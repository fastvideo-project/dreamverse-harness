# Community LoRAs

A community LoRA is a small adapter trained on top of MiniMax-H3. It pushes a shot toward a look, a subject or a camera
behaviour that the words of a prompt describe only weakly: photoreal skin and faces, a period film stock, a VHS tape, a
360-degree orbit, a named camera move.

## When to use one

Use a LoRA when the shot needs a specific look that the prompt alone renders unreliably, and the deployment vouches for
an adapter for that look. `dv_lora_list` gives the adapters of this deployment and the model and tasks each is for.
Read the candidates with `dv_lora_get` before you choose: it gives the trigger words, the default and allowed strength,
and the licence and source.

Do not use a LoRA to fix a prompt problem: composition, action, camera and sound still come from the prompt. A LoRA
does not add a capability the model lacks, such as a new input, and it does not make a face consistent across shots —
that is task `ref2v` with reference images.

## Apply it to a shot

Name the adapter in the shot's render `extra` as `lora`, with the id that `dv_lora_list` shows and the strength:

```json
{"lora": {"id": "fal/MiniMax-H3-Realism-People-LoRA", "strength": 0.8}}
```

- Put the adapter's trigger words in the prompt where its description says they belong; without them the effect is
  weaker.
- Omit `strength` to use the adapter's default. Start at the default, and change one step at a time: 0.6 and 1.0 around
  a 0.8 default usually show the direction of the change.
- `0` is the model without the adapter, exactly. A shot at `0` is the control that shows what the adapter adds.
- Stay inside the adapter's allowed range. Above the author's scale the shot usually over-saturates or breaks up; below
  it the effect can be invisible.
- One adapter per shot. Stacking two adapters is not supported, and a shot that needs two looks should be two shots or a
  prompt that describes both.

## Community adapters are trained on base H3

Most community LoRAs are trained on base MiniMax-H3, which samples in 50 steps with classifier-free guidance. FastH3
is distilled to 8 steps without guidance, so the look carries over but its best strength can differ from the published
one: tune it against the shot instead of trusting the author's number. The published number is the starting point.

Step-reduction adapters — "turbo", "lightning", "acceleration", "4-step" — are not used on FastH3. It already samples
in 8 steps, and stacking a second step-reduction path on a distilled model degrades the shot.

## Licences

Community adapters are third-party weights with their own licence, and they also inherit the MiniMax-H3 Community
License of the model they adapt. Read both before you use one in work that leaves this machine. `dv_lora_get` reports
the licence and the source page; keep the attribution the licence asks for.

## Limits

- FastH3 Trim (pruned) models do not support community LoRAs: their block numbering does not line up with the 50-block
  adapters.
- a side-branch layer holds one adapter, so switching adapters per shot is fine but stacking them on one shot is not;
- an adapter that needs extra conditioning, such as a character-swap adapter trained with guide latents, cannot
  reproduce its full workflow from a prompt and reference images alone.
