---
name: open-canvas
description: 打开 SneeAI 在线或本地画布，并连接用户已安装的本机 Sneeai Agent。用户要求打开、启动、进入或使用 SneeAI 画布时使用。
---

# Open SneeAI Canvas

默认打开在线版。只有用户明确要求使用本地项目时，才启动本地前端。

## 在线版

1. 在浏览器打开：

```text
https://sneeai.com/canvas?mode=new
```

2. 网页会自动发现已经运行的本机 Sneeai Agent，并通过网站授权完成配对。

3. Agent 未安装、未启动或版本不兼容时，告知用户先在 SneeAI 下载页安装或更新 Agent；不要自行通过 npm 下载、升级或启动 Agent。

## 本地版

1. 在 SneeAI 项目中启动前端，并使用 Vite 输出的 `Local` 地址：

```bash
cd web
pnpm install
pnpm dev
```

2. 用户已经启动本机 Sneeai Agent 后，打开：

```text
<Vite Local 地址>/canvas?mode=new
```

## MCP 与连接边界

插件只启动 Sneeai Codex Bridge。Bridge 将 MCP 工具请求转发到已经安装并运行的本机 Sneeai Agent；它不会下载、启动、升级 Agent，也不处理网站授权凭据。

## 打开模式

用户没有明确指定打开方式时，始终使用 `mode=new` 新建画布。只有用户明确要求时才替换为：

- 最近画布：`mode=recent`
- 自己选择：`mode=choose`
