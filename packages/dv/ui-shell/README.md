---
description: "The DreamVerse shell over the DSH web app: the entry page and the project workspace (canvas or timeline) in the center, the project navigator in the left sidebar, and the 对话 / 轨迹 tabs in the right panel."
kind: "package-reference"
---

# @dv/ui-shell

English | [中文](README.zh.md)

## Summary

Use this package to turn the DSH web app into DreamVerse. With no project open, the center shows the entry page: the chat composer, the template chips, recent projects, and 探索 / Explore. 探索 shows one tab per entry that other plugins register in the `dv.explore` slot that the center declares, labeled and ordered by the entry, such as the MCP tab of `@dv/ui-mcp-presets` and the 技能 / Skills tab of `@dv/ui-skills`, and the selected tab's body; it is expanded until 收起 / Show less folds it, and absent while no plugin registers an entry. With a project open, it shows one view of the project, and the left sidebar starts collapsed. The views are the entries that other plugins register in the `dv.center.view` slot that the center declares, one tab of the view control each, labeled and ordered by the entry: 画布 / Canvas of `@dv/ui-canvas` and 时间线 / Timeline of `@dv/ui-timeline`. The left sidebar shows the navigator: 新建项目 / Create project, 首页 / Home, the DSH sidebar pages (插件 / Plugins, MCP, 技能 / Skills, and any other `sidebar.panellist` entry), and the project → chat session tree. Every navigation of the shell closes an open sidebar page, so 首页 leaves Plugins or MCP. The right panel gets the 对话 / Chat and 轨迹 / Trajectory tabs. The shell also injects the DreamVerse theme: the `--dv-*` variables that every DreamVerse package draws with, and DSH's alias variables pointed at the same palette. Outside text fields, Ctrl+Z (Cmd+Z on macOS) moves the open project one step back and Shift+Ctrl+Z (Shift+Cmd+Z) one step forward; these keys move the current position of the history list and write no record.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in a profile that stacks `dsh-web-app` (which provides the sidebars, the session and Workspace services, and the client module loader) and `@dv/api` (which serves the routes the shell calls). Mount `@dv/ui-asset-pool` and `@dv/ui-history` too: the right-panel button and the right-panel guide open their tabs. Mount `@dv/ui-canvas` and `@dv/ui-timeline` as well: they register the 画布 and 时间线 views of the center. Mount `@dv/ui-media` too: its `dv.media` Factory draws the project covers. Build the browser bundle first: `pnpm run build` writes `lib/client.js`.

```yaml
- id: dv-ui-shell
  name: '@dv/ui-shell'
```

The Host half registers nothing. The browser half provides the client service `dvCenter` (`DvCenter` of `@dv/ui-shell/contract`) and registers the center, the navigator, and the DreamVerse wordmark as the brand name at priority -1 over DSH's entries, the `dv-chat` and `dv-trajectory` tab types with their tab bodies, and the right-panel guide that offers 对话, 素材库, 历史, and 轨迹. It also hides DSH chrome that DreamVerse does not use (the welcome notice, the sidebar's brand mark, New Session button, the page list of the expanded sidebar (the navigator lists those pages; the collapsed rail keeps their icons), the composer statistics, the context meter, and the host slash commands) rewords a few DSH strings, and shows the DreamVerse icon in the browser tab in place of DSH's. The workspace top bar shows the session switcher (the project cover, the project name, and the chat session title; its menu offers 首页 / Home, 新建项目 / Create project, the project's chat sessions with 新建会话 / New chat, and the other projects), the view control (画布 | 时间线 / Canvas | Timeline), and the right-panel button, a 16 px icon button labelled 打开右侧面板 / Open the right panel that opens 对话 / Chat, 素材库 / Asset pool, and 历史 / History. The button shows only while the right panel is collapsed (`ctx.sidebarRight.expanded`), in the corner where the panel's own collapse control sits while the panel is shown. The right panel opens 448 px wide, enough for its three tabs and the active tab's close button, until the user drags its edge. The entry page shows the headline 今天想拍点什么？ / What are we making today?, the disabled 从模板开始 / Start from a template chips, and the two newest projects as cover cards (全部项目 / All projects shows the rest). The project cards and the session switcher draw the cover asset through the `dv.media` Factory, at purpose `card` on a card and `thumb` in the switcher, by the asset ID and MIME type that the summary sends. These parts leave the page when the first message is sent, so the message's bubble shows in the chat while the turn starts. The URL hash has the form `#project=<id>&view=<view>&<field>=<value>&session=<id>`, so a reload, Back, and Forward restore the location. `view` is the `id` of the shown `dv.center.view` entry; without it the center shows `canvas`, and an id that no entry has shows the first view. Every other field is a center field of the open project, such as `timeline=t2`, the timeline that the 时间线 view shows, so `#project=<id>&timeline=t2` opens the canvas, and 时间线 then shows timeline `t2`.

| Gesture | Request or event |
| --- | --- |
| Page load, then every 4 seconds | `GET /api/dv/workspaces` for the projects, their Workspaces, and the session bindings |
| 新建项目 / Create project | `POST /api/dv/projects` with the first free title 未命名项目 / Untitled project (numbered), then `POST /api/dv/workspaces` to link the Workspace created for it; a blank chat session opens in it |
| Entry page with projects | One `GET /api/dv/projects/summary` for every card's cover (the first clip with media on the project's first timeline, else the first image the project made) and last edit time; read again when the project list changes. The switcher's cover uses the timeline that the center fields name |
| Workspace of an open project | `GET /api/dv/projects/summary?project=<id>` with the `timeline` center field, when it is set, as a further query field, for the session switcher's cover; read again after every change of the project or of its center fields. The route takes the cover from that timeline |
| Open a project (navigator row, recent project card, or session switcher) | `GET /api/dv/workspaces/sessions` for its stored chat sessions; the main session moves to its latest non-blank chat session, else to a blank one |
| ＋ on a project row, 新建会话 / New chat in the session switcher, or DSH's New Session | a blank chat session in the project's Workspace; on the entry page, DSH's New Session equals 首页 |
| Rename a project (row menu) | `POST /api/dv/projects/rename`; the project's Workspace is renamed to match |
| Delete a project (row menu, then the confirmation) | `POST /api/dv/projects/delete` (the project moves to the trash directory); the linked Workspace is deleted and an open project returns to 首页 |
| Rename or delete a chat session (row menu) | DSH's session rename, or archive with its activity stopped |
| A main session that sits in a project's Workspace without a binding | `POST /api/dv/workspaces/bind` |
| `ctx.dvCenter.show({ view, target })`, such as a selected History row (`@dv/ui-history`) or 插入片段 / Insert clip in the asset preview (`@dv/ui-timeline`) | the `view` entry shows and gets `target` as the value of its owner prop `request` until it takes the request; another `show`, another view, or another project drops a request that the view has not taken |
| A view's owner prop `note(fields)`, such as the timeline that the user picks in the 时间线 view (`@dv/ui-timeline`) | the open project's center fields change (null removes a field) and the URL hash shows them; a note of a project that is no longer open changes nothing |
| `dv:trajectory-focus` `{session, toolCall}` | the main session moves to `session`, then 轨迹 opens scrolled to that tool call |

The workspace renders the shown view with the owner props `projectId` (the open project), `session` (the chat session, only while the main session belongs to the open project, else null), `request`, `fields`, and `note`; until then the view's edits carry no chat session. `request` is a `CenterRequest` with two fields. `value` is the target of the latest `dvCenter.show` for the view, and `take()` marks the request as handled, so the view does not get it again, also after a remount. The prop is null without a request. `fields` is the open project's center fields (`CenterFields`), which every view reads and the shell clears when another project opens. The center fields also narrow the open project's summary, so the switcher's cover follows the timeline that the `timeline` field names. Every change of the open project is published as `dv:current-project` for the other DreamVerse bundles.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`CenterPanel` restores the URL location once the project links and DSH's session and Workspace lists are ready, after DSH's own startup restore of its last session (or 4 seconds without one), because DSH's late restore would replace the session the shell opened. Afterwards it adopts the project of a main session that moves to another project by itself, such as the entry chat that the agent binds to a project it created. A project's chat sessions are the sessions of its Workspace, the sessions bound to it, and the sessions the server stores under its directory; a session bound to another project belongs to that project. Each browser tab keeps its own blank chat session per Workspace in `sessionStorage`, because DSH's `openWorkspace` reuses any blank session and two tabs would share one chat. The entry Workspace (the directory that holds chats started before a project exists, titled DreamVerse) replaces DSH's first-use default Workspace. The left sidebar's fold state is read from the `data-sidebar-collapsed` attribute of DSH's app frame and changed through `ctx.layout.toggleSidebar()`. The frame updates the attribute only after React renders a toggle, so the shell keeps the fold its own last toggle asked for until the attribute shows it, and a collapse right after a restore (opening a project from 首页) toggles again instead of reading the stale attribute. 首页 expands the sidebar again only when the workspace collapsed it and the user has not folded or unfolded it from DSH's rail since. The right panel's 448 px default goes through the layout store's private `setRightbar` action, because `ctx.layout` has no width setting; it is set once per page load, so a layout plugin reload keeps a width the user dragged, and a layout service without the action logs a console warning. Closing 轨迹 remounts the 对话 tab's chat, because the hidden composer of 轨迹 unbinds the session's composer editor when it unmounts.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | The Host half, which registers nothing |
| [`src/css-modules.d.ts`](src/css-modules.d.ts) | The type of the CSS Module imports |
| [`src/client/contract/index.ts`](src/client/contract/index.ts) | `@dv/ui-shell/contract`: `DvCenter`, `CenterTarget`, `CenterRequest`, `CenterFields`, and the `dv.explore` and `dv.center.view` slots |
| [`src/client/index.ts`](src/client/index.ts) | `dvCenter`, registrations, the New Session and first-use default Workspace overrides, the links poll, and the `dv:trajectory-focus` listener |
| [`src/client/actions.ts`](src/client/actions.ts) | `ShellActions`: create, open, rename, and delete projects and chat sessions, the entry page, and the right-panel tabs |
| [`src/client/store.ts`](src/client/store.ts) | The shared state (open project, view, center fields, the shown view's request, main session, links), `dvCenter.show` and the views' `note`, the URL hash mirror, and the session → project lookup |
| [`src/client/Center.tsx`](src/client/Center.tsx) | The center: URL restore, the entry page, template chips, recent projects, the workspace top bar, the shown center view with its request and center fields, and the Back, Forward, and edited-hash listeners |
| [`src/client/SessionSwitcher.tsx`](src/client/SessionSwitcher.tsx) | The session switcher button and menu of the workspace top bar |
| [`src/client/cover.tsx`](src/client/cover.tsx) | Project covers and last edit times read from `/api/dv/projects/summary`; the cover asset drawn through `dv.media` |
| [`src/client/sessions.ts`](src/client/sessions.ts) | The chat sessions of one project, shared by the navigator and the session switcher |
| [`src/client/sidebar.ts`](src/client/sidebar.ts) | The fold state of DSH's left sidebar and the shell's collapse and restore |
| [`src/client/right-panel.ts`](src/client/right-panel.ts) | The right panel's 448 px default width |
| [`src/client/theme.ts`](src/client/theme.ts) | The DreamVerse theme stylesheet: the `--dv-*` variables, among them the node palette `--dv-node-1` to `--dv-node-8` that each canvas node type picks a slot of and the waveform colors, and the DSH alias mapping |
| [`src/client/icons.tsx`](src/client/icons.tsx) | The shell's 16 px stroke icons |
| [`src/client/Navigator.tsx`](src/client/Navigator.tsx) | The left navigator and the brand name |
| [`src/client/panels.ts`](src/client/panels.ts) | The DSH sidebar page entries, mirrored for the navigator |
| [`src/client/slot-tabs.ts`](src/client/slot-tabs.ts) | The 探索 tabs and the view control's tabs, mirrored from the `dv.explore` and `dv.center.view` entries |
| [`src/client/tabs.tsx`](src/client/tabs.tsx) | The 对话 and 轨迹 tab types and bodies |
| [`src/client/undo-keys.ts`](src/client/undo-keys.ts) | `historyKey` and `listenHistoryKeys`: the window listener that calls `/api/dv/undo` on Ctrl+Z (Cmd+Z) and `/api/dv/redo` on Shift+Ctrl+Z (Shift+Cmd+Z) |
| [`src/client/chrome.tsx`](src/client/chrome.tsx) | Hidden and reworded DSH chrome, the right-panel guide, and tab titles that follow the interface language |
| [`src/client/logo.ts`](src/client/logo.ts) | The DreamVerse logo's SVG path data: the sidebar wordmark and the browser tab mark |
| [`src/client/InlineRename.tsx`](src/client/InlineRename.tsx) | The inline title field and the ⋯ row menu |
| [`src/client/shell.module.css`](src/client/shell.module.css) | Styles of the center, the navigator, and the tabs |
| [`src/client/chrome.module.css`](src/client/chrome.module.css) | Styles of the right-panel guide |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/api`](../api/README.md) — the project, Workspace, binding, and operation routes.
- [`@dv/ui-canvas`](../ui-canvas/README.md) — the canvas, registered as the center's 画布 view.
- [`@dv/ui-timeline`](../ui-timeline/README.md) — the timeline editor, registered as the center's 时间线 view; it inserts the clips of 插入片段 / Insert clip.
- [`@dv/ui-history`](../ui-history/README.md) — the History tab, whose rows move the center through `dvCenter.show`, and the `dv:trajectory-focus` link.
- [`@dv/ui-kit`](../ui-kit/README.md) — the API client, the wire types, the window events, and the current project.
- [`@dv/ui-media`](../ui-media/README.md) — the `dv.media` Factory that draws the project covers.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `@dv/project`; the session bindings the shell saves reach the model only through the `dv:project` prompt section and the `dv_proj_*` and operation tools of [`@dv/project`](../project/README.md).

#### KV Cache effect

None; the shell sends nothing to a model.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Hidden DSH chrome depends on DSH internals** — the shell finds the hidden controls by CSS Module class name suffixes and accessible labels, rewrites DSH dictionary entries, the host command fetcher, and the right panel's width preference through private fields, reads the left sidebar's fold state from a frame attribute, and replaces `uiWorkspace.startSession` and `workspaces.initializeDefault` on the services; a DSH change to any of them shows the chrome again or breaks the override without an error, except a missing `setRightbar` action, which logs a console warning.
- **Links poll** — projects and bindings that the agent creates appear in the navigator up to 4 seconds later.
