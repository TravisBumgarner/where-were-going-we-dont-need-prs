// wit: version control for business rules.

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { prompt, reportFrom, runHeadless, runInteractive, writeTranscript } from "./claude.ts";
import { api, ApiError, ensureServer, fetchBlobs, ServerDown } from "./client.ts";
import { ORIGIN, RULES_FORMAT_DOC } from "./config.ts";
import {
  type State, type Tree, changes, checkout, findRoot, logPath, readLog, readState, snapshot, witDir, writeState,
} from "./workdir.ts";

const tty = process.stdout.isTTY;
const color = (code: number) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const [bold, dim, red, green, yellow, cyan] = [1, 2, 31, 32, 33, 36].map(color);

class UsageError extends Error {}
const today = () => new Date().toISOString().slice(0, 10);
const openUrl = (url: string) => {
  try {
    execFileSync("open", [url]);
  } catch {
    // Not on macOS; the URL is printed anyway.
  }
};

// ---------- Working copy helpers ----------

const requireRepo = () => {
  const root = findRoot();
  if (!root) throw new UsageError("Not in a wit repo. Run `wit init` to make one.");
  return { root, state: readState(root) };
};

const requireBranch = () => {
  const ctx = requireRepo();
  if (ctx.state.branch === "main") throw new UsageError("You're on main. Start a branch with `wit start \"<what we're doing>\"`.");
  return ctx;
};

const localChanges = (root: string, state: State) => changes(state.tree, snapshot(root).tree);

const requireClean = (root: string, state: State, action: string) => {
  const dirty = localChanges(root, state);
  if (dirty.length) {
    throw new UsageError(`You have changes that haven't been condensed, so you can't ${action}:\n${dirty.map((c) => `  ${c.status.padEnd(9)} ${c.path}`).join("\n")}\nRun \`wit condense\` first.`);
  }
};

// Uploads the working copy as a new revision on the current branch.
const commitWorkingCopy = async (root: string, state: State, message: string, author: "claude" | "human") => {
  const { tree, files } = snapshot(root);
  if (changes(state.tree, tree).length === 0) return null;
  const known = new Set(Object.values(state.tree));
  const blobs: Record<string, string> = {};
  for (const [path, hash] of Object.entries(tree)) if (!known.has(hash)) blobs[hash] = files.get(path)!.toString("base64");
  const { rev } = await api<{ rev: number }>("POST", `/api/repos/${state.repo}/branches/${state.branch}/revisions`, { parent: state.rev, tree, blobs, message, author });
  writeState(root, { ...state, rev, tree });
  return rev;
};

const moveTo = async (root: string, state: State, branch: string, rev: number) => {
  const { tree } = await api<{ tree: Tree }>("GET", `/api/repos/${state.repo}/revisions/${rev}`);
  // Files already on disk with the right content are skipped by checkout; fetch the rest.
  const blobs = await fetchBlobs(Object.entries(tree).filter(([path, hash]) => state.tree[path] !== hash).map(([, hash]) => hash));
  checkout(root, state.tree, tree, blobs);
  writeState(root, { ...state, branch, rev, tree });
};

const slugify = (description: string) => {
  const stop = new Set(["a", "an", "the", "to", "for", "of", "and", "with", "in", "on", "we", "i", "lets", "let's", "so", "that", "is", "are", "be", "our", "my"]);
  const words = description.toLowerCase().replace(/[^a-z0-9\s-]/g, "").split(/\s+/).filter((w) => w && !stop.has(w));
  return words.slice(0, 4).join("-") || "work";
};

const ask = async (question: string, fallback = "") => {
  if (!process.stdin.isTTY) return fallback;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question}${fallback ? dim(` (${fallback})`) : ""} `)).trim();
  rl.close();
  return answer || fallback;
};

const flags = (args: string[]) => {
  const out: Record<string, string | true> = {};
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) rest.push(a);
    else if (args[i + 1] && !args[i + 1].startsWith("--")) out[a.slice(2)] = args[++i];
    else out[a.slice(2)] = true;
  }
  return { flags: out, rest };
};

// ---------- Commands ----------

const commands: Record<string, { usage: string; summary: string; run: (args: string[]) => Promise<void> }> = {
  init: {
    usage: "wit init [--name <repo>] [--title <product>] [--summary <text>]",
    summary: "Make this folder a wit repo, with a root rules node",
    run: async (args) => {
      const { flags: f } = flags(args);
      const root = process.cwd();
      if (findRoot(root)) throw new UsageError("This folder is already inside a wit repo.");
      await ensureServer();
      const name = String(f.name ?? basename(root).toLowerCase().replace(/[^a-z0-9._-]/g, "-"));
      const rootNode = join(root, "rules", "index.md");
      if (!existsSync(rootNode)) {
        const title = String(f.title ?? (await ask("Product name?", basename(root))));
        const summary = String(f.summary ?? (await ask("One or two sentences on what it is?", "")));
        mkdirSync(join(root, "rules"), { recursive: true });
        writeFileSync(rootNode, `# ${title}\n\n${summary || "Principles that hold everywhere in the product."}\n`);
      }
      const { tree, files } = snapshot(root);
      const blobs = Object.fromEntries([...files].map(([path, data]) => [tree[path], data.toString("base64")]));
      const { rev } = await api<{ rev: number }>("POST", "/api/repos", { name, tree, blobs, message: "Initialize" });
      writeState(root, { repo: name, branch: "main", rev, tree, sessions: {} });
      console.log(`${green("✓")} Created wit repo ${bold(name)} at r${rev}.`);
      const { registered } = await api<{ registered: boolean }>("GET", "/api/setup");
      if (!registered) console.log(`\n${yellow("!")} Set up your passkey before your first review: ${cyan(`${ORIGIN}/setup`)}\n  Only your passkey can approve and merge.`);
      console.log(`\nNext: ${bold('wit start "<what we\'re building>"')}`);
    },
  },

  start: {
    usage: 'wit start "<what we\'re doing>" [--name <branch>]',
    summary: "Start a branch off main",
    run: async (args) => {
      const { flags: f, rest } = flags(args);
      const description = rest.join(" ").trim();
      if (!description) throw new UsageError('Say what the branch is for: wit start "add reminders"');
      const { root, state } = requireRepo();
      requireClean(root, state, "start a branch");
      if (readLog(root, state.branch) && state.branch !== "main") {
        throw new UsageError(`Branch ${state.branch} has decisions that haven't been condensed. Run \`wit condense\` first.`);
      }
      let name = String(f.name ?? slugify(description));
      for (let i = 2; ; i++) {
        try {
          const created = await api<{ name: string; rev: number }>("POST", `/api/repos/${state.repo}/branches`, { name, description });
          await moveTo(root, state, created.name, created.rev);
          console.log(`${green("✓")} On new branch ${bold(created.name)} from main r${created.rev}.`);
          console.log(`\nNext: ${bold("wit chat")}`);
          return;
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 409 && !f.name)) throw err;
          name = `${slugify(description)}-${i}`;
        }
      }
    },
  },

  chat: {
    usage: "wit chat [--continue] [-- <extra claude args>]",
    summary: "Talk to Claude; every decision is recorded to the branch's log",
    run: async (args) => {
      const split = args.indexOf("--");
      const extra = split === -1 ? [] : args.slice(split + 1);
      const { flags: f } = flags(split === -1 ? args : args.slice(0, split));
      const { root, state } = requireBranch();
      const branch = await api("GET", `/api/repos/${state.repo}/branches/${state.branch}`);
      if (branch.status !== "open") throw new UsageError(`Branch ${state.branch} is ${branch.status}. Start a new one with \`wit start\`.`);

      const feedback = await api("GET", `/api/repos/${state.repo}/branches/${state.branch}/feedback`);
      const feedbackSection = feedback.reviewId
        ? `\n## Review feedback is waiting\n\nThe human requested changes in review #${feedback.reviewId}. \`wit apply\` can apply it automatically, or you can discuss it here. Record any new decisions with \`wit note\`.\n\n\`\`\`json\n${JSON.stringify(feedback.decisions, null, 2)}\n\`\`\`\n`
        : "";
      const log = readLog(root, state.branch);
      const unresolved = log.split("\n").filter((l) => l.includes("UNRESOLVED:"));
      const unresolvedSection = unresolved.length ? `\n## Unresolved from the last condense\n\nRaise these with the user first:\n${unresolved.join("\n")}\n` : "";

      const system = prompt("chat", {
        REPO: state.repo, BRANCH: state.branch, DESCRIPTION: branch.description, RULES_FORMAT: RULES_FORMAT_DOC,
        FEEDBACK: feedbackSection + unresolvedSection,
      });
      const promptFile = join(witDir(root), "chat-prompt.md");
      writeFileSync(promptFile, system);

      const sessions = state.sessions[state.branch] ?? [];
      const last = sessions.at(-1);
      const tools = ["--allowedTools", "Bash(wit note:*)", "Bash(wit status)"];
      if (f.continue && last && !last.condensed) {
        console.log(dim(`Resuming session ${last.id}…`));
        process.exitCode = await runInteractive(root, ["--resume", last.id, "--append-system-prompt-file", promptFile, ...tools, ...extra]);
        return;
      }
      const id = randomUUID();
      writeState(root, { ...state, sessions: { ...state.sessions, [state.branch]: [...sessions, { id, condensed: false, startedAt: new Date().toISOString() }] } });
      console.log(dim(`Chatting on ${state.branch}. Decisions are recorded to .wit/log/${state.branch}.md.`));
      process.exitCode = await runInteractive(root, ["--session-id", id, "--append-system-prompt-file", promptFile, ...tools, ...extra]);
      const count = readLog(root, state.branch).split("\n").filter((l) => l.startsWith("- ")).length;
      console.log(`\n${count} decision${count === 1 ? "" : "s"} recorded on ${state.branch}. Next: ${bold("wit condense")}`);
    },
  },

  note: {
    usage: 'wit note "<decision>"',
    summary: "Record a decision in the branch's log (Claude runs this during chat)",
    run: async (args) => {
      const text = args.join(" ").trim();
      if (!text) throw new UsageError('wit note "<decision>"');
      const { root, state } = requireBranch();
      const path = logPath(root, state.branch);
      mkdirSync(join(witDir(root), "log"), { recursive: true });
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
      appendFileSync(path, `- ${stamp} — ${text.replace(/\n+/g, " ")}\n`);
      console.log(`${green("✓")} Recorded.`);
    },
  },

  status: {
    usage: "wit status",
    summary: "Show the branch, recorded decisions, and uncondensed changes",
    run: async () => {
      const { root, state } = requireRepo();
      console.log(`${bold(state.repo)} · ${state.branch === "main" ? "main" : `branch ${bold(state.branch)}`} · r${state.rev}`);
      if (state.branch !== "main") {
        try {
          const branch = await api("GET", `/api/repos/${state.repo}/branches/${state.branch}`);
          console.log(dim(branch.description));
          if (branch.status !== "open") console.log(yellow(`This branch is ${branch.status}. Start a new one with \`wit start\`.`));
          else if (branch.mainHead !== branch.base_rev) console.log(yellow(`main has moved to r${branch.mainHead}. Run \`wit sync\` before merging.`));
          if (branch.review) {
            const label = { open: "open", changes_requested: "changes requested — run `wit apply` or `wit chat`", merged: "merged", superseded: "superseded" }[branch.review.status as string];
            console.log(`Review #${branch.review.id} (r${branch.review.rev}): ${label}  ${dim(`${ORIGIN}/r/${state.repo}/reviews/${branch.review.id}`)}`);
          }
        } catch (err) {
          console.log(yellow((err as Error).message));
        }
      }
      const log = readLog(root, state.branch);
      const entries = log ? log.split("\n") : [];
      console.log(`\n${bold(`Decisions recorded (${entries.length})`)}`);
      console.log(entries.length ? entries.map((e) => `  ${e}`).join("\n") : dim("  none"));
      const local = localChanges(root, state);
      console.log(`\n${bold(`Uncondensed changes (${local.length})`)}`);
      console.log(local.length ? local.map((c) => `  ${c.status.padEnd(9)} ${c.path}`).join("\n") : dim("  none"));
      if (state.branch !== "main" && (entries.length || local.length)) console.log(`\nNext: ${bold("wit condense")}`);
    },
  },

  condense: {
    usage: "wit condense",
    summary: "Turn recorded decisions into rules and save a revision (like commit)",
    run: async () => {
      const { root, state } = requireBranch();
      const branch = await api("GET", `/api/repos/${state.repo}/branches/${state.branch}`);
      if (branch.status !== "open") throw new UsageError(`Branch ${state.branch} is ${branch.status}.`);
      const log = readLog(root, state.branch);
      const sessions = (state.sessions[state.branch] ?? []).filter((s) => !s.condensed);
      const transcripts = sessions.map((s) => writeTranscript(root, s.id)).filter((f): f is string => Boolean(f));
      const codeChanged = localChanges(root, state).some((c) => !c.path.startsWith("rules/"));
      if (!log && !transcripts.length && !codeChanged) {
        console.log("Nothing to condense: no decisions recorded and no changes.");
        return;
      }

      let report: { message: string; changes: string[]; conflicts?: string[]; skipped?: string[] } = { message: "", changes: [], conflicts: [], skipped: [] };
      if (log || transcripts.length) {
        const { ids } = await api<{ ids: string[] }>("GET", `/api/repos/${state.repo}/ids`);
        const text = prompt("condense", {
          BRANCH: state.branch, DESCRIPTION: branch.description, DATE: today(), RULES_FORMAT: RULES_FORMAT_DOC,
          LOG: log ? logPath(root, state.branch) : "(empty — nothing was logged)",
          TRANSCRIPTS: transcripts.length ? transcripts.map((t) => `  - \`${t}\``).join("\n") : "  (none)",
          IDS: ids.length ? ids.join(", ") : "(none yet)",
        });
        console.log(`Condensing ${state.branch}…`);
        report = reportFrom(await runHeadless(root, text, ["Read", "Glob", "Grep", "Edit", "Write", "Bash(ls:*)", "Bash(mkdir:*)"]));
      }

      const message = report.message || `Code changes on ${state.branch}`;
      const body = [message, "", ...(report.changes.length ? ["Rules:", ...report.changes.map((c) => `- ${c}`)] : ["Rules: none"])].join("\n");
      const rev = await commitWorkingCopy(root, state, body, "claude");

      // The log has been condensed. Keep it, and carry any conflicts forward for the next chat.
      const archive = join(witDir(root), "log", "archive");
      mkdirSync(archive, { recursive: true });
      if (existsSync(logPath(root, state.branch))) renameSync(logPath(root, state.branch), join(archive, `${state.branch}-${rev ?? `r${state.rev}`}-${Date.now()}.md`));
      if (report.conflicts?.length) {
        writeFileSync(logPath(root, state.branch), report.conflicts.map((c) => `- UNRESOLVED: ${c}`).join("\n") + "\n");
      }
      const fresh = readState(root);
      fresh.sessions[state.branch] = (fresh.sessions[state.branch] ?? []).map((s) => ({ ...s, condensed: true }));
      writeState(root, fresh);

      console.log();
      for (const c of report.changes) console.log(`  ${green("•")} ${c}`);
      for (const s of report.skipped ?? []) console.log(`  ${dim(`skipped: ${s}`)}`);
      for (const c of report.conflicts ?? []) console.log(`  ${red("✗ conflict:")} ${c}`);
      if (rev) console.log(`\n${green("✓")} r${rev} on ${state.branch}: ${message}`);
      else console.log("\nNo rule or code changes to save.");
      if (report.conflicts?.length) console.log(yellow(`\n${report.conflicts.length} conflict(s) weren't written. They're in the log. Resolve them with \`wit chat\`.`));
      if (rev) console.log(`Next: ${bold("wit review")}`);
    },
  },

  review: {
    usage: "wit review",
    summary: "Open the review for this branch in the browser",
    run: async () => {
      const { root, state } = requireBranch();
      const dirty = localChanges(root, state);
      if (dirty.length || readLog(root, state.branch)) {
        console.log(yellow("Heads up: there are recorded decisions or changes that haven't been condensed, so they won't be in this review."));
      }
      const { url } = await api("POST", `/api/repos/${state.repo}/branches/${state.branch}/reviews`);
      console.log(`Review: ${cyan(url)}`);
      openUrl(url);
    },
  },

  apply: {
    usage: "wit apply",
    summary: "Have Claude apply the changes requested in review",
    run: async () => {
      const { root, state } = requireBranch();
      requireClean(root, state, "apply review feedback");
      const branch = await api("GET", `/api/repos/${state.repo}/branches/${state.branch}`);
      const feedback = await api("GET", `/api/repos/${state.repo}/branches/${state.branch}/feedback`);
      if (!feedback.reviewId) {
        console.log("No requested changes waiting on this branch's latest revision.");
        return;
      }
      // The base revision's rules, so Claude can restore things the reviewer rejected.
      const baseDir = join(witDir(root), "base");
      rmSync(baseDir, { recursive: true, force: true });
      const { tree: baseTree } = await api<{ tree: Tree }>("GET", `/api/repos/${state.repo}/revisions/${branch.base_rev}`);
      const rulesOnly = Object.entries(baseTree).filter(([p]) => p.startsWith("rules/"));
      const blobs = await fetchBlobs(rulesOnly.map(([, h]) => h));
      for (const [path, hash] of rulesOnly) {
        mkdirSync(join(baseDir, path, ".."), { recursive: true });
        writeFileSync(join(baseDir, path), blobs[hash]);
      }
      const text = prompt("apply", {
        BRANCH: state.branch, DESCRIPTION: branch.description, DATE: today(), RULES_FORMAT: RULES_FORMAT_DOC,
        DECISIONS: JSON.stringify(feedback.decisions, null, 2), BASE_DIR: join(baseDir, "rules"),
      });
      console.log(`Applying review #${feedback.reviewId}…`);
      const report = reportFrom<{ message: string; changes: string[]; unresolved?: string[]; codeImpact?: string[] }>(
        await runHeadless(root, text, ["Read", "Glob", "Grep", "Edit", "Write", "Bash(ls:*)", "Bash(mkdir:*)", "Bash(rm -r rules/*)", "Bash(rmdir:*)"]),
      );
      rmSync(baseDir, { recursive: true, force: true });
      const body = [report.message, "", "Rules:", ...report.changes.map((c) => `- ${c}`)].join("\n");
      const rev = await commitWorkingCopy(root, readState(root), body, "claude");
      console.log();
      for (const c of report.changes) console.log(`  ${green("•")} ${c}`);
      for (const u of report.unresolved ?? []) console.log(`  ${yellow("? unresolved:")} ${u}`);
      for (const c of report.codeImpact ?? []) console.log(`  ${yellow("! code:")} ${c}`);
      console.log(rev ? `\n${green("✓")} r${rev} on ${state.branch}. Next: ${bold("wit review")}` : "\nNothing changed.");
    },
  },

  sync: {
    usage: "wit sync",
    summary: "Bring main's latest rules into this branch",
    run: async () => {
      const { root, state } = requireBranch();
      requireClean(root, state, "sync");
      try {
        const result = await api<{ upToDate: boolean; rev: number }>("POST", `/api/repos/${state.repo}/branches/${state.branch}/sync`);
        if (result.upToDate) {
          console.log("Already up to date with main.");
          return;
        }
        await moveTo(root, readState(root), state.branch, result.rev);
        console.log(`${green("✓")} Synced with main as r${result.rev}. Review again with ${bold("wit review")}.`);
      } catch (err) {
        if (err instanceof ApiError && err.details) {
          console.log(red("Sync has conflicts, so nothing changed:"));
          for (const d of err.details) console.log(`  ${d}`);
          console.log("\nResolve them with `wit chat` (tell Claude what main changed), condense, then sync again.");
          process.exitCode = 1;
          return;
        }
        throw err;
      }
    },
  },

  switch: {
    usage: "wit switch <branch|main>",
    summary: "Switch the working copy to another branch",
    run: async ([name]) => {
      if (!name) throw new UsageError("wit switch <branch|main>");
      const { root, state } = requireRepo();
      requireClean(root, state, "switch branches");
      const branch = await api("GET", `/api/repos/${state.repo}/branches/${name}`);
      await moveTo(root, state, name, branch.head_rev);
      console.log(`${green("✓")} On ${bold(name)} at r${branch.head_rev}${branch.status !== "open" && name !== "main" ? dim(` (${branch.status})`) : ""}.`);
    },
  },

  abandon: {
    usage: "wit abandon",
    summary: "Close this branch without merging, and go back to main",
    run: async () => {
      const { root, state } = requireBranch();
      const answer = await ask(`Abandon ${state.branch}? Its revisions stay in history. [y/N]`, "n");
      if (answer.toLowerCase() !== "y") return;
      await api("POST", `/api/repos/${state.repo}/branches/${state.branch}/abandon`);
      const main = await api("GET", `/api/repos/${state.repo}/branches/main`);
      const current = readState(root);
      // Discard uncondensed local changes by checking out main over the current snapshot.
      await moveTo(root, { ...current, tree: snapshot(root).tree }, "main", main.head_rev);
      console.log(`${green("✓")} Abandoned. On main at r${main.head_rev}.`);
    },
  },

  log: {
    usage: "wit log",
    summary: "Show revisions on this branch and main",
    run: async () => {
      const { state } = requireRepo();
      const print = (revs: { id: number; message: string; author: string; created_at: string; signed?: boolean | null }[]) => {
        for (const r of revs) {
          const [subject, ...rest] = r.message.split("\n");
          const sig = r.signed === true ? green(" ✓ signed") : r.signed === false ? red(" ✗ signature invalid") : "";
          console.log(`${yellow(`r${r.id}`)} ${subject} ${dim(`— ${r.author}, ${r.created_at.slice(0, 16).replace("T", " ")}`)}${sig}`);
          for (const line of rest.filter((l) => l.startsWith("- "))) console.log(dim(`     ${line}`));
        }
      };
      if (state.branch !== "main") {
        const branch = await api("GET", `/api/repos/${state.repo}/branches/${state.branch}`);
        console.log(bold(`${state.branch}`) + dim(` (${branch.status})`));
        print(branch.revisions);
        console.log();
      }
      const repo = await api("GET", `/api/repos/${state.repo}`);
      console.log(bold("main"));
      print(repo.history);
    },
  },

  map: {
    usage: "wit map",
    summary: "Open the zoomable map of this branch's rules",
    run: async () => {
      const { state } = requireRepo();
      await api("GET", "/api/health");
      const url = `${ORIGIN}/r/${state.repo}/map?branch=${state.branch}`;
      console.log(cyan(url));
      openUrl(url);
    },
  },

  open: {
    usage: "wit open",
    summary: "Open this repo on the wit server",
    run: async () => {
      const root = findRoot();
      await api("GET", "/api/health");
      const url = root ? `${ORIGIN}/r/${readState(root).repo}` : ORIGIN;
      console.log(cyan(url));
      openUrl(url);
    },
  },

};

const help = () => {
  console.log(`${bold("wit")}: version control for business rules\n`);
  const flow = ["init", "start", "chat", "condense", "review", "apply", "sync"];
  const width = Math.max(...Object.keys(commands).map((k) => k.length));
  console.log(bold("The loop"));
  for (const name of flow) console.log(`  ${name.padEnd(width)}  ${commands[name].summary}`);
  console.log(bold("\nMore"));
  for (const name of Object.keys(commands).filter((n) => !flow.includes(n))) console.log(`  ${name.padEnd(width)}  ${commands[name].summary}`);
  console.log(dim(`\nThe server runs at ${ORIGIN}. Start it from the wit repo with \`npm start\`.`));
};

const [name, ...args] = process.argv.slice(2);
if (!name || name === "help" || name === "--help" || name === "-h") help();
else if (!commands[name]) {
  console.error(red(`Unknown command: ${name}\n`));
  help();
  process.exitCode = 1;
} else {
  try {
    await commands[name].run(args);
  } catch (err) {
    if (err instanceof UsageError || err instanceof ServerDown) console.error(err.message);
    else if (err instanceof ApiError) {
      console.error(red(err.message));
      for (const d of err.details ?? []) console.error(`  ${d}`);
    } else console.error(red((err as Error).stack ?? String(err)));
    process.exitCode = 1;
  }
}
