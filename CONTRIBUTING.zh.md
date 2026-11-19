# 贡献

[English](CONTRIBUTING.md) | 中文

感谢你关注 DreamVerse Harness！我们欢迎所有人提交 pull request。DreamVerse Harness 构建于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 之上，所以下面的大部分仓库规则和工具都来自 DeepSeek Harness。

## 参与方式

- 在 [GitHub Issues](https://github.com/fastvideo-project/dreamverse-harness/issues) 报告 bug、提出功能需求。
- 在 [FastVideo Slack](https://join.slack.com/t/fastvideo/shared_invite/zt-4heayzk81-lOkgpvJRoceuZjNP7pXxJA) 或 [Discord 服务器](https://discord.gg/dqc2J2yNQ) 提问并分享你的作品。
- 为新模型写一个提供方插件，或者写一个教 agent 新工作方式的 skill，然后通过 pull request 或在 Slack、Discord 上分享。
- 通过 pull request 修复 bug、改进文档或添加功能。

## 开始之前

- 按照[开发指南](docs/development.zh.md)设置仓库，并从源码运行。
- 阅读[架构文档](docs/architecture.zh.md)和 [DreamVerse 包页面](docs/subsystems/video-harness.zh.md)。DreamVerse 的代码位于 `packages/dv/` 和 `packages/bundle/dv/`。
- 遵循 [AGENTS.md](AGENTS.md) 中的规则。这些规则同时适用于人和编程 agent。

## Pull request 的检查

- `pnpm install` 会安装 Git hook。`pre-commit` hook 检查暂存的文件，`pre-push` hook 运行 `pnpm run typecheck`。
- 推送之前，按照 [AGENTS.md](AGENTS.md#run-relevant-checks-locally) 的说明，把覆盖你改动的检查运行一次。例如，用 `pnpm exec vitest run <test file>` 运行改动行为对应的测试文件，代码改动运行 `pnpm run lint`，文档改动运行 `pnpm run doc-sync`，包清单和导出的改动运行 `pnpm run build`。
- 修改英文文档时同时修改它的中文配对文档，并用 `pnpm run verify-translation-pairing --write <file>.md` 记录这对文档。规则见[双语文档约定](docs/i18n/README.zh.md)。
- 填写 [pull request 模板](.github/pull_request_template.md)：问题、改动，以及测试和测试输出。如果改动了用户界面，请附上一个在真实运行的应用中录制的 GIF。
- 不要提交 API key 或其他凭据。
