// Hard rules for product repos. This file lives in the tool repo and runs via the reusable
// workflow in .github/workflows/guardrails.yml, pinned to a commit by the product repo, so
// a PR — including one written by Claude — cannot weaken the checks that judge it.
// `danger`, `fail`, `warn`, `message` and `schedule` are globals provided by Danger.

// Changes here can only land via a human admin bypassing the required check.
const PROTECTED_PATHS = [/^\.github\//, /^\.claude\//, /(^|\/)CODEOWNERS$/];

// Rules live in a tree: every folder under rules/ is a node, and its rules are in index.md.
const isRulesFile = (path) => /^rules\/(?:[^/]+\/)*index\.md$/.test(path);
const RULE_HEADING = /^## (\S+): (.+)$/gm;
const NODE_TITLE = /^# \S.*$/m;
const RULE_ID = /^[A-Z][A-Z0-9]*-\d{3}$/;
const REQUIRED_FIELDS = ["Status", "Rule", "Why"];
const STATUSES = ["active", "retired"];

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
];

const { pr } = danger.github;
const repoSlug = pr.base.repo.full_name;
const changedFiles = [...danger.git.created_files, ...danger.git.modified_files];
const touchedFiles = [...changedFiles, ...danger.git.deleted_files];

const read = async (path, ref) => {
  try {
    return await danger.github.utils.fileContents(path, repoSlug, ref);
  } catch {
    return "";
  }
};

// Splits a node file into { id, title, body } per `## ID: title` heading.
const parseRules = (text) => {
  const headings = [...text.matchAll(RULE_HEADING)];
  return headings.map((match, i) => ({
    id: match[1],
    title: match[2],
    body: text.slice(match.index, headings[i + 1]?.index ?? text.length),
  }));
};

const field = (body, name) => body.match(new RegExp(`^\\*\\*${name}:\\*\\*\\s*(.+)$`, "m"))?.[1].trim();

const collectRules = async (ref, files) => {
  const byId = new Map();
  for (const path of files) {
    for (const rule of parseRules(await read(path, ref))) {
      if (!byId.has(rule.id)) byId.set(rule.id, []);
      byId.get(rule.id).push({ ...rule, path });
    }
  }
  return byId;
};

schedule(async () => {
  // 1. Protected paths are off-limits to PRs.
  for (const path of touchedFiles.filter((p) => PROTECTED_PATHS.some((re) => re.test(p)))) {
    fail(`\`${path}\` is protected. Changes here must be merged by a human admin.`);
  }
  if (touchedFiles.includes("CLAUDE.md")) {
    warn("`CLAUDE.md` changed. It steers how Claude works in this repo — read the diff closely.");
  }

  const touchesRules = touchedFiles.some((path) => path.startsWith("rules/"));
  if (!touchesRules) return;

  // Whole rules tree at the PR head, so moves between nodes and duplicate IDs are caught.
  const { data: tree } = await danger.github.api.git.getTree({
    owner: pr.head.repo.owner.login,
    repo: pr.head.repo.name,
    tree_sha: pr.head.sha,
    recursive: "true",
  });
  const headPaths = tree.tree.filter((entry) => entry.path.startsWith("rules/"));
  const headNodeFiles = headPaths.filter((entry) => entry.type === "blob" && isRulesFile(entry.path)).map((e) => e.path);

  // 2. The tree is well-formed: every folder is a node, and nothing else lives in rules/.
  for (const entry of headPaths) {
    if (entry.type === "tree" && !headNodeFiles.includes(`${entry.path}/index.md`)) {
      fail(`\`${entry.path}/\` has no \`index.md\`. Every folder under \`rules/\` is a node and needs one.`);
    }
    if (entry.type === "blob" && !isRulesFile(entry.path) && changedFiles.includes(entry.path)) {
      fail(`\`${entry.path}\` isn't a node file. Rules go in \`index.md\` inside a node folder.`);
    }
  }
  if (!headNodeFiles.includes("rules/index.md")) fail("`rules/index.md` (the root node) is missing.");

  // 3. Node files are never deleted — their rules are retired instead.
  for (const path of danger.git.deleted_files.filter(isRulesFile)) {
    const remaining = (await collectRules(pr.base.sha, [path])).size;
    if (remaining > 0) fail(`\`${path}\` was deleted with rules in it. Move or retire the rules first.`);
  }

  const baseFiles = [...danger.git.modified_files, ...danger.git.deleted_files].filter(isRulesFile);
  const headFiles = changedFiles.filter(isRulesFile);
  const baseRules = await collectRules(pr.base.sha, baseFiles);
  const headRules = await collectRules(pr.head.sha, headNodeFiles);

  // 4. Every rule that existed still exists (anywhere in the tree), and retired rules stay retired.
  for (const [id, [before]] of baseRules) {
    const after = headRules.get(id)?.[0];
    if (!after) {
      fail(`Rule \`${id}\` was removed. Mark it \`Status: retired\` instead.`);
      continue;
    }
    if (field(before.body, "Status") === "retired" && field(after.body, "Status") !== "retired") {
      fail(`Rule \`${id}\` was un-retired. Retired IDs are never reused — create a new rule.`);
    }
    const changed = before.body.trim() !== after.body.trim() || before.path !== after.path;
    const beforeHistory = before.body.match(/^- \d{4}-\d{2}-\d{2}.*$/gm) ?? [];
    const afterHistory = after.body.match(/^- \d{4}-\d{2}-\d{2}.*$/gm) ?? [];
    if (changed && afterHistory.length <= beforeHistory.length) {
      fail(`Rule \`${id}\` changed${before.path !== after.path ? " (moved)" : ""} but has no new dated \`History\` entry.`);
    }
  }

  // 5. Every rule in a touched node is well-formed and uniquely identified.
  for (const [id, copies] of headRules) {
    if (!copies.some((copy) => headFiles.includes(copy.path))) continue;
    if (copies.length > 1) {
      fail(`Rule ID \`${id}\` is used ${copies.length} times (${copies.map((c) => c.path).join(", ")}).`);
    }
    if (!RULE_ID.test(id)) fail(`Rule ID \`${id}\` in \`${copies[0].path}\` must look like \`DOMAIN-001\`.`);
    for (const rule of copies) {
      for (const name of REQUIRED_FIELDS) {
        if (!field(rule.body, name)) fail(`Rule \`${id}\` in \`${rule.path}\` is missing \`**${name}:**\`.`);
      }
      const status = field(rule.body, "Status");
      if (status && !STATUSES.includes(status)) {
        fail(`Rule \`${id}\` has status \`${status}\`; expected one of ${STATUSES.join(", ")}.`);
      }
    }
  }

  // 6. Every touched node has a title.
  for (const path of headFiles) {
    if (!NODE_TITLE.test(await read(path, pr.head.sha))) fail(`\`${path}\` needs a \`# Title\` line.`);
  }
});

schedule(async () => {
  // 7. No secrets in any added or changed file.
  for (const path of changedFiles) {
    const diff = await danger.git.diffForFile(path);
    if (!diff) continue;
    if (SECRET_PATTERNS.some((re) => re.test(diff.added))) {
      fail(`\`${path}\` appears to contain a secret.`);
    }
  }
});

// 8. Code changes should trace back to a rule.
const touchesCode = touchedFiles.some((path) => !path.startsWith("rules/") && !path.endsWith(".md"));
if (touchesCode && !/\b[A-Z][A-Z0-9]*-\d{3}\b/.test(pr.body ?? "")) {
  warn("This PR changes code but its description doesn't cite any rule ID (e.g. `BILLING-003`).");
}
