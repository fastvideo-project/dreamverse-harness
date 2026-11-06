---
description: "Text node component of DreamVerse: the dvTextNode service, versioned Markdown documents of a project addressed by a relative TextPath, the operations textnode.write, textnode.edit and textnode.read with their agent tools, the base_version guard, source links between text nodes, the text-node skill, and the textnode state slice."
kind: "package-reference"
---

# @dv/text-node

English | [中文](README.zh.md)

## Summary

Use this package to keep a video's planning text in the project, such as a script, story beats, an ad spec or review notes. A text node is one Markdown document at a path that the caller chooses, such as `beats.md`, with numbered versions that survive new turns and new conversations. The agent writes with `dv_textnode_write`, edits lines with `dv_textnode_edit` and reads with `dv_textnode_read`; a `base_version` that is not the newest version refuses a write. The interface shows the tools as Write text, Edit text and Read text, with Chinese names in the Chinese interface.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin after `@dv/project`; the asset pool stores one `text/markdown` file per version. The reducer keeps the `textnode` slice: every version of every text node. While the DSH skill registry is mounted, the plugin also registers the `text-node` skill, which tells the agent when to write, when to edit, and to pass `base_version` on every write.

```yaml
- id: dv-text-node
  name: '@dv/text-node'
```

The plugin has no configuration fields.

| Operation | Tool | Params | Outputs and report | Confirm |
| --- | --- | --- | --- | --- |
| `textnode.write` | `dv_textnode_write` | `path`, `body` (the whole Markdown text), `title?`, `base_version`; tool argument `from?` | `text` (`text/markdown`); report `{path, version, title, chars}` | `never` |
| `textnode.edit` | `dv_textnode_edit` | `path`, `edits` (each `old_text` and `new_text`), `base_version` | `text` (`text/markdown`); report `{path, version, title, chars}` | `never` |
| `textnode.read` | `dv_textnode_read` | `path`, `section?` (the text of a heading), `version?` | no record; report `{path, version, title, chars, section?, text}` | `never` |

A `TextPath` is a relative path that holds no whitespace, `@`, `#` or `..`, does not start with `/`, and has no empty or `.` part between slashes; every operation refuses another path before any record. The plugin registers no reference kind, so a text node is not an `inputs` reference of other operations; the agent finds text nodes in the `texts` summary. A version is numbered from 1. `base_version` is required: the version the caller last read, and `0` for a new path. A write or an edit whose `base_version` is not the newest version is refused with a message that tells the agent to read the text node again. A write or an edit while another write or edit of the same path is pending or running is refused with a message that tells the agent to read the text node again after a DreamVerse project update reports that write finished. The title of a version is the `title` of the write, else the previous title, else the first heading of the body, else the path. The slice `components.textnode` is `{texts: Record<TextPath, TextVersion[]>}`, oldest version first; a `TextVersion` is `{version, title, body, asset, created_by}`, whose path is its key. The browser reads these types from `@dv/text-node/types`.

A write can name the text nodes it was built from in the tool argument `from`, such as the beats that a script follows. Each path becomes a `source` input `{record, output: 0}` on the record that wrote the newest version of that text node, so the kernel marks the write stale when a later version of a source supersedes that record, and the canvas draws an edge from each source. Each path counts once; `from` beside `inputs` is refused, and so is a source whose first write is still pending or running, with a message that tells the agent to wait. A write or an edit without `from` keeps the `source` inputs of the previous version, so a later edit keeps the links and the stale mark; `from: []` drops them. Every write after version 1 is `based_on` the record of the previous version. A human write on the canvas sends its own `source` inputs, because only an agent call runs `prepareToolCall`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`textnode.write` and `textnode.edit` compute the next title and body with one pure function, `nextText`, which the reducer also uses, so a refused edit and a reduced edit agree. Before their record is written, for every caller, they refuse a bad path, a missing or stale `base_version`, a write while another write of the path has not finished, and, for `textnode.edit`, an empty `edits` list and every edit whose `old_text` is empty or does not occur exactly once in the text that the earlier edits left. Each call imports the body through `context.importAsset` and supersedes the record of the previous version, so the kernel's stale rules mark every record that took the previous asset as an input. Both operations are non-deterministic for the runner: an edit depends on the previous body, so the runner never reuses an earlier output. `textnode.read` is a read: it writes no record, and it numbers each line with its 1-based number and a tab. A section runs from its heading to the next heading of the same or a higher level; a line in a fenced code block is never a heading. The project lock serializes the version check, so `execute` and the reducer start from the same previous version and compute the same body.

The reducer ignores records that are not `done` and records of other operations. The agent summary lists each text node once as `{path, title, version, chars, asset}`: the newest version, without its body. `chars` counts Unicode code points.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `dvTextNode`: the three operations, the `base_version` check, the source links and the `text-node` skill |
| [`src/reducer.ts`](src/reducer.ts) | The `textnode` reducer, `nextText` and the agent summary |
| [`src/text.ts`](src/text.ts) | Path parsing, literal edits, heading sections and line numbers |
| [`src/types.ts`](src/types.ts) | `TextPath`, `TextEdit`, `TextVersion`, `TextState` |
| [`skills/text-node/SKILL.md`](skills/text-node/SKILL.md) | The `text-node` skill |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/project`](../project/README.md): operations, records, stale marks, reducers and agent tools.
- [`COMPONENT-TEMPLATE.md`](../COMPONENT-TEMPLATE.md): the layout every component follows.

-----

<a id="model-experience"></a>
## Model Experience

### Tool definitions

#### What the model sees

Three tools, `dv_textnode_write`, `dv_textnode_edit` and `dv_textnode_read`, in the format `@dv/project` gives every operation tool; `dv_textnode_read` ends with the read note and takes no `supersedes` or `based_on`. The bundle test `packages/bundle/dv/tests/expected/tools/text-node.json` pins the complete definitions. The descriptions are:

##### dv_textnode_write description

```markdown
Write the whole Markdown text of a text node as its next version; a new path starts at version 1. A text node holds planning text such as a script, story beats or an ad spec. base_version is the version you read, so you never overwrite a version you have not read; 0 for a new path. For a small change to a long text, call dv_textnode_edit instead.
```

##### dv_textnode_edit description

```markdown
Change a text node by literal replacements and write the result as its next version. The edits apply in order; each old_text must occur exactly once in the text, so copy it from dv_textnode_read without the line numbers and add neighboring lines when it repeats. When any edit does not apply, nothing is written. base_version is the version you read.
```

##### dv_textnode_read description

```markdown
Read a text node with line numbers: the whole text, or one section (a heading and its lines up to the next heading of the same or a higher level). The newest version unless you pass version. dv_proj_state lists the text nodes under texts. A read that writes no record.
```

#### Token effect

About 1,800 tokens for the three definitions (7,061 characters of JSON, estimated at 4 characters per token), fixed while the plugin is mounted. The project summary adds about 20 tokens per text node under `texts`.

#### KV Cache effect

The definitions sit in the stable tool section of every agent request; mounting or removing the plugin changes the tool list and invalidates the cached prefix from the tool section on. The `texts` list is part of the `dv:project` prompt section, so a write that changes a version, title or size changes that section from the next request on.

### Tool results

#### What the model sees

A `dv_textnode_write` call returns one text block such as `done <record>: wrote beats.md v2` with the `text/markdown` output, the params, and the report `{"path":"beats.md","version":2,"title":"Beats","chars":812}`; a `dv_textnode_edit` call returns `edited beats.md v3`. A `dv_textnode_read` call returns `done: dv_textnode_read answered` and the report with `text`, one line per text line as `<number>\t<line>`. A stale `base_version` is refused with `Text node beats.md is at version 3, not base_version 2: it changed since you read it. Call dv_textnode_read on beats.md again, then make your change on version 3.`, and an edit that does not apply with `dv_textnode_edit wrote nothing.` and one sentence per failed edit.

#### Token effect

A write result repeats the call's params, so it carries the whole body a second time; an edit result carries only its edits. A read result carries the text once, plus the line numbers.

#### KV Cache effect

Each result is appended to the conversation after its call; the cached prefix stays intact.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Duplicate headings**: when several headings have the same text, `section` reads the first one.
- **Chat mentions are not expanded**: the plugin registers no reference kind, so `@dv/chat-references` describes a `dv:textnode/<path>` mention from the `@` menu as an unknown mention kind; the agent reads the path from the URI.
- **Write results repeat the body**: the result of every operation tool repeats its params, so a long `dv_textnode_write` body reaches the model twice.
- **No shot prompt cites a text node**: `shot.render` refuses a citation that is not an asset or an input of the call, so a text node reaches a shot only through the prompt that the agent writes after it reads the text node.
