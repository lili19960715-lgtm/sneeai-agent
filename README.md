# Sneeai Agent

Sneeai Agent is the cross-platform Codex plugin and local MCP bridge for SneeAI Canvas.

## Install the Codex plugin

```bash
git clone https://github.com/lili19960715-lgtm/sneeai-agent.git
cd sneeai-agent
codex plugin marketplace add "$(pwd)"
codex plugin add sneeai-agent@sneeai
```

On Windows PowerShell, use `$PWD` instead of `$(pwd)`.

## Run the local agent

```bash
npx -y @sneeai/sneeai-agent@0.3.1 open
```

The package uses the user's local Codex installation and connects it to SneeAI Canvas. Codex credentials stay on the user's device.

See [canvas-agent/README.md](canvas-agent/README.md) for commands and configuration.
