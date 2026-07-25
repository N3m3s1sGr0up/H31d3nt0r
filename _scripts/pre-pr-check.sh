#!/usr/bin/env bash
# Local pre-PR quality gate (optional). Copy into a consumer repo as
# `_scripts/pre-pr-check.sh` (or `scripts/pre-pr-check.sh`) and extend with
# repo-specific lint/test. Org merge gates stay lean (zizmor + Gitleaks);
# archetype quality (skill-quality, go test, markdown lint, …) belongs here —
# not as required GitHub Actions checks — to save Actions minutes.
#
# Usage (from repo root):
#   ./_scripts/pre-pr-check.sh
# Agents: run before `gh pr create` when this script exists; do not open a PR
# until it exits 0.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> pre-pr-check: repo root $ROOT"

if command -v gitleaks >/dev/null 2>&1; then
  echo "==> gitleaks detect (local)"
  gitleaks detect --source . --verbose --redact --exit-code 1
else
  echo "==> gitleaks not installed locally — skipping (CI will still scan)"
fi

# Repo-specific hooks (uncomment / extend per archetype):
# if [[ -f go.mod ]]; then go test ./...; fi
# if [[ -f package.json ]]; then npm test; fi
# if [[ -d Skills ]]; then # skill-quality checks ; fi

echo "==> pre-pr-check: PASS"
