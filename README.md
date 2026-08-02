# Sneeai

Sneeai is the Codex plugin bridge for the independently installed Sneeai Agent runtime.

## Install the Codex plugin

```bash
git clone https://github.com/sneeai/sneeai-agent.git
cd sneeai-agent
codex plugin marketplace add "$(pwd)"
codex plugin add sneeai@sneeai
```

On Windows PowerShell, use `$PWD` instead of `$(pwd)`.

## Start the local Agent

```bash
npx -y @sneeai/sneeai-agent open
```

The Agent is downloaded and updated independently from the Codex plugin. Codex credentials stay on the user's device.

See [canvas-agent/README.md](canvas-agent/README.md) for commands and configuration.
