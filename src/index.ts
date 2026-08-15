/**
 * dsh-mini-tui — a minimalist interactive terminal driver over dsh-base.
 * @module dsh-mini-tui
 */

import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolCallView, ToolDefinition, ToolResultView } from '@deepseek-ai/dsh-tools'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { AskUserQuestionAnswer, AskUserQuestionRequest, UserQuestionProvider } from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import { Editor, matchesKey, ProcessTerminal, TuiMainScreen, type EditorTheme } from '@earendil-works/pi-tui'

/** Stable Cordis plugin name. */
export const name = 'tui-runner'

/** Core services required before the terminal session can start. */
export const inject = ['agentDefaultModel', 'agents', 'agentPresets', 'tools', 'userQuestions']

/** Terminal tool-detail limits. */
export interface Config {
  /** Maximum lines retained for one expanded tool detail. */
  toolDetailMaxLines: number
  /** Maximum characters retained for one expanded tool detail. */
  toolDetailMaxCharacters: number
  /** Maximum completed or active calls retained for `/tool N`. */
  toolDetailHistoryLimit: number
}

export const Config: z<Config> = z.object({
  toolDetailMaxLines: z.number().min(1).default(80),
  toolDetailMaxCharacters: z.number().min(100).default(8_000),
  toolDetailHistoryLimit: z.number().min(1).default(200),
})

/** Process-facing terminal IO; tests may replace these streams. */
export const internals = {
  input: process.stdin,
  output: process.stdout,
}

const execFileAsync = promisify(execFile)

const ansi = {
  reset: '\u001B[0m',
  dim: '\u001B[2m',
  bold: '\u001B[1m',
  fg: (rgb: RGB): string => `\u001B[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`,
}

type RGB = readonly [number, number, number]
type ThemeColor = keyof typeof theme

const theme = {
  foam: [160, 245, 255],
  tide: [92, 225, 255],
  azure: [38, 148, 255],
  indigo: [62, 78, 255],
  kelp: [82, 196, 188],
  current: [86, 164, 224],
  trench: [54, 102, 150],
  muted: [95, 132, 164],
  warning: [129, 187, 225],
  danger: [125, 154, 216],
} as const

const pathPalette: readonly RGB[] = [
  [92, 225, 255],
  [82, 196, 188],
  [86, 164, 224],
  [100, 139, 220],
  [116, 154, 205],
]

const dashboardLogo = [
  '██████╗  ███████╗ ███████╗ ██████╗  ███████╗ ███████╗ ███████╗ ██╗  ██╗',
  '██╔══██╗ ██╔════╝ ██╔════╝ ██╔══██╗ ██╔════╝ ██╔════╝ ██╔════╝ ██║ ██╔╝',
  '██║  ██║ █████╗   █████╗   ██████╔╝ ███████╗ █████╗   █████╗   █████╔╝ ',
  '██║  ██║ ██╔══╝   ██╔══╝   ██╔═══╝  ╚════██║ ██╔══╝   ██╔══╝   ██╔═██╗ ',
  '██████╔╝ ███████╗ ███████╗ ██║      ███████║ ███████╗ ███████╗ ██║  ██╗',
  '╚═════╝  ╚══════╝ ╚══════╝ ╚═╝      ╚══════╝ ╚══════╝ ╚══════╝ ╚═╝  ╚═╝',
]

/** Apply terminal emphasis when the output stream supports ANSI color. */
function paint(value: string, color: ThemeColor, options: { dim?: boolean; bold?: boolean } = {}): string {
  if (!internals.output.isTTY) return value
  return `${options.dim === true ? ansi.dim : ''}${options.bold === true ? ansi.bold : ''}${ansi.fg(theme[color])}${value}${ansi.reset}`
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

function gradientText(value: string): string {
  if (!internals.output.isTTY) return value
  return Array.from(value, (char, index) => {
    const t = index / Math.max(1, value.length - 1)
    const color = t < 0.5 ? mix(theme.tide, theme.azure, t / 0.5) : mix(theme.azure, theme.indigo, (t - 0.5) / 0.5)
    return `${ansi.fg(color)}${char}`
  }).join('') + ansi.reset
}

function pathColor(value: string): RGB {
  let hash = 0
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return pathPalette[hash % pathPalette.length] ?? theme.current
}

function colorizePaths(value: string): string {
  if (!internals.output.isTTY) return value
  const pathPattern = /(?<![\w.-])(?:[A-Za-z]:\\[^\s"'<>|]+|(?:\.{1,2}[\\/])?[A-Za-z0-9_.@-]+(?:[\\/][A-Za-z0-9_.@-]+)+|[A-Za-z0-9_.@-]+\.(?:[cm]?[jt]sx?|json|ya?ml|md|txt|py|css|html|reg|cmd|ps1))(?![\w.-])/gu
  return value.replace(pathPattern, match => `${ansi.fg(pathColor(match))}${match}${ansi.reset}`)
}

function statusTag(label: string, color: ThemeColor): string {
  return paint(`[${label}]`, color, { bold: true })
}

/**
 * Render the terminal session's initial status.
 * @param details - Active workspace and model identifiers.
 * @returns The complete welcome text.
 */
export function welcomeScreen(details: { cwd: string; provider: string; model: string; sessionId: string }): string {
  return '\n'
    + dashboardLogo.map(line => gradientText(line)).join('\n')
    + '\n'
    + `${paint('D E E P S E E K  T U I', 'tide', { bold: true })} ${paint(`${details.provider}/${details.model}`, 'muted')}\n`
    + `${paint('cwd', 'trench')} ${colorizePaths(details.cwd)}\n`
    + `${paint('/help', 'muted')} ${paint('commands', 'trench')}\n\n`
}

const editorTheme: EditorTheme = {
  borderColor: value => paint(value, 'azure'),
  selectList: {
    selectedPrefix: value => paint(value, 'tide'),
    selectedText: value => value,
    description: value => paint(value, 'muted'),
    scrollInfo: value => paint(value, 'muted'),
    noMatch: value => paint(value, 'muted'),
  },
}

/** Collect one message through pi-tui's multi-line editor. */
async function editorQuestion(options: {
  initialText?: string
  signal?: AbortSignal
  onCancel?: () => void
} = {}): Promise<string | undefined> {
  if (options.signal?.aborted) return undefined
  const terminal = new ProcessTerminal()
  const tui = new TuiMainScreen(terminal)
  const editor = new Editor(tui, editorTheme, { paddingX: 1 })
  editor.setText(options.initialText ?? '')
  tui.addChild(editor)
  tui.setFocus(editor)
  return await new Promise<string | undefined>((resolve) => {
    let settled = false
    const finish = (value: string | undefined): void => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', abort)
      tui.stop()
      resolve(value)
    }
    const abort = (): void => { finish(undefined) }
    options.signal?.addEventListener('abort', abort, { once: true })
    tui.addInputListener((data) => {
      if (!matchesKey(data, 'ctrl+c')) return undefined
      options.onCancel?.()
      return { consume: true }
    })
    editor.onSubmit = (text) => {
      editor.addToHistory(text)
      finish(text)
    }
    tui.start()
  })
}

/** Read Unicode text from the Windows clipboard without routing it through the terminal editor. */
async function readClipboard(): Promise<string> {
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Raw',
  ], { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 })
  return stdout.replace(/\r?\n$/, '')
}

/** Concatenate the visible text blocks from one completed assistant message. */
function assistantText(event: SessionEvent<'assistant/message'>): string {
  return event.data.message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** Identifies one streamed model response within this terminal session. */
function stepKey(turn: number, step: number): string {
  return `${turn}/${step}`
}

/**
 * Create a renderer that streams visible text and closes each completed response.
 * @returns A Session-event listener for assistant output.
 */
export function createAssistantRenderer(): (event: SessionEvent) => void {
  const streamed = new Map<string, string>()
  const thinking = new Set<string>()

  const renderThinking = (key: string): void => {
    if (thinking.has(key)) return
    thinking.add(key)
    internals.output.write(`\n${statusTag('thinking', 'kelp')} ${paint('tracing the deep current...', 'muted')}\n`)
  }

  return (event: SessionEvent): void => {
    if (event.type === 'assistant/chunk') {
      const { chunk, turn, step } = event.data
      const key = stepKey(turn, step)
      if (chunk.type === 'block-start' && chunk.blockType === 'reasoning') {
        renderThinking(key)
        return
      }
      if (chunk.type === 'reasoning-delta') {
        renderThinking(key)
        return
      }
      if (chunk.type !== 'text-delta') return
      const previous = streamed.get(key)
      if (previous === undefined) internals.output.write('\n')
      internals.output.write(chunk.text)
      streamed.set(key, `${previous ?? ''}${chunk.text}`)
      return
    }
    if (event.type !== 'assistant/message') return
    const key = stepKey(event.data.turn, event.data.step)
    const streamedText = streamed.get(key)
    streamed.delete(key)
    thinking.delete(key)
    const text = assistantText(event)
    if (streamedText === undefined) {
      if (text !== '') internals.output.write(`\n${text}\n\n`)
      return
    }
    if (text.startsWith(streamedText)) internals.output.write(text.slice(streamedText.length))
    else if (text !== streamedText) internals.output.write(`\n${text}`)
    internals.output.write('\n\n')
  }
}

/** A quiet-by-default tool renderer with runtime detail controls. */
export interface ToolRenderer {
  (event: SessionEvent): void
  /** Toggle complete tool details for subsequent events. */
  toggleVerbose(): boolean
  /** Return retained details for a numeric call label. */
  detail(label: number): string | undefined
}

/**
 * Retain durable tool details with a stable label for each parallel tool call.
 * @param resolveTool - Resolves the call's scoped presentation definition.
 * @param limits - Bounds retained and printed details.
 * @returns A Session-event listener with runtime detail controls.
 */
export function createToolRenderer(
  resolveTool?: (name: string) => ToolDefinition | undefined,
  limits: Config = { toolDetailMaxLines: 80, toolDetailMaxCharacters: 8_000, toolDetailHistoryLimit: 200 },
): ToolRenderer {
  const calls = new Map<string, { label: number; name: string; time: number; args: unknown; view?: ToolCallView }>()
  const details = new Map<number, string>()
  let nextLabel = 1
  let verbose = false

  const indent = (value: string): string => value.split('\n').map(line => `    ${colorizePaths(line)}`).join('\n')
  const formatValue = (value: unknown): string => typeof value === 'string' ? value : JSON.stringify(value, undefined, 2)
  const retainDetail = (label: number, value: string): void => {
    details.delete(label)
    details.set(label, value)
    while (details.size > limits.toolDetailHistoryLimit) {
      const oldest = details.keys().next().value as number | undefined
      if (oldest === undefined) break
      details.delete(oldest)
    }
  }
  const truncate = (value: string): string => {
    const lines = value.split('\n')
    const lineLimited = lines.slice(0, limits.toolDetailMaxLines).join('\n')
    const limited = lineLimited.slice(0, limits.toolDetailMaxCharacters)
    const omittedLines = Math.max(0, lines.length - limits.toolDetailMaxLines)
    const omittedCharacters = Math.max(0, lineLimited.length - limits.toolDetailMaxCharacters)
    if (omittedLines === 0 && omittedCharacters === 0) return limited
    const omissions = [
      omittedLines === 0 ? undefined : `${String(omittedLines)} lines`,
      omittedCharacters === 0 ? undefined : `${String(omittedCharacters)} characters`,
    ].filter(value => value !== undefined).join(', ')
    return `${limited}\n… ${omissions} omitted; use the session log for the complete value`
  }
  const rawResult = (event: SessionEvent<'tool/result'>): string => event.data.message.content[0].content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
  const callDetail = (view: ToolCallView | undefined, args: unknown): string => {
    if (view?.card === 'terminal') return [view.description, view.cwd, view.title].filter(Boolean).join('\n')
    if (view?.card === 'diff') return view.diffs.map(diff => diff.path).join('\n')
    if (view?.card === 'generic') return view.rawInput === undefined ? '' : formatValue(view.rawInput)
    return formatValue(args)
  }
  const resultDetail = (view: ToolResultView | undefined, event: SessionEvent<'tool/result'>): string => {
    if (view?.card === 'terminal') return [view.output, view.exitCode === undefined ? undefined : `exit ${String(view.exitCode)}`, view.signal].filter(Boolean).join('\n')
    if (view?.card === 'diff') return view.diffs.map(diff => diff.path).join('\n')
    if (view?.card === 'search') return view.shape === 'paths'
      ? view.paths.join('\n')
      : view.files.flatMap(file => file.matches.map(match => `${file.path}:${String(match.lineNumber)}: ${match.line}`)).join('\n')
    if (view?.card === 'read') return view.lines.map(line => `${String(line.number).padStart(4)}  ${line.text}`).join('\n')
    if (view?.card === 'web') return view.kind === 'search'
      ? [view.answer, ...view.sources.map(source => `${source.title ?? source.url} — ${source.url}`)].filter(Boolean).join('\n')
      : `${String(view.statusCode)} ${view.url}${view.truncated ? ' (truncated)' : ''}`
    const content = view?.card === 'generic' && view.content !== undefined
      ? view.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
      : rawResult(event)
    return content
  }

  const resultSummary = (view: ToolResultView | undefined): string => {
    if (view?.card === 'terminal') return view.exitCode === undefined ? '' : `exit ${String(view.exitCode)}`
    if (view?.card === 'diff') return `${String(view.diffs.length)} file${view.diffs.length === 1 ? '' : 's'}`
    if (view?.card === 'search') {
      const count = view.shape === 'paths' ? view.paths.length : view.files.reduce((sum, file) => sum + file.matches.length, 0)
      return `${String(count)} match${count === 1 ? '' : 'es'}`
    }
    if (view?.card === 'read') return `${String(view.lines.length)} line${view.lines.length === 1 ? '' : 's'}`
    if (view?.card === 'web') return view.kind === 'search'
      ? `${String(view.sources.length)} source${view.sources.length === 1 ? '' : 's'}`
      : `${String(view.statusCode)}${view.truncated ? ', truncated' : ''}`
    return ''
  }

  const render = (event: SessionEvent): void => {
    switch (event.type) {
      case 'tool/call': {
        let args: unknown = event.data.arguments
        try { args = JSON.parse(event.data.arguments) as unknown } catch { /* Model arguments may be incomplete JSON. */ }
        const view = resolveTool?.(event.data.name)?.presentCall?.(args)
        const call = { label: nextLabel++, name: event.data.name, time: event.time, args, ...view === undefined ? {} : { view } }
        calls.set(event.data.callId, call)
        const title = view?.title ?? call.name
        const detail = callDetail(view, args)
        retainDetail(call.label, `Input\n${truncate(detail)}`)
        if (verbose) internals.output.write(`\n${statusTag(`tool ${String(call.label)}`, 'azure')} ${paint(title, 'current')} ${paint('running', 'muted')}${detail === '' ? '' : `\n${indent(truncate(detail))}`}\n`)
        return
      }
      case 'tool/result': {
        const callId = event.data.message.source.callId
        const call = calls.get(callId)
        calls.delete(callId)
        const definition = call === undefined ? undefined : resolveTool?.(call.name)
        const resultBlock = event.data.message.content[0]
        const view = call === undefined ? undefined : definition?.presentResult?.(call.args, {
          content: resultBlock.content,
          isError: resultBlock.isError ?? false,
          ...event.data.meta === undefined ? {} : { meta: event.data.meta },
        })
        const title = view?.title ?? call?.view?.title ?? call?.name
        const prefix = call === undefined ? statusTag('tool', 'azure') : statusTag(`tool ${String(call.label)}`, 'azure') + ` ${paint(title ?? call.name, 'current')}`
        const elapsed = call === undefined ? '' : ` (${((event.time - call.time) / 1000).toFixed(1)}s)`
        const detail = resultDetail(view, event)
        const status = event.data.error === undefined ? `completed${elapsed}` : `failed: ${event.data.error.code}${elapsed}`
        const summary = resultSummary(view)
        if (call !== undefined && details.has(call.label)) {
          const retained = details.get(call.label) ?? 'Input'
          retainDetail(call.label, `${retained}\n\nResult\n${truncate(detail)}`)
        }
        if (!verbose && event.data.error === undefined) return
        if (!verbose) {
          internals.output.write(`\n${statusTag('tool failed', 'danger')} ${paint(title ?? call?.name ?? 'tool', 'current')}: ${paint(event.data.error?.code ?? 'unknown', 'danger')}\n\n`)
          return
        }
        internals.output.write(`${prefix} ${paint(status, event.data.error === undefined ? 'kelp' : 'danger')}${summary === '' ? '' : ` — ${paint(summary, 'muted')}`}${detail === '' ? '' : `\n${indent(truncate(detail))}`}\n`)
        return
      }
      case 'turn/end':
        if (event.data.reason.kind === 'aborted') internals.output.write(`\n${statusTag('task cancelled', 'warning')}\n\n`)
        if (event.data.reason.kind === 'error') internals.output.write(`\n${statusTag('task failed', 'danger')} ${event.data.reason.error.message}\n\n`)
        return
      default:
        return
    }
  }
  render.toggleVerbose = () => { verbose = !verbose; return verbose }
  render.detail = (label: number) => {
    const detail = details.get(label)
    return detail === undefined ? undefined : colorizePaths(detail)
  }
  return render
}

/** Render and collect structured answers for the standard user-questions provider. */
function terminalQuestions(): UserQuestionProvider {
  return {
    async ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
      const answers: AskUserQuestionAnswer['answers'] = []
      for (const item of request.questions) {
        const heading = item.header === undefined ? '' : `${item.header}: `
        internals.output.write(`\n${statusTag('question', 'tide')} ${heading}${item.question}\n`)
        if (item.detail !== undefined) internals.output.write(`${item.detail}\n`)
        for (const [index, option] of (item.options ?? []).entries()) {
          internals.output.write(`  ${String(index + 1)}. ${option.label}${option.description === undefined ? '' : ` — ${option.description}`}\n`)
        }
        const reply = await editorQuestion(request.signal === undefined ? {} : { signal: request.signal })
        if (reply === undefined) throw new Error('ask_user_question was cancelled')
        const selected = item.options?.[Number(reply) - 1]
        answers.push({
          id: item.id,
          selected: selected === undefined ? [] : [selected.label],
          ...selected === undefined ? { custom: reply } : {},
        })
      }
      return { answers }
    },
  }
}

/** Ask whether one tool call may proceed. */
async function terminalApproval(
  toolName: string, reason: string | undefined, signal: AbortSignal | undefined,
): Promise<ApprovalOutcome> {
  internals.output.write(`\n${statusTag('approval', 'warning')} Allow ${paint(toolName, 'current')}${reason === undefined ? '' : `: ${reason}`}\n`)
  const reply = await editorQuestion(signal === undefined ? {} : { signal })
  if (reply === undefined) return 'cancelled'
  return /^(y|yes)$/iu.test(reply.trim()) ? 'allowed-once' : 'rejected'
}

/**
 * Start the interactive terminal loop after all configured plugins settle.
 * @param ctx - plugin context carrying core agent services.
 */
async function run(ctx: Context, config: Config): Promise<void> {
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  if (agents === undefined || defaultModel === undefined) return

  const selection = defaultModel.currentSelection()
  const presets = ctx.get('agentPresets')
  const agentPreset = presets === undefined ? undefined : (await presets.resolve()).id
  const sessionId = SessionId(`session-${randomUUID()}`)
  const handle = await agents.create({
    sessionId,
    meta: { cwd: process.cwd(), ...agentPreset === undefined ? {} : { agentPreset } },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: async (agentCtx) => {
      const selected: ModelSelectionRef = { current: selection, assembled: undefined }
      installModelSelection(agentCtx, selected)
      if (agentPreset !== undefined) await presets?.mount(agentCtx, agentPreset)
    },
  })
  const { agent } = handle
  const writeAssistantEvent = createAssistantRenderer()
  const writeToolEvent = createToolRenderer(toolName => ctx.tools.get(toolName, agent), config)
  const disposeEvents = ctx.on('session/event', (session, event) => {
    if (session !== agent.session) return
    if (event.type === 'assistant/chunk' || event.type === 'assistant/message') writeAssistantEvent(event)
    else writeToolEvent(event)
  })
  const disposeQuestions = ctx.userQuestions.registerProvider(terminalQuestions())
  const disposeApproval = ctx.on('approval/request', (request, next) => {
    if (request.agent !== agent) return next()
    return terminalApproval(request.toolName, request.reason, request.signal)
  })
  internals.output.write(welcomeScreen({
    cwd: process.cwd(),
    provider: selection.provider,
    model: selection.model,
    sessionId,
  }))
  try {
    for (;;) {
      const prompt = await editorQuestion({
        onCancel: () => {
          if (agent.status !== 'running') return
          agent.cancel({ kind: 'user' })
          internals.output.write(`\n${statusTag('cancelling task', 'warning')}\n\n`)
        },
      }) ?? '/exit'
      const text = prompt.trim()
      if (text === '') continue
      if (text === '/exit' || text === '/quit') break
      if (text === '/help') {
        internals.output.write('\nEnter sends; Shift+Enter or Ctrl+J adds a line; Ctrl+V pastes multi-line text; /paste reads the Windows clipboard; /verbose toggles tool output; /tool N shows retained tool detail; /cancel or Ctrl+C stops the active task; /exit closes the session.\n\n')
        continue
      }
      if (text === '/verbose') {
        const enabled = writeToolEvent.toggleVerbose()
        internals.output.write(`\n${statusTag('verbose', 'azure')} tool output ${enabled ? paint('enabled', 'kelp') : paint('disabled', 'muted')}\n\n`)
        continue
      }
      const toolDetailMatch = /^\/tool\s+(\d+)$/u.exec(text)
      if (toolDetailMatch !== null) {
        const detail = writeToolEvent.detail(Number(toolDetailMatch[1]))
        internals.output.write(detail === undefined ? `\n${statusTag('tool detail not found', 'warning')}\n\n` : `\n${detail}\n\n`)
        continue
      }
      if (text === '/cancel') {
        if (agent.status === 'running') {
          agent.cancel({ kind: 'user' })
          internals.output.write(`\n${statusTag('cancelling task', 'warning')}\n\n`)
        } else {
          internals.output.write(`\n${statusTag('nothing is running', 'muted')}\n\n`)
        }
        continue
      }
      const message = text === '/paste'
        ? await readClipboard()
        : prompt
      if (message.trim() === '') {
        internals.output.write(text === '/paste' ? '\nClipboard is empty.\n\n' : '\nMessage is empty.\n\n')
        continue
      }
      if (text === '/paste') internals.output.write(`\n${statusTag('pasted', 'kelp')} ${String(message.length)} characters\n\n`)
      agent.followup(createUserMessage({ content: [{ type: 'text', text: message }], source: { kind: 'user' } }))
      await agent.whenIdle()
    }
  } finally {
    disposeApproval()
    disposeQuestions()
    disposeEvents()
    await handle.dispose()
    ctx.get('appExit')?.(0)
  }
}

/**
 * Mount the terminal driver.
 * @param ctx - plugin context carrying the configured application tree.
 */
export function apply(ctx: Context, config: Config): void {
  void run(ctx, config).catch((error: unknown) => {
    internals.output.write(`\ndsh: ${error instanceof Error ? error.message : String(error)}\n`)
  })
}
