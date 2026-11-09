---
description: "Feedback of DreamVerse: an authenticated route that checks a submission of the sidebar's Feedback dialog and sends it as one row to a configured sheet."
kind: "package-reference"
---

# @dv/feedback

English | [中文](README.zh.md)

## Summary

Use this package to collect feedback from DreamVerse users in a sheet that is separate from the GitHub issue list. It registers `POST /api/dv/feedback`, which checks a submission of the Feedback dialog of [`@dv/ui-feedback`](../ui-feedback/README.md) and sends it, with the time it arrived, as one JSON row to a Google Apps Script web app that saves the attached files to Google Drive and appends the row to a Google Sheet. Duplicate reports stay separate rows; a person reads the sheet and files one issue per real problem.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The `dv-feedback` row of [`@dv/bundle`](../../bundle/dv/README.md) reads the endpoint from `DV_FEEDBACK_URL`; without that variable the row and the `dv-ui-feedback` row are off, so DreamVerse has no Feedback button.

| Field | Default | Meaning |
| --- | --- | --- |
| `endpoint` | required | The HTTPS URL of the web app; it answers `{"ok": true}` once the row is stored |
| `timeoutMs` | `30000` | Milliseconds to wait for the web app's answer, redirects included |
| `maxDescriptionChars` | `5000` | The most characters a description may have |
| `maxAttachments` | `5` | The most files one submission may attach |
| `maxAttachmentBytes` | `5242880` (5 MiB) | The most bytes one attached file may have |

To create the endpoint:

1. Create a Google Sheet. In its first row, write the column titles `time`, `kind`, `areas`, `description`, `attachments`, `email`, `project`, `session`, `view`, `locale`, `screen`, `user_agent`, `version`, `commit`.
2. Open Extensions → Apps Script, replace the code with the script below, and save. For each submission the script creates a folder named after the submission's time and kind, such as `2026-11-08T05:10:21.034Z problem`, inside the Drive folder `DreamVerse feedback` (created on the first submission), saves the attached files in it, and writes that folder's link to the `attachments` column.
3. Choose Deploy → New deployment → Web app, with Execute as: Me and Who has access: Anyone, and allow the access to Drive and Sheets that Google asks for. Copy the web app URL that ends in `/exec`.
4. Start DreamVerse with `DV_FEEDBACK_URL=<that URL>`, for example `DV_FEEDBACK_URL=https://script.google.com/macros/s/<id>/exec scripts/video-harness/launch.sh web`.

```js
function doPost(e) {
  const row = JSON.parse(e.postData.contents)
  const roots = DriveApp.getFoldersByName('DreamVerse feedback')
  const root = roots.hasNext() ? roots.next() : DriveApp.createFolder('DreamVerse feedback')
  const folder = root.createFolder(row.time + ' ' + row.kind)
  row.attachments.forEach(file => folder.createFile(
    Utilities.newBlob(Utilities.base64Decode(file.data), file.type || 'application/octet-stream', file.name)))
  SpreadsheetApp.getActiveSpreadsheet().getSheets()[0].appendRow([row.time, row.kind, row.areas.join(', '),
    row.description, folder.getUrl(), row.email || '', row.project, row.session, row.view, row.locale, row.screen,
    row.user_agent, row.version, row.commit])
  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON)
}
```

The script runs as the account that deployed it, so people who send feedback need no Google account; share the sheet and the folder with the people who read them. Anyone who has the URL can append rows, so keep it out of chat messages and commits.

| Request | Answer |
| --- | --- |
| A submission whose fields check | 200 `{"ok": true}` after the web app answered `{"ok": true}` |
| A body that is not JSON, an unknown `kind` or area, no area or an area named twice, a blank description or one over `maxDescriptionChars` characters, no attachment or more than `maxAttachments`, an attachment without a name or whose data is not base64 of at most `maxAttachmentBytes` bytes, an email without one `@` between non-blank parts, or a context field that is not a string (or null where allowed) | 400 `{"error"}` naming the field; nothing is sent |
| The web app fails, times out, or answers anything other than `{"ok": true}` with a success status | 502 `{"error"}`; the answer never contains the endpoint URL |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`apply` waits for the optional `connection` service with `ctx.inject` and registers the Fetch route in an effect of that scope, so the route exists only while a Connection is mounted and unloading the plugin removes it. `parseSubmission` checks every field of [`FeedbackSubmission`](src/types.ts) at this wire boundary, and `sendRow` posts the row with `redirect: 'follow'`: Apps Script answers a POST with a redirect to the script's output. A failing Apps Script answers an HTML error page with status 200, so only the JSON acknowledgement `{"ok": true}` counts as stored. The plugin writes nothing to the project, the session log, or GitHub, and the endpoint URL stays on the host.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | Config, the route, the submission check, and the request to the web app |
| [`src/types.ts`](src/types.ts) | The submission and the row, which `@dv/ui-feedback` type-imports |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/ui-feedback`](../ui-feedback/README.md) — the Feedback button and dialog that send to this route.
- [`@dv/bundle`](../../bundle/dv/README.md) — the `dv-feedback` row and `DV_FEEDBACK_URL`.

-----

<a id="model-experience"></a>
## Model Experience

None, as feedback goes to a sheet outside the harness and adds no model request or Session event.

#### KV Cache effect

No direct effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No automatic session log** — the session ID travels with each submission, but the log stays on the host that ran the session; a person who wants to share it attaches it as a file.
- **No duplicate grouping** — every submission is its own row; grouping duplicates is the job of the person who reads the sheet.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The plugin owns one Fetch route registration, released with the plugin fiber; the spec checks that unloading the plugin removes the route, so no second authority exists to check at runtime.
