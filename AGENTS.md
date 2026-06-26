# AGENTS.md — H31d3nt0r

Contract for **agents calling this gateway** (OpenAI-compatible HTTP wire format on `/v1/*`; default inference backend is Cursor SDK local) and **agents modifying its source**.

## For agents calling the gateway

### Primitives

| Goal | Endpoint |
|------|----------|
| Liveness probe | `GET /health` (no auth) — exposes `bridgeGeneration`, `changelog`, `version`. |
| Readiness probe | `GET /ready` (no auth) — probes `Cursor.models.list` unless `BRIDGE_CURSOR_READY_MS=0` (skipped). |
| Models | `GET /v1/models`, `GET /v1/models/{id}` with Bearer auth. |
| Chat (blocking) | `POST /v1/chat/completions` with Bearer auth. |
| Chat (streaming) | Same POST with `"stream": true` — SSE, terminal `[DONE]`. `: comment` heartbeats when `BRIDGE_SSE_HEARTBEAT_MS > 0`. |
| Capability discovery | `GET /v1/capabilities` (Bearer). |

### Dual tool path (v1.1)

- **Upstream proxy:** `BRIDGE_CHAT_UPSTREAM_*` POSTs verbatim to OpenAI-compatible `/v1/chat/completions` for native structured `tool_calls`.
- **Cursor path:** Inject tool definitions into prompts; optionally parse **`OPENAI_COMPAT_TOOL_JSON`** on assistant text (`src/openai/tool-bridge.ts`). See **`docs/reference/openai-extensions.md`**.

### Workspace OPSEC

This repo is the **gateway**, not an engagement workspace. Pentest/red-team output (Kerberos `.ccache`, BloodHound zips, loot, hashes, keytabs, dumps) must **never** land here — use `~/ops/<engagement>/` outside the repo. Agents receive the same rules via injected bridge context (`src/cursor/bridge-context.ts`).

### Gateway rules

1. **Composable surface only.** Implement higher-level workflows in your own tooling; `/v1/*` stays primitives-shaped.
2. **Shared bearer.** `Authorization: Bearer <BRIDGE_API_KEY>` guards `/v1/*`. No tenancy in v1.
3. **Structured errors.** JSON bodies expose `error.code`, nested OpenAI-ish `type`/`param`, `retryable`, `request_id` when present.
4. **Streams terminate with `[DONE]`.** Mid-stream failures prepend an SSE `{ "object": "bridge.error", ... }` chunk with `retryable` where applicable.

## For agents modifying this service

### Patterns

- **One-shot runs.** Prefer `Agent.prompt(...)` mapped from chat completions unless upstream routing is configured.
- **Dispose agents.** Wrap `Agent.create` / streaming handles with async disposal (`await using` / `finally`).
- **`local.cwd` wiring.** Resolved from env via `workspaceCwd` config; MCP via `CURSOR_AGENT_MCP_SERVERS` optional JSON.
- **Secrets never echoed.** Assertions and logging must omit `CURSOR_API_KEY`/bridge secrets.

### Conventions

- TypeScript strict; no `inline` imports policy per repo.
- Vitest suites under `test/`.

### Verification

| Scope | Command |
|-------|---------|
| Version sync | `npm run version:verify` |
| Release bump | `npm run version:bump -- <semver> "<note>"` |
| Types | `npm run typecheck` |
| Unit | `npm test` |
| Live SDK ping | `npm run verify-sdk` (requires `CURSOR_API_KEY`) |
| Operational flow | **`docs/operator-setup.md`** |

### Documented knowledge

- `CONCEPTS.md` (repo root) — shared domain vocabulary (H31d3nt0r, Cursor SDK local runtime, upstream proxy). Relevant when orienting to the codebase or discussing domain concepts.
- `docs/solutions/` — documented solutions to past problems (bugs, best practices), organized by category with YAML frontmatter (`module`, `tags`, `problem_type`). Relevant when implementing or debugging in documented areas.

---

> The block between `<!-- SOP:BEGIN -->` and `<!-- SOP:END -->` is **managed
<!-- SOP:BEGIN -->
<!-- Managed by N3m3s1sGr0up/org-workflows. Do not edit by hand. -->

## N3m3s1sGr0up Standard Operating Procedures

These rules apply to every repository in the organization and to every human and
AI agent contributing to it.

### Secret handling

- **Never commit secrets.** No credentials, tokens, API keys, private keys, or
  connection strings in source, history, logs, or fixtures.
- Secrets live **only** in untracked `.env` files (locally) or GitHub
  repository/Environment **secrets** (in CI). They are never echoed into logs.
- The **titus** secrets scan gates every repo and is **fail-closed** — a finding
  fails the build and cannot be omitted. Any titus hit is an incident: **rotate
  the affected credential immediately**, regardless of log visibility.
- **Backstop:** no client data, PII, or real-target data belongs in any repo,
  **ever**. Engagement work does not live in git.

### Commits & pull requests

- **Conventional Commits** (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`,
  `test:`, `ci:`, …) with a clear, value-first subject.
- **No tool-attribution footers.** Do not add `Co-authored-by:` for tools or
  `Generated with …` lines. Do not add `Signed-off-by:` unless DCO is explicitly
  required.
- **Integration flow is `dev` → `main`.** Feature branches merge to `dev`; `main`
  is protected and reached only by reviewed PRs.
- **Every change reaches `main` through a pull request** — direct pushes to
  `main` are blocked for everyone, including the owner. PR descriptions follow
  the org PR template.

### Commit signing

- **All commits must be signature-verified.** Humans sign with **SSH signing**
  (setup in the `org-workflows` README); automation commits route through the
  verified `n3m3sis-ci` GitHub App identity. Unsigned commits are rejected on
  `main`.

### Supply chain & workflows

- **All Actions are pinned by full commit SHA** with an honest `# vX.Y.Z`
  comment. Tag/branch refs are forbidden and flagged by zizmor.
- CI capability comes from the **`org-workflows` hub** via thin, SHA-pinned
  caller workflows. Do not fork hub logic into a repo; change it in the hub.
- **Harden-Runner** runs as the first step of every CI job (audit mode default).
- **Dependabot** keeps Action and package pins fresh; hub pin bumps are reviewed,
  never auto-merged.

### Tests

- Tests run in CI when present and a failure **blocks the merge**. No tests are
  *required* where none exist, and no coverage-gap analysis is performed.

<!-- SOP:END -->
