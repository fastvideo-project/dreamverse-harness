# 贡献

[English](CONTRIBUTING.md) | 中文

感谢你愿意为 DreamVerse Harness 作出贡献！

DreamVerse Harness 基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 构建，它新增的每项能力都是一个插件。因此，大多数贡献都小而独立：为新模型编写的 provider 插件、教会智能体某个工作流程的技能、一项功能，或一次修复。

DreamVerse Harness 仍处于早期阶段，并在积极开发中，因此不同版本之间的接口可能发生变化。

## 参与方式

- 在 [GitHub Issues](https://github.com/fastvideo-project/dreamverse-harness/issues) 中报告 bug 或提出功能需求。请附上复现步骤、你连接的模型和服务器，以及相关日志。
- 分享 provider 插件和技能：提交 PR（Pull Request），或发布到 [FastVideo Slack](https://join.slack.com/t/fastvideo/shared_invite/zt-4heayzk81-lOkgpvJRoceuZjNP7pXxJA) 或 [Discord](https://discord.gg/dqc2J2yNQ)。
- 改进文档，并撰写博客文章和操作指南，介绍你用 DreamVerse Harness 制作的作品。
- 回答问题并帮助其他社区成员。

如需报告安全漏洞，请不要创建公开 Issue，而是按照 [SECURITY.md](SECURITY.md) 处理。

## Pull Request

新增生成提供商时，需要提交该提供商的维护指南。参阅[提供商贡献指南](docs/cookbook/adding-a-dreamverse-provider.zh.md)。

1. 从[开发指南](docs/development.zh.md)和[架构文档](docs/architecture.zh.md)开始。智能体遵循 [AGENTS.md](AGENTS.md)。
2. 对于较大的改动，请先创建 Issue，以便在动手编写之前就实现方案达成一致。
3. 每个 PR 只聚焦一项改动，并填写 PR 模板，包括你的测试方式。
4. 运行能覆盖你的改动的最小检查集；开发指南列出了这些检查。文档改动需运行 `pnpm run doc-sync`。

属于底层智能体 harness、而非视频制作的改动，通常更适合直接向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提出。

提交贡献即表示你同意你的贡献按本仓库的 [MIT License](LICENSE) 授权。
