---
description: "Reference kit of DreamVerse: defineReference turns one declaration of a reference noun into its Cordis service, with the component, reducer, reference kind, create and update operations, and skill."
kind: "package-reference"
---

# @dv/reference-kit

English | [中文](README.zh.md)

## Summary

Use this package to declare a reference noun: a kind of item, such as a person or a place, that keeps reference images as versions that shots name as `<id>@<version>`. `defineReference(spec)` returns the service class of one noun. The class registers with `dvProject` the component key `spec.component`, its reducer, the reference kind of the same name, the operations `<k>.create` and `<k>.update`, and the skill named `<k>`. The kit names no noun and no media type; the declaration gives the noun words, the input roles and the skill.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

A noun package declares its ID, version and slice types from `@dv/reference-kit/types`, merges the slice into `ComponentStates` and the ID type into `ReferenceKinds` of `@dv/project/types`, and default-exports a subclass of `defineReference({...})`. The service injects `dvProject` and has no configuration fields.

| Field | Meaning |
| --- | --- |
| `service` | The Cordis service name, such as `dvCharacter` |
| `component` | The component key, which is also the reference kind, the ID param and the operation prefix |
| `noun` | The noun in the labels: 新建<zh> / Create <en> and 修改<zh> / Update <en> |
| `meaning` | What one item is, in the create description |
| `reference` | The input roles of both operations |
| `skill` | The skill `description`, `whenToUse` and the `file` URL of its body |
| `fields` | Optional extra version fields: one param on both operations and the value of a new ID |

| Operation | Params | Effect |
| --- | --- | --- |
| `<k>.create` | `<k>` (the ID, without `@` or `#`), `name`, `description`, each `fields` param | Version 1 of a new ID; fails when `dvProject.kindsWithId` lists the ID |
| `<k>.update` | `<k>` (the ID), `name`, `description`, each `fields` param | The next version; keeps what the call leaves out; supersedes the record of the previous version and is `based_on` it, so it joins the item's canvas node; fails for an unknown ID |

The slice of a noun is `ReferenceSlice<V>`: a map from ID to the versions oldest first. A version (`ReferenceVersion<I>`) has `id`, `version`, `name`, `description`, `references` (asset IDs) and `created_by` (the record that wrote it), plus each `fields` value. `referenceReducer(spec)` is the reducer the service registers. While `dvCanvasNodes` of [`@dv/canvas`](../canvas/README.md) is loaded, the service registers `<k>.create` as the maker of `<k>` nodes in column 0, so each item is one canvas node that holds every version.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The reducer reads only finished `<k>.create` and `<k>.update` records. A version's reference images are the resolved assets of the record's inputs; an update without inputs keeps the previous images. The reference kind answers from the slice: `assetsOf` gives the images of a version, `createdBy` the record that wrote it, and `latest` the newest version of an ID. All registrations pass variables, so a static scan sees only the `component:` literal of each noun declaration.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `defineReference`, `referenceReducer`, the reference kind, both operations and the skill registration |
| [`src/types.ts`](src/types.ts) | `ReferenceVersion`, `ReferenceSlice` and `ReferenceKey` |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/project`](../project/README.md): operations, reducers, reference kinds, stale marks and undo.

-----

<a id="model-experience"></a>
## Model Experience

### Tool definitions

#### What the model sees

Two tools per noun, `dv_<k>_create` and `dv_<k>_update`, in the format `@dv/project` gives every operation tool. Each takes the ID under the key `<k>`, `name`, `description` ("Words carried into every prompt: wardrobe, mood, or look."), each `fields` param, and the input roles of the declaration. The create description says what the noun is, that a shot names it as the input `<k>@1`, and that the ID must not name any other item that an input names as `<id>@<version>`.

#### Token effect

About 600 tokens for the two definitions of one noun, fixed while the noun's plugin is mounted.

#### KV Cache effect

The definitions sit in the stable tool section of every agent request; mounting or removing a noun changes the tool list and invalidates the cached prefix from the tool section on.

### Tool results

#### What the model sees

A call returns one text block: `done <record>: <k> <name> created` (`<k> <id> updated` for an update) and the params. A refused ID returns a tool error that says why, such as "The ID 'c1' already names a location; update it, or choose another ID."

#### Token effect

About 50 tokens per call.

#### KV Cache effect

The result is appended to the conversation after the call; the cached prefix stays intact.

### Skill

#### What the model sees

The skill catalog lists the skill `<k>` of each mounted noun with the description and the `whenToUse` text of its declaration; loading it returns the noun's skill file.

#### Token effect

The catalog entry and the body are the noun package's text; the kit adds none.

#### KV Cache effect

The catalog entry sits in the stable skill section; mounting or removing a noun changes the catalog.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Skill names**: the skill name is the component key, and a DSH skill name matches `^[a-z0-9]+(?:-[a-z0-9]+)*$`, so a noun whose key holds `_` gets no skill; the skill registry logs the refusal.
- **No delete**: an item stays in the project once created; an update can only change it.
