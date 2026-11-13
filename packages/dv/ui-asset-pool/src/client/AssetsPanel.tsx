/**
 * The project asset pool panel: an import drop zone, every asset of the project once in thumbnail grids grouped by media
 * type (图片 · 视频 · 从生成中截取的帧 · 音频), drag sources that carry the asset ID as `application/x-dv-asset` and its
 * MIME type as `application/x-dv-asset-mime`, and the `dvMedia` preview on click, which grows out of the clicked tile
 * and shrinks back into it on close. The panel lists every asset of the project, including the assets of steps that an
 * undo went back past: the asset pool only grows.
 *
 * @module @dv/ui-asset-pool/AssetsPanel
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent, ReactNode } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { PropsRenderFactories, PropsRuntime, RenderFactorySlot } from '@deepseek-ai/dsh-client-ui-slots'
import type { DvClient } from '@dv/ui-kit/api.ts'
import type { Asset } from '@dv/ui-kit/types.ts'
import { useCurrentProject } from '@dv/ui-kit/current-project.ts'
import { mediaTypeOf } from '@dv/ui-kit/media-type.ts'
import { useText } from '@dv/ui-kit/locale.ts'
import { useProjectState } from '@dv/ui-kit/useProject.ts'
import { DV_ASSET_DRAG_TYPE, DV_ASSET_MIME_DRAG_TYPE } from '@dv/ui-kit/workspace-events.ts'
import type {} from '@dv/ui-media/contract'
import { assetLibrary } from './library.ts'
import css from './AssetsPanel.module.css'

/**
 * Props of {@link AssetsPanel}: a click on a thumbnail calls `onOpen` when it is given, and otherwise opens the asset
 * preview through `preview`.
 */
export type AssetsPanelProps = {
  projectId: string
  /** The chat session the panel sits beside, recorded as the `session` of its imports. */
  session: string | null
  client: DvClient
  /** Draws each thumbnail's asset through the `dv.media` Factory of `@dv/ui-media`. */
  renderFactorySlot: RenderFactorySlot
} & (
  | {
    /** Open the asset preview of `dvMedia` for an asset of a project, growing out of the clicked tile. */
    preview: (projectId: string, asset: Asset, opener: Element | null) => void
    onOpen?: never
  }
  | { onOpen: (asset: Asset) => void }
)

/**
 * The asset pool panel of one project.
 * @param props - the project and an optional client.
 * @returns the panel.
 */
export function AssetsPanel(props: AssetsPanelProps): ReactNode {
  const { client } = props
  const state = useProjectState(client, props.projectId)
  const t = useText()
  const library = useMemo(() => state.value === null ? null : assetLibrary(state.value), [state.value])
  const onOpen = (asset: Asset, tile: Element): void => {
    if (props.onOpen === undefined) props.preview(props.projectId, asset, tile)
    else props.onOpen(asset)
  }

  let body: ReactNode
  if (library === null) body = <p className={css.note}>{state.error === null ? t('正在读取…', 'Loading…') : t(`读取失败：${state.error}`, `Failed to load: ${state.error}`)}</p>
  else if (library.images.length + library.videos.length + library.extracted.length + library.audio.length === 0) {
    body = <p className={css.note}>{t('还没有素材。在上方导入，或在对话里生成。', 'No images, videos or audio yet. Import files above, or generate them in the chat.')}</p>
  } else {
    body = (
      <>
        <Section title={t('图片', 'Images')} assets={library.images} onOpen={onOpen} renderFactorySlot={props.renderFactorySlot} />
        <Section title={t('视频', 'Videos')} assets={library.videos} onOpen={onOpen} renderFactorySlot={props.renderFactorySlot} />
        <Section
          title={t('从生成中截取的帧', 'Extracted from generation')} assets={library.extracted} onOpen={onOpen}
          renderFactorySlot={props.renderFactorySlot}
        />
        <Section title={t('音频', 'Audios')} assets={library.audio} onOpen={onOpen} renderFactorySlot={props.renderFactorySlot} />
      </>
    )
  }
  return (
    <div data-testid="dv-asset-pool-panel" className={css.panel}>
      <ImportZone client={client} projectId={props.projectId} session={props.session} />
      <div className={css.scroll}>{body}</div>
    </div>
  )
}

/**
 * The drop zone that imports image, video and audio files through `POST /api/dv/assets/import`, and names each other file it
 * refuses; also opens a file chooser on click.
 * @param props - the API client, the project, and the chat session the panel sits beside.
 * @returns the zone.
 */
function ImportZone(props: { client: DvClient; projectId: string; session: string | null }): ReactNode {
  const [pending, setPending] = useState(0)
  const [over, setOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refused, setRefused] = useState<string[]>([])
  const input = useRef<HTMLInputElement>(null)
  const t = useText()
  const importFiles = useCallback((files: Iterable<File> | null) => {
    const chosen = [...new Set(files)]
    const accepted = chosen.filter(file => ['image', 'video', 'audio'].includes(mediaTypeOf(file.type)))
    setRefused(chosen.filter(file => !accepted.includes(file)).map(file => file.name))
    for (const file of accepted) {
      setPending(count => count + 1)
      props.client.importAsset(props.projectId, file, 'asset_pool', props.session)
        .then(() => { setError(null) }, (failure: unknown) => { setError(t(`「${file.name}」导入失败：${String(failure)}`, `Failed to import “${file.name}”: ${String(failure)}`)) })
        .finally(() => { setPending(count => count - 1) })
    }
  }, [props.client, props.projectId, props.session, t])
  // Asset drags from the grid carry an asset ID, not files; the zone ignores them.
  const isFileDrag = (event: DragEvent): boolean => event.dataTransfer.types.includes('Files') && !event.dataTransfer.types.includes(DV_ASSET_DRAG_TYPE)
  return (
    <div
      role="button" tabIndex={0} onClick={() => input.current?.click()} onKeyDown={(event) => {
        if (event.key === 'Enter') input.current?.click()
        else if (event.key === ' ') { event.preventDefault(); input.current?.click() }
      }}
      onDragOver={(event) => { if (isFileDrag(event)) { event.preventDefault(); setOver(true) } }}
      onDragLeave={() => { setOver(false) }}
      onDrop={(event) => { if (!isFileDrag(event)) return; event.preventDefault(); setOver(false); importFiles(event.dataTransfer.files) }}
      className={css.importZone} data-over={over ? '' : undefined}
    >
      {pending > 0
        ? t(`导入中（${String(pending)}）…`, `Importing (${String(pending)})…`)
        : t('拖入图片、视频或音频导入，或点击选择文件', 'Drop images, videos or audio here to import, or click to choose files')}
      {error === null ? null : <div className={css.error}>{error}</div>}
      {refused.map(name => (
        <div key={name} className={css.error}>
          {t(`「${name}」不是图片、视频或音频，没有导入。`, `“${name}” is not an image, a video or audio, so it was not imported.`)}
        </div>
      ))}
      <input ref={input} type="file" accept="image/*,video/*,audio/*" multiple hidden onChange={(event) => { importFiles(event.currentTarget.files); event.currentTarget.value = '' }} />
    </div>
  )
}

type ThumbProps = { onOpen: (asset: Asset, tile: Element) => void; renderFactorySlot: RenderFactorySlot }

/**
 * One titled grid of thumbnails.
 * @param props - the title, the assets, the preview callback, and the `dv.media` renderer.
 * @returns the section, or nothing when it has no assets.
 */
function Section(props: ThumbProps & { title: string; assets: Asset[] }): ReactNode {
  if (props.assets.length === 0) return null
  return (
    <section className={css.section}>
      <h3 className={css.sectionTitle}>{props.title} · {props.assets.length}</h3>
      <div className={css.grid}>
        {props.assets.map(asset => (
          <Thumb key={asset.id} asset={asset} onOpen={props.onOpen} renderFactorySlot={props.renderFactorySlot} />
        ))}
      </div>
    </section>
  )
}

/**
 * The box of a thumbnail's media: the asset's aspect ratio at the largest size that the square cell holds, or the whole
 * cell for an asset of unknown dimensions.
 * @param asset - the asset.
 * @returns the box style.
 */
function thumbBox(asset: Asset): CSSProperties {
  if (asset.width === null || asset.height === null || asset.height <= 0) return { width: '100%', height: '100%' }
  return { aspectRatio: `${String(asset.width)} / ${String(asset.height)}`, width: `${String(Math.min(1, asset.width / asset.height) * 100)}%` }
}

/**
 * One draggable thumbnail, its asset drawn through `dv.media` at purpose 'thumb', with the length of a video or an audio
 * file to one decimal place, and the asset's name under it, cut with an ellipsis at the thumbnail's width; dragging the
 * thumbnail carries the asset ID and its MIME type, clicking it opens the preview.
 * @param props - the asset, the preview callback, and the `dv.media` renderer.
 * @returns the thumbnail and its name.
 */
function Thumb(props: ThumbProps & { asset: Asset }): ReactNode {
  const { asset } = props
  const timed = ['video', 'audio'].includes(mediaTypeOf(asset.mime))
  return (
    <div className={css.item}>
      <button
        type="button" draggable title={asset.name} aria-label={asset.name} data-asset-id={asset.id}
        onDragStart={(event) => {
          event.dataTransfer.setData(DV_ASSET_DRAG_TYPE, asset.id)
          event.dataTransfer.setData(DV_ASSET_MIME_DRAG_TYPE, asset.mime)
          event.dataTransfer.effectAllowed = 'copy'
        }}
        onClick={(event) => { props.onOpen(asset, event.currentTarget) }}
        className={css.thumb}
      >
        <span className={css.thumbMedia} style={thumbBox(asset)}>{props.renderFactorySlot('dv.media', { asset, purpose: 'thumb' })}</span>
        {timed && asset.duration_sec !== null
          ? <span className={css.duration}>{asset.duration_sec.toFixed(1)}s</span>
          : null}
      </button>
      {/* The button's label already names the asset, so the visible name is hidden from screen readers. */}
      <span className={css.name} aria-hidden="true">{asset.name}</span>
    </div>
  )
}

/** What the plugin hands the tab body and the canvas picker entry. */
export interface AssetsTabInjected {
  client: DvClient
  preview: (projectId: string, asset: Asset, opener: Element | null) => void
}

/**
 * The tab body: the asset pool panel of the project that the DreamVerse shell has open, beside the chat session whose
 * right panel holds the tab.
 * @param props - the tab's chat session and the injected client.
 * @returns the panel, or a notice while no project is open.
 */
export function AssetsTabBody(props: PropsRuntime<'sidebar.right.pane.tab'> & AssetsTabInjected & PropsRenderFactories): ReactNode {
  const project = useCurrentProject()
  const t = useText()
  if (project === null) return <p className={css.note} style={{ padding: 16 }}>{t('先打开一个项目', 'Open a project first')}</p>
  // Keyed by project so a switch starts from an empty panel instead of showing the previous project's assets.
  return (
    <AssetsPanel
      key={project} projectId={project} session={props.sessionId} client={props.client} preview={props.preview}
      renderFactorySlot={props.renderFactorySlot}
    />
  )
}
