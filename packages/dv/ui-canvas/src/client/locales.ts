/**
 * `dvCanvas` namespace dictionaries, and the namespace's declaration.
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Canvas tab name, guide entry, node chrome, node menu, editor shell, asset picker, and project bar copy. */
    dvCanvas: DvCanvasKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'dvCanvas'

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  'type.label': '画布',
  'guide.title': '视频画布',
  'guide.description': '按素材流向查看项目的记录，改参数后重跑',
  'bar.project': '项目',
  'bar.undo': '撤销',
  'bar.newProject': '新建项目',
  'bar.newProjectPrompt': '新项目的标题',
  'bar.noProject': '没有项目',
  'empty.projects': '还没有项目。在对话里让智能体新建一个项目。',
  loading: '正在读取…',
  error: '失败：{message}',
  'canvas.aria': '项目画布',
  'canvas.empty': '画布还是空的。在对话里让智能体开始。',
  'canvas.fit': '适应',
  'canvas.zoomIn': '放大',
  'canvas.zoomOut': '缩小',
  'canvas.zoom': '缩放',
  'node.running': '运行中…',
  'node.queued': '排队中…',
  'node.failed': '失败',
  'node.failedReason': '{status}：{reason}',
  'node.stale': '已过期',
  'node.unseen': '未查看',
  'node.resize': '调整节点大小',
  'node.version': 'v{n}',
  'node.remove': '从画布移除',
  'node.removeConfirm': '从画布移除「{title}」？它的版本保留在素材库中，可在历史记录中恢复该节点。',
  'menu.label': '节点操作',
  'node.rename': '重命名',
  'node.renameAria': '节点名称',
  'node.renameHint': '回车保存 · Esc 取消',
  'node.renameTooLong': '名称最多 {max} 个字符。',
  'editor.close': '关闭',
  'editor.keepAnyway': '仍然保留',
  'editor.resize': '调整面板大小',
  'editor.versions': '版本',
  'editor.versionOf': '第 {i} / {n} 版',
  'history.moved': '移动节点',
  'history.resized': '调整大小',
  'history.removed': '从画布移除「{title}」',
  'history.renamed': '重命名为「{name}」',
  'picker.title': '添加素材',
  'picker.cancel': '取消',
  'picker.confirm': '确认（{count}）',
} satisfies Record<string, string>

/** Every key of the namespace. */
export type DvCanvasKey = keyof typeof zh

/** English dictionary. */
export const en = {
  'type.label': 'Canvas',
  'guide.title': 'Video canvas',
  'guide.description': 'See the project\'s records as asset flow; change params and rerun',
  'bar.project': 'Project',
  'bar.undo': 'Undo',
  'bar.newProject': 'Create project',
  'bar.newProjectPrompt': 'Title of the new project',
  'bar.noProject': 'No project',
  'empty.projects': 'No projects yet. Ask the agent in the chat to create one.',
  loading: 'Loading…',
  error: 'Failed: {message}',
  'canvas.aria': 'Project canvas',
  'canvas.empty': 'The canvas is empty. Ask the agent in the chat to start.',
  'canvas.fit': 'Fit',
  'canvas.zoomIn': 'Zoom in',
  'canvas.zoomOut': 'Zoom out',
  'canvas.zoom': 'Zoom',
  'node.running': 'Running…',
  'node.queued': 'Queued…',
  'node.failed': 'Failed',
  'node.failedReason': '{status}: {reason}',
  'node.stale': 'Stale',
  'node.unseen': 'Not viewed yet',
  'node.resize': 'Resize the node',
  'node.version': 'v{n}',
  'node.remove': 'Remove from canvas',
  'node.removeConfirm': 'Remove “{title}” from the canvas? Its versions stay in the asset pool, and History can bring the node back.',
  'menu.label': 'Node actions',
  'node.rename': 'Rename',
  'node.renameAria': 'Node name',
  'node.renameHint': 'Enter to save · Esc to cancel',
  'node.renameTooLong': 'The name can have at most {max} characters.',
  'editor.close': 'Close',
  'editor.keepAnyway': 'Keep anyway',
  'editor.resize': 'Resize the panel',
  'editor.versions': 'Versions',
  'editor.versionOf': 'Version {i} of {n}',
  'history.moved': 'Moved “{title}”',
  'history.resized': 'Resized “{title}”',
  'history.removed': 'Removed “{title}”',
  'history.renamed': 'Renamed to “{name}”',
  'picker.title': 'Add assets',
  'picker.cancel': 'Cancel',
  'picker.confirm': 'Confirm ({count})',
} satisfies Record<DvCanvasKey, string>
