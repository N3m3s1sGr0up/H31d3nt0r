import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WORKFLOWS_DIR = path.join(ROOT, ".github/workflows");
const USES_LINE = /^\s*- uses:\s+(\S+)/;
const PINNED_SHA = /^[0-9a-f]{40}$/;

function fail(message: string): never {
  console.error(`actions:verify — ${message}`);
  process.exit(1);
}

function refFromUses(spec: string): string {
  const at = spec.lastIndexOf("@");
  if (at === -1) {
    fail(`missing @ ref in uses spec: ${spec}`);
  }
  return spec.slice(at + 1);
}

function main(): void {
  const files = readdirSync(WORKFLOWS_DIR)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort();

  if (files.length === 0) {
    fail(`no workflow files under ${WORKFLOWS_DIR}`);
  }

  let checked = 0;
  for (const file of files) {
    const source = readFileSync(path.join(WORKFLOWS_DIR, file), "utf8");
    for (const line of source.split(/\r?\n/)) {
      const match = USES_LINE.exec(line);
      if (match === null) continue;
      const spec = match[1];
      if (spec === undefined || spec.length === 0) continue;
      const ref = refFromUses(spec);
      if (!PINNED_SHA.test(ref)) {
        fail(`${file}: unpinned action "${spec}" — pin to a full 40-char commit SHA`);
      }
      checked += 1;
    }
  }

  console.log(`actions:verify ok — ${checked} pinned action(s) across ${files.length} workflow(s)`);
}

main();
