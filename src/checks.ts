// Hard rules, run by the server before anything merges into main. Ported from the old
// dangerfile. Nothing merges while any check fails.

import { type Files, field, isNodeFile, isRulesPath, parseNodeFile, RULE_ID, taxonomy } from "./rules.ts";

const STATUSES = ["active", "retired"];
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
];
const historyLines = (body: string) => body.match(/^- \d{4}-\d{2}-\d{2}.*$/gm) ?? [];

export const runChecks = (base: Files, head: Files): string[] => {
  const failures: string[] = [];
  const fail = (message: string) => failures.push(message);

  // 1. The tree is well-formed: only node files under rules/, every folder has one, and the root exists.
  const headPaths = Object.keys(head);
  for (const path of headPaths.filter((p) => isRulesPath(p) && !isNodeFile(p))) {
    fail(`\`${path}\` isn't a node file. Rules go in \`index.md\` inside a node folder.`);
  }
  if (!head["rules/index.md"]) fail("`rules/index.md` (the root node) is missing.");
  const folders = new Set<string>();
  for (const path of headPaths.filter(isRulesPath)) {
    const parts = path.split("/").slice(1, -1);
    parts.forEach((_, i) => folders.add(parts.slice(0, i + 1).join("/")));
  }
  for (const folder of folders) {
    if (!head[`rules/${folder}/index.md`]) fail(`\`rules/${folder}/\` has no \`index.md\`. Every folder under \`rules/\` is a node and needs one.`);
  }
  for (const path of headPaths.filter(isNodeFile)) {
    if (!parseNodeFile(head[path]).title) fail(`\`${path}\` needs a \`# Title\` line.`);
  }

  // 2. Every rule that existed still exists, retired rules stay retired, and changes are recorded.
  const before = taxonomy(base);
  const after = taxonomy(head);
  for (const [id, old] of before.rules) {
    const now = after.rules.get(id);
    if (!now) {
      fail(`Rule \`${id}\` was removed. Mark it \`Status: retired\` instead.`);
      continue;
    }
    if (old.status === "retired" && now.status !== "retired") fail(`Rule \`${id}\` was un-retired. Retired IDs are never reused — create a new rule.`);
    const changed = old.body.trim() !== now.body.trim() || old.node !== now.node;
    if (changed && historyLines(now.body).length <= historyLines(old.body).length) {
      fail(`Rule \`${id}\` changed${old.node !== now.node ? " (moved)" : ""} but has no new dated \`History\` entry.`);
    }
  }

  // 3. Every rule is well-formed and uniquely identified.
  const seen = new Map<string, string[]>();
  for (const path of headPaths.filter(isNodeFile)) {
    for (const rule of parseNodeFile(head[path]).rules) {
      seen.set(rule.id, [...(seen.get(rule.id) ?? []), path]);
      if (!RULE_ID.test(rule.id)) fail(`Rule ID \`${rule.id}\` in \`${path}\` must look like \`DOMAIN-001\`.`);
      for (const name of ["Status", "Rule", "Why"]) {
        if (!field(rule.body, name)) fail(`Rule \`${rule.id}\` in \`${path}\` is missing \`**${name}:**\`.`);
      }
      const status = field(rule.body, "Status");
      if (status && !STATUSES.includes(status)) fail(`Rule \`${rule.id}\` has status \`${status}\`; expected one of ${STATUSES.join(", ")}.`);
      if (!before.rules.has(rule.id) && status === "retired") fail(`Rule \`${rule.id}\` is new but already retired.`);
    }
  }
  for (const [id, paths] of seen) {
    if (paths.length > 1) fail(`Rule ID \`${id}\` is used ${paths.length} times (${paths.join(", ")}).`);
  }

  // 4. No secrets in anything added or changed.
  for (const path of headPaths) {
    if (head[path] === base[path]) continue;
    const added = head[path].split("\n").filter((line) => !(base[path] ?? "").includes(line)).join("\n");
    if (SECRET_PATTERNS.some((re) => re.test(added))) fail(`\`${path}\` appears to contain a secret.`);
  }

  return failures;
};
