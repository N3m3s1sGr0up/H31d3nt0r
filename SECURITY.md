# Security Policy

## Supported versions

Security fixes are applied to the latest release on the `main` branch.

| Version | Supported |
|---------|-----------|
| 0.3.x   | Yes       |
| < 0.3   | No        |

## Reporting a vulnerability

**Please do not open public GitHub issues for security vulnerabilities.**

Report privately via one of:

1. [GitHub Security Advisories](https://github.com/N3m3s1sGr0up/H31d3nt0r/security/advisories/new) (preferred)
2. Contact the repository maintainers through your existing N3m3s1sGr0up channel

Include:

- Affected component (gateway routes, scripts, release tooling, etc.)
- Steps to reproduce
- Impact assessment (confidentiality, integrity, availability)
- Suggested fix, if you have one

We aim to acknowledge reports within **5 business days** and provide a remediation timeline when confirmed.

## Operator security reminders

- Keep `CURSOR_API_KEY` server-side only; clients use `BRIDGE_API_KEY` on `/v1/*`.
- Store secrets in `.env.local` with mode `600` — never commit `.env.local`.
- Default bind is loopback (`127.0.0.1`). Non-loopback exposure requires `BRIDGE_ALLOW_REMOTE_BIND=1` plus TLS and network ACLs.
- Engagement artifacts (pentest loot, tickets, dumps) must not live in this gateway repository — use `~/ops/<engagement>/` outside the repo.

See `docs/operator-setup.md` for deployment hardening and key rotation guidance.
