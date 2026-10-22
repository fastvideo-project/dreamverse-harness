# User interface

English | [中文](ui.zh.md)

This page is the reference for the DreamVerse History panel and its links between the project's history and the agent's trajectory in a chat session.

## History and the trajectory

The history is the steps of the project's history list in order, from every actor, view, and chat session; the trajectory is the agent's steps in one chat session. A record links the two through its `session` and `tool_call` fields. [`@dv/ui-history`](../../../packages/dv/ui-history/README.md) is the History panel (tab type `dv-history`). It lists the steps of the history list, newest first, as one row each, with the action, who did it (你 / You, 智能体 / Agent, 自动 / Automatic), the status, and an output thumbnail; the current position carries 当前 / Current, the steps after it are gray, and the records that a plan approval scheduled fold under the approval's row. Its header holds the undo and redo buttons. Each row's ⋮ menu offers 回到这一步 / Go back to this step, which moves the current position to that row ([history rules](project.md#history-rules)). Selecting a row of a step at or before the current position focuses the record's node on the canvas (`dv:canvas-focus`) or its clip on the timeline (`dv:timeline-focus`); the row's 在轨迹中查看 / Show in trajectory link sends `dv:trajectory-focus`, and `@dv/ui-shell` opens 轨迹 on that chat session at that tool call. In the chat, every settled row of a tool that writes a record has an 在历史中查看 / Show in history link, which sends `dv:history-focus` so the History panel selects the record that tool call wrote.
