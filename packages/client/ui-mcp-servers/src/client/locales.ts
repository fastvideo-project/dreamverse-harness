/** Locale-owned copy for the MCP server dashboard. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** Dictionary namespace for every MCP dashboard string. */
export const NS = 'mcp-servers'

/** Chinese dictionary and key source. */
export const zh = {
  panel: 'MCP',
  pageTitle: 'MCP',
  pageIntro: '管理 agent 可以使用的 MCP 服务器。关闭插件页里的 MCP 后，这个入口会消失。',
  title: 'MCP 服务器',
  intro: '添加的服务器会在保存后自动连接，它提供的工具会出现在 agent 的工具列表里，名称为 mcp__服务器名__工具名。',
  add: '添加服务器',
  empty: '还没有添加 MCP 服务器。',
  loading: '正在读取服务器列表…',
  reconnecting: '正在重新连接 harness…',
  count: '{count} 个',
  'phase.connecting': '连接中',
  'phase.connected': '已连接 · {count} 个工具',
  'phase.failed': '连接失败',
  tools: '工具',
  noTools: '这个服务器没有提供工具。',
  retry: '重新连接',
  remove: '删除',
  removeLabel: '删除 {name}',
  retryLabel: '重新连接 {name}',
  toolsLabel: '展开 {name} 的工具',
  failed: '操作失败：{message}',
  'form.title': '添加 MCP 服务器',
  'form.description': '本地程序用 stdio 启动；已经在运行的服务用 HTTP 连接。',
  'form.close': '关闭',
  'form.name': '名称',
  'form.namePlaceholder': '例如 blender',
  'form.nameHelp': '只能包含字母、数字、- 和 _，最多 32 个字符。',
  'form.transport': '连接方式',
  'form.stdio': '本地程序（stdio）',
  'form.http': 'HTTP',
  'form.command': '命令',
  'form.commandPlaceholder': '例如 /usr/bin/uvx',
  'form.args': '参数',
  'form.argsHelp': '每行一个参数。',
  'form.env': '环境变量',
  'form.envHelp': '每行一个，格式为 KEY=VALUE。',
  'form.url': '地址',
  'form.urlPlaceholder': '例如 http://127.0.0.1:3000/mcp',
  'form.headers': '请求头',
  'form.headersHelp': '每行一个，格式为 Name: Value。',
  'form.cancel': '取消',
  'form.save': '保存并连接',
  'form.badLine': '第 {line} 行格式不对：{text}',
}

/** Every dashboard dictionary key. */
export type McpServersKey = keyof typeof zh

/** English dictionary with the same complete key set. */
export const en: Record<McpServersKey, string> = {
  panel: 'MCP',
  pageTitle: 'MCP',
  pageIntro: 'Manage the MCP servers the agent can use. Switching MCP off in Plugins removes this entry.',
  title: 'MCP servers',
  intro: 'A saved server connects automatically, and its tools join the agent\'s tool list as mcp__<server>__<tool>.',
  add: 'Add server',
  empty: 'No MCP servers yet.',
  loading: 'Loading servers…',
  reconnecting: 'Reconnecting to the harness…',
  count: '{count}',
  'phase.connecting': 'Connecting',
  'phase.connected': 'Connected · {count} tools',
  'phase.failed': 'Connection failed',
  tools: 'Tools',
  noTools: 'This server provides no tools.',
  retry: 'Reconnect',
  remove: 'Remove',
  removeLabel: 'Remove {name}',
  retryLabel: 'Reconnect {name}',
  toolsLabel: 'Show the tools of {name}',
  failed: 'Action failed: {message}',
  'form.title': 'Add an MCP server',
  'form.description': 'Start a local program over stdio, or connect to a running service over HTTP.',
  'form.close': 'Close',
  'form.name': 'Name',
  'form.namePlaceholder': 'For example, blender',
  'form.nameHelp': 'Letters, digits, - and _ only; at most 32 characters.',
  'form.transport': 'Connection',
  'form.stdio': 'Local program (stdio)',
  'form.http': 'HTTP',
  'form.command': 'Command',
  'form.commandPlaceholder': 'For example, /usr/bin/uvx',
  'form.args': 'Arguments',
  'form.argsHelp': 'One argument per line.',
  'form.env': 'Environment variables',
  'form.envHelp': 'One per line, as KEY=VALUE.',
  'form.url': 'URL',
  'form.urlPlaceholder': 'For example, http://127.0.0.1:3000/mcp',
  'form.headers': 'Headers',
  'form.headersHelp': 'One per line, as Name: Value.',
  'form.cancel': 'Cancel',
  'form.save': 'Save and connect',
  'form.badLine': 'Line {line} is malformed: {text}',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** MCP server dashboard on the MCP plugin page. */
    'mcp-servers': McpServersKey
  }
}
