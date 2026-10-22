# Agent Note: DreamVerse 客户端状态类型——必填的切片合并与部分的 wire 视图

Status: implemented

[English](2026-10-17-dv-architecture-client-state-types.md) | 中文

## 问题

每个 DreamVerse 组件把自己的项目数据放在项目状态的一个切片（slice）里，服务器通过 `WireState.components` 把这些切片发给浏览器；切片如何计算和发送由 [数据流 Agent Note](2026-10-17-dv-architecture-data-flow.zh.md) 负责。每个 UI 包把自己切片的类型以必填键的形式合并进 `@dv/ui-kit/types.ts` 的 `ComponentStates` 接口，例如 `packages/dv/ui-character/src/client/index.ts` 中的 `character: CharacterState`。`WireState.components` 的类型曾是 `ComponentStates`，因此类型声称每个合并进来的切片在浏览器中始终存在。

没有任何运行时事实支撑这一说法。bundle 文件 `packages/bundle/dv/cordis.patch.yml` 把宿主插件（例如 `@dv/character`）和它的 UI 插件 `@dv/ui-character` 作为两行分别挂载，而 UI 插件只注入渲染器 `@deepseek-ai/dsh-client-ui-renderer`。服务器只为宿主插件已加载的组件构建切片。这一错误说法造成两个后果：

- 编译器接受的读取在运行时抛错。`packages/dv/ui-timeline/src/client/timelines.ts` 中的 `timelinesOf` 返回 `state.components.timeline.timelines`，当服务器没有加载 `@dv/timeline` 时会抛出 `TypeError`。`packages/dv/ui-shot-plan/src/client/` 中两处对 `state.components.plan.plans` 的读取，以及 `packages/dv/ui-kit/src/client/reference-kit.tsx` 中对名词切片的 `Object.entries` 调用，都有同样的缺陷。
- 添加一个引用名词需要修改共享包。`packages/dv/ui-kit/tests/fixture.client.tsx` 中的 `fixtureState()` 返回一个完整的 `WireState`，供每个包的 UI 测试共用，因此它必须列出每个合并进来的键；它持有 `character`、`location: {}` 和 `style: {}`。第四个名词 `prop` 采用同样的必填客户端合并后，根客户端类型检查在这个 fixture（测试前置数据）中报错：`TS2741: Property 'prop' is missing … but required in type 'ComponentStates'`。可用的修法只有修改 `@dv/ui-kit`，或在名词自己的包里写可选合并加 `?? {}`；后者只是挪动了错误说法，并没有消除它。

## 决策

切片合并在宿主和客户端上都保持必填。客户端的协议视图是部分的：`WireState.components` 的类型是 `WireComponents = Pick<ComponentStates, 'proj' | 'asset'> & Partial<ComponentStates>`，其中只有 `proj` 和 `asset` 是必填的，因为发送状态的 `@dv/api` 插件只注入了它们的所有者 `dvProject` 和 `dvAssetPool`。每个切片的所有者只在一个访问函数（`itemsOf`、`timelinesOf`、`plansOf`）中定义一次缺失的含义。缺失切片的值等于所有者在宿主上的初始切片，因此"插件未加载"和"切片为空"画出的视图相同。引用名词 `fields` 条目的值类型同样是必填的，因为 `packages/dv/reference-kit/src/index.ts` 中的 kit reducer 会把每个声明的字段写进每个版本。读取具名切片的代码用 `Pick` 为它们定类型，并由调用方证明它们存在，`packages/dv/api/src/summaries.ts` 中的 `SummarySource` 就是这样。

共享的客户端测试状态 `FixtureState` 列出它持有的切片，不持有任何名词切片，因此新增名词不修改任何共享文件。合并进宿主 `ComponentStates` 的仅测试用键保持可选，例如 `packages/dv/reference-kit/tests/support.ts` 中的 `test_ref?:` 和 `packages/dv/project/tests/reducers.spec.ts` 中的 `reducers_test?:`，因为根宿主类型检查程序包含每个宿主测试文件，合并到那里的测试键会进入每个包的宿主状态类型。`packages/dv/ui-kit/tests/reference-kit.client.spec.tsx` 中的用例"draws no entry, @ item or version for a state without the slice of the noun"固定了 kit 在切片缺失时的行为。

声明、wire 视图、访问函数和 `FixtureState` 记录在 [界面](../../../../docs/dreamverse/subsystems/ui.zh.md#wire-types) 中。

## Cordis 对应关系

这个模型照搬 Cordis 为服务定类型的方式。Cordis 把一个服务声明一次，作为 `Context` 的必填成员，由读取方说明服务是否存在：

| Cordis                                                                                                                                                                                          | DreamVerse 切片                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `Context` 增补：一个必填成员，例如 `packages/dv/character/src/index.ts` 中的 `dvCharacter: DvCharacter`                                                                                         | 宿主和客户端上必填的 `ComponentStates` 合并                                                                                   |
| `inject`：插件"only loads while all are available"（`vendor/cordis/src/registry.ts`），未注入就访问会抛出 `cannot get property "…" without inject`（`vendor/cordis/src/reflect.ts`）            | 宿主所有者读取自己的切片；在浏览器中是 `proj` 和 `asset`（`WireComponents` 的 `Pick` 部分）                                   |
| `ctx.get(name)`，类型为 `undefined \| this[K]`（`vendor/cordis/src/reflect.ts`）；读取方在读取处定义缺失，如 `packages/dv/api/src/index.ts` 中的 `this.ctx.get('dvModels')?.taskLabels() ?? {}` | 浏览器中的其他每个切片（`WireComponents` 的 `Partial` 部分）；所有者的访问函数（`itemsOf`、`timelinesOf`、`plansOf`）定义缺失 |
| 插件的 `inject` 列表列出它持有的服务                                                                                                                                                            | `FixtureState` 列出共享测试状态持有的切片                                                                                     |

在宿主上，reducer 注册表是存在性背后的运行时事实：`packages/dv/project/src/reducers.ts` 中的 `reduceChain` 从每个已注册 reducer 的初始切片开始构建切片，`componentStates` 对完整的 `ComponentStates` 类型只断言一次。在浏览器中，切片只是服务器发来的 JSON 的一个字段，浏览器中的 Cordis 实例并不知道服务器加载了哪些宿主插件，所以客户端状态采用 `ctx.get` 的形式。

## 曾考虑的替代方案

**每个名词写可选合并，并在每处读取写 `?? {}`。** 每个 UI 包写 `<k>?: <K>State` 和 `slice: state => state.components.<k> ?? {}`，`traits` 之类的额外字段也变为可选。它落选是因为它靠约定把存在性放在每个声明上：忘记写 `?` 的作者在名词自己的包里编译通过，只在 `@dv/ui-kit` 的 fixture 中失败，也就是"问题"一节描述的那种失败。同一个键于是在宿主上必填、在客户端上可选。`plan` 和 `timeline` 的读取仍保留运行时缺陷。可选的 `traits?` 声称字段可能缺失，而 kit reducer 总会写入它。

**共享 fixture 列出每个名词。** 合并保持必填，每添加一个名词就把它的空切片加进 `fixtureState()`。它落选是因为每个名词和每个字段都要修改 `@dv/ui-kit`，而且类型仍然声称每个切片都存在。

**保留完整类型，在 kit 中用 `Object.hasOwn` 检查，在 fixture 中加类型断言。** `WireState.components` 保持 `ComponentStates` 类型，kit 只在 `Object.hasOwn(state.components, spec.key)` 之后读取名词切片。它落选是因为类型仍然声称存在：`timelinesOf` 仍被定为存在并且仍会抛错，fixture 也需要类型断言。

**kit 按 `key` 读取切片，不要 `slice` 函数。** `defineReferenceUi` 接收受条件类型 `ReferenceKey` 约束的 `key: K`，自己读取 `state.components[spec.key]`。它是正确的，但需要这个条件类型和 kit 中的一次断言。合并已经为 `slice` 函数定了类型，两者都不需要，所以 `slice` 函数以更简单胜出。

**单独的 `SliceTypes` 映射，值为 `unknown`。** 合并进入 `SliceTypes` 接口，`ComponentStates` 只保留 `proj`、`asset` 和 `[key: string]: unknown`。它诚实且不需要断言，但大约 25 处测试读取和 3 处源码读取失去类型，手写的测试切片也失去类型检查。

**每个包一个客户端类型检查程序。** 每个 UI 包单独对自己的测试做类型检查，fixture 就看不到第四个名词的合并。它落选是因为它把错误藏起来，错误说法依然存在；`tsconfig.client.json` 有意建立一个聚合的客户端程序。

## 后果

添加一个引用名词需要写必填的宿主合并、必填的客户端合并、一次 `defineReferenceUi({ id, key, slice, label, mention })` 调用和 `export const apply = <k>.apply`。它不写 `?`、`?? {}`、类型断言，也不修改任何共享包；kit 和一个名词的实测成本由 [引用名词 Agent Note](2026-10-17-dv-architecture-reference-nouns.zh.md) 负责。额外的名词字段（例如通过 `fields` 声明的 `traits: string[]` 字段）是必填类型。

当宿主插件缺失时，所有者负责的读取不会抛错：`timelinesOf`、`plansOf` 和 kit 的名词读取返回所有者的空值。编译器检查缺失：客户端代码中像 `state.components.character.hero` 这样的直接读取会报错 `'state.components.character' is possibly 'undefined'`，所以读取方要么经过所有者的访问函数，要么用 `Pick` 证明存在。

代价是每个非 kit 所有者一个访问函数，以及读取 `plan` 或 `timeline` 的测试要使用的 `FixtureState` 类型。把这个模型应用到已发布的包时改动了 17 个文件，新增 66 行、删除 52 行；逻辑改动只在 `@dv/ui-kit` 中，其余改动大多在测试里。

宿主还有一处缺口。`packages/dv/` 下的 `api/src/wire.ts`、`api/src/summaries.ts` 和 `chat-references/src/expand.ts` 读取 `state.components.timeline.timelines`，但它们所在插件的 `inject` 列表只有 `dvProject` 和 `dvAssetPool`（`packages/dv/api/src/index.ts`、`packages/dv/chat-references/src/index.ts`）。这些读取在没有 Cordis 保证的情况下假定 `@dv/timeline` 已加载。按照 Cordis 的规则，修法是在这两个 `inject` 列表中加入 `dvTimeline`。
