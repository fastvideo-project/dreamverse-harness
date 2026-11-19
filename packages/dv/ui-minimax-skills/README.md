---
description: "Browser half of the MiniMax skill set: nine template cards with preview GIFs on DreamVerse Home and in the Explore section; a card click puts /name into the chat composer."
kind: "package-reference"
---

# @dv/ui-minimax-skills

English | [中文](README.zh.md)

## Summary

Use this package to start a MiniMax skill from a template card. It shows nine cards with preview GIFs on DreamVerse Home and in the Explore section. A card click puts `/<skill> ` into the chat composer; the user adds requirements and sends the message.

## Use this package

The bundle of [`@dv/minimax-skills`](../minimax-skills/README.md) mounts this package next to the Host plugin, so a profile that selects that bundle needs no extra row. The package registers nine template cards in the `dv.templates` slot of the DreamVerse Home page and in a MiniMax templates tab of the `dv.explore` slot. Each card shows the preview GIF that `@dv/minimax-skills` serves at `GET /api/minimax/previews/<skill>.gif`.

A card click puts `/<skill> ` into the draft of the current conversation and focuses the composer. The click neither creates a project nor sends a message; the user adds requirements and sends the message to invoke the skill.

## Understand the implementation

`src/client/index.ts` registers the two slot entries and writes the draft through the `conversation` input of the mounted session. `src/client/labels.ts` holds the card labels in card order, keyed by the `MiniMaxSkill` type of `@dv/minimax-skills/types`, so the compiler rejects a missing or unknown skill. `src/index.ts` is an empty Host entry.

## Model Experience

Indirectly, through `dsh-tool-skill`; a card click only fills the composer, and the skill reaches the model when the user sends the message and `dsh-tool-skill` injects the named skill.

#### KV Cache effect

None; the cards send nothing to a model.

## Known Limitations and Deferred Work

- **Bundle selection** — No shipped DreamVerse profile selects the `@dv/minimax-skills` bundle, so a fresh install shows no cards until a profile adds that bundle.
