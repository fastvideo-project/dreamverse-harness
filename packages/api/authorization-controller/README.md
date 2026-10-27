---
description: "Browser configuration pages run the sign-in flows a deployment offers over authenticated Remote. Notices and prompts cross the wire; tokens never do."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-authorization-controller

English | [中文](README.zh.md)

## Summary

Browser configuration pages run the sign-in flows a deployment offers over authenticated Remote. Notices and prompts cross the wire; tokens never do.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Mount `AuthorizationController` with `flows`, the credential keys (`<scope>/<id>`) whose flows the browser may reach. A malformed key fails at load. A registered flow absent from `flows` stays Host-only; the Web App profile lists only `llm-pi-ai/openai-codex`. `preferredOptions` maps an offered key to the select-prompt option the browser presents first; select prompts that offer it carry `preferred`, and a key outside `flows` fails at load. The Web App profile prefers `device_code` for Codex.

The `authorization` namespace exposes `list`, `begin`, `answer`, `decline`, `cancel`, and `signOut`. `list` returns offered flows that are registered now, with their methods, whether an attempt is running, and whether a credential is stored. `begin` streams `notice`, `prompt`, and `prompt-withdrawn` frames, then one `settled` frame with `authorized` or `cancelled`; a failed attempt ends the stream with `authorization/failed`. `answer` and `decline` name a prompt by the id from its frame. Closing the stream or calling `cancel` withdraws the attempt. `signOut` withdraws any running attempt and deletes the stored credential.

Keys outside `flows`, or without a registered flow, fail with `authorization/not-offered`; a stale prompt id fails with `authorization/no-prompt`. A second `begin` while an attempt runs fails with `authorization/failed` and code `ALREADY_IN_FLIGHT`.

<a id="understand-the-implementation"></a>
## Understand the implementation

The controller adapts `ctx.authorization` attempts to one Remote stream per attempt. Open prompts live in memory per running attempt and are declined when the attempt settles. A prompt its flow withdraws reports `prompt-withdrawn` and rejects without the decline error, so the flow continues. The controller keeps no state beyond running attempts, so no invariant companion is published.

<a id="further-exploration"></a>
## Further Exploration

The [credentials subsystem](../../../docs/subsystems/credentials.md) owns authorization flows and credential storage; [llm-pi-ai](../../llm/llm-pi-ai/README.md) registers the provider flows this controller offers.

<a id="model-experience"></a>
## Model Experience

None, as sign-in stores credentials that affect HTTP authentication only and never enter model prompts, Session logs, or tool results.

#### KV Cache effect

No model request prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- A running attempt does not survive a Host exit, and a reconnecting browser cannot reattach to an attempt it lost; it cancels and starts again.
- Browser-redirect methods listen on the Host's loopback, so a remotely hosted Web App can finish only device-code methods.

<a id="dev-note"></a>
### Dev Note

The [browser sign-in decision](../../../.agents/notes/implemented/architecture/2026-10-26-browser-sign-in-flows.md) records the offered-flow list and the device-code default.
