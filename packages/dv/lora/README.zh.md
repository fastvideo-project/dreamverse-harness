---
description: "DreamVerse 的社区 LoRA 注册表：dvLora 服务持有部署方认可的适配器，为 agent 提供 dv_lora_list 与 dv_lora_get 工具，并通过 community-lora 运行时技能说明何时以及如何把适配器应用到镜头上。"
kind: "package-reference"
---

# @dv/lora

[English](README.md) | 中文

## 摘要

用这个包发布 DreamVerse 部署方认可的社区 LoRA，让 agent 能为一个镜头选择适配器，并让视频 provider 把它作为渲染的 `extra.lora` 参数提供出来。服务 `dvLora` 为每个适配器保存一条注册表记录：id、创作者读到的名称与描述、触发词、默认强度与允许强度、它面向的模型与任务、许可证与来源页。该行的配置就是整份注册表，因此由部署方决定提供哪些第三方权重。这个包注册两个工具 `dv_lora_list` 与 `dv_lora_get`，以及 `community-lora` 运行时技能；它本身不渲染。

## 目录

- [使用这个包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## 使用这个包

把它挂载一次，放在读取它的视频 provider 之前，并写入部署方的适配器。DreamVerse bundle 把它挂载为行 `dv-lora`：

```yaml
- id: dv-lora
  name: '@dv/lora'
  config:
    adapters:
      - id: fal/MiniMax-H3-Realism-People-LoRA
        displayName: Realism People
        description: Photoreal skin, faces and hands for people in a shot.
        triggerWords: [r34l1sm]
        defaultStrength: 1.0
        minStrength: 0
        maxStrength: 1.5
        targets:
          - model: fasth3
            tasks: [t2v, ref2v]
        license: other (see the source page)
        sourceUrl: https://huggingface.co/fal/MiniMax-H3-Realism-People-LoRA
```

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `adapters` | 必填 | 本部署发布的社区 LoRA；空列表让注册表为空 |
| `adapters[].id` | 必填 | 适配器 id：渲染服务器加载的 Hugging Face 仓库 id 或本地路径，也是渲染请求命名的 id |
| `adapters[].displayName` | 必填 | agent 与用户读到的名称 |
| `adapters[].description` | `''` | 适配器在镜头里改变什么，以及它训练所基于的模型 |
| `adapters[].triggerWords` | `[]` | prompt 必须带上的、让效果显现的词 |
| `adapters[].defaultStrength` | `0.8` | 请求只给 id 时使用的强度 |
| `adapters[].minStrength` / `maxStrength` | `0` / `2` | 本部署提供的强度范围 |
| `adapters[].targets` | 必填 | 适配器面向的模型，以及每个模型的任务 |
| `adapters[].license` | `''` | 适配器权重的许可证 |
| `adapters[].sourceUrl` | `''` | 权重来源页，供许可证要求的署名使用 |

加载在以下情况失败：id 重复、不满足 `minStrength <= defaultStrength <= maxStrength`、目标命名了目录未声明的任务，或 id 为空。provider [`@dv/fastvideo`](../fastvideo/README.zh.md) 在挂载时读取注册表，并把服务器的允许列表收敛到本注册表为该条目的模型与任务发布的适配器，因此两行必须在 id 上一致。服务器自己的配置也必须允许同一个 id；否则渲染会在服务器处失败。

两条规则让注册表保持诚实。id 就是服务器加载的 id，因此也是渲染请求发送的内容；请求里的短昵称需要一张两行都不拥有的映射表。强度范围是本部署试过的范围，而不是适配器作者描述的范围：注册表是部署方的承诺，服务器的允许列表是它的执行。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`DvLora` 扩展 Cordis 的 `Service`，并把自己注册为 `dvLora`。构造函数校验配置、冻结每个适配器的一条记录、在 DSH 工具注册表中注册两个工具、在 DSH 技能注册表中注册一个技能；每次注册都是一个 `ctx.effect`，因此销毁这个包会同时移除工具、技能与服务。provider 用 `ctx.get('dvLora')` 读取服务，未挂载这个包时得到 `undefined`——此时参数只来自服务器的允许列表。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `Config`、`LoraDefinition`、`dvLora` 服务、`dv_lora_list` 与 `dv_lora_get` 工具，以及 `community-lora` 技能的注册 |
| [`skills/community-lora.md`](skills/community-lora.md) | 技能正文：何时应用适配器、如何命名与调整强度、为什么基于基础 H3 训练的社区适配器在 8 步 FastH3 上需要合适的强度，以及为什么不使用降步数适配器 |
| [`tests/lora.spec.ts`](tests/lora.spec.ts) | 一个带系统提示词、两个注册表与该包的 Loader 组合：注册表、工具、技能、销毁，以及配置拒绝 |

工具通过 `defineTool` 的 `json` 输出返回 JSON，并使用 snake_case 线上字段名（`display_name`、`trigger_words`、`default_strength`、`strength_range`、`targets`、`license`、`source_url`），因为 agent 按 JSON 读取它们。`dv_lora_list` 按 `model` 与 `task` 过滤，让 agent 恰好问到某个镜头可用的适配器；`dv_lora_get` 在 id 未知时列出提供的 id，因此一个错误 id 只花一次调用，而不是一次白跑的渲染。

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/fastvideo`](../fastvideo/README.zh.md)：提供 `extra.lora` 并把选择发送给服务器的 provider。
- [`@dv/models`](../models/README.zh.md)：目标所命名的模型目录。
- [`dsh-tool-skill`](../../skill/tool-skill/README.zh.md)：agent 如何看到技能目录并加载技能。

-----

<a id="model-experience"></a>
## 模型体验

### `dv_lora_list` 与 `dv_lora_get` 工具

#### 模型看到什么

工具注册表挂载期间，工具目录列出这两个工具。每条记录持有适配器的 `id`、`display_name`、`description`、`trigger_words`、`default_strength`、`strength_range`、`targets`、`license` 与 `source_url`，与配置写入的内容一致。工具 schema 由 `defineTool` 生成；参数 schema 见生成的[工具目录](../../../docs/tool-catalog.zh.md)。注册表不提供的 id 会用一句列出所提供 id 的话拒绝：

##### 未知 id 的拒绝语句

```markdown
dv-lora serves no adapter "nobody/none"; it serves: fal/MiniMax-H3-Realism-People-LoRA. Call dv_lora_list.
```

#### Token 影响

包挂载期间，两个工具 schema 在组装后的请求里约占 120 token。每次调用追加它的记录：`dv_lora_list` 中每个适配器约 120 token，一次 `dv_lora_get` 约 80 token。

#### KV Cache 影响

包挂载期间，工具 schema 是稳定前缀，因此挂载或卸载它只会替换一次工具段。调用结果作为普通工具结果追加；它们不会让前面的前缀失效。

### `community-lora` 技能

#### 模型看到什么

技能注册表挂载期间，技能目录列出下面的条目。用 `skill` 工具调用 `community-lora` 会返回 [`skills/community-lora.md`](skills/community-lora.md) 的正文：镜头何时该用适配器、如何在 `extra.lora` 中命名它并调整强度、为什么基于 50 步基础 H3 训练的适配器在 8 步 FastH3 上需要不同的强度，以及为什么这里不用 "turbo" 适配器。用户不能用 `/community-lora` 调用它；只有 agent 加载它。

##### 目录条目

```markdown
- `community-lora`: When and how to apply a community LoRA to a shot: choosing an adapter, its trigger words and strength, and why step-reduction adapters are not used on FastH3.
```

#### Token 影响

包与技能注册表挂载期间，目录里约占 40 token；agent 每次加载技能约 900 token。

#### KV Cache 影响

挂载或卸载这个包会改变技能列表，`dsh-tool-skill` 会追加一份替换目录；已加载的技能正文作为工具结果追加。两者都保持它们之前的缓存前缀不变。

-----

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **注册表不加载也不校验权重。** 它记录部署方发布的内容；渲染服务器的允许列表才是执行。服务器无法加载的适配器会在请求到达服务器后、以加载器的消息失败。
- **每个镜头一个适配器。** FastVideo 的旁支 LoRA 层一次只持有一个适配器，叠加第二个会被拒绝。注册表没有叠加字段，因为没有 provider 支持。
- **没有按适配器的提示词技能条目。** 技能说明共享规则；需要长工作流的适配器，例如用对齐引导 latent 训练的角色替换适配器，不会被描述为可用，因为 FastVideo 还没有那条条件输入路径。
- **注册表不是模型许可证。** MiniMax-H3 社区许可证与每个适配器自己的许可证同时适用。注册表记录适配器的许可证与来源用于署名，并不构成法律审查。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者的工作上下文——点击展开</summary>

None.

</details>
