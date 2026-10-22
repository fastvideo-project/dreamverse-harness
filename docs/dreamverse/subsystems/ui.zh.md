# 界面

[English](ui.md) | 中文

本页是 DreamVerse 历史面板的参考，以及它在项目历史和智能体在一个对话中的轨迹之间建立的链接。

## 历史和轨迹

历史是项目历史列表中按顺序排列的步骤，来自每个发起者、视图和对话；轨迹是智能体在一个对话中的步骤。记录通过它的 `session` 和 `tool_call` 字段把两者连起来。[`@dv/ui-history`](../../../packages/dv/ui-history/README.zh.md) 是历史面板（标签类型 `dv-history`）。它把历史列表中的每一步各列为一行，最新的在前，显示动作、谁做的（你 / You、智能体 / Agent、自动 / Automatic）、状态和一张输出缩略图；当前位置标 当前 / Current，它之后的步骤显示为灰色，批准分镜计划时排定的记录折叠在该批准行之下。它的顶部放着撤销和重做按钮。每一行的 ⋮ 菜单提供 回到这一步 / Go back to this step，它把当前位置移到那一行（[历史规则](project.zh.md#history-rules)）。选中当前位置或之前某一步的那一行，会在画布上聚焦该记录的节点（`dv:canvas-focus`）或在时间线上聚焦它的片段（`dv:timeline-focus`）；行内的 在轨迹中查看 / Show in trajectory 链接发出 `dv:trajectory-focus`，`@dv/ui-shell` 随即在那个对话的那次工具调用处打开 轨迹。在对话中，写入记录的工具的每个已结束行都有 在历史中查看 / Show in history 链接，它发出 `dv:history-focus`，让历史面板选中那次工具调用写入的记录。
