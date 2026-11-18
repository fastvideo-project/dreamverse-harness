---
description: "Project component of DreamVerse: the dvProject service that stores every project's records with its history list and current position, runs operations, computes state and history, turns every operation into its agent tool, owns the dv_proj_* tools, contributes the dv:project rules section, and appends the project state and update messages to each chat session's conversation."
kind: "package-reference"
---

# @dv/project

English | [中文](README.zh.md)

## Summary

Use this package to change and read DreamVerse projects. Every change is a record written by `dvProject.run` (component operations) or by a `proj.*` method (stale accept), after the project's current position; `undo`, `redo` and a move to a step only move the current position. The [history rules](../../../docs/subsystems/video-harness.md#history-rules) say which changes are steps and what undo and redo do. Components register their operations with `registerOperation` and their reducers with `registerReducer`. While the DSH `tools` registry is mounted, every operation becomes its agent tool `dv_<operation name with _>`, beside Project's own `dv_proj_*` tools. Project's rules reach the agent as the `dv:project` prompt section, and the project's state as appended project state and update messages. `CONTRACTS.md` specifies each internal module.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin beside the DSH Workspace registry (`workspaceRegistry`) with the DreamVerse folder, which holds the folders of new chats and projects: `newProjectFolder(name)` makes an empty folder `<name>` there, else `<name> 2`, `<name> 3`, …, and two calls never get one folder. A project is a registered DSH Workspace whose folder holds `.dreamverse/records.jsonl`: the project ID is the Workspace ID, and the title, `created_at` and `path` of `ProjectInfo` are the Workspace's title, creation time and folder. `createProject(folder, title, origin)` makes an existing folder a project: it registers the folder's Workspace with the title, then writes the first record and writes the title once more, so the last Workspace change of the create comes after the folder is a project, and a call for a folder that is a project already returns that project. `renameProject` sets the Workspace title (the folder keeps its name), and `removeProject` unregisters the Workspace and leaves every file on disk; adding the folder again later gives it a new project ID. Each component plugin registers its component key with `registerComponent` before its reducer and its operations, and `registerReducer` and `registerOperation` refuse an unregistered key (`invalid_params`); Project registers its own key `proj`, and the core keeps no list of components. An operation's optional `OperationSpec.basedOn(params, state)` names the record that a call is a changed copy of; the runner writes it as the record's `based_on` when the caller names none, as `<k>.update` of `@dv/reference-kit` and the writes of `@dv/text-node` do, so a later version joins the canvas node of the earlier one. A plugin that owns a reference kind registers it with `registerReferenceKind({kind, component, assetsOf, createdBy, latest})` after its component key (`kind_exists` for a second owner, `invalid_params` for the kinds `asset`, `record` and `version`) and declares the kind in `ReferenceKinds`; an input names a version as `<id>@<version>`, `parseReference` parses one reference text for the one kind that has the version, and `listReferenceKinds` lists the kinds for agent text. IDs are unique across kinds: the create of a kind's owner refuses an ID that `kindsWithId(state, id)` lists, and `latestVersion(state, kind, id)` gives an ID's newest version. The asset pool registers its store with `registerAssetStore` when it loads, and a chat session's project is the project whose folder is the session's working directory (`sessionProject`, read from the live session in `sessions`); `createProject` also attaches to the Workspace every stored or live top-level chat session whose working directory is the folder (a chat that cannot be attached is logged and skipped), so adding a folder again lists its earlier chats. Each reducer adds its slice's fields to the project summary through `Reducer.agentSummary`, which also receives the session whose agent reads the summary. An operation lists in `OperationSpec.pendingInputRoles` the input roles that may name the output of a record that is not done yet: the runner records and executes such a call at once with a null `resolved_asset`, which the record's current form fills when the producer finishes (Timeline clips that wait for their render use it). An operation whose `execute` runs further operations passes `started_by: {record, slot, lane?}` in each run request: the record whose execute makes the call, the position that the caller gives the call in its own sequence (or null), and the caller's parallel sequence, such as a variant; the runner copies it onto the new record and never reads it, and a record without it was not started by a record. An operation may declare `OperationSpec.label`, `{zh, en}`: the name that views show for it; Project only stores it.

A prompt cites a project item as `@[<label>](dv:<kind>/<id>)`. The two reference grammars are string functions in [`src/grammar.ts`](src/grammar.ts), which imports no host module, so the browser reads and writes them through the entry `@dv/project/grammar` with the kernel's own code. `parsePromptCitations` and `citedAsset` read citations. `citedInput` reads a citation of an input of the call by its role, such as `dv:input/first_frame`. `citedElement` reads the kind and the ID of any other citation, `citationTarget` reads the kind and the ID of any citation URI, which `formatCitation` writes back, and `elementCitationUri` gives the citation `dv:<kind>/<id>` of the element that an input reference is a version of, with its reference kind. `formatCitation` is the one writer of a citation: it encodes `(` and `)` in the ID, and it never writes an empty label or a line break in a label. `splitInputRef` and `formatInputSyntax` read and write an input reference text (`<asset>`, `<record>#<output>`, `<id>@<version>`) by syntax alone. `promptAssets` and `replacePromptCitations` of [`src/citations.ts`](src/citations.ts) read these citations against a call. A model provider plugin uses them to replace each citation with the syntax of its model.

`check(request)` runs the refusals of `run` (the params and input roles, the records that `after` names, the inputs and the operation's `precondition`) in the order that `run` runs them, and writes nothing. It returns `{problems}`: the sentence of the first refusal, or no sentence when `run` would accept the call on the current state. A read never waits for a producer, so `check` and `run` refuse a read whose input names an output of a record that has not finished, whatever `after` says. The answer is advisory, because `run` checks the call again under the project lock.

```yaml
- id: dv-project
  name: '@dv/project'
  config:
    projectsFolder: $DV_PROJECTS_FOLDER
```

| Field | Default | Meaning |
| --- | --- | --- |
| `projectsFolder` | `<Documents>/deepseek-harness/DreamVerse` | The DreamVerse folder; created when missing. Unset, it follows the DSH first-use Workspace rule, and the service fails to start, naming `DV_PROJECTS_FOLDER`, on a host whose Documents folder does not resolve |
| `cpuConcurrency` | `4` | Scheduled `cpu` records that may run at the same time |
| `gpuConcurrency` | `1` | Scheduled `gpu` records that may run at the same time |
| `promptSectionOrder` | `4900` | Order of the `dv:project` section in the system prompt; before the tool SDK section at 5000 |

<a id="understand-the-implementation"></a>
## Understand the implementation

The service in `src/index.ts` delegates to twelve private modules: the project folders (the only code that writes the Workspace registry, which lists the projects) and the record store (the only code that touches `records.jsonl` and `line.json` in the `.dreamverse/` directory of each project folder, which it reads at the first call that names the project), the runner, the scheduler, history, the reducer registry, subscriptions, the chat sessions (held tool calls), the agent tools (one DSH tool per operation), the `dv_proj_*` tools, the agent context (the `dv:project` prompt section), and the project updates (the project state and update messages, added at `agent/pre-step`, and what the agent of a session saw of its project, folded from the session log by the `dvProjectSight` session projection). Each project's `line.json` holds `{tip, at}`: `tip` is the last step, the history list is the `parents[0]` ancestry of `tip`, and `at` is the current position. Every write of every actor appends its record after `at` and makes it both `tip` and `at`, so the steps that were after `at` are discarded: they leave the history list for good, and the runner cancels each of them that has not finished (`error.code: 'discarded'`). `undo(project)` moves `at` one step back (`nothing_to_undo` at the first record); `moveTo(project, to)` moves it to that step of the history list, before or after `at` (`invalid_params` for a discarded record); `redo(project)` moves `at` one step forward (`nothing_to_redo` at `tip`); `line(project)` returns `{tip, at}`. These moves write no record and emit a `line` event. An operation with `OperationSpec.outsideHistory: true` is a durable setting outside the history, such as a conversation's video model: its record follows `at`, but `tip` and `at` stay, so it discards no step and cancels no record. The current state (`getState(project)`) folds the chain that ends at `at`, then every record of such an operation in write order through its own component's reducer, so undo, redo and moves never change those settings. Records carry `session`, `turn` and `tool_call` as links into the DSH session log: the agent tools read the turn when a tool runs, as the DSH turn number of the calling agent's session from the `turnBoundary` session projection that the agent loop registers (null outside a turn or without an agent). `CONTRACTS.md` lists each module's functions, rules, errors and tests. `listHistory(query)` is the one history query: the `dv_proj_history_list` tool and the `POST /api/dv/history` route of `@dv/api` both call it. It lists the steps of the history list, newest first, as `{record, place}` with `place` `before`, `current` or `after` relative to `at`; discarded records are not listed, and `listRecords(project)` returns every record, discarded ones included. Its filters (`actor`, `component`, `operation`, `kind`, `status`, `session`, `turn`, `tool_call`, `records`, `before`) combine with AND, and `limit` applies after them.

<a id="further-exploration"></a>
## Further Exploration

- `CONTRACTS.md` in this package: module contracts and the test plan.

<a id="model-experience"></a>
## Model Experience

### Operation tool definitions

#### What the model sees

While the DSH `tools` registry is mounted, every registered operation reaches the model as one tool, `dv_<operation name with _>`: the operation's `description` followed by the resource hint ("Uses the GPU." or "Runs on the CPU.") and a note for reads ("A read that writes no record.") and deterministic operations ("Repeating a call with the same inputs and params reuses the earlier result."); its `params` plus `toolParams`; and the shared arguments `reason` (the record's intent), `inputs` (`<asset>`, `<record>#<output>`, or `<id>@<version>` for a version of a registered reference kind, which the text names, by role; only for operations with inputs), `supersedes` and `based_on` (the last two only for operations that write a record). A call with any other argument fails with "<tool> has no argument <names>." and writes nothing.

#### Token effect

The shared arguments add up to about 200 tokens to each definition; the operation's description and params add the rest, and each component README gives the total of its tools.

#### KV Cache effect

The definitions sit in the stable tool section of every request of an agent that mounts the DSH tool registry; registering or removing an operation changes the tool list and invalidates the cached prefix from the tool section on.

### Operation tool results

#### What the model sees

A call returns one text block: `<status> <record>: <summary>` (`<status>: <summary>` for a read, which writes no record), one line per output with its asset ID, media type and URL, the scheduled records, the params, and the report; an operation that sets `OperationSpec.omitParamsFromResult`, such as `plan.create` and `plan.update` of the Shot plan component, leaves out the params, which repeat the model's own tool call. Each image output follows as one image block while an attachment service is mounted. A record that failed or was cancelled returns a tool error with its message, and a stopped one returns "dv_<name> was stopped before it finished.".

#### Token effect

Roughly 50 to 200 tokens of text per call, plus the image blocks.

#### KV Cache effect

Each result is appended to the conversation after its call; the cached prefix stays intact.

### Project tools

#### What the model sees

Eight tools: `dv_proj_create`, `dv_proj_rename`, `dv_proj_state`, `dv_proj_history_list`, `dv_proj_undo`, `dv_proj_redo`, `dv_proj_stale_accept` and `dv_proj_wait`. No tool takes a project argument: `dv_proj_create` makes the conversation's folder (its working directory) a project, refusing in a conversation that has a project ("This conversation's folder is already the project "<title>"; keep all work in it. Start a new conversation for a new project."), and every other tool and every operation tool works on that project only; in a conversation without a project they fail with "This conversation has no project yet: call dv_proj_create first.". `dv_proj_history_list` returns the steps newest first (20 by default), each with its `place` (`current`, `before` or `after`), operation, status, actor, intent and outputs. `dv_proj_wait` takes `records`, the record IDs to wait for (the records a result listed under `scheduled`, or a record whose status was pending), waits until each has finished or failed, and returns one line `<status> <record> (<intent>): <summary>` per record in the order named, each followed by one `- <role>: <asset> (<mime>) <url>` line per output; a failed record's summary is its error, and an empty list or an unknown record ID is refused before any wait. The others return the project summary of the current state as indented JSON: `record` (only after a tool that writes records: the newest record the call wrote), `project_id`, `title`, `head`, `records` (the count), then the `agentSummary` fields of each component in the alphabetical order of component keys (Character `characters`, Location `locations`, Shot plan `plans`, Style `styles`, Timeline `timelines`), then `stale` and `recent` (at most twelve records with their summaries and output URLs). `dv_proj_undo` without `to` goes back one step, and with `to` (a record ID from `dv_proj_history_list`) moves to that step, before or after the current one; `dv_proj_redo` goes forward one step. These moves add no step; a later change discards the steps after the current one. `dv_proj_rename` takes a `title` and renames only the conversation's project; it trims the title, refuses an empty one, adds the suffix ` 2`, ` 3`, … when another project uses the title, and writes no record. Every tool except `dv_proj_history_list`, and every operation tool that writes a record, also stores what its result showed as `dv_seen` in the result's persisted metadata, which the model never reads; the project update messages leave those records out.

#### Token effect

About 800 tokens for the nine definitions, fixed while the plugin is mounted. A project summary starts near 150 tokens and grows with the project: each recent record, character, location, style, plan and clip adds its fields. A `dv_proj_wait` result is about 30 tokens per named record plus about 40 per output, whatever the project's size.

#### KV Cache effect

The nine definitions are a fixed part of the stable tool section; each result is appended to the conversation after its call, so the cached prefix stays intact.

### Project prompt section

#### What the model sees

While the DSH `systemPrompt` service is mounted, the system prompt of every step carries the `dv:project` section, which holds only Project's rules: a conversation without a project starts with `dv_proj_create`, and once the project state message or `dv_proj_create` names the conversation's project, all work stays in it; changes that the agent's own tool results did not show arrive as DreamVerse project updates, and `dv_proj_state` reads the whole project at any time; every call of the agent and every edit of the user is a step of the project history at once, and the user does not accept changes; a roll back calls `dv_proj_undo` (one step, or `to` a step) and `dv_proj_redo` goes forward one step, these moves add no step, and a new change after a move discards the later steps for good, so the agent asks first when the user may still want them; a roll back never uses new edits that rebuild an earlier state; things are named by the IDs in the project summary (record, `<record>#<n>`, `<id>@<version>` for a version of a registered reference kind, which the rule names, asset, and the ID of any other item), the user points at things with `dv:` mentions, and an ambiguous reference is asked about instead of guessed; a stale record is rendered again only when the user agrees. The section holds no project state, no selection and no preference that the user cannot see.

#### Token effect

About 500 tokens on every step, whatever the project's size.

#### KV Cache effect

Stable. The section sits in the system prompt at order `promptSectionOrder` (4900, before the tool SDK section), and its text changes only when a reference kind registers or unregisters, which rebuilds the operation tool definitions in the same request.

### Project state and update messages

#### What the model sees

While the DSH `sessionProjections` service is mounted, a step of a chat session bound to a project gets at most one user-role message after the step's own messages. The project state message comes at the first step that has no view of the project (the first step of a bound session, the first step after the agent bound an unbound session with `dv_proj_create`, or the first step after compaction or tool-result trimming shadowed that message): "DreamVerse project state. This conversation belongs to the project "<title>" in the folder <path>: do all work in it and never call dv_proj_create. Later changes that your own tool results did not show reach you as DreamVerse project updates. The project summary, as dv_proj_state returns it without the reports of recent records:", then that summary as indented JSON. Afterwards a step whose project changed in a way the agent has not seen gets the project update message, "DreamVerse project updates since your last step:" followed by `- history: the current step is <record>; dv_proj_history_list shows which steps are undone or discarded.` when undo, redo or a move changed the current position, then `- <status> <record> (<who>): <text>` for each record of the history list up to the current position that the agent has not seen and each finish of such a record it saw unfinished, where who is `user on canvas`, `user on timeline`, `user in asset pool`, `user in chat`, `user in another chat` (an edit made in another chat), `user in history`, `user via API`, `your call`, `another chat` or `scheduled`, and text is the operation's summary (with one indented `- <role>: <asset> (<mime>) <url>` line per output) for a done record, `<intent>: <error>` for a failed or cancelled one, and the intent for an unfinished one. Records that an operation tool result, a `dv_proj_wait` result or a project summary tool result of the same session showed are not repeated, and a step with nothing new gets no message.

#### Token effect

The project state message is about 60 tokens plus the project summary without reports (about 150 tokens for a new project, growing with the project). An update is about 15 tokens plus about 25 for a move line, about 20 per record line and about 40 per output line; after a long absence it lists every record written meanwhile.

#### KV Cache effect

Each message is logged as a `user/message` and appended after the cached history, so the request extends the previous one token for token. Compaction starts a new request series and the next step sends the project state message again.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- A record that only a `dv_proj_history_list` result or a failed operation tool call showed is still reported in the next project update, because those results store no `dv_seen` metadata.
- A move line names no actor and no undone or discarded step, because `line.json` does not record who moved the current position; `dv_proj_history_list` shows the place of each step.
- A project update reports neither a rename nor a record that became stale; the next project summary shows both.
- The `pending` to `running` step, and the outputs and reports written while a record runs, are not reported; the finish is.
- A version whose reference kind gives no assets resolves to no input, so a record that names such a version keeps no trace of it and does not become stale when the version changes.
