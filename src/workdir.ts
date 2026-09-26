// The working copy: files on disk, plus .wit/ holding which repo, branch, and revision they came from.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

export type Tree = Record<string, string>; // path → sha256 of content

export type State = {
  repo: string;
  branch: string;
  rev: number;
  tree: Tree; // the revision's tree, for detecting local changes without the server
  sessions: Record<string, { id: string; condensed: boolean; startedAt: string }[]>;
};

const ALWAYS_IGNORED = [".wit/", ".git/", "node_modules/", ".DS_Store", ".claude/settings.local.json"];

export const hashOf = (data: Buffer) => createHash("sha256").update(data).digest("hex");

export const findRoot = (from = process.cwd()): string | null => {
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".wit", "state.json"))) return dir;
    if (dirname(dir) === dir) return null;
  }
};

export const witDir = (root: string) => join(root, ".wit");
export const readState = (root: string): State => JSON.parse(readFileSync(join(witDir(root), "state.json"), "utf8"));
export const writeState = (root: string, state: State) => {
  mkdirSync(witDir(root), { recursive: true });
  writeFileSync(join(witDir(root), "state.json"), `${JSON.stringify(state, null, 2)}\n`);
};

const ignorePatterns = (root: string) => {
  const file = join(root, ".witignore");
  const extra = existsSync(file) ? readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")) : [];
  return [...ALWAYS_IGNORED, ...extra];
};

// A pattern ending in / ignores a directory anywhere; otherwise it matches a file name or a full path.
const ignored = (path: string, isDir: boolean, patterns: string[]) =>
  patterns.some((p) => {
    if (p.endsWith("/")) return isDir && (path === p.slice(0, -1) || path.endsWith(`/${p.slice(0, -1)}`));
    return path === p || path.endsWith(`/${p}`);
  });

// Every tracked file in the working copy, with its content.
export const snapshot = (root: string) => {
  const patterns = ignorePatterns(root);
  const files = new Map<string, Buffer>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const path = relative(root, full).split(sep).join("/");
      if (ignored(path, entry.isDirectory(), patterns)) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.set(path, readFileSync(full));
    }
  };
  walk(root);
  const tree: Tree = {};
  for (const [path, data] of files) tree[path] = hashOf(data);
  return { tree, files };
};

export type Change = { path: string; status: "added" | "modified" | "deleted" };
export const changes = (from: Tree, to: Tree): Change[] =>
  [...new Set([...Object.keys(from), ...Object.keys(to)])]
    .sort()
    .filter((p) => from[p] !== to[p])
    .map((path) => ({ path, status: !from[path] ? "added" : !to[path] ? "deleted" : "modified" }));

// Replaces the working copy's tracked files `from` one tree `to` another.
export const checkout = (root: string, from: Tree, to: Tree, blobs: Record<string, Buffer>) => {
  for (const path of Object.keys(from)) {
    if (to[path]) continue;
    const full = join(root, path);
    if (existsSync(full)) rmSync(full);
    // Remove directories left empty.
    for (let dir = dirname(full); dir !== root && existsSync(dir) && readdirSync(dir).length === 0; dir = dirname(dir)) rmdirSync(dir);
  }
  for (const [path, hash] of Object.entries(to)) {
    const full = join(root, path);
    if (existsSync(full) && statSync(full).isFile() && hashOf(readFileSync(full)) === hash) continue;
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, blobs[hash]);
  }
};

export const logPath = (root: string, branch: string) => join(witDir(root), "log", `${branch}.md`);
export const readLog = (root: string, branch: string) => {
  const path = logPath(root, branch);
  return existsSync(path) ? readFileSync(path, "utf8").trim() : "";
};
