---
description: "Browser half of the MiniMax skill set: nine template cards with preview GIFs on DreamVerse Home; a card click puts /name into the chat composer."
kind: "package-reference"
---

# @dv/ui-minimax-skills

English | [中文](README.zh.md)

## Summary

Use this package to start a MiniMax skill from a template card. It shows nine cards with preview GIFs on DreamVerse Home. A card click puts `/<skill> ` into the chat composer; the user adds requirements and sends the message.

## Use this package

The DreamVerse bundle [`@dv/bundle`](../../bundle/dv/README.md) mounts this package next to the Host plugin [`@dv/minimax-skills`](../minimax-skills/README.md), so every DreamVerse profile shows the cards. The package registers nine template cards in the `dv.templates` slot of the DreamVerse Home page. Each card shows the preview GIF that `@dv/minimax-skills` serves at `GET /api/minimax/previews/<skill>.gif`.

A card click puts `/<skill> ` into the draft of the current conversation and focuses the composer. The click neither creates a project nor sends a message; the user adds requirements and sends the message to invoke the skill.

## Understand the implementation

`src/client/index.ts` registers the slot entry and writes the draft through the `conversation` input of the mounted session. `src/client/labels.ts` holds the card labels in card order, keyed by the `MiniMaxSkill` type of `@dv/minimax-skills/types`, so the compiler rejects a missing or unknown skill. `src/index.ts` is an empty Host entry.

## Model Experience

Indirectly, through `dsh-tool-skill`; a card click only fills the composer, and the skill reaches the model when the user sends the message and `dsh-tool-skill` injects the named skill.

#### KV Cache effect

None; the cards send nothing to a model.

## Known Limitations and Deferred Work

- **Fixed card set** — The cards cover exactly the nine MiniMax skills of `@dv/minimax-skills`; other skills appear on the Skills page of `@dv/ui-skills`.
