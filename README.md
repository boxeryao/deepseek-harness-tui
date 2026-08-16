# DSH Mini TUI — DeepSeek Harness 极简终端插件

[English](README.en.md) | 中文

[DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 的极简终端 UI 插件。它保留完整的 Agent 与工具能力，但默认把执行过程收进后台，让终端专注于你的输入和模型的最终回答。

界面、npm 包与 GitHub 仓库统一命名为 **DSH Mini TUI** / [`dsh-mini-tui`](https://github.com/boxeryao/dsh-mini-tui)：`Mini` 指更少的界面噪声，而不是更少的 Harness 能力。中文也可以昵称为 **“单身汉 Mini TUI”**，取自 DSH 的谐音。

![DSH Mini TUI — Welcome to DeepSeek](assets/dsh-mini-tui-welcome.png)

![新版 DeepSeek Harness TUI 启动界面](assets/tui-startup-dashboard.png)

## DSH 与 Mini TUI 的关系

**DSH Mini TUI 是 DeepSeek Harness 的终端表现层插件，不是独立的 Agent 框架。** 它决定用户在终端里如何输入、查看状态和阅读回答；模型与 Agent 如何运行，仍由 DSH 负责。

DSH Mini TUI 与 [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) 同属 DeepSeek Harness 的社区终端界面生态，二者是独立的插件实现。

```text
dsh --profile tui
       │
       ▼
DeepSeek Harness（运行时与插件系统）
       │
       ├── 模型路由与凭据
       ├── standard Agent preset
       ├── 工具执行与权限审批
       ├── Session、日志与持久化
       └── dsh-mini-tui（终端表现层）
              ├── 输入框与流式回答
              ├── answer-first 工具输出
              ├── 活动状态与失败提示
              └── 窗口重绘、标题和终端交互
```

| DeepSeek Harness 负责 | DSH Mini TUI 负责 |
| --- | --- |
| 模型选择、路由与调用 | 启动界面、输入框与回答渲染 |
| Agent 生命周期与 `standard` preset | answer-first 对话布局与活动状态 |
| scoped 工具、审批与取消 | `/verbose`、`/tool N` 等终端命令 |
| Session 日志和完整执行记录 | resize 重绘、窗口标题与 Windows 终端体验 |
| DSH 插件生态与能力组合 | 将这些能力以克制的 TUI 形式呈现 |

因此，安装或移除 Mini TUI 改变的是 **DSH 的交互界面**，不会把 DSH 替换成另一套 Agent，也不会削减 DSH 的模型、工具或 Session 能力。

## Mini 的含义：少显示，专注回答

这版界面的设计原则很简单：**工具照常工作，过程不必占满屏幕。** 对终端用户来说，更少的状态信息意味着更清晰的上下文、更少的滚屏，也更容易连续阅读真正重要的回答。

- **渐变品牌标识** — 使用青蓝到深蓝的真彩色渐变展示 `DEEPSEEK` 字标，形成清晰、统一的终端识别度。
- **紧凑运行信息** — 字标下方只显示当前模型、工作目录和 `/help` 提示；不再堆叠 Session ID、平台版本、权限模式与快捷键说明。
- **深海配色体系** — 输入边框、状态标签、工作路径和思考提示共用低反差的海洋色板，长时间使用时更克制。
- **路径颜色标识** — 输出中的文件与目录路径会获得稳定的颜色，便于在日志和工具详情中快速定位引用目标。
- **回答优先的对话流** — 成功的工具调用默认不显示，终端主要呈现用户输入和模型回答；失败时只保留一行短提示，不让异常悄悄消失。
- **按需查看过程** — 极简不等于丢失信息。需要排查时，可用 `/verbose` 查看后续工具输出，或用 `/tool N` 查看已保留的调用详情；完整记录仍由 DSH Session 持久化。
- **安全的思考提示** — 模型推理期间显示简洁的 `[thinking]` 状态，但不会把内部 reasoning 内容输出到终端。

这是一种有意为之的取舍：**Mini 是界面，不是能力。** DSH 的模型路由、工具执行、审批、Agent 生命周期及 Session 持久化机制保持不变。

## 插件特点

- **轻量** — 专注于终端展示层，不携带 Web 应用运行时。
- **快捷** — 多行输入响应迅速，键盘控制直接，工具活动默认不打断对话流。
- **深海视觉** — 启动仪表盘、状态标签、路径引用和思考状态使用统一的低反差深海色系。
- **原生衔接 DSH** — 直接使用 DSH 的 scoped 工具、审批、Agent 生命周期和持久化 Session 日志。

## 快速安装

从 npm 将最新版 DSH Mini TUI 安装到 DSH 的 `tui` profile：

```powershell
dsh plugin --profile tui add dsh-mini-tui@latest
dsh --profile tui
```

> 注意：npm 上的 `deepseek-harness-tui` 属于另一个项目。本项目的正确包名是 `dsh-mini-tui`。

## Windows 资源管理器右键启动

DSH Mini TUI 内置当前用户级别的右键菜单安装器。安装后，可以在目录空白处、目录本身或磁盘驱动器上直接启动：

- **Open DSH TUI here** — 使用标准权限模式打开当前目录。
- **Open DSH TUI full access** — 以 `danger-full-access` 模式打开当前目录；只有主动选择该菜单时才会启用。

从 npm 安装到默认 `tui` profile 后执行：

```powershell
& "$HOME\.dsh\profiles\tui\node_modules\dsh-mini-tui\scripts\install-dsh-tui-context-menu.cmd"
```

从源码目录开发时执行：

```powershell
.\scripts\install-dsh-tui-context-menu.cmd
```

卸载右键菜单：

```powershell
.\scripts\uninstall-dsh-tui-context-menu.cmd
```

安装和卸载只修改 `HKEY_CURRENT_USER`，不需要管理员权限。右键命令最终运行 `dsh --profile tui`，因此模型、Agent 和工具仍由 DSH 提供。

## 环境要求

- Node.js 22.19 或更高版本，或者 Node.js 24+
- pnpm 11+
- 已安装 DeepSeek Harness `0.1.0-rc.6`
- DSH 中已有可用的模型凭据，可由凭据服务保存，也可通过启动环境提供

## 从本目录开发

```powershell
pnpm install
pnpm run build
pnpm test
dsh plugin --profile tui add .
dsh --profile tui
```

这里的 `dsh plugin --profile tui add .` 用于安装当前源码目录；普通用户应优先使用上面的 npm 快速安装命令。本包使用 npm 已发布的 `0.1.0-rc.6` 版 `@deepseek-ai/*` 包，不包含 monorepo 相对路径或 `workspace:^` 依赖。

## 输入与命令

- Enter 发送当前消息。
- Shift+Enter 或 Ctrl+J 插入换行。
- Ctrl+V 接收 bracketed 多行粘贴；`/paste` 直接读取 Windows 剪贴板。
- `/cancel` 或 Ctrl+C 取消当前任务。
- `/verbose` 切换后续调用的限长工具输出。
- `/tool N` 显示编号为 `N` 的调用所保留的输入和结果。
- `/help` 显示命令；`/exit` 或 `/quit` 关闭会话。

工具调用默认静默；失败时只显示一行短提示。`/verbose` 会显示后续调用的编号摘要和限长详情，`/tool N` 可查看最近保留的输入和结果。`toolDetailMaxLines` 和 `toolDetailMaxCharacters` 默认限制为 80 行和 8,000 字符。`toolDetailHistoryLimit` 默认让 `/tool N` 保留最近 200 次调用；更早的详情会从进程内存淘汰，完整值仍保留在 DSH Session 日志中。

## 范围

本仓库只负责终端展示插件。模型路由、工具、权限、持久化和 Agent 执行由 DSH 提供。TUI 采用行式界面，不提供 Web 客户端的图形卡片、会话导航或全屏滚动区。

## 许可证

[MIT](LICENSE)
