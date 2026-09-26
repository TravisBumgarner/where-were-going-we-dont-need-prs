#!/usr/bin/env node
// Builds a zoomable map of the rules taxonomy as a single HTML file and opens it.
// Usage: node build.mjs [--rules <dir>] [--out <file>] [--no-open]
// Reads the working tree, so uncommitted rules show up too.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const repoRoot = (() => {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return process.cwd();
  }
})();
const rulesDir = flag("rules", join(repoRoot, "rules"));
const out = flag("out", join(tmpdir(), `tb-map-${basename(repoRoot)}.html`));

if (!existsSync(rulesDir)) {
  console.error(`No rules folder at ${rulesDir}. Run /tb:init first.`);
  process.exit(1);
}

const field = (body, name) => body.match(new RegExp(`^\\*\\*${name}:\\*\\*\\s*(.+)$`, "m"))?.[1].trim() ?? null;

// Bullet lines following `**Name:**`, up to the next `**Field:**` or end of rule.
const listField = (body, name) => {
  const start = body.search(new RegExp(`^\\*\\*${name}:\\*\\*`, "m"));
  if (start === -1) return [];
  const rest = body.slice(start).split("\n").slice(1);
  const items = [];
  for (const line of rest) {
    if (/^\*\*[^*]+:\*\*/.test(line)) break;
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item) items.push(item[1]);
  }
  return items;
};

const parseNode = (dir) => {
  const file = join(dir, "index.md");
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const firstRule = text.search(/^## /m);
  const head = firstRule === -1 ? text : text.slice(0, firstRule);
  const title = head.match(/^# (.+)$/m)?.[1].trim() ?? basename(dir);
  const summary = head.replace(/^# .+$/m, "").trim();

  const headings = [...text.matchAll(/^## (\S+): (.+)$/gm)];
  const rules = headings.map((match, i) => {
    const body = text.slice(match.index, headings[i + 1]?.index ?? text.length).trim();
    return {
      id: match[1],
      title: match[2].trim(),
      status: field(body, "Status") ?? "active",
      rule: field(body, "Rule"),
      why: field(body, "Why"),
      examples: listField(body, "Examples"),
      history: listField(body, "History"),
    };
  });

  const children = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort()
    .map((name) => parseNode(join(dir, name)));

  const path = relative(rulesDir, dir).split("\\").join("/");
  return { path, title, summary, missingIndex: !existsSync(file), rules, children };
};

const tree = parseNode(rulesDir);
const count = (node) => node.rules.length + node.children.reduce((n, child) => n + count(child), 0);

const template = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "map.html"), "utf8");
const data = JSON.stringify({ repo: basename(repoRoot), builtAt: new Date().toISOString(), tree })
  .replaceAll("<", "\\u003c")
  .replaceAll("\u2028", "\\u2028")
  .replaceAll("\u2029", "\\u2029");
writeFileSync(out, template.replace("/*__DATA__*/null", () => data));

console.log(`MAP ${out}`);
console.log(`${count(tree)} rule(s) in ${rulesDir}`);
if (!args.includes("--no-open")) execFileSync("open", [out]);
