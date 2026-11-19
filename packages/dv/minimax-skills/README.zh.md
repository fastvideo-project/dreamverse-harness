---
description: "独立的 MiniMax H3 技能集插件：九个可发现技能、按需指令、受限引用读取及可选模板预览。"
kind: "package-reference"
---

# @dv/minimax-skills

[English](README.md) | 中文

## 使用插件

挂载本插件即可将九个固定版本的 MiniMax 技能注册到现有中央技能注册器。Host 只要求 `skills` 服务，不运行时依赖项目、画布、图像、音频或视频插件。引用工具与预览路由只在现有服务存在时启用。

DreamVerse bundle [`@dv/bundle`](../../bundle/dv/README.zh.md) 挂载本 Host 插件及其浏览器包 [`@dv/ui-minimax-skills`](../ui-minimax-skills/README.zh.md)，因此每个 DreamVerse profile 都有这些技能和首页模板卡片。其他组合挂载同样两行：

```yaml
- id: dv-minimax-skills
  name: '@dv/minimax-skills'
- id: dv-ui-minimax-skills
  name: '@dv/ui-minimax-skills'
```

在本仓库先运行 `pnpm exec tsc -b packages/dv/minimax-skills packages/dv/ui-minimax-skills`，再运行 `pnpm --filter @dv/ui-minimax-skills run bundle` 构建。这些包不会发布到 npm。

沿用 `tool-skill` 的目录与 `/name` 调用，例如发送 `/h3-prompt-writing 写一个产品视频提示词`。在首页或探索区的 MiniMax 标签选择模板，会把 `/name ` 填入当前草稿；补充需求并发送才调用技能。点击卡片不会创建项目或启动生成。单个 SKILL.md 的导入仍属于通用技能导入功能，不要求包装成插件。

## 加载与资源

启动时只读取由固定技能头部生成的 `assets/catalog.json` 元数据。列目录不读任何 SKILL.md 正文。调用 `ctx.skills.get()` 时才通过现有文件系统提供方加载指定技能，并追加本包独立维护的 DreamVerse 适配说明；其他技能正文及引用文件不加载。标准 slash 处理器负责注入，模型自行选择时沿用 `skill` 工具，没有新增专用 agent 或媒体执行引擎。

工具注册器存在时，`dv_skill_read_reference` 读取指定技能 `references/` 或 `agents/` 下的文本文档。参数 `skill` 是精确技能名，`path` 相对该技能目录。工具检查注册器当前胜出项、真实路径归属与字节上限，拒绝未知技能、路径越界与跨技能读取，不执行脚本。

浏览器包 `@dv/ui-minimax-skills` 拥有标签和卡片。本插件通过认证的 `GET /api/minimax/previews/<skill>.gif` Connection 路由服务固定预览 GIF，不依赖 Web 应用公共目录或媒体提供方的 MiniMax 专用改动。移除插件会清理技能目录、引用工具、预览路由和 UI 扩展。历史会话中已记录的指令仍保留，验证无插件基线时应使用新会话。

## 配置与兼容

| 字段 | 默认值 | 行为 |
| --- | --- | --- |
| `referenceMaxBytes` | `1048576` | 单次引用读取的字节上限 |

只有用户发送 `/name` 或模型通过 `skill` 工具加载时，技能才会运行。插件不读写任何项目数据。原来的正则自动路由改为标准元数据目录与模型选择。

来源与版本见 `assets/SOURCE.json`，官方技能文件保持原样。主动升级版本后运行 `pnpm --filter @dv/minimax-skills run catalog:generate` 更新目录。适配说明与上游技能分离维护。

## 模型体验

模型通过标准目录看到名称和描述，只有加载技能后才收到完整指令与适配说明。引用文本由受限工具返回。媒体任务仍由现有工具执行，沿用其参数与审批规则。

### KV Cache 影响

摘要沿用标准技能目录生命周期；完整指令和引用按需添加，安装插件不会将九份正文一次性注入上下文。

## 已知限制与延期工作

- **部署能力** — 技能涉及的部分 MiniMax Hub 能力可能不存在。适配器只映射已有 DreamVerse 工具，要求检查实际模型支持并披露缺失能力；安装本包不会安装、配置或授权媒体服务、独立音乐生成、字幕渲染或任意 Hub 编辑。可选 UI 使用通用 `dv.templates` 首页插槽与探索区插槽，无浏览器时仍可使用 Host 技能。无需单独 invariant 导出：实际 Loader 组合测试覆盖目录所有权、按需读取和卸载清理。
