# DeepSeek Harness TUI — DSH 插件

[English](README.en.md) | 中文

[DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 的轻量、快捷终端 UI 插件。它直接衔接 DSH 的 Agent、工具、权限和 Session 服务，不重复实现 Harness 运行时。

项目简称 **DSH-TUI**，中文昵称为 **“单身汉 TUI”**，取自 DSH 的谐音。

![DeepSeek Harness TUI](assets/tui-windows.png)

## 插件特点

- **轻量** — 专注于终端展示层，不携带 Web 应用运行时。
- **快捷** — 多行输入响应迅速，键盘控制直接，工具活动以简洁摘要呈现。
- **原生衔接 DSH** — 直接使用 DSH 的 scoped 工具、审批、Agent 生命周期和持久化 Session 日志。

## 环境要求

- Node.js 22.19 或更高版本，或者 Node.js 24+
- pnpm 11+
- 已安装 DeepSeek Harness `0.1.0-rc.6`
- DSH 中已有可用的模型凭据，可由凭据服务保存，也可通过启动环境提供

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

工具调用默认显示带编号的摘要，失败调用自动展开。`toolDetailMaxLines` 和 `toolDetailMaxCharacters` 默认限制为 80 行和 8,000 字符。`toolDetailHistoryLimit` 默认让 `/tool N` 保留最近 200 次调用；更早的详情会从进程内存淘汰，完整值仍保留在 DSH Session 日志中。

## 范围

本仓库只负责终端展示插件。模型路由、工具、权限、持久化和 Agent 执行由 DSH 提供。TUI 采用行式界面，不提供 Web 客户端的图形卡片、会话导航或全屏滚动区。

## 许可证

[MIT](LICENSE)
