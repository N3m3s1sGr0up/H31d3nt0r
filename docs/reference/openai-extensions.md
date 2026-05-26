# OpenAI extensions (this gateway)

The HTTP surface follows the OpenAI Chat Completions API for `/v1/models` and `/v1/chat/completions`. A few behaviors are **extensions** on top of the vanilla spec.

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

## Upstream proxy (`BRIDGE_CHAT_UPSTREAM_*`)

When `BRIDGE_CHAT_UPSTREAM_MODE` is `tools` or `always`, eligible requests are POSTed to `BRIDGE_CHAT_UPSTREAM_URL` with the same OpenAI-shaped body (plus gateway normalization). That path yields **standard** `tool_calls` in the upstream JSON without the line protocol above.
