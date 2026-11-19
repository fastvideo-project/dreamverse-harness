---
description: "MiniMax 技能集的浏览器部分：在 DreamVerse 首页和探索区显示九张带预览 GIF 的模板卡片；点击卡片会把 /name 填入聊天输入框。"
kind: "package-reference"
---

# @dv/ui-minimax-skills

[English](README.md) | 中文

## 概述

使用本包可从模板卡片启动 MiniMax 技能。本包在 DreamVerse 首页和探索区显示九张带预览 GIF 的卡片。点击卡片会把 `/<skill> ` 填入聊天输入框；用户补充需求后发送消息。

## 使用本包

DreamVerse bundle [`@dv/bundle`](../../bundle/dv/README.zh.md) 在 Host 插件 [`@dv/minimax-skills`](../minimax-skills/README.zh.md) 旁挂载本包，因此每个 DreamVerse profile 都显示这些卡片。本包在 DreamVerse 首页的 `dv.templates` 插槽注册九张模板卡片，并在 `dv.explore` 插槽注册 MiniMax 模板标签。每张卡片显示 `@dv/minimax-skills` 通过 `GET /api/minimax/previews/<skill>.gif` 提供的预览 GIF。

点击卡片会把 `/<skill> ` 填入当前会话的草稿并聚焦输入框。点击不会创建项目，也不会发送消息；用户补充需求并发送后才调用技能。

## 实现说明

`src/client/index.ts` 注册两个插槽条目，并通过已挂载会话的 `conversation` 输入写入草稿。`src/client/labels.ts` 按卡片顺序保存卡片标签，键类型来自 `@dv/minimax-skills/types` 的 `MiniMaxSkill`，因此编译器会拒绝缺失或未知的技能。`src/index.ts` 是空的 Host 入口。

## 模型体验

间接地，通过 `dsh-tool-skill`；点击卡片只填写输入框，用户发送消息后，`dsh-tool-skill` 注入所点名的技能，技能才到达模型。

#### KV Cache 影响

无；卡片不向模型发送任何内容。

## 已知限制与后续工作

- **固定卡片集** — 卡片只覆盖 `@dv/minimax-skills` 的九个 MiniMax 技能；其他技能显示在 `@dv/ui-skills` 的技能页面。
