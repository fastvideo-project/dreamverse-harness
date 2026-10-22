# Agent Note: DreamVerse documentation tree

Status: implemented

English | [中文](2026-10-22-dreamverse-docs-tree.zh.md)

## Problem

The DreamVerse documentation was one page of 6,470 words, `docs/subsystems/video-harness.md`. A second page, `docs/subsystems/video-harness-design.md`, pointed to external documents and described a branch model that the code does not have. The DeepSeek Harness documentation keeps an architecture map, subsystem reference pages, cookbook guides and a glossary in separate tiers, but the DreamVerse text mixed all of these in one page.

Eight implemented DreamVerse Agent Notes held the current state that had no docs home. About half of their text described layers, types and mechanisms instead of a decision and its alternatives. Each fact of this kind had to stay correct in a note that the documentation standard reserves for rationale.

Two checks failed on main. `packages/dv/` had no group README, so `verify-subsystem-pages` failed. The subsystem index test in `scripts/project-doc-site.spec.ts` failed because `docs/subsystems/README.md` had no row for `video-harness-design.md`.

## Decision

The DreamVerse documentation is a sibling tree `docs/dreamverse/` that has the tiers of the DeepSeek Harness documentation:

- `architecture.md`, the ordered map of the layers;
- `architecture-checks.md`, the scripts that check the layers;
- `subsystems/`, one reference page for each DreamVerse subsystem;
- `cookbook/`, how-to guides with numbered verify steps;
- `glossary.md`, the names that code, records, tools and interface copy use.

Each DreamVerse Agent Note keeps `## Problem`, `## Decision`, `## Alternatives considered` and `## Consequences`. Its `## Decision` states the decision in one to three paragraphs and links the docs pages that hold the mechanics.

The checks accept the tree. `verify-subsystem-pages` accepts a group README link into `docs/dreamverse/subsystems/`. The subsystem index test reads both `docs/subsystems/` and `docs/dreamverse/subsystems/`. `scripts/dv-blast-radius.ts` counts each file under `docs/dreamverse/` as wiring. The documentation website does not publish the tree, and `scripts/doc-budgets.manifest.json` sets no word budget for its pages. The [DreamVerse documentation index](../../../../docs/dreamverse/README.md) lists the pages.

## Alternatives considered

**Name the folder `docs/dv-subsystems/`.** The folder holds an architecture map, a checks page, cookbook guides and a glossary, so a name that says subsystems describes only one of its five parts.

**Put a subfolder inside `docs/subsystems/`.** The documentation structure reference keeps that folder flat because its pages are parallel ([`structure-hierarchy.md`](../../../skills/dsh-doc/references/structure-hierarchy.md#documentation-hierarchy)).

**Move each Agent Note whole into `docs/`.** No documentation rule allows a note to become a docs page, and docs pages exclude rejected alternatives, which are the part of a note that prevents a repeated debate.

**Keep each Agent Note whole and copy its facts into `docs/`.** Each fact then has two homes, and the two copies drift apart.

**Leave a stub page at `docs/subsystems/video-harness.md`.** The stub holds no content, and the index test then requires a row for a page that only points elsewhere.

## Consequences

The tree has 17 English pages, each with a Chinese page and a consistency record: the index, the architecture map, the checks page, the glossary, the subsystem index with 8 subsystem pages, and 4 cookbook guides. `verify-subsystem-pages` and the subsystem index test pass.

The eight DreamVerse Agent Notes are shorter. By `wc -w` on the English files, they had 14,583 words before the split and have 8,979 words after it:

| Agent Note                           | Before | After |
| ------------------------------------ | -----: | ----: |
| `dv-architecture-client-state-types` |  1,767 | 1,407 |
| `dv-architecture-data-flow`          |  1,843 | 1,063 |
| `dv-architecture-generation`         |  1,800 | 1,162 |
| `dv-architecture-layers`             |  1,914 | 1,274 |
| `dv-architecture-reference-nouns`    |  1,837 | 1,071 |
| `dv-architecture-ui-registries`      |  1,839 | 1,011 |
| `dv-architecture-workflows`          |  1,781 | 1,104 |
| `dv-architecture-fitness-test`       |  1,802 |   887 |

The Chinese terms of the DreamVerse pages, such as 引用名词 for reference noun and 版本 for take, are in a DreamVerse section of [`docs/i18n/terminology.md`](../../../../docs/i18n/terminology.md).

DreamVerse readers do not find these pages on the documentation website. They reach the pages from the repository, from `docs/subsystems/README.md` and from the package READMEs. A later DreamVerse page goes in this tree, in the tier that owns its fact.
