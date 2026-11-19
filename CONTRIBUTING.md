# Contributing

English | [中文](CONTRIBUTING.zh.md)

Thank you for your interest in DreamVerse Harness! We welcome pull requests from everyone. DreamVerse Harness is built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), so most of the repository rules and tools below come from DeepSeek Harness.

## Ways to help

- Report bugs and request features in [GitHub Issues](https://github.com/fastvideo-project/dreamverse-harness/issues).
- Ask questions and share what you make in the [FastVideo Slack](https://join.slack.com/t/fastvideo/shared_invite/zt-4heayzk81-lOkgpvJRoceuZjNP7pXxJA) or on the [Discord server](https://discord.gg/dqc2J2yNQ).
- Write a provider plugin for a new model, or a skill that teaches the agent a new way to work, and share it in a pull request or in Slack or Discord.
- Fix a bug, improve the documentation, or add a feature in a pull request.

## Before you start

- Follow the [development guide](docs/development.md) to set up the repository and run it from source.
- Read the [architecture documentation](docs/architecture.md) and the [DreamVerse packages page](docs/subsystems/video-harness.md). The DreamVerse code is in `packages/dv/` and `packages/bundle/dv/`.
- Follow the rules in [AGENTS.md](AGENTS.md). They apply to people and to coding agents.

## Checks for a pull request

- `pnpm install` installs the Git hooks. The `pre-commit` hook checks the staged files, and the `pre-push` hook runs `pnpm run typecheck`.
- Run the checks that cover your change once before you push, as [AGENTS.md](AGENTS.md#run-relevant-checks-locally) describes. For example, run the test file of the changed behavior with `pnpm exec vitest run <test file>`, `pnpm run lint` for code, `pnpm run doc-sync` for documentation, and `pnpm run build` for package manifests and exports.
- Change each English document together with its Chinese pair, and record the pair with `pnpm run verify-translation-pairing --write <file>.md`. The [bilingual documentation contract](docs/i18n/README.md) gives the rules.
- Fill in the [pull request template](.github/pull_request_template.md): the problem, the changes, and the tests with their output. For a change to the user interface, add a GIF recorded from a real run of the app.
- Never commit API keys or other credentials.
