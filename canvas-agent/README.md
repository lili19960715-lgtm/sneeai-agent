# Sneeai Agent

本地 Canvas Agent 用来连接画布网页和用户电脑上的 Codex / Claude Code。本地 Agent 不部署到云端，网站和生成后端运行在 `sneeai.com`。

## 启动

```bash
npx -y @sneeai/sneeai-agent
```

需要排查连接、线程、Codex app-server 或工具调用问题时，可开启 Debug 模式：

```bash
npx -y @sneeai/sneeai-agent --debug
```

Debug 日志会以 `[DEBUG][HH:mm:ss]` 等传统格式输出到终端，并按启动日期保存到 `~/.sneeai-agent/logs/sneeai-agent-YYYY-MM-DD.log`。终端日志带级别颜色，文件日志为纯文本；日志包含 HTTP、SSE、线程、turn、Codex app-server 和工具调用事件，token 与图片 Data URL 会自动隐藏。

本仓库开发时也可以直接运行：

```bash
cd canvas-agent
npm install
npm run build
node dist/index.js
```

启动后会输出本机地址和 token：

```txt
Local URL: http://127.0.0.1:17371
Connect token: xxxxxx
```

在画布右上角点击 `Agent`，填入地址和 token 后连接。

使用 `open` 子命令时，Canvas Agent 会复用本机配置、启动本地服务并打开带 fragment 配对信息的画布地址：

```bash
npx -y @sneeai/sneeai-agent@0.3.2 open "https://sneeai.com/canvas?mode=new"
```

诊断本机 Node、Agent 端口和版本：

```bash
npx -y @sneeai/sneeai-agent@0.3.2 doctor
npx -y @sneeai/sneeai-agent@0.3.2 version
```

Sneeai Agent 默认只监听 `127.0.0.1`。网页第一次带正确 token 连接后，Sneeai Agent 会记录该网页 Origin；之后其他 Origin 不能复用这个本地 Agent，除非用户清理 `~/.sneeai-agent/sneeai-agent.json` 里的 `origins`。

## 发布

`sneeai-agent` 使用自己的 `package.json` 版本号，不跟仓库根目录 `VERSION` 绑定。推送到 `main` 后，GitHub Actions 会检查 npm 上是否已经存在当前包版本；不存在时才发布 `@sneeai/sneeai-agent`。

发布使用 npm Trusted Publisher 与 GitHub Actions OIDC。npm 包仅信任
`sneeai/sneeai-agent` 仓库中的 `publish-canvas-agent.yml`，工作流不保存长期 npm Token。

## Codex MCP

如果希望 Codex 终端能直接操作画布，需要先把 Canvas Agent 注册成 Codex MCP。

直接运行 `npx -y @sneeai/sneeai-agent` 只启动本地 Agent 服务，不会安装 MCP，也不会增加 Codex 工具上下文。只有安装 Codex app 插件，或手动执行 `codex mcp add` 后，`sneeai-agent` 工具才会进入 Codex 上下文；由于工具较多，不使用时建议移除。

通过插件安装时移除插件：

```bash
codex plugin remove sneeai-agent
```

手动添加 MCP 时移除 MCP：

```bash
codex mcp remove sneeai-agent
```

### Codex app 插件

仓库内提供了 Codex app 插件：`plugins/infinite-canvas`。在 Codex app 中添加本仓库的 marketplace 后，可以安装 `Sneeai Agent` 插件；插件会注册同一个 `sneeai-agent` MCP，并带上画布操作说明。

添加本地 marketplace 时建议使用仓库绝对路径，避免 Codex 从其他工作目录解析失败：

```bash
cd /path/to/infinite-canvas
codex plugin marketplace add "$(pwd)"
codex plugin add sneeai-agent@sneeai
```

插件默认通过 npm 启动 MCP；MCP 启动前会自动拉起或复用普通本地 Agent，不会把 MCP 写入全局配置，也不会在退出时自动卸载：

```bash
npx -y @sneeai/sneeai-agent@0.3.2 mcp
```

使用时可以直接在 Codex 里说“打开 Infinite Canvas”，插件会使用本地 Agent 的配对信息，在右侧打开 `https://sneeai.com/` 并自动新建、连接画布；只有明确要求使用本地项目时才会启动本地前端。

Canvas Agent 启动后，给 Codex 添加 MCP：

```bash
codex mcp add sneeai-agent -- npx -y @sneeai/sneeai-agent@0.3.2 mcp
```

本仓库开发时可以改成，实际使用建议替换为本机绝对路径：

```bash
codex mcp add sneeai-agent -- node /path/to/sneeai-agent/canvas-agent/dist/index.js mcp
```

Canvas Agent 源码使用 TypeScript 编写，MCP 协议层使用官方 `@modelcontextprotocol/sdk`，工具入参使用 `zod` 描述。

如果希望终端里的 Codex 不被 MCP 审批卡住，可以在 `~/.codex/config.toml` 里给这个 MCP 设置自动放行：

```toml
[mcp_servers.sneeai-agent]
command = "npx"
args = ["-y", "@sneeai/sneeai-agent@0.3.2", "mcp"]
default_tools_approval_mode = "approve"
```

可用工具：

- `canvas_get_state`
- `canvas_get_selection`
- `canvas_export_snapshot`
- `canvas_apply_ops`
- `canvas_create_text_node`
- `canvas_create_image_prompt_flow`

`canvas_apply_ops` 示例：

```json
{
  "ops": [
    {
      "type": "add_node",
      "nodeType": "text",
      "title": "标题",
      "position": { "x": 0, "y": 0 },
      "metadata": { "content": "文本内容" }
    }
  ]
}
```

## 侧边栏 Codex

本地面板会把提示词发送给 Sneeai Agent。Sneeai Agent 使用官方 `@openai/codex` CLI 的 `codex app-server --stdio` 启动并复用同一个 Codex thread，启动时会注入 `sneeai-agent` MCP 配置并自动放行 MCP 审批，真正执行画布修改前仍由网页侧边栏二次确认。

### Codex 双通道

Canvas Agent 会读取本机默认 Codex 的脱敏账户状态：

- ChatGPT 订阅登录：复用用户本机 Codex 订阅，不显示或复制密钥。
- API key/第三方中转登录：不读取用户默认 Codex 配置。用户在 Agent 面板申请并输入独立 API key 后，Agent 在 `~/.sneeai-agent/codex-kapeai` 中启动隔离的 Codex 运行环境；固定 provider 地址只存在本地配置，不显示在网页，也不能由用户修改。

Agent 专用密钥由 Codex app-server 写入专用 `CODEX_HOME`，不上传网站、不写浏览器 localStorage、不写普通 Agent 配置文件；清除 Agent API 时只注销该专用运行环境。

侧边栏会展示 Codex 返回的 `thread.started`、`turn.started`、`item.*`、`turn.completed` 等结构化事件；Canvas Agent 会合并短时间内的回复、思考摘要和命令输出增量，网页使用同一条消息持续更新，并把任务进度、计划、搜索、文件修改与工具操作整理为中文过程时间线。

侧边栏上传或粘贴的图片会先发到本机 Canvas Agent，再由 Canvas Agent 临时写入本机文件并作为 app-server `localImage` 输入传给 Codex；前端会提示附件体积，单次请求体限制为 30MB。

## Claude Code

Claude Code Adapter 代码暂时保留，但当前网页侧边栏只开放 Codex。后续开放 Claude 入口时，Canvas Agent 会调用本机 `claude -p --output-format stream-json` 并把流式 JSON 事件转发到侧边栏。

如果希望 Claude Code 也能操作画布，需要给 Claude Code 添加同一个 MCP。建议用 user scope，避免 Canvas Agent 从不同目录启动时找不到配置：

```bash
claude mcp add --scope user --transport stdio sneeai-agent -- npx -y @sneeai/sneeai-agent@0.3.2 mcp
```

本仓库开发时可以改成：

```bash
claude mcp add --scope user --transport stdio sneeai-agent -- node /path/to/sneeai-agent/canvas-agent/dist/index.js mcp
```

Sneeai Agent 调用 Claude Code 时会默认带上 `--allowedTools mcp__sneeai-agent__*`，画布写操作仍由网页侧边栏确认。
