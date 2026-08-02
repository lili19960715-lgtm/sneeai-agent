# Sneeai Codex Plugin

Sneeai is the stable Codex-side bridge for a separately installed Sneeai Agent.

## Install

```bash
git clone https://github.com/sneeai/sneeai-agent.git
cd sneeai-agent
codex plugin marketplace add "$(pwd)"
codex plugin add sneeai@sneeai
```

Windows PowerShell uses `"$PWD"` instead of `"$(pwd)"`.

## Use

1. Download and start Sneeai Agent from the SneeAI website.
2. Install this Codex plugin once.
3. Open a new Codex task and say: `打开并连接 SneeAI Canvas`.

The plugin contains its small Codex bridge, but not the Agent runtime. It does not download, start, or pin an Agent version. Agent upgrades are independent. If the Agent is missing, stopped, or incompatible, the bridge reports that the user should download or update it.
