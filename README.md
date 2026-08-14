# DeepSeek Harness TUI

English | [中文](README.zh.md)

An independent terminal UI plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It provides multi-line editing and bracketed paste through `pi-tui`, compact tool activity, interactive approvals, and persisted Harness sessions.

![DeepSeek Harness TUI](assets/tui-windows.png)

## Requirements

- Node.js 22.19 or later, or Node.js 24+
- pnpm 11+
- DeepSeek Harness `0.1.0-rc.6`
- `DEEPSEEK_API_KEY` in the process that launches `dsh`

## Develop from this checkout

```powershell
pnpm install
pnpm run build
pnpm test
dsh plugin --profile tui add .
dsh --profile tui
```

The package consumes published `@deepseek-ai/*` packages at `0.1.0-rc.6`; it has no monorepo-relative or `workspace:^` dependency.

## Input and commands

- Enter sends the current message.
- Shift+Enter or Ctrl+J inserts a newline.
- Ctrl+V accepts bracketed multi-line paste; `/paste` reads the Windows clipboard directly.
- `/cancel` or Ctrl+C cancels the active task.
- `/verbose` toggles bounded tool details for subsequent calls.
- `/tool N` prints the retained input and result for call number `N`.
- `/help` lists commands; `/exit` or `/quit` closes the session.

Tool calls show numbered summaries by default and failed calls expand automatically. `toolDetailMaxLines` and `toolDetailMaxCharacters` default to 80 lines and 8,000 characters. Complete tool values remain in the Harness Session log.

## Scope

This repository owns only the terminal presentation plugin. DeepSeek Harness owns model routing, tools, permissions, persistence, and agent execution. The TUI is line-oriented and does not provide the Web client's graphical cards, session navigation, or full-screen scrollback.

## License

[MIT](LICENSE)

