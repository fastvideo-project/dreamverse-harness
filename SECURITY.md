# Security policy

## Reporting a vulnerability

Please do not report security vulnerabilities in public GitHub issues, pull requests, Slack or Discord.

Report them privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**, or go to [the new advisory form](https://github.com/fastvideo-project/dreamverse-harness/security/advisories/new). Include:

- the affected component (for example the Web UI, the `dsh` CLI, a plugin under `packages/`, or the FastVideo provider);
- the version or commit you tested;
- the steps to reproduce, and a proof of concept if you have one;
- the impact you expect, such as code execution, a sandbox escape, or disclosure of files or credentials.

We will acknowledge your report, keep you informed while we investigate and fix it, and credit you in the advisory unless you prefer to stay anonymous. Please give us reasonable time to release a fix before you disclose the issue publicly.

## Scope

In scope:

- escaping the sandbox, approval prompts, or permission controls;
- reading, writing, or sending files, credentials, or API keys that the configuration does not grant;
- remote access to the Web UI, its API, or a local server that is meant to be reachable only from the same machine;
- vulnerabilities in the plugins and skills that this repository ships.

Out of scope:

- behavior described in [SAFETY.md](SAFETY.md): DreamVerse Harness runs model-generated commands and third-party plugins with the access you give it, and it is not a security boundary for untrusted workloads;
- vulnerabilities in third-party plugins, models, or servers that you connect, such as a FastVideo, vLLM, or SGLang server; report those to their maintainers;
- denial of service through your own resource limits, such as running out of GPU memory.

DreamVerse Harness is built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). If a vulnerability also affects DeepSeek Harness, tell us in your report; we coordinate with its maintainers.

## Supported versions

DreamVerse Harness is a developer preview. Security fixes land on the `main` branch and in the next release; older releases are not patched.
