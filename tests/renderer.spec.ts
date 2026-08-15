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

function reasoningStart(): SessionEvent<'assistant/chunk'> {
  return {
    type: 'assistant/chunk', seq: 0, time: 0,
    data: { turn: 1, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } },
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

  it('renders a compact thinking state without printing reasoning text', () => {
    let output = ''
    internals.output = { write: (chunk: string) => { output += chunk; return true } } as typeof process.stdout
    const render = createAssistantRenderer()

    render(reasoningStart())
    render({
      type: 'assistant/chunk', seq: 1, time: 0,
      data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'private reasoning' } },
    })
    render(textDelta('Answer'))
    render(completed('Answer'))

    expect(output).toBe('\n[thinking] tracing the deep current...\n\nAnswer\n\n')
    expect(output).not.toContain('private reasoning')
  })
})

describe('tool renderer', () => {
  it('keeps successful tool calls quiet while retaining numbered details', () => {
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

    expect(output).toBe('')
    expect(render.detail(1)).toBe('Input\n{}\n\nResult\n')
  })

  it('keeps tool-owned presentations available through detail lookup', () => {
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

    expect(output).toBe('')
    expect(render.detail(1)).toContain('Input\nE:\\work\nGet-ChildItem')
    expect(render.detail(1)).toContain('Result\nREADME.md\nsrc\nexit 0')
  })

  it('toggles bounded details and expands failed results automatically', () => {
    let output = ''
    internals.output = { write: (chunk: string) => { output += chunk; return true } } as typeof process.stdout
    const render = createToolRenderer(undefined, { toolDetailMaxLines: 2, toolDetailMaxCharacters: 100, toolDetailHistoryLimit: 200 })
    expect(render.toggleVerbose()).toBe(true)
    const callId = CallId('read-1')

    render({ type: 'tool/call', seq: 0, time: 1_000, data: { turn: 1, step: 1, callId, name: 'read', arguments: '{"path":"README.md"}' } })
    render({ type: 'tool/result', seq: 1, time: 2_000, surfaceOp: 'append', data: {
      turn: 1, step: 1, error: { code: 'READ_FAILED', name: 'ReadError' },
      message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'one\ntwo\nthree' }], isError: true }),
    } })

    expect(output).toContain('    {\n      "path": "README.md"\n    … 1 lines omitted')
    expect(output).toContain('[tool 1] read failed: READ_FAILED (1.0s)\n    one\n    two\n    … 1 lines omitted')
  })

  it('prints only a compact line for failed tools outside verbose mode', () => {
    let output = ''
    internals.output = { write: (chunk: string) => { output += chunk; return true } } as typeof process.stdout
    const render = createToolRenderer()
    const callId = CallId('read-1')

    render({ type: 'tool/call', seq: 0, time: 1_000, data: { turn: 1, step: 1, callId, name: 'read', arguments: '{}' } })
    render({ type: 'tool/result', seq: 1, time: 2_000, surfaceOp: 'append', data: {
      turn: 1, step: 1, error: { code: 'READ_FAILED', name: 'ReadError' },
      message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'private detail' }], isError: true }),
    } })

    expect(output).toBe('\n[tool failed] read: READ_FAILED\n\n')
    expect(render.detail(1)).toContain('private detail')
  })

  it('retains only the configured number of tool details', () => {
    internals.output = { write: () => true } as typeof process.stdout
    const render = createToolRenderer(undefined, {
      toolDetailMaxLines: 80, toolDetailMaxCharacters: 8_000, toolDetailHistoryLimit: 2,
    })

    for (const [index, value] of ['first', 'second', 'third'].entries()) {
      render({
        type: 'tool/call', seq: index, time: index,
        data: { turn: 1, step: 1, callId: CallId(value), name: 'read', arguments: `{"value":"${value}"}` },
      })
    }

    expect(render.detail(1)).toBeUndefined()
    expect(render.detail(2)).toContain('second')
    expect(render.detail(3)).toContain('third')
  })
})

describe('welcome screen', () => {
  it('reports only the active workspace, model, and help hint', () => {
    const originalPermission = process.env.DSH_PERMISSION_MODE
    process.env.DSH_PERMISSION_MODE = 'danger-full-access'
    try {
      const screen = welcomeScreen({ cwd: 'E:\\work', provider: 'deepseek', model: 'deepseek-chat', sessionId: 'session-test' })

      expect(screen).toContain('D E E P S E E K  T U I')
      expect(screen).toContain('deepseek/deepseek-chat')
      expect(screen).toContain('cwd E:\\work')
      expect(screen).toContain('/help commands')
      expect(screen).not.toContain('session-test')
      expect(screen).not.toContain('FULL ACCESS')
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
