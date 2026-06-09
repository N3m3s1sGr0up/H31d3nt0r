import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PKG_PATH = path.join(ROOT, "package.json");
const LOCK_PATH = path.join(ROOT, "package-lock.json");
const METADATA_PATH = path.join(ROOT, "src/bridge-metadata.ts");

function usage(): never {
  console.error('Usage: npm run version:bump -- <semver> "<changelog note>"');
  console.error('Example: npm run version:bump -- 0.3.1 "fix(stream): heartbeat cadence"');
  process.exit(1);
}

function readCurrentVersion(): string {
  const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8")) as { version?: string };
  return typeof pkg.version === "string" ? pkg.version : "";
}

function assertChangelogMarkerPresent(): void {
  const source = readFileSync(METADATA_PATH, "utf8");
  const marker = "export const BRIDGE_GENERATION_CHANGELOG: readonly string[] = [";
  if (!source.includes(marker)) {
    throw new Error("BRIDGE_GENERATION_CHANGELOG marker not found in bridge-metadata.ts");
  }
}

function bumpPackageJson(version: string): void {
  const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8")) as { version?: string };
  pkg.version = version;
  writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

function bumpPackageLock(version: string): void {
  const lock = JSON.parse(readFileSync(LOCK_PATH, "utf8")) as {
    version?: string;
    packages?: Record<string, { version?: string }>;
  };
  lock.version = version;
  if (lock.packages?.[""] !== undefined) {
    lock.packages[""].version = version;
  }
  writeFileSync(LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}

function prependChangelog(version: string, note: string): void {
  const source = readFileSync(METADATA_PATH, "utf8");
  const entry = `  ${JSON.stringify(`v${version}: ${note}`)},`;
  const marker = "export const BRIDGE_GENERATION_CHANGELOG: readonly string[] = [";
  const idx = source.indexOf(marker);
  const insertAt = idx + marker.length;
  const updated = `${source.slice(0, insertAt)}\n${entry}${source.slice(insertAt)}`;
  writeFileSync(METADATA_PATH, updated, "utf8");
}

function main(): void {
  const [version, ...noteParts] = process.argv.slice(2);
  const note = noteParts.join(" ").trim();

  if (version === undefined || !/^\d+\.\d+\.\d+$/.test(version)) {
    usage();
  }
  if (note.length === 0) {
    console.error("Changelog note is required.");
    usage();
  }

  assertChangelogMarkerPresent();
  const currentVersion = readCurrentVersion();
  if (currentVersion === version) {
    console.error(`version:bump — package.json is already v${version}`);
    process.exit(1);
  }

  bumpPackageJson(version);
  bumpPackageLock(version);
  prependChangelog(version, note);

  console.log(`Bumped to v${version}`);
  console.log(`Changelog: v${version}: ${note}`);
  console.log("Run npm run version:verify before committing.");
}

main();
