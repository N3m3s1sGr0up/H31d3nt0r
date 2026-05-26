# agent-workspace

Sample directory used by `npm run verify-sdk` when `WORKSPACE_CWD` is unset.

The gateway itself defaults `WORKSPACE_CWD` to the repository root. Point it here (or any project tree) when you want smoke tests or agents scoped to a dedicated folder.

| Route | Auth | Role |
|-------|------|------|
| `GET /v1/models` | Bearer | Model discovery (`context_length` when `MODEL_CONTEXT_LENGTHS` is set) |
| `POST /v1/chat/completions` | Bearer | OpenAI chat completions (stream + non-stream) |
