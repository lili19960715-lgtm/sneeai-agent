# Sneeai

Sneeai is the Codex plugin bridge for the independently installed Sneeai Agent runtime. The plugin ships its bridge directly and does not download the Agent from npm.

## Install the Codex plugin

```bash
git clone https://github.com/sneeai/sneeai-agent.git
cd sneeai-agent
codex plugin marketplace add "$(pwd)"
codex plugin add sneeai@sneeai
```

On Windows PowerShell, use `$PWD` instead of `$(pwd)`.

## Start the local Agent during development

```bash
cd canvas-agent
npm install
npm run build
npm start
```

Production users download the Agent installer from sneeai.com. The Agent is not distributed through npm and is updated independently from the Codex plugin. Codex credentials stay on the user's device.

See [canvas-agent/README.md](canvas-agent/README.md) for commands and configuration.
