---
description: "The DreamVerse Skills page: a 技能 / Skills entry in the left navigator that lists the skills a creator can start with /name, with 使用 / Use, which puts /name into the chat composer."
kind: "package-reference"
---

# @dv/ui-skills

English | [中文](README.zh.md)

## Summary

Use this package to show creators the skills of DreamVerse. A skill is a written procedure the agent follows. The package adds 技能 / Skills to the left navigator below 首页 / Home; the page lists every skill a creator can start with `/name`, one card each. 使用 / Use closes the page and puts `/name` into the chat composer; the creator adds the request and sends it. Skills that the agent uses only for itself (such as `fasth3-t2va-prompting`) declare that users cannot invoke them, so the page does not list them.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in a profile that stacks `dsh-web-app` (which provides the sidebar, the main column, the `skills` Remote, and the client module loader) and `@dv/ui-shell` (whose navigator lists the `sidebar.panellist` entries below 首页). Build the browser bundle first: `pnpm run build` writes `lib/client.js`.

```yaml
- id: dv-ui-skills
  name: '@dv/ui-skills'
```

The Host half registers nothing. The browser half registers the page in the `main` slot under the panel id `skills` and the navigator entry in `sidebar.panellist` with order 2, after 插件 / Plugins. Every DreamVerse chat uses the one DreamVerse agent preset, so the page reads the list through the session the chat shows, else through the newest listed session.

| Gesture | Request or event |
| --- | --- |
| Open 技能 / Skills | `skills/list` Remote with the chat session; the list is read each time the page opens |
| 使用 / Use on a card | the layout's main panel goes back to the center, then `dv:compose` `{text: '/name', refs: []}` prefills the chat composer |
| 重试 / Retry after a failed read | `skills/list` again |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`apply` builds the injected `list` and `use` actions and registers the page and the entry through `ctx.effect`, so disposing the plugin removes both. `SkillsPage` keeps one read state (`loading`, `ready`, `failed`) and sorts the skills by name.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | The inert Host entry |
| [`src/css-modules.d.ts`](src/css-modules.d.ts) | The type of the CSS Module imports |
| [`src/client/index.ts`](src/client/index.ts) | The registrations, the session choice for the list, and the 使用 action |
| [`src/client/SkillsPage.tsx`](src/client/SkillsPage.tsx) | The page, its cards, and the navigator icon |
| [`src/client/SkillsPage.module.css`](src/client/SkillsPage.module.css) | Styles of the page |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/bundle`](../../bundle/dv/README.md) — the DreamVerse profile, which mounts this package.
- [`@dv/ui-shell`](../ui-shell/README.md) — the navigator that lists the sidebar pages.
- [`@dv/ui-composer`](../ui-composer/README.md) — the `dv:compose` prefill.
- [`@deepseek-ai/dsh-tool-skill`](../../skill/tool-skill/README.md) — the `/name` invocation and the model's skill list.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-skill`; 使用 only fills the composer, and the skill reaches the model when the user sends the message and `dsh-tool-skill` injects the named skill.

#### KV Cache effect

None; the page sends nothing to a model.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **English descriptions** — the cards show each skill's `description` as its file writes it; skill files carry one description, which the model also reads, so the page has no Chinese text for them.
- **No list before a chat session** — the `skills` Remote is addressed by a session; before any session exists the page shows the empty note.
