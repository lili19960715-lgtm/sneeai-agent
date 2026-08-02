# Sneeai Agent Codex Plugin

让 Codex 可以打开并操作 SneeAI Canvas。

## 安装

macOS / Linux：

```bash
git clone https://github.com/lili19960715-lgtm/sneeai-agent.git
cd sneeai-agent
codex plugin marketplace add "$(pwd)"
codex plugin add sneeai-agent@sneeai
```

Windows PowerShell：

```powershell
git clone https://github.com/lili19960715-lgtm/sneeai-agent.git
cd sneeai-agent
codex plugin marketplace add "$PWD"
codex plugin add sneeai-agent@sneeai
```

Windows CMD 将 `$PWD` 替换为 `%cd%`。

安装后新建一个 Codex 任务，然后输入：

```text
帮我打开并连接到 SneeAI Canvas
```
