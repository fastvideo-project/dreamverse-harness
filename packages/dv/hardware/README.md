# @dv/hardware

English | [中文](README.zh.md)

Connect generation workers through HTTP APIs or key-only OpenSSH forwards. Model providers inspect their own worker state and reuse these connections when admitting generation work. The service has no NVIDIA, Spark, or model-family requirement.

## Configuration

Mount this plugin with the existing Harness credential provider. Its live `workers` field is edited through Harness settings. Each worker has a stable ID and a provider ID.

| Field | Default | Use |
| --- | --- | --- |
| `workers` | `{}` | Saved workers keyed by stable ID |
| `workers.<id>.label` | Required | Display name |
| `workers.<id>.provider` | `fastvideo` | Provider whose inspector and generation adapter use the connection |
| `workers.<id>.enabled` | `true` | Admit new work on this worker |
| `workers.<id>.transport` | `api` | Direct API or `ssh` forwarding |
| `workers.<id>.baseUrl` | `http://127.0.0.1:18000` | API origin and optional reverse-proxy prefix |
| `workers.<id>.credentialRef` | Empty | Existing credential-service reference, resolved on each request |
| `workers.<id>.sshHost` | Empty | Existing OpenSSH host alias on the Harness host |
| `workers.<id>.remoteHost` | `127.0.0.1` | API host reached from the SSH server |
| `workers.<id>.remotePort` | `18000` | API port reached from the SSH server |
| `connectionTimeoutMs` | `10000` | Connection-check deadline |

Settings refuse a save or reload whose inventory has an invalid ID, label, provider, credential reference, SSH coordinate, or URL, or two workers with the same endpoint. An invalid inventory already stored in the profile still starts the service: the operator prompt reports the error, and inventory, checks, and admission refuse until the inventory is edited.

SSH uses the Harness host's OpenSSH client and existing authorized identity. It never accepts or transfers private-key contents, asks for a password, or trusts a new host key automatically. The alias must already work with batch authentication and a trusted host key. SSH forwarding currently requires macOS or Linux; direct APIs also work on Windows.

## Generation admission

`workers(provider)` captures the enabled connections. `reserve(id)` admits at most one local operation per worker. Releasing a reservation is idempotent. A configuration edit does not redirect an admitted operation. Providers check `eligible(connection)` before acquiring a connection captured earlier. Native backends must still serialize their own pipeline because another Harness instance may use the same API.

FastVideo enables this inventory with its live `useHardware` setting. It selects an installed model on an idle worker, prefers a compatible resident model, and waits when all eligible installed workers are busy. A worker group spanning one video is not implemented here. A separate distributed backend and an atomic reservation of every group member are required before that operation can be offered.

## Inspection

Authenticated browser routes expose `GET /api/dv/hardware/status`, `POST /api/dv/hardware/check`, and `GET` or `POST /api/dv/hardware/models?worker=<id>`. Checks make one bounded attempt per enabled worker. The model route currently supports the native FastVideo catalog and explicit load/unload actions. Model downloads are not implemented.

The agent tool `dv_hardware_list` reports names, availability, model residency, and busy state. It never returns endpoint credentials. Provider inspectors register through `registerInspector`; the fallback only checks `/health` and cannot assert physical GPU inventory or model residency.

## Runtime invariants

No standalone invariant is published: reservation ownership is private to this service and has no independent projection to compare. Behavior tests cover reservation exclusivity and release, credential rotation, endpoint validation, settings-schema serialization, and an opt-in real SSH worker check.

## Existing RunPod Pods

Hardware settings can discover running GPU Pods through `POST /api/dv/hardware/runpod/pods`, using a saved account credential reference. Discovery makes one authenticated `GET` to RunPod's Pod-list API and returns only Pod IDs, names, status, and exposed HTTP ports. Pod environments and account credentials are not returned to the browser.

Choose the HTTP port already serving FastVideo. The saved worker uses the existing API transport and RunPod HTTPS proxy; its optional FastVideo bearer key is separate from `DV_RUNPOD_API_KEY`. Discovery does not create, start, stop, or modify Pods. A Pod being running does not establish that FastVideo is ready; use the normal connection check after saving. Real-account validation remains opt-in and is not covered by fake-provider tests.

## Model Experience

### `dv:hardware` system-prompt section

#### What the model sees

While the DSH system-prompt service is mounted, every request carries the section `dv:hardware` below, at order `promptSectionOrder` (default `4870`). `<inventory>` is one line: a JSON array with `id`, `label`, `provider` and `enabled` for each saved worker. When the saved inventory is invalid, that line is `Worker configuration contains invalid or duplicate endpoints. Edit Hardware settings before generating.` instead. The section never contains endpoints, credentials or live state.

##### dv:hardware text

```markdown
Generation hardware:
When the user asks whether a device is connected, available, busy, or loaded, call dv_hardware_list immediately and report its result. Do not ask permission for this read-only inspection or claim no visibility before checking.
The configured worker IDs below are routing targets, not evidence of current connectivity. Read dv_hardware_list for live state.
<inventory>
For explicit placement, pass worker to dv_shot_render, dv_models_status, dv_models_load, or dv_models_unload. Use the exact enabled worker ID. A pinned operation never falls back to another device. Omit worker to let the provider place independent jobs automatically.
Check model status per worker before switching models. Loading retains compatible common components when supported. Never unload or replace a busy worker. Submit independent clips together; wait only for clips whose inputs depend on an earlier output.
Only configured workers may be used. Do not infer distributed single-video support from multiple available workers, start Ray, change device connections, or access credentials from generation tools.
```

#### Token effect

About 230 tokens of fixed text, plus about 20 tokens for each saved worker, in every request while this package is mounted.

#### KV Cache effect

The fixed lines do not change. A saved edit of a worker ID, label, provider or enabled flag, or a change between a valid and an invalid inventory, changes the `<inventory>` line and invalidates the cached prefix from this section on. A connection check, a reservation or a change of worker state does not change the section.

### `dv_hardware_list` tool definition and results

#### What the model sees

While the DSH tool registry is mounted, the agent sees the tool `dv_hardware_list` with the description below and no arguments. The generated tool catalog does not list DreamVerse tools, so this section quotes the description. A call checks each enabled worker once and returns one text block with JSON: an array with `id`, `label`, `provider`, `transport`, `enabled`, `reachable`, `busy`, `loadedModel`, `loadingModel` and `status` for each saved worker. An invalid saved inventory fails the call with the error text of the `<inventory>` line above.

##### dv_hardware_list description

```markdown
Inspect enabled generation workers, connectivity, busy state, and resident models. Call this immediately when asked about connected devices or worker status; no confirmation is needed. Returned IDs can target render, model status, load, and unload calls. This does not configure hardware or start Ray.
```

#### Token effect

About 75 tokens for the definition, in every request while the tool registry is mounted. A result costs about 45 tokens for each saved worker.

#### KV Cache effect

The definition is fixed text in the stable tool section. Mounting or removing this package changes the tool list and invalidates the cached prefix from the tool section on. The conversation gets each result after its call. The cached prefix before the result does not change.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One video cannot span workers**: a worker group for one video needs a separate distributed backend and an atomic reservation of every group member.
- **No model downloads**: the model route supports only the native FastVideo catalog and explicit load and unload actions.
- **SSH forwarding needs macOS or Linux**: a Windows Harness host can use only direct APIs.
