---
description: "MiniMax 技能集的浏览器部分：在 DreamVerse 首页和探索区显示九张带预览 GIF 的模板卡片；点击卡片会把 /name 填入聊天输入框。"
kind: "package-reference"
---

# @dv/ui-minimax-skills

[English](README.md) | 中文

## 使用本包

[`@dv/minimax-skills`](../minimax-skills/README.zh.md) 的 bundle 会在 Host 插件旁挂载本包，因此选择该 bundle 的 profile 无需额外配置行。本包在 DreamVerse 首页的 `dv.templates` 插槽注册九张模板卡片，并在 `dv.explore` 插槽注册 MiniMax 模板标签。每张卡片显示 `@dv/minimax-skills` 通过 `GET /api/minimax/previews/<skill>.gif` 提供的预览 GIF。

点击卡片会把 `/<skill> ` 填入当前会话的草稿并聚焦输入框。点击不会创建项目，也不会发送消息；用户补充需求并发送后才调用技能。

## 实现说明

`src/client/index.ts` 注册两个插槽条目，并通过已挂载会话的 `conversation` 输入写入草稿。`src/client/labels.ts` 按卡片顺序保存卡片标签，键类型来自 `@dv/minimax-skills/types` 的 `MiniMaxSkill`，因此编译器会拒绝缺失或未知的技能。`src/index.ts` 是空的 Host 入口。

## 模型体验

本包不添加任何模型可见输入。模型只看到用户发送的 `/name` 消息。

## 已知限制与后续工作

- **Bundle 选择** — 当前没有内置 DreamVerse profile 选择 `@dv/minimax-skills` bundle，因此全新安装在 profile 添加该 bundle 前不会显示卡片。
