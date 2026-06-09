import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

import type { Config } from "../config.js";
import { SERVICE_ROOT } from "../config.js";

function workspaceRoots(config: Config): string[] {
  const cwd = config.workspaceCwd;
  const fromConfig = typeof cwd === "string" ? [cwd] : [...cwd];
  const roots = [SERVICE_ROOT, ...fromConfig];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const root of roots) {
    const abs = path.resolve(root);
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push(abs);
  }
  return out;
}

function isUnderRoot(root: string, candidate: string): boolean {
  if (candidate === root) return true;
  const rel = path.relative(root, candidate);
  return rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Resolves a requested workspace path when it exists on disk and lies under an
 * allowed root (`SERVICE_ROOT`, `WORKSPACE_CWD`, or `BRIDGE_EXTRA_CWD`).
 */
export function resolveAllowedWorkspaceCwd(requested: string, config: Config): string | null {
  if (requested.trim().length === 0) return null;
  const resolved = path.resolve(requested);
  if (!existsSync(resolved)) return null;
  let canonical: string;
  try {
    canonical = realpathSync(resolved);
  } catch {
    return null;
  }
  for (const root of workspaceRoots(config)) {
    let canonicalRoot: string;
    try {
      canonicalRoot = realpathSync(root);
    } catch {
      continue;
    }
    if (isUnderRoot(canonicalRoot, canonical)) {
      return canonical;
    }
  }
  return null;
}
