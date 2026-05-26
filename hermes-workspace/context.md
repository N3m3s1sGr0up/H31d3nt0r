# hermes-workspace

This directory is the **shared local cwd** the Cursor SDK uses for agent runs bridged from Hermes. Both operators and Hermes (when wired) share this single working tree (Pattern C — shared workspace, no HTTP file CRUD in v1).

## Bridge surface (v1)

| Route | Auth | Purpose |
|-------|------|---------|
| `GET /health` | none | Liveness probe for systemd / ops |
| `GET /v1/models` | Bearer | Hermes model discovery (incl. `context_length` when known) |
| `POST /v1/chat/completions` | Bearer | OpenAI-compatible chat (stream + non-stream); Hermes calls this |

Bridge is bound to `http://127.0.0.1:8787` (loopback only).

## Context contract

For v1 this file is a seed for human/agent context. In v2 a `GET /v1/context` route will surface:

- `bridgeGeneration` (monotonic; increments on process start)
- Active agent count + workspace path
- SDK version

Agents and operators may append accumulated context here between runs.

## Conventions

- Anything in this directory is considered ephemeral working state; it is gitignored except for this file and `.gitkeep`.
- Do not store secrets here. Bridge auth lives in `.env.local` at the repository root (chmod 600).
