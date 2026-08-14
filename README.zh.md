# DeepSeek Harness TUI

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的独立终端 UI 插件。它通过 `pi-tui` 提供多行编辑与 bracketed paste，并支持简洁的工具活动、交互式审批和 Harness 持久化会话。

![DeepSeek Harness TUI](assets/tui-windows.png)

## 环境要求

- Node.js 22.19 或更高版本，或者 Node.js 24+
- pnpm 11+
- DeepSeek Harness `0.1.0-rc.6`
- 启动 `dsh` 的进程中已设置 `DEEPSEEK_API_KEY`

## 从本目录开发和安装

```powershell
pnpm install
pnpm run build
pnpm test
dsh plugin --profile tui add .
dsh --profile tui
```

本包使用 npm 已发布的 `0.1.0-rc.6` 版 `@deepseek-ai/*` 包，不包含 monorepo 相对路径或 `workspace:^` 依赖。

## 输入与命令

- Enter 发送当前消息。
- Shift+Enter 或 Ctrl+J 插入换行。
- Ctrl+V 接收 bracketed 多行粘贴；`/paste` 直接读取 Windows 剪贴板。
- `/cancel` 或 Ctrl+C 取消当前任务。
- `/verbose` 切换后续调用的限长工具详情。
- `/tool N` 显示编号为 `N` 的调用所保留的输入和结果。
- `/help` 显示命令；`/exit` 或 `/quit` 关闭会话。

工具调用默认显示带编号的摘要，失败调用自动展开。`toolDetailMaxLines` 和 `toolDetailMaxCharacters` 默认限制为 80 行和 8,000 字符。完整工具值仍保留在 Harness Session 日志中。

## 范围

本仓库只负责终端展示插件。模型路由、工具、权限、持久化和 Agent 执行由 DeepSeek Harness 提供。TUI 采用行式界面，不提供 Web 客户端的图形卡片、会话导航或全屏滚动区。

## 许可证

[MIT](LICENSE)

