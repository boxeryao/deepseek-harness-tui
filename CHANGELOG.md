# Changelog

## Unreleased

- Kept the full session transcript inside the TUI render tree so terminal resize redraws no longer leave only the input editor visible.
- Added a live, phase-aware activity indicator with elapsed time, terminal progress integration, and `Ctrl+C` cancellation while an agent turn is running.
- Added a moving highlight to the startup logo and an active `MESSAGE` marker with a gently pulsing input border.
- Set the terminal window title to the active workspace directory name.
- Bundled current-user Windows Explorer context-menu installers in the npm package, including standard and explicitly selected full-access entries.

## 0.2.0 — 2026-08-15

- Published the plugin under the unique npm package name `dsh-mini-tui` and documented one-line installation for the DSH `tui` profile.
- Introduced **DSH Mini TUI** as the interface and package name while keeping the existing GitHub repository URL.
- Redesigned the startup screen with a true-color `DEEPSEEK` gradient, compact model and workspace context, and a direct `/help` hint.
- Added a restrained deep-sea palette with consistent status styling and deterministic colors for file and directory references.
- Clarified the answer-first interface: routine tool activity stays out of the conversation without removing tools, failure visibility, retained details, or durable Session logs.
- Kept successful tool activity quiet by default while retaining details for `/tool N`.
- Added a compact thinking indicator without displaying reasoning content.
- Added portable Windows launch, local-profile, and Explorer context-menu helpers.

## 0.1.1

- Limited retained `/tool N` details to the latest 200 calls by default.

## 0.1.0

- Added multi-line input and bracketed clipboard paste.
- Added compact numbered tool summaries, automatic failure details, `/verbose`, and `/tool N`.
- Added configurable limits for retained terminal tool details.
- Split the TUI into an independently installable DeepSeek Harness plugin.
