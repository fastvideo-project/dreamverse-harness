# Text nodes

A text node is one Markdown document of the project, such as a script, story beats, an ad spec or review notes. It has a relative path that you choose, such as `beats.md` or `episodes/ep001/script.md`, and numbered versions. The project block lists each text node under `texts` with its `path`, `title`, newest `version`, `chars` and `asset`, without its text.

Keep planning text in text nodes, not only in chat replies. A text node keeps its versions across turns and conversations, and the user sees it on the canvas.

| You need to | Call | Arguments |
| --- | --- | --- |
| See the text | `dv_textnode_read` | `path`; `section` = a heading's text to read only that section; `version` for an older version. |
| Start a new document | `dv_textnode_write` | `path`, `body` (the whole Markdown text), `title` when the first heading is not the title, `base_version: 0`. |
| Replace most of a document | `dv_textnode_write` | `path`, `body`, `base_version` = the version you read. |
| Change a few lines | `dv_textnode_edit` | `path`, `edits` (each `old_text` and `new_text`), `base_version` = the version you read. |

Rules:

1. Always pass `base_version`: the `version` from the project block or from the `dv_textnode_read` report that you based your change on, and `0` for a new path. A call refused with "it changed since you read it" means that the user or another call wrote a newer version. Call `dv_textnode_read` again and make your change on the newer text.
2. Prefer `dv_textnode_edit` for a change of a few lines in a long text. Copy each `old_text` from `dv_textnode_read` without the line number and the tab before each line. When the text occurs more than once, add neighboring lines until it occurs exactly once. When any edit does not apply, the call writes nothing; fix the named edits and call again.
3. Use `dv_textnode_write` for a new document or when most of the text changes. `body` is the complete text, never a fragment.
4. Read a long document one section at a time with `section`.
5. Every write is a new version and one step in the project history. Records that took the previous version's asset become stale.
6. When a document follows other text nodes, such as a script built from the beats, pass their paths in `from` to `dv_textnode_write`. A later version of a source marks the document stale, and the canvas draws an edge from each source. A call without `from` keeps the sources of the previous version.
