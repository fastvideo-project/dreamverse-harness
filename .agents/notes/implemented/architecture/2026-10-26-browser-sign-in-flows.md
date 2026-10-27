# Agent Note: Browser sign-in flows

Status: implemented

English | [中文](2026-10-26-browser-sign-in-flows.zh.md)

## Problem

[Credential records and authorization flows](2026-08-13-credential-records-and-authorization-flows.md) registered a sign-in flow for every pi-ai provider, but the flows were reachable only in-process. A browser user could not start a ChatGPT (Codex) subscription sign-in, so `openai-codex`, whose only method is that sign-in, stayed unusable in the Web app ([issue #76](https://github.com/fastvideo-project/dreamverse-harness/issues/76)). A surface also needs to know which flows a deployment is willing to offer: a flow being registered does not mean its provider's terms allow a third-party application to use it.

## Decision

`dsh-api-authorization-controller` publishes the `authorization` Remote namespace: `list`, a `begin` stream of notices, prompts, prompt withdrawals, and the settled status, plus `answer`, `decline`, `cancel`, and `signOut`. Its `flows` config is the allowlist of credential keys the deployment offers; a registered flow outside it is invisible and refused. No operation returns or logs a credential value: the stream carries only what `dsh-authorization` already restricts to non-secret notices, and `signOut` deletes the record through the credentials seam.

The Web app offers `llm-pi-ai/openai-codex` only. Anthropic's subscription sign-in is registered by `llm-pi-ai` but not offered, because Anthropic's terms do not permit a third-party application to use Claude subscription credentials; API-key routes remain the way to use Claude models. Offering another flow is a `flows` edit in the deployment's patch, made after that provider's terms are checked.

`preferredOptions` names, per flow, the select option a surface shows first. The Web app prefers `device_code` for Codex because pi-ai's browser method waits for a callback on the Host's loopback port 1455, which a browser on another machine cannot reach; the device code works from any browser. The preference is Host config rather than a client constant, so the Models page carries no provider ids.

The Models page matches a provider card to a flow by `<settingsNs>/<provider>`, the record key `llm-pi-ai` writes under its shipped Loader entry id. The sign-in block renders beside the `settings.models.provider-card` seat instead of occupying it, so an external plugin keyed on `llm-pi-ai` still receives every card.

`llm-pi-ai` classifies pi-ai's `Provider is not configured` failure as `MISSING_CREDENTIAL`. That message is what a keyless route with no stored sign-in produces before any request is sent, so after `signOut` a Codex turn fails with the same code as a route whose key reference is empty.

## Alternatives considered

- **Offer every registered flow.** Zero config, and pi-ai already registers 38. It would also offer subscription sign-ins whose terms the deployment has not checked, starting with Claude's. An allowlist makes each offer a reviewed line of config.
- **Default to the browser method.** One click instead of a code, on the machine that runs the Host. Every remote browser would wait on a callback that can never arrive, and the failure would surface only as a timeout.
- **Forward `credentials/record-updated` to the browser.** It would refresh other windows after a sign-in elsewhere. The event names credential keys that the browser has no other reason to see, and the page already relists on attempt end, sign-out, and reconnect; cross-window freshness is left as a limitation.
- **Render sign-in as a `settings.models.provider-card` registrant.** It reuses the seat built for card extensions. The seat is keyed by settings namespace, so a sign-in registrant for `llm-pi-ai` would displace any external plugin registered under the same key.

## Consequences

A Web user signs in to ChatGPT from the `openai-codex` card, sees the device page and code, and signs out from the same card; the tokens stay in the Host's credential store. A running attempt does not survive a Host restart, and the browser method is usable only when the browser runs on the Host's machine. Another window's sign-in shows only after this page lists again. Readiness still treats a configured keyless route as usable, so a signed-out Codex route ends first-run onboarding and its turns then fail with `MISSING_CREDENTIAL`. A renamed `llm-pi-ai` Loader entry breaks the card-to-flow match.

## Testing

`authorization-controller` covers every operation against the real `LocalCredentialProvider` and `AuthorizationService`: list filtering, notices and prompts, decline, prompt withdrawal, failures with and without a code, the already-running refusal, carrier abort and cancel, sign-out, the preferred marker, and config errors. `ui-settings-models` covers the sign-in store over a scripted stream, every rendered state of the block, and its placement on the matching card. `llm-pi-ai` covers the `MISSING_CREDENTIAL` classification. An end-to-end turn with a real ChatGPT account, including token refresh, has not been recorded.
