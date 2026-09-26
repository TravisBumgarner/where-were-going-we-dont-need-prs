// .witignore: which files wit never tracks. Same syntax as .gitignore — globs, `**`, a
// leading `/` to anchor, a trailing `/` for directories, `!` to un-ignore, `#` comments —
// and a .witignore in any folder applies to that folder. Later rules win.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Never tracked, no matter what a .witignore says.
const ALWAYS = [".wit/", ".git/"];

// Tracked-by-nobody defaults. A .witignore can un-ignore any of these with `!`.
export const DEFAULTS = [
  "node_modules/",
  "dist/",
  "build/",
  "coverage/",
  ".env",
  ".env.*",
  "!.env.example",
  "*.db",
  "*.db-wal",
  "*.db-shm",
  "*.db-journal",
  "*.sqlite",
  "*.sqlite3",
  "*.log",
  ".DS_Store",
  ".claude/settings.local.json",
];

type Rule = { base: string; regex: RegExp; negate: boolean; dirOnly: boolean; anchored: boolean };

const globToRegex = (glob: string) => {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      const slashAfter = glob[i + 2] === "/";
      out += slashAfter ? "(?:.*/)?" : ".*";
      i += slashAfter ? 2 : 1;
    } else if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else if (c === "[") {
      const end = glob.indexOf("]", i);
      if (end === -1) out += "\\[";
      else {
        out += glob.slice(i, end + 1).replace(/^\[!/, "[^");
        i = end;
      }
    } else out += c.replace(/[.+^${}()|\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
};

export const parseRules = (text: string, base: string): Rule[] =>
  text.split("\n").flatMap((raw) => {
    let line = raw.replace(/\s+$/, "");
    if (!line || line.startsWith("#")) return [];
    const negate = line.startsWith("!");
    if (negate) line = line.slice(1);
    const dirOnly = line.endsWith("/");
    if (dirOnly) line = line.slice(0, -1);
    const anchored = line.includes("/");
    line = line.replace(/^\//, "");
    return line ? [{ base, regex: globToRegex(line), negate, dirOnly, anchored }] : [];
  });

// Rules from the defaults, plus every .witignore from the root down to `dir`.
export class Ignore {
  root: string;
  private cache = new Map<string, Rule[]>();
  private always = parseRules(ALWAYS.join("\n"), "");
  private defaults = parseRules(DEFAULTS.join("\n"), "");

  constructor(root: string) {
    this.root = root;
  }

  private rulesIn(dir: string) {
    if (!this.cache.has(dir)) {
      const file = join(this.root, dir, ".witignore");
      this.cache.set(dir, existsSync(file) ? parseRules(readFileSync(file, "utf8"), dir) : []);
    }
    return this.cache.get(dir)!;
  }

  // `path` is repo-relative with forward slashes. Parent directories are checked too, so a file
  // inside an ignored folder is ignored even if a later rule matches the file itself.
  ignored(path: string, isDir = false): boolean {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      if (this.matches(parts.slice(0, i).join("/"), true)) return true;
    }
    return this.matches(path, isDir);
  }

  private matches(path: string, isDir: boolean) {
    const name = path.split("/").pop()!;
    if (this.always.some((r) => r.regex.test(name) && (!r.dirOnly || isDir))) return true;
    const dirs = [""];
    const parts = path.split("/").slice(0, -1);
    parts.forEach((_, i) => dirs.push(parts.slice(0, i + 1).join("/")));
    let ignored = false;
    for (const rule of [...this.defaults, ...dirs.flatMap((d) => this.rulesIn(d))]) {
      if (rule.dirOnly && !isDir) continue;
      const rel = rule.base ? path.slice(rule.base.length + 1) : path;
      if (rule.base && !path.startsWith(`${rule.base}/`)) continue;
      if (rule.anchored ? rule.regex.test(rel) : rule.regex.test(name)) ignored = !rule.negate;
    }
    return ignored;
  }
}

export const STARTER = `# Files wit never tracks. Same syntax as .gitignore, and a .witignore in any folder
# applies to that folder.
#
# On top of these, wit always ignores: ${DEFAULTS.filter((d) => !d.startsWith("!")).join(" ")}
# (but keeps .env.example). Un-ignore a default with !, e.g. !build/
`;
