# Agent Note: Browser sign-in flows

Status: implemented

English | [中文](2026-10-26-browser-sign-in-flows.zh.md)

## Problem

[Credential records and authorization flows](2026-08-13-credential-records-and-authorization-flows.md) registered a sign-in flow for every pi-ai provider, but the flows were reachable only in-process. A browser user could not start a ChatGPT (Codex) subscription sign-in, so `openai-codex`, whose only method is that sign-in, stayed unusable in the Web app ([issue #76](https://github.com/fastvideo-project/dreamverse-harness/issues/76)). A surface also needs to know which flows a deployment is willing to offer: a flow being registered does not mean its provider's terms allow a third-party application to use it.

## Decision

`dsh-api-authorization-controller` is one optional plugin. It publishes the `authorization` Remote namespace: `list`, a `begin` stream of notices, prompts, prompt withdrawals, and the settled status, plus `answer`, `decline`, `cancel`, and `signOut`. Its `flows` config is the allowlist of credential keys the deployment offers; a registered flow outside it is invisible and refused. No operation returns or logs a credential value: the stream carries only what `dsh-authorization` already restricts to non-secret notices, and `signOut` deletes the record through the credentials seam. The plugin reuses the Codex flow `llm-pi-ai` already registers. It does not bring its own OAuth client or credential file.

The plugin's own patch lists `llm-pi-ai/openai-codex` only, and the default Web App profile does not include that patch. Anthropic's subscription sign-in stays registered by `llm-pi-ai` and unlisted, because Anthropic's terms do not permit a third-party application to use Claude subscription credentials; API-key routes remain the way to use Claude models. Offering another flow is a `flows` edit in a deployment's patch, made after that provider's terms are checked.

`preferredOptions` names, per flow, the select option the page shows first. The patch prefers `device_code` for Codex because pi-ai's browser method waits for a callback on the Host's loopback port 1455, which a browser on another machine cannot reach; the device code works from any browser.

The browser entry mounts the namespace itself and adds one settings page, OpenAI Codex, fixed on the key `llm-pi-ai/openai-codex`. The Models page is unchanged. pi-ai's `Provider is not configured` failure stays pi-ai's own message: mapping it to `MISSING_CREDENTIAL` would edit `llm-pi-ai`, which every deployment runs.

## Alternatives considered

- **Edit the Web profile, the shared Remote list, and the Models page.** That is where the first version of this change put the page. Those files load for every Web user, including users who never sign in to ChatGPT.
- **Copy the standalone Codex plugins' own OAuth and credential file.** Those plugins show the packaging: one installable package, its own patch, its own settings page. Their login code repeats what `llm-pi-ai` already runs, and a second credential file would not be the record the Codex route reads.
- **Offer every registered flow.** Zero config, and pi-ai already registers 38. It would also offer subscription sign-ins whose terms the deployment has not checked, starting with Claude's. An allowlist makes each offer a reviewed line of config.
- **Default to the browser method.** One click instead of a code, on the machine that runs the Host. Every remote browser would wait on a callback that can never arrive, and the failure would surface only as a timeout.
- **Forward `credentials/record-updated` to the browser.** It would refresh other windows after a sign-in elsewhere. The event names credential keys that the browser has no other reason to see, and the page already relists on attempt end, sign-out, and reconnect; cross-window freshness is left as a limitation.
- **Render sign-in as a `settings.models.provider-card` registrant.** It reuses the seat built for card extensions. The seat is keyed by settings namespace, so a sign-in registrant for `llm-pi-ai` would displace any external plugin registered under the same key.

## Consequences

A user who loads the patch signs in to ChatGPT from Settings → OpenAI Codex, sees the device page and code, and signs out from the same page; the tokens stay in the Host's credential store, which is the store `llm-pi-ai` reads. A running attempt does not survive a Host restart, and the browser method is usable only when the browser runs on the Host's machine. Another window's sign-in shows only after this page lists again. Readiness still treats a configured keyless route as usable, so a signed-out Codex route can end first-run onboarding. After sign-out, a Codex turn fails with pi-ai's `Provider is not configured` message. A renamed `llm-pi-ai` Loader entry breaks the page's fixed key.

## Testing

`authorization-controller` covers every Host operation against the real `LocalCredentialProvider` and `AuthorizationService`: list filtering, notices and prompts, decline, prompt withdrawal, failures with and without a code, the already-running refusal, carrier abort and cancel, sign-out, the preferred marker, and config errors. The client tests cover the sign-in store over a scripted stream, every rendered state of the page, and registration plus withdrawal of the settings section. Launching the Web app with this package's patch leaves the loading screen and shows the OpenAI Codex settings page. A Codex turn with no stored sign-in fails with pi-ai's `Provider is not configured` message. A live token refresh was not checked.
