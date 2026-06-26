# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## H31d3nt0r
A self-hosted, loopback HTTP gateway that exposes an OpenAI-compatible Chat Completions surface (`/v1/*`) in front of a Cursor-backed inference engine, so any OpenAI-wire client can use a Cursor subscription as its model provider.
*Avoid:* the bridge — the codebase refers to the gateway's internals as "bridge" (bridge errors, the shared bridge bearer, injected bridge context); treat these as the same component, not a separate one.

## Cursor SDK local runtime
The gateway's default inference backend: model turns are executed locally through the Cursor subscription rather than forwarded to a remote OpenAI-style API. This is why the OpenAI-compatible `/v1` surface is a wire-format compatibility layer, not a proxy to OpenAI cloud. Distinct from the upstream proxy path.

## Upstream proxy
An optional alternate backend in which qualifying chat requests are forwarded verbatim to a separate OpenAI-compatible endpoint (for native structured tool calls) instead of running on the Cursor SDK local runtime. Off by default; when disabled, every request takes the Cursor SDK local runtime path.
