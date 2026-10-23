/**
 * The plan editor: the `dv.canvas.editor` entry that the canvas shows under the editor header of an entry `plan:<PlanId>`.
 * Its texts follow the interface language of `<html lang>`.
 * @module @dv/ui-shot-plan/PlanEditor
 */
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { HostObservable, InjectFace, PropsRenderFactories, PropsRuntime, RenderFactorySlot } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChainAnchor } from '@dv/ui-canvas/contract'
import type { PromptHost } from '@dv/ui-composer/contract'
import type { PlanVersion, Shot } from '@dv/shot-plan/types'
import { useText } from '@dv/ui-kit/locale.ts'
import { referenceItems } from '@dv/ui-kit/references.ts'
import type { VersionKind } from '@dv/ui-kit/registries.ts'
import { clockText } from '@dv/ui-kit/timeline.ts'
import { taskLabel, type WireTaskLabels } from '@dv/ui-kit/tool-labels.ts'
import type { WireOperation, WireState } from '@dv/ui-kit/types.ts'
import type {} from '@dv/ui-media/contract'

/** What the plugin injects: the `dvCanvas` chain anchors and version kinds, and the task labels, as observable sources. */
export interface PlanEditorInjected {
  hooks: {
    chainAnchors: HostObservable<readonly ChainAnchor[]>
    versionKinds: HostObservable<readonly VersionKind[]>
    /** Empty until `GET /api/dv/tasks` loads, and after it fails; a shot then shows its task by its name. */
    taskLabels: HostObservable<WireTaskLabels>
  }
}

const chipThumb: CSSProperties = { display: 'flex', width: 24, height: 24, overflow: 'hidden', borderRadius: 'var(--dv-radius-sm)', flex: 'none' }
/** A small rounded tag in the plan editor: the duration and model-and-task chips of a shot. */
const tag: CSSProperties = { height: 22, padding: '0 8px', display: 'inline-flex', alignItems: 'center', fontSize: 12, lineHeight: '16px', background: 'var(--dv-surface-3)' }
const mono: CSSProperties = { fontFamily: 'var(--dv-font-mono)', fontVariantNumeric: 'tabular-nums' }
const term: CSSProperties = { fontSize: 12, lineHeight: '16px', color: 'var(--dv-text-2)' }
/** The height a shot prompt is collapsed to until the reader expands it. */
const PROMPT_COLLAPSED_HEIGHT = 140

/**
 * @param version - a plan version.
 * @returns the total duration of its shots in seconds, or null when it has no shots or a shot has no duration.
 */
export function totalSec(version: PlanVersion): number | null {
  const durations = version.shots.flatMap(shot => shot.duration_sec === undefined ? [] : [shot.duration_sec])
  return durations.length > 0 && durations.length === version.shots.length ? durations.reduce((sum, duration) => sum + duration, 0) : null
}

/**
 * The reference texts a plan shot renders from: in task `ref2v`, the shot's own references, else the plan version's.
 * A shot in task `t2v` has none.
 * @param version - the plan version.
 * @param shot - one shot of the version.
 * @returns the reference texts (`<asset>`, `<record>#<output>`, or `<id>@<version>`).
 */
export function shotReferences(version: Pick<PlanVersion, 'references'>, shot: Pick<Shot, 'references' | 'task'>): string[] {
  return shot.task === 'ref2v' ? shot.references ?? version.references ?? [] : []
}

/** The plans of a state by `PlanId`, oldest version first; a state without the plan slice holds none. */
export const plansOf = (state: WireState): Readonly<Record<string, PlanVersion[]>> => state.components.plan?.plans ?? {}

/**
 * The plan editor: the version row, then the shots of the chosen version. The entry ID `plan:<PlanId>` names the plan;
 * the entry of a plan without versions shows nothing.
 * @param props - the node, the state, the registry and task label hooks, and the Factory renderer.
 * @returns the element.
 */
export function PlanEditor(
  { node, state, operations, host, useChainAnchors, useVersionKinds, useTaskLabels, renderFactorySlot }: PropsRuntime<'dv.canvas.editor'> & PropsRenderFactories & InjectFace<PlanEditorInjected>,
): ReactNode {
  const versions = plansOf(state)[node.id.slice(node.id.indexOf(':') + 1)] ?? []
  // The version on show; the editor holds the choice so the version row and the shot list read the same version.
  const [chosen, setChosen] = useState<number | null>(null)
  const anchors = useChainAnchors(value => value)
  const kinds = useVersionKinds(value => value)
  const taskLabels = useTaskLabels(value => value)
  // The canvas lends a new host object on each render; one stable host lets the memoized shot list skip the redraws of
  // a move or resize of the editor panel.
  const lent = useRef(host)
  lent.current = host
  const shotHost = useMemo<PromptHost>(() => ({
    preview: (asset, opener) => { lent.current.preview(asset, opener) },
    openNode: (nodeId) => { lent.current.openNode(nodeId) },
  }), [])
  const plan = versions.find(version => version.version === chosen) ?? versions.at(-1)
  if (plan === undefined) return null
  // The approved versions of the node are the union of what every chain anchor reports for it.
  const approved = anchors.some(anchor => anchor.approvedVersions?.(state, node.id).includes(plan.version) === true)
  return (
    <>
      <PlanHeader
        versions={versions} plan={plan} approved={approved} state={state} kinds={kinds} onChoose={setChosen}
        renderFactorySlot={renderFactorySlot}
      />
      <PlanShots
        plan={plan} state={state} operations={operations} taskLabels={taskLabels} host={shotHost} renderFactorySlot={renderFactorySlot}
      />
    </>
  )
}

/**
 * The version row: the chosen version's title, the version switch, its approval status, its shot count, total
 * duration and aspect ratio, and the plan's reference assets. The status is approved, awaiting approval (the latest
 * version only), or replaced by the next version.
 */
function PlanHeader(
  { versions, plan, approved, state, kinds, onChoose, renderFactorySlot }: {
    versions: readonly PlanVersion[]
    plan: PlanVersion
    approved: boolean
    state: WireState
    kinds: readonly VersionKind[]
    onChoose: (version: number) => void
    renderFactorySlot: RenderFactorySlot
  },
): ReactNode {
  const pick = useText()
  // A version that a later version replaced before anyone approved it never waits for approval again.
  const replaced = !approved && plan !== versions.at(-1)
  let status = pick('待批准', 'Awaiting approval')
  let tone = 'var(--dv-warn)'
  if (approved) { status = pick('已批准', 'Approved'); tone = 'var(--dv-ok)' }
  else if (replaced) { status = pick(`已被第 ${String(plan.version + 1)} 版取代`, `Replaced by v${String(plan.version + 1)}`); tone = 'var(--dv-text-2)' }
  const total = totalSec(plan)
  const summary = [pick(`${String(plan.shots.length)} 个镜头`, `${String(plan.shots.length)} shots`), ...total === null ? [] : [clockText(total)], ...plan.aspect_ratio === undefined ? [] : [plan.aspect_ratio]]
  const references = referenceItems(state, plan.references ?? [], kinds)
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      {plan.title === undefined || plan.title === '' ? null : <span style={{ fontSize: 14, lineHeight: '20px', fontWeight: 500 }}>{plan.title}</span>}
      <div role="group" aria-label={pick('分镜计划版次', 'Plan versions')} style={{ display: 'inline-flex', padding: 3, borderRadius: 'var(--dv-radius-md)', background: 'var(--dv-surface-3)' }}>
        {versions.map((version) => {
          const pressed = version === plan
          return (
            <button
              key={version.version} type="button" aria-pressed={pressed} onClick={() => { onChoose(version.version) }}
              className={pressed ? undefined : 'dv-canvas-btn'}
              style={{
                height: 24, padding: '0 10px', border: 'none', borderRadius: 'var(--dv-radius-sm)', fontFamily: 'inherit', fontSize: 12, lineHeight: '16px', cursor: 'pointer',
                ...pressed ? { background: 'var(--dv-surface-1)', color: 'var(--dv-text)', fontWeight: 500, boxShadow: '0 0 0 1px var(--dv-line-strong)' } : { color: 'var(--dv-text-2)' },
              }}
            >
              {pick(`第 ${String(version.version)} 版`, `v${String(version.version)}`)}
            </button>
          )
        })}
      </div>
      <span
        data-testid="dv-canvas-plan-status"
        style={{ height: 22, padding: '0 8px', display: 'inline-flex', alignItems: 'center', gap: 5, borderRadius: 9999, background: approved ? 'var(--dv-ok-soft)' : 'var(--dv-surface-3)', color: tone, fontSize: 12, lineHeight: '16px' }}
      >
        <span style={{ width: 6, height: 6, borderRadius: 9999, background: tone }} />{status}
      </span>
      <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--dv-text-2)' }}>{summary.join(' · ')}</span>
      <span style={{ flex: 1 }} />
      {references.length === 0
        ? null
        : (
          <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 12, lineHeight: '16px', color: 'var(--dv-text-2)' }}>
            {pick('计划参考', 'Plan references')}
            {references.map(({ name, asset }, index) => (
              <span key={index} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {asset === null ? null : <span style={{ ...chipThumb, boxShadow: '0 0 0 1px var(--dv-line-strong)' }}>{renderFactorySlot('dv.media', { asset, purpose: 'thumb' })}</span>}
                <span style={{ color: 'var(--dv-text)' }}>{name}</span>
              </span>
            ))}
          </span>
        )}
    </div>
  )
}

/**
 * The shots of one plan version as cards. Memoized, because a move or resize of the editor panel re-renders the editor
 * on every pointer move and each shot card renders a composer.
 */
const PlanShots = memo(function PlanShots(
  { plan, state, operations, taskLabels, host, renderFactorySlot }: {
    plan: PlanVersion
    state: WireState
    operations: readonly WireOperation[]
    taskLabels: WireTaskLabels
    host: PromptHost
    renderFactorySlot: RenderFactorySlot
  },
): ReactNode {
  const pick = useText()
  return (
    <ol aria-label={pick('镜头', 'Shots')} style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {plan.shots.map((shot, index) => (
        <ShotCard
          key={index} number={index + 1} shot={shot} referenceCount={shotReferences(plan, shot).length} taskLabels={taskLabels}
          prompt={renderFactorySlot('dv.prompt', {
            projectId: state.project.id, state, operations, readOnly: true, surface: 'canvas',
            host,
            call: {
              operation: 'shot.render', params: { prompt: shot.prompt, model: shot.model, task: shot.task },
              inputs: shotReferences(plan, shot).map(ref => ({ role: 'reference', ref })),
            },
          })}
        />
      ))}
    </ol>
  )
})

/**
 * One shot of a plan version as a card with exactly the fields that the plan holds.
 */
function ShotCard(
  { number, shot, referenceCount, taskLabels, prompt }: {
    number: number
    shot: Shot
    referenceCount: number
    taskLabels: WireTaskLabels
    prompt: ReactNode
  },
): ReactNode {
  const pick = useText()
  let noReferences: string | null = null
  if (shot.task === 't2v') noReferences = pick('无（文字生成不用参考图）', 'None (a text render uses no reference images)')
  else if (referenceCount === 0) noReferences = pick('无', 'None')
  return (
    <li data-shot={number} style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12, borderRadius: 'var(--dv-radius-lg)', background: 'var(--dv-surface-2)', boxShadow: '0 0 0 1px var(--dv-line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 16, lineHeight: '24px', fontWeight: 500 }}>{pick(`镜头 ${String(number)}`, `Shot ${String(number)}`)}</span>
        {shot.duration_sec === undefined
          ? null
          : <span style={{ ...tag, ...mono, borderRadius: 'var(--dv-radius-sm)', color: 'var(--dv-text-2)' }}>{pick(`${String(shot.duration_sec)} 秒`, `${String(shot.duration_sec)} s`)}</span>}
        <span data-testid="dv-canvas-shot-mode" style={{ ...tag, borderRadius: 9999, color: 'var(--dv-text)' }}>{`${shot.model} · ${pick(...taskLabel(shot.task, taskLabels))}`}</span>
      </div>
      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '72px minmax(0, 1fr)', gap: '8px 12px', alignItems: 'center' }}>
        {noReferences === null
          ? null
          : <><dt style={term}>{pick('参考', 'References')}</dt><dd style={{ margin: 0, minWidth: 0, color: 'var(--dv-text-2)' }}>{noReferences}</dd></>}
        <dt style={term}>{pick('首帧', 'First frame')}</dt>
        <dd style={{ margin: 0, color: 'var(--dv-text-2)' }}>{shot.continue_previous === true ? pick('接上一镜头', 'Continues the previous shot') : pick('无 · 不接上一镜头', 'None · does not continue the previous shot')}</dd>
        <dt style={{ ...term, alignSelf: 'start', paddingTop: 10 }}>{pick('提示词', 'Prompt')}</dt>
        <dd style={{ margin: 0, minWidth: 0 }}><PromptBox>{prompt}</PromptBox></dd>
      </dl>
    </li>
  )
}

/**
 * A shot prompt in full: the read-only `dv.prompt` composer of the shot, which draws each citation as a chip and the
 * shot's references as its tray. A prompt taller than {@link PROMPT_COLLAPSED_HEIGHT} starts collapsed under a fade,
 * with a toggle that shows all of it.
 */
function PromptBox({ children }: { children: ReactNode }): ReactNode {
  const pick = useText()
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const observer = useRef<ResizeObserver | null>(null)
  // The composer fills its editor after it mounts, redraws its chips as references resolve, and wraps again when the
  // panel's width changes. The box measures again on each resize of itself until React detaches it: it resizes with
  // its content until it reaches the collapsed height, and with the panel's width.
  const box = useCallback((element: HTMLDivElement | null): void => {
    observer.current?.disconnect()
    if (element === null) return
    const measure = (): void => { setOverflows(element.scrollHeight > PROMPT_COLLAPSED_HEIGHT) }
    measure()
    observer.current = new ResizeObserver(measure)
    observer.current.observe(element)
  }, [])
  const collapsed = overflows && !expanded
  return (
    <>
      <div
        ref={box}
        style={{
          position: 'relative', maxHeight: expanded ? 'none' : PROMPT_COLLAPSED_HEIGHT, overflow: 'hidden', boxSizing: 'border-box', padding: '10px 12px',
          borderRadius: 'var(--dv-radius-md)', background: 'var(--dv-surface-1)', boxShadow: 'inset 0 0 0 1px var(--dv-line)',
        }}
      >
        {children}
        {collapsed ? <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 40, background: 'linear-gradient(to bottom, transparent, var(--dv-surface-1))' }} /> : null}
      </div>
      {overflows
        ? (
          <button
            type="button" aria-expanded={expanded} onClick={() => { setExpanded(!expanded) }}
            style={{ marginTop: 6, padding: 0, border: 'none', background: 'transparent', color: 'var(--dv-accent-text)', fontFamily: 'inherit', fontSize: 12, lineHeight: '16px', cursor: 'pointer' }}
          >
            {expanded ? pick('收起提示词', 'Collapse the prompt') : pick('展开全部提示词', 'Show the full prompt')}
          </button>
        )
        : null}
    </>
  )
}
