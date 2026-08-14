/**
 * deepseek-harness-tui — an interactive terminal driver over dsh-base.
 * @module deepseek-harness-tui
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
}

export const Config: z<Config> = z.object({
  toolDetailMaxLines: z.number().min(1).default(80),
  toolDetailMaxCharacters: z.number().min(100).default(8_000),
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
  cyan: '\u001B[36m',
  green: '\u001B[32m',
  yellow: '\u001B[33m',
  bold: '\u001B[1m',
}

/** Apply terminal emphasis when the output stream supports ANSI color. */
function paint(value: string, color: keyof typeof ansi): string {
  return internals.output.isTTY ? `${ansi[color]}${value}${ansi.reset}` : value
}

/**
 * Render the terminal session's initial status board.
 * @param details - Active workspace, model, and session identifiers.
 * @returns The complete welcome board.
 */
export function welcomeScreen(details: { cwd: string; provider: string; model: string; sessionId: string }): string {
  const permission = process.env.DSH_PERMISSION_MODE ?? 'workspace-write'
  const access = permission === 'danger-full-access' ? 'FULL ACCESS — no approval prompts' : `${permission} — approvals enabled`
  const width = 76
  const line = (plain: string, rendered = plain) => {
    const padding = Math.max(1, width - plain.length - 4)
    return `│ ${rendered}${' '.repeat(padding)} │\n`
  }
  const detail = (label: string, value: string, renderedValue = value) => line(`${label}${value}`, `${paint(label, 'dim')}${renderedValue}`)
  const divider = '├' + '─'.repeat(width - 2) + '┤\n'
  const top = '┌' + '─'.repeat(width - 2) + '┐\n'
  const bottom = '└' + '─'.repeat(width - 2) + '┘\n'
  const title = '  DEEPSEEK HARNESS'
  const subtitle = 'INTERACTIVE TERMINAL'
  const header = `${title}${' '.repeat(width - title.length - subtitle.length - 4)}${subtitle}`

  return '\n'
    + paint(top, 'cyan')
    + paint(line(header), 'cyan')
    + paint(divider, 'cyan')
    + detail('  Workspace ', details.cwd)
    + detail('  Model     ', `${details.provider} / ${details.model}`)
    + detail('  Access    ', access, paint(access, permission === 'danger-full-access' ? 'yellow' : 'green'))
    + detail('  Platform  ', `${process.platform} · Node ${process.version}`)
    + detail('  Session   ', details.sessionId)
    + paint(divider, 'cyan')
    + line('  Input    Enter sends    Shift+Enter / Ctrl+J adds a line', `  ${paint('Input', 'bold')}    Enter sends    Shift+Enter / Ctrl+J adds a line`)
    + line('  Paste    Ctrl+V multi-line clipboard    /paste Windows clipboard', `  ${paint('Paste', 'bold')}    Ctrl+V multi-line clipboard    /paste Windows clipboard`)
    + line('  Control  Ctrl+C cancel    /verbose    /tool N    /help', `  ${paint('Control', 'bold')}  Ctrl+C cancel    /verbose    /tool N    /help`)
    + paint(bottom, 'cyan')
    + '\n'
}

const editorTheme: EditorTheme = {
  borderColor: value => paint(value, 'cyan'),
  selectList: {
    selectedPrefix: value => paint(value, 'cyan'),
    selectedText: value => value,
    description: value => paint(value, 'dim'),
    scrollInfo: value => paint(value, 'dim'),
    noMatch: value => paint(value, 'dim'),
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

  return (event: SessionEvent): void => {
    if (event.type === 'assistant/chunk') {
      const { chunk, turn, step } = event.data
      if (chunk.type !== 'text-delta') return
      const key = stepKey(turn, step)
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

/** A durable tool renderer with runtime detail controls. */
export interface ToolRenderer {
  (event: SessionEvent): void
  /** Toggle complete tool details for subsequent events. */
  toggleVerbose(): boolean
  /** Return retained details for a numeric call label. */
  detail(label: number): string | undefined
}

/**
 * Render durable execution milestones with a stable label for each parallel tool call.
 * @param resolveTool - Resolves the call's scoped presentation definition.
 * @param limits - Bounds retained and printed details.
 * @returns A Session-event listener with runtime detail controls.
 */
export function createToolRenderer(
  resolveTool?: (name: string) => ToolDefinition | undefined,
  limits: Config = { toolDetailMaxLines: 80, toolDetailMaxCharacters: 8_000 },
): ToolRenderer {
  const calls = new Map<string, { label: number; name: string; time: number; args: unknown; view?: ToolCallView }>()
  const details = new Map<number, string>()
  let nextLabel = 1
  let verbose = false

  const indent = (value: string): string => value.split('\n').map(line => `    ${line}`).join('\n')
  const formatValue = (value: unknown): string => typeof value === 'string' ? value : JSON.stringify(value, undefined, 2)
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
        details.set(call.label, `Input\n${truncate(detail)}`)
        internals.output.write(`\n[${String(call.label)}] ${title}…${verbose && detail !== '' ? `\n${indent(truncate(detail))}` : ''}\n`)
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
        const prefix = call === undefined ? '[tool]' : `[${String(call.label)}] ${title ?? call.name}`
        const elapsed = call === undefined ? '' : ` (${((event.time - call.time) / 1000).toFixed(1)}s)`
        const detail = resultDetail(view, event)
        const status = event.data.error === undefined ? `completed${elapsed}` : `failed: ${event.data.error.code}${elapsed}`
        const summary = resultSummary(view)
        if (call !== undefined) {
          const retained = details.get(call.label) ?? 'Input'
          details.set(call.label, `${retained}\n\nResult\n${truncate(detail)}`)
        }
        const showDetail = verbose || event.data.error !== undefined
        internals.output.write(`${prefix} ${status}${summary === '' ? '' : ` — ${summary}`}${showDetail && detail !== '' ? `\n${indent(truncate(detail))}` : ''}\n`)
        return
      }
      case 'turn/end':
        if (event.data.reason.kind === 'aborted') internals.output.write('\n[task cancelled]\n\n')
        if (event.data.reason.kind === 'error') internals.output.write(`\n[task failed: ${event.data.reason.error.message}]\n\n`)
        return
      default:
        return
    }
  }
  render.toggleVerbose = () => { verbose = !verbose; return verbose }
  render.detail = (label: number) => details.get(label)
  return render
}

/** Render and collect structured answers for the standard user-questions provider. */
function terminalQuestions(): UserQuestionProvider {
  return {
    async ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
      const answers: AskUserQuestionAnswer['answers'] = []
      for (const item of request.questions) {
        const heading = item.header === undefined ? '' : `${item.header}: `
        internals.output.write(`\n[question] ${heading}${item.question}\n`)
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
  internals.output.write(`\n[approval] Allow ${toolName}${reason === undefined ? '' : `: ${reason}`}\n`)
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
          internals.output.write('\n[cancelling task]\n\n')
        },
      }) ?? '/exit'
      const text = prompt.trim()
      if (text === '') continue
      if (text === '/exit' || text === '/quit') break
      if (text === '/help') {
        internals.output.write('\nEnter sends; Shift+Enter or Ctrl+J adds a line; Ctrl+V pastes multi-line text; /paste reads the Windows clipboard; /verbose toggles full tool output; /tool N shows one retained tool detail; /cancel or Ctrl+C stops the active task; /exit closes the session.\n\n')
        continue
      }
      if (text === '/verbose') {
        const enabled = writeToolEvent.toggleVerbose()
        internals.output.write(`\n[verbose tool output ${enabled ? 'enabled' : 'disabled'}]\n\n`)
        continue
      }
      const toolDetailMatch = /^\/tool\s+(\d+)$/u.exec(text)
      if (toolDetailMatch !== null) {
        const detail = writeToolEvent.detail(Number(toolDetailMatch[1]))
        internals.output.write(detail === undefined ? '\n[tool detail not found]\n\n' : `\n${detail}\n\n`)
        continue
      }
      if (text === '/cancel') {
        if (agent.status === 'running') {
          agent.cancel({ kind: 'user' })
          internals.output.write('\n[cancelling task]\n\n')
        } else {
          internals.output.write('\n[nothing is running]\n\n')
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
      if (text === '/paste') internals.output.write(`\n[pasted ${String(message.length)} characters]\n\n`)
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
