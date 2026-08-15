# Changelog

## Unreleased

- Documented the one-line npm installation command for the DSH `tui` profile.
- Introduced **DSH Mini TUI** as the interface name while keeping the `deepseek-harness-tui` package and repository identity stable.
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
