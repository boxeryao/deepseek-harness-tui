import { afterEach, describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { createAssistantRenderer, createToolRenderer, internals, welcomeScreen } from '../src/index.ts'
import { CallId, createToolResultMessage, MessageId } from '@deepseek-ai/dsh-llm'
import { getKeybindings } from '@earendil-works/pi-tui'

const originalOutput = internals.output

afterEach(() => {
  internals.output = originalOutput
})

function textDelta(text: string): SessionEvent<'assistant/chunk'> {
  return {
    type: 'assistant/chunk', seq: 0, time: 0,
    data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text } },
  }
}

function completed(text: string): SessionEvent<'assistant/message'> {
  return {
    type: 'assistant/message', seq: 1, time: 1,
    data: {
      turn: 1,
      step: 1,
      message: {
        id: MessageId('assistant-message'),
        role: 'assistant',
        content: [{ type: 'text', text }],
        source: { kind: 'model', provider: 'test-provider', model: 'test-model' },
      },
    },
    surfaceOp: 'append',
  }
}

describe('assistant renderer', () => {
  it('writes text deltas immediately and does not repeat their completed message', () => {
    let output = ''
    internals.output = { write: (chunk: string) => { output += chunk; return true } } as typeof process.stdout
    const render = createAssistantRenderer()

    render(textDelta('Hel'))
    render(textDelta('lo'))
    render(completed('Hello'))

    expect(output).toBe('\nHello\n\n')
  })

  it('prints a completed message when its provider did not stream text', () => {
    let output = ''
    internals.output = { write: (chunk: string) => { output += chunk; return true } } as typeof process.stdout

    createAssistantRenderer()(completed('replayed response'))

    expect(output).toBe('\nreplayed response\n\n')
  })

  it('appends a completed suffix that was unavailable in the raw stream', () => {
    let output = ''
    internals.output = { write: (chunk: string) => { output += chunk; return true } } as typeof process.stdout
    const render = createAssistantRenderer()

    render(textDelta('draft'))
    render(completed('draft final'))

    expect(output).toBe('\ndraft final\n\n')
  })
})

describe('tool renderer', () => {
  it('matches parallel results to their numbered tool calls', () => {
    let output = ''
    internals.output = { write: (chunk: string) => { output += chunk; return true } } as typeof process.stdout
    const render = createToolRenderer()
    const first = CallId('read-1')
    const second = CallId('read-2')

    render({ type: 'tool/call', seq: 0, time: 1_000, data: { turn: 1, step: 1, callId: first, name: 'read', arguments: '{}' } })
    render({ type: 'tool/call', seq: 1, time: 1_500, data: { turn: 1, step: 1, callId: second, name: 'read', arguments: '{}' } })
    render({
      type: 'tool/result', seq: 2, time: 2_000, surfaceOp: 'append',
      data: { turn: 1, step: 1, message: createToolResultMessage({ callId: second, content: [], isError: false }) },
    })
    render({
      type: 'tool/result', seq: 3, time: 4_250, surfaceOp: 'append',
      data: { turn: 1, step: 1, message: createToolResultMessage({ callId: first, content: [], isError: false }) },
    })

    expect(output).toBe('\n[1] read…\n\n[2] read…\n[2] read completed (0.5s)\n[1] read completed (3.3s)\n')
    expect(render.detail(1)).toBe('Input\n{}\n\nResult\n')
  })

  it('renders tool-owned command and result presentations', () => {
    let output = ''
    internals.output = { write: (chunk: string) => { output += chunk; return true } } as typeof process.stdout
    const render = createToolRenderer(() => ({
      name: 'pwsh', description: '', parameters: {}, output: { schema: {} }, execute: async () => [],
      presentCall: () => ({ card: 'terminal', title: 'Get-ChildItem', cwd: 'E:\\work' }),
      presentResult: () => ({ card: 'terminal', output: 'README.md\nsrc', exitCode: 0 }),
    } as never))
    const callId = CallId('pwsh-1')

    render({ type: 'tool/call', seq: 0, time: 1_000, data: { turn: 1, step: 1, callId, name: 'pwsh', arguments: '{"command":"Get-ChildItem"}' } })
    render({ type: 'tool/result', seq: 1, time: 2_500, surfaceOp: 'append', data: {
      turn: 1, step: 1, message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'raw' }], isError: false }),
    } })

    expect(output).toBe('\n[1] Get-ChildItem…\n[1] Get-ChildItem completed (1.5s) — exit 0\n')
    expect(render.detail(1)).toContain('Input\nE:\\work\nGet-ChildItem')
    expect(render.detail(1)).toContain('Result\nREADME.md\nsrc\nexit 0')
  })

  it('toggles bounded details and expands failed results automatically', () => {
    let output = ''
    internals.output = { write: (chunk: string) => { output += chunk; return true } } as typeof process.stdout
    const render = createToolRenderer(undefined, { toolDetailMaxLines: 2, toolDetailMaxCharacters: 100 })
    expect(render.toggleVerbose()).toBe(true)
    const callId = CallId('read-1')

    render({ type: 'tool/call', seq: 0, time: 1_000, data: { turn: 1, step: 1, callId, name: 'read', arguments: '{"path":"README.md"}' } })
    render({ type: 'tool/result', seq: 1, time: 2_000, surfaceOp: 'append', data: {
      turn: 1, step: 1, error: { code: 'READ_FAILED', name: 'ReadError' },
      message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'one\ntwo\nthree' }], isError: true }),
    } })

    expect(output).toContain('    {\n      "path": "README.md"\n    … 1 lines omitted')
    expect(output).toContain('[1] read failed: READ_FAILED (1.0s)\n    one\n    two\n    … 1 lines omitted')
  })
})

describe('welcome screen', () => {
  it('reports the active workspace, model, access mode, and input commands', () => {
    const originalPermission = process.env.DSH_PERMISSION_MODE
    process.env.DSH_PERMISSION_MODE = 'danger-full-access'
    try {
      const screen = welcomeScreen({ cwd: 'E:\\work', provider: 'deepseek', model: 'deepseek-chat', sessionId: 'session-test' })

      expect(screen).toContain('Workspace E:\\work')
      expect(screen).toContain('deepseek / deepseek-chat')
      expect(screen).toContain('FULL ACCESS — no approval prompts')
      expect(screen).toContain('Shift+Enter / Ctrl+J adds a line')
      expect(screen).toContain('Ctrl+V multi-line clipboard')
      expect(screen).toContain('Ctrl+C cancel')
      expect(screen).toContain('/verbose')
      expect(screen).toContain('/tool N')
    } finally {
      if (originalPermission === undefined) delete process.env.DSH_PERMISSION_MODE
      else process.env.DSH_PERMISSION_MODE = originalPermission
    }
  })
})

describe('editor integration', () => {
  it('uses the framework bindings for submit and newline', () => {
    const bindings = getKeybindings()
    expect(bindings.getKeys('tui.input.submit')).toContain('enter')
    expect(bindings.getKeys('tui.input.newLine')).toEqual(expect.arrayContaining(['shift+enter', 'ctrl+j']))
  })
})
