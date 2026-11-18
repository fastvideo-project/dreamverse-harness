# @dv/ui-hardware

English | [中文](README.zh.md)

Adds Hardware and Generation models pages to the existing Harness settings shell. The existing Models page continues to own operator LLM providers and credentials.

Hardware settings saves worker coordinates through revision-fenced Harness settings. API keys are written through the existing credential service; saved values are never read back into the editor. Adding hardware starts with a display name and a local FastVideo server, an existing SSH alias, or a compatible API endpoint, including hosted GPU services. The address is resolved from the Harness host, not from the browser. The stable worker ID is generated from the name. Advanced fields expose the ID, credential reference, and remote API host/port.

Generation models reads the selected worker's native catalog and exposes explicit load/unload controls. It also lists the five FastVideo NVFP4 kit variants. The model library describes the variants and links their source cards; it does not show a working download action because no worker installation API is implemented. Custom weights must be registered with FastVideo on the target worker. API credentials require a compatible model endpoint; generic provider protocols need an appropriate generation adapter. This page does not download weights into the browser or promise arbitrary model compatibility.

## Composition

Mount `@dv/hardware`, the normal Harness settings and credential services, and a generation provider. The DreamVerse bundle includes this browser companion. Build its client artifact with `pnpm --filter @dv/ui-hardware bundle` before launching the normal `dsh` profile.

## Runtime invariants

No standalone invariant is published. Host settings and credentials own durable values; this package is their UI consumer. Component tests exercise key references, refused edits, busy-worker controls, and model lifecycle actions.

## Connect an existing RunPod Pod

Choose **Add hardware → RunPod Pod**, save the RunPod account API key, and select **Find my Pods**. Select the exposed HTTP port where FastVideo already runs. Save the FastVideo worker key separately when that endpoint requires authentication, then choose **Save and check**. The account key only lists Pods; it is never saved as the worker credential. This flow does not provision or start a paid Pod.

## Model Experience

None, as the pages only edit saved hardware workers and credentials, and `@dv/hardware` and the generation providers own every model-facing contribution.

#### KV Cache effect

No direct effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No weight download or installation**: the model library has no download action because no worker installation API exists; custom weights must be registered with FastVideo on the target worker.
- **No arbitrary provider protocols**: API credentials require a compatible model endpoint, and a generic provider protocol needs its own generation adapter.
- **No provisioning**: the RunPod flow lists existing Pods and does not provision or start a paid Pod.
