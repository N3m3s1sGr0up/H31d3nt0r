import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BRIDGE_GENERATION_CHANGELOG } from "../bridge-metadata.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PKG_PATH = path.join(ROOT, "package.json");
const LOCK_PATH = path.join(ROOT, "package-lock.json");

function fail(message: string): never {
  console.error(`version:verify — ${message}`);
  process.exit(1);
}

function readPackageVersion(): string {
  const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8")) as { version?: string };
  if (typeof pkg.version !== "string" || pkg.version.length === 0) {
    fail("package.json is missing a version string");
  }
  return pkg.version;
}

function readLockVersion(): { root: string; workspace: string | undefined } {
  const lock = JSON.parse(readFileSync(LOCK_PATH, "utf8")) as {
    version?: string;
    packages?: Record<string, { version?: string }>;
  };
  return {
    root: typeof lock.version === "string" ? lock.version : "",
    workspace: lock.packages?.[""]?.version,
  };
}

function readHeadChangelogVersion(): string | undefined {
  const head = BRIDGE_GENERATION_CHANGELOG[0] ?? "";
  const match = head.match(/^v([^:]+):/);
  return match?.[1];
}

function main(): void {
  const pkgVersion = readPackageVersion();
  const lock = readLockVersion();
  const changelogVersion = readHeadChangelogVersion();

  if (lock.root !== pkgVersion) {
    fail(`package-lock.json version (${lock.root || "<missing>"}) !== package.json (${pkgVersion})`);
  }
  if (lock.workspace !== undefined && lock.workspace !== pkgVersion) {
    fail(
      `package-lock.json packages[""] version (${lock.workspace}) !== package.json (${pkgVersion})`,
    );
  }
  if (changelogVersion === undefined) {
    fail("could not parse head changelog entry from src/bridge-metadata.ts");
  }
  if (changelogVersion !== pkgVersion) {
    fail(
      `head changelog entry (v${changelogVersion}) !== package.json (${pkgVersion}); run npm run version:bump`,
    );
  }

  console.log(`version:verify ok — v${pkgVersion}`);
}

main();
