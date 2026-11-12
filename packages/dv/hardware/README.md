# @dv/hardware

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

SSH uses the Harness host's OpenSSH client and existing authorized identity. It never accepts or transfers private-key contents, asks for a password, or trusts a new host key automatically. The alias must already work with batch authentication and a trusted host key. SSH forwarding currently requires macOS or Linux; direct APIs also work on Windows.

## Generation admission

`workers(provider)` captures the enabled connections. `reserve(id)` admits at most one local operation per worker. Releasing a reservation is idempotent. A configuration edit does not redirect an admitted operation. Providers check `eligible(connection)` before acquiring a connection captured earlier. Native backends must still serialize their own pipeline because another Harness instance may use the same API.

FastVideo enables this inventory with its live `useHardware` setting. It selects an installed model on an idle worker, prefers a compatible resident model, and waits when all eligible installed workers are busy. A worker group spanning one video is not implemented here. A separate distributed backend and an atomic reservation of every group member are required before that operation can be offered.

## Inspection

Authenticated browser routes expose `GET /api/dv/hardware/status`, `POST /api/dv/hardware/check`, and `GET` or `POST /api/dv/hardware/models?worker=<id>`. Checks make one bounded attempt per enabled worker. The model route currently supports the native FastVideo catalog and explicit load/unload actions. Model downloads are not implemented.

The agent tool `dv_hardware_list` reports names, availability, model residency, and busy state. It never returns endpoint credentials. Provider inspectors register through `registerInspector`; the fallback only checks `/health` and cannot assert physical GPU inventory or model residency.

## Model experience

The operator inspects hardware availability and can submit independent render calls together. It cannot add hardware, read credentials, start SSH sessions, or launch Ray through the hardware tool. Render reports record the selected worker.

## Runtime invariants

No standalone invariant is published: reservation ownership is private to this service and has no independent projection to compare. Behavior tests cover reservation exclusivity and release, credential rotation, endpoint validation, settings-schema serialization, and an opt-in real SSH worker check.

## Existing RunPod Pods

Hardware settings can discover running GPU Pods through `POST /api/dv/hardware/runpod/pods`, using a saved account credential reference. Discovery makes one authenticated `GET` to RunPod's Pod-list API and returns only Pod IDs, names, status, and exposed HTTP ports. Pod environments and account credentials are not returned to the browser.

Choose the HTTP port already serving FastVideo. The saved worker uses the existing API transport and RunPod HTTPS proxy; its optional FastVideo bearer key is separate from `DV_RUNPOD_API_KEY`. Discovery does not create, start, stop, or modify Pods. A Pod being running does not establish that FastVideo is ready; use the normal connection check after saving. Real-account validation remains opt-in and is not covered by fake-provider tests.
