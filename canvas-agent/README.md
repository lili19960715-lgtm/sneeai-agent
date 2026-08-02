# Sneeai Agent

Sneeai Agent is the independent local runtime for SneeAI. Users download and update it separately from the Codex plugin. It runs on the user's computer, listens only on `127.0.0.1`, and connects the SneeAI website to the user's local Codex.

## Start locally

```bash
npx -y @sneeai/sneeai-agent
```

For diagnostics:

```bash
npx -y @sneeai/sneeai-agent doctor
npx -y @sneeai/sneeai-agent version
```

The Agent stores its local configuration in `~/.sneeai-agent/sneeai-agent.json`. It never sends the user's Codex credentials to SneeAI.

## Website pairing

The website discovers the loopback Agent, verifies its protocol and device identity, then issues a short-lived authorization ticket. The Agent must be running before the website can connect. Agent updates do not require a Codex plugin update as long as the stable protocol remains compatible.

## Codex plugin boundary

The Codex plugin is a separate package. It starts `@sneeai/sneeai-codex-bridge`, which only forwards MCP calls to this already-installed local Agent. The bridge never starts, downloads, or upgrades the Agent.

## Development

```bash
cd canvas-agent
npm install
npm run typecheck
npm test
npm run build
```

The current release baseline is `0.3.3`. Publish it only after the website API and the Agent download channel are available.
