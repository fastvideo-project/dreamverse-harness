# Contributing

English | [中文](CONTRIBUTING.zh.md)

Thank you for your interest in contributing to DreamVerse Harness!

DreamVerse Harness is built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), and every capability it adds is a plugin. That makes most contributions small and self-contained: a provider plugin for a new model, a skill that teaches the agent a workflow, a feature, or a fix.

DreamVerse Harness is still at an early stage and under active development, so interfaces can change between releases.

## Ways to contribute

- Report bugs and request features in [GitHub Issues](https://github.com/fastvideo-project/dreamverse-harness/issues). Include the steps to reproduce, the models and servers you connected, and the relevant logs.
- Share provider plugins and skills: open a pull request, or post them in the [FastVideo Slack](https://join.slack.com/t/fastvideo/shared_invite/zt-4heayzk81-lOkgpvJRoceuZjNP7pXxJA) or on [Discord](https://discord.gg/dqc2J2yNQ).
- Improve the documentation, and write blog posts and how-to guides about what you make with DreamVerse Harness.
- Answer questions and help other members of the community.

To report a security vulnerability, do not open a public issue; follow [SECURITY.md](SECURITY.md).

## Pull requests

Every new generation provider must include a provider-specific maintenance guide. Follow the [provider contribution guide](docs/cookbook/adding-a-dreamverse-provider.md).

1. Start with the [development guide](docs/development.md) and the [architecture documentation](docs/architecture.md). Agents follow [AGENTS.md](AGENTS.md).
2. For a larger change, open an issue first so that we can agree on the approach before you write it.
3. Keep each pull request focused on one change, and fill in the pull request template, including how you tested it.
4. Run the smallest checks that cover your change; the development guide lists them. Documentation changes run `pnpm run doc-sync`.

Changes that belong to the underlying agent harness rather than to video production are usually better proposed to [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) itself.

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE) of this repository.
