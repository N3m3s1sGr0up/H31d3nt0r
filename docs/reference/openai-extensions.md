# Wire-format extensions (h31d3nt0r)

**h31d3nt0r** defaults to the Cursor SDK for inference. This reference documents **extensions on the OpenAI-compatible wire format** for `/v1/models` and `/v1/chat/completions` — protocol-shape compatibility, not OpenAI cloud as the backend.

`GET /v1/capabilities` (Bearer) exposes additive bridge metadata; `suggested_base_url` is the OpenAI-compatible base URL (`http://<host>:<port>/v1`) derived from bind config.

## Tool definitions + `OPENAI_COMPAT_TOOL_JSON`

When the request includes a non-empty `tools` array and chat is handled by the **Cursor SDK path** (upstream proxy off or not engaged for that turn), the gateway injects tool metadata into the system prompt. The Cursor runtime does not register arbitrary OpenAI functions natively.

To return `tool_calls` in the JSON response, the model must end its assistant text with a **single final line**:

```text
OPENAI_COMPAT_TOOL_JSON {"tool_calls":[{"id":"call_…","type":"function","function":{"name":"<registered name>","arguments":"<JSON string>"}}]}
```

Rules:

- `arguments` is a **string** containing minified JSON (OpenAI function-calling shape), not a raw object.
- Only `name` values from the request `tools` list are accepted; unknown names are dropped.
- If no client-side tools are needed, omit the line entirely.

See `src/openai/tool-bridge.ts` for the authoritative parser.

Parser notes (v1.1+):

- Optional whitespace may appear between the token and the JSON object.
- The token is read from the last non-empty line; trailing blank lines after the JSON line are ignored.
- If JSON parsing fails, the gateway attempts recovery from the last `{` on that line (trailing garbage may still break recovery).
- Do not wrap the JSON in markdown fences — use a raw final line.
- Streaming responses buffer assistant text and emit `tool_calls` in the final SSE chunks when the line protocol is present.

For clients that cannot rely on model-emitted JSON lines, use upstream proxy mode below.

## Per-request workspace (`X-Bridge-Workspace-Cwd`)

Optional request header on `POST /v1/chat/completions` (streaming or not):

```http
X-Bridge-Workspace-Cwd: /absolute/path/to/project
```

When set, the Cursor SDK `local.cwd` for that request uses the resolved path instead of the gateway default (`WORKSPACE_CWD` / `BRIDGE_EXTRA_CWD`). The path must exist on disk and lie under an allowed root: install `SERVICE_ROOT`, `WORKSPACE_CWD`, or `BRIDGE_EXTRA_CWD`. Invalid paths return HTTP 400 `bad_request`.

## Upstream proxy (`BRIDGE_CHAT_UPSTREAM_*`)

When `BRIDGE_CHAT_UPSTREAM_MODE` is `tools` or `always`, eligible requests are POSTed to `BRIDGE_CHAT_UPSTREAM_URL` with the same OpenAI-shaped body (plus gateway normalization). That path yields **standard** `tool_calls` in the upstream JSON without the line protocol above.
