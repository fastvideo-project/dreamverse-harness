# Agent Note: Prompt media citations

Status: proposed

English | [中文](2026-10-15-prompt-media-citations.zh.md)

## Problem

A render call takes a `prompt` and a separate `reference` list. The prompt names each reference with a MiniMax H3 token, such as `<Picture 1>`. This design has two problems:

1. The tokens work for one model only. Other video models use a different syntax.
2. A person who reads the prompt cannot see which media each token names.

## Proposal

A render call keeps two inputs: the reference list and the prompt. The prompt cites the items of the reference list in one harness syntax. Each model plugin changes the citations to the syntax of its model. Existing prompts and projects do not need migration.

### Terms

- **Reference list**: the `reference` inputs of a render call, in input order. The model plugin sends these media to the model.
- **Citation**: text in a prompt that names one project item, written as `@[<label>](dv:<kind>/<id>)`.
- **Element**: a named group of reference media in a project, with versions. An element is a harness concept for people and the agent. A video model does not know elements.

### Ownership

| Step                                                                | Owner                                                      |
| ------------------------------------------------------------------- | ---------------------------------------------------------- |
| Define the citation syntax and parse citations                      | `@dv/project`                                              |
| Insert and show citations in the UI                                 | `@dv/ui-composer` and `@dv/ui-canvas`, after `@dv/project` |
| Check the citations against the reference list, and expand elements | `@dv/shot-render`                                          |
| Declare the reference limits and change the citation syntax         | Each model plugin, for example `@dv/fastvideo`             |

`@dv/project` owns the citation syntax because the project holds the records and the history that the citations name. `@dv/models` is only the catalog of the registered models.

### Rules

1. A render call takes a reference list and a prompt. The harness sends the prompt as written; it does not rewrite it.
2. The prompt cites items of the reference list. If a citation names an item that is not in the reference list, then the render call returns an error.
3. An item of the reference list that the prompt does not cite is sent to the model as usual.
4. The first frame stays in the `continue_from` field. The prompt can cite it with `dv:first-frame`. If the prompt cites the first frame and the field is empty, then the render call returns an error.
5. An element version can be an item of the reference list. At render time, the harness expands the element into its media, and expands each citation of the element into citations of the media. The agent and the model plugins do not expand elements.
6. Each take keeps the source prompt and the expanded prompt. The `shot.render` result includes the expanded prompt.
7. Each model plugin declares its reference limits and changes each citation into the label that its model reads. For example, MiniMax H3 reads the k-th reference image as `<Picture k>`.

### Deferred

A notice in the UI for a reference that the prompt does not cite waits for user feedback.

### Delivery

- Each pull request depends only on merged pull requests. Open the next pull request after its base merges.
- Each pull request changes at most about 300 lines outside tests.
- After each merge, `main` works.

The pull requests come in this order:

1. This Agent Note.
2. The citation parser in `@dv/project`, and the change to `<Picture N>` in `@dv/fastvideo`. A prompt without citations renders as before.
3. The check of the citations against the reference list in `shot.render`, with the tool descriptions and the skills.
4. The citation thumbnails in the take editor and the plan view.
5. The first-frame citation.
6. Element citations and their expansion.
7. Video citations.
8. Audio citations.

## Alternatives considered

**Read the reference list from the prompt only.** A user can type any text into a prompt, and a plain-text prompt cites nothing. A separate reference list keeps every reference that the user adds, and it matches the request of the video models: a list of media and a prompt that names them.

**Model tokens in the prompt.** Each video model uses a different syntax. Positional tokens also change their numbers when the reference order changes.

**Cite only single media of an element.** The user must select each medium every time. Video products that group reference media insert one citation for the group.

**Expand elements in the agent.** The agent must find the media of each element, and the prompt loses the group.

**Expand elements in each model plugin.** Each plugin must know elements, and each plugin repeats the same code.

**Drop the media over the limit.** The harness removes media silently and decides for the agent or the user.

## Acceptance criteria

1. A render call whose prompt cites an asset outside the reference list returns an error and does not render.
2. For a prompt that cites one image of the reference list, `@dv/fastvideo` sends `<Picture 1>` and that image.
3. An element citation expands into the media of that element version, and the take keeps both prompts.

## Risks

1. The harness sets the text of an expanded element. A model can follow this text less well than text that its plugin writes.
