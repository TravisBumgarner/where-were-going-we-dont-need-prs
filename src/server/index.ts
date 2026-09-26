// The wit server: a local, GitHub-like home for every wit repo. It owns all history —
// repos, branches, revisions, reviews — in SQLite under data/, and serves the web UI.
// Run it from this repo with `npm start`.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { runChecks } from "../checks.ts";
import { DB_PATH, HOST, ORIGIN, PACKAGE_ROOT, PORT } from "../config.ts";
import { diffTaxonomy, isRulesPath, nestedTree, parseNodeFile, taxonomy } from "../rules.ts";
import {
  type BranchRow, db, filesOf, getBranch, getRevision, getReview, hasBlob, insertRevision, now, putBlob,
  type ReviewRow, type RevisionRow, transaction, type Tree, treeOf, getBlob,
} from "./db.ts";
import { hashOf, mergeTrees } from "./merge.ts";
import { type Assertion, auditApproval, b64url, consumeApproval, credentials, issueChallenge, register } from "./webauthn.ts";

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const assert: (cond: unknown, status: number, message: string) => asserts cond = (cond, status, message) => {
  if (!cond) throw new HttpError(status, message);
};

const canonicalTree = (tree: Tree) => JSON.stringify(Object.fromEntries(Object.entries(tree).sort(([a], [b]) => a.localeCompare(b))));
const treeHash = (treeJson: string) => createHash("sha256").update(treeJson).digest("hex");
const mainOf = (repo: string) => {
  const main = getBranch(repo, "main");
  assert(main, 404, `No repo named ${repo}`);
  return main;
};
const rulesFiles = (tree: Tree) => filesOf(tree, isRulesPath);
const rootTitle = (tree: Tree) => {
  const hash = tree["rules/index.md"];
  const parsed = hash ? parseNodeFile(Buffer.from(getBlob(hash) ?? []).toString("utf8")) : null;
  return { title: parsed?.title ?? null, summary: parsed?.summary ?? "" };
};

// Stores uploaded blobs, verifying each hash, and checks the tree only references known blobs.
const storeTree = (tree: Tree, blobs: Record<string, string> = {}) => {
  for (const [hash, b64] of Object.entries(blobs)) {
    const data = Buffer.from(b64, "base64");
    assert(hashOf(data) === hash, 400, `Blob ${hash} doesn't match its content`);
    putBlob(hash, data);
  }
  for (const [path, hash] of Object.entries(tree)) assert(hasBlob(hash), 400, `Missing blob for ${path}`);
  return canonicalTree(tree);
};

// Revisions on a branch since it forked, newest first.
const branchRevisions = (branch: BranchRow, upTo = branch.head_rev) => {
  const revs: RevisionRow[] = [];
  for (let id: number | null = upTo; id && id !== branch.base_rev; ) {
    const rev = getRevision(id);
    if (!rev || rev.branch !== branch.name) break;
    revs.push(rev);
    id = rev.parent;
  }
  return revs;
};

// ---------- Review assembly ----------

const reviewPayload = (review: ReviewRow) => {
  const branch = getBranch(review.repo, review.branch)!;
  const main = mainOf(review.repo);
  const rev = getRevision(review.rev)!;
  const baseTree = treeOf(branch.base_rev!);
  const headTree: Tree = JSON.parse(rev.tree);
  const { nodeChanges, ruleChanges, after } = diffTaxonomy(rulesFiles(baseTree), rulesFiles(headTree));

  const tree = [...after.nodes.values()].map((n) => ({ ...n, removed: false }));
  for (const n of nodeChanges.filter((c) => c.kind === "removed")) tree.push({ path: n.path, title: n.title, summary: n.summary, ruleIds: [], removed: true });
  tree.sort((a, b) => a.path.localeCompare(b.path));

  const changedIds = new Set(ruleChanges.map((r) => r.id));
  const context: Record<string, { id: string; title: string; body: string }[]> = {};
  for (const rule of after.rules.values()) {
    if (!changedIds.has(rule.id)) (context[rule.node] ??= []).push({ id: rule.id, title: rule.title, body: rule.body });
  }

  const codeFiles = [...new Set([...Object.keys(baseTree), ...Object.keys(headTree)])]
    .filter((p) => !isRulesPath(p) && baseTree[p] !== headTree[p])
    .sort()
    .map((path) => ({ path, status: !baseTree[path] ? "added" : !headTree[path] ? "deleted" : "modified" }));

  return {
    id: review.id,
    repo: review.repo,
    status: review.status,
    decisions: review.decisions ? JSON.parse(review.decisions) : null,
    branch: { name: branch.name, description: branch.description, status: branch.status, head: branch.head_rev, base: branch.base_rev },
    rev: review.rev,
    stale: branch.head_rev !== review.rev,
    mainMoved: main.head_rev !== branch.base_rev,
    passkey: credentials().length > 0,
    checks: runChecks(filesOf(baseTree), filesOf(headTree)),
    revisions: branchRevisions(branch, review.rev).map(({ id, message, author, created_at }) => ({ id, message, author, created_at })),
    codeFiles,
    tree,
    nodeChanges,
    ruleChanges,
    context,
  };
};

// ---------- Routes ----------

type Ctx = { req: IncomingMessage; res: ServerResponse; params: Record<string, string>; query: URLSearchParams; body: any };
type Handler = (ctx: Ctx) => unknown;
const routes: { method: string; pattern: RegExp; keys: string[]; handler: Handler }[] = [];
const route = (method: string, path: string, handler: Handler) => {
  const keys: string[] = [];
  const pattern = new RegExp(`^${path.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)"))}$`);
  routes.push({ method, pattern, keys, handler });
};

const page = (name: string) => readFileSync(join(PACKAGE_ROOT, "src", "web", name), "utf8");
const html = (res: ServerResponse, body: string) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body);
  return undefined;
};
const inject = (source: string, data: unknown) =>
  source.replace("/*__DATA__*/null", () => JSON.stringify(data).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029"));

// Pages
route("GET", "/", ({ res }) => html(res, page("app.html")));
route("GET", "/setup", ({ res }) => html(res, page("app.html")));
route("GET", "/r/:repo", ({ res }) => html(res, page("app.html")));
route("GET", "/r/:repo/reviews/:id", ({ res }) => html(res, page("review.html")));
route("GET", "/r/:repo/map", ({ res, params, query }) => {
  const main = mainOf(params.repo);
  const branch = query.get("branch") ? getBranch(params.repo, query.get("branch")!) : main;
  assert(branch, 404, "No such branch");
  const rev = Number(query.get("rev") ?? branch.head_rev);
  return html(res, inject(page("map.html"), {
    repo: params.repo,
    label: `${branch.name} · r${rev}`,
    tree: nestedTree(rulesFiles(treeOf(rev))),
  }));
});

// API
route("GET", "/api/health", () => ({ ok: true }));

route("GET", "/api/setup", () => ({ registered: credentials().length > 0 }));
route("POST", "/api/setup/challenge", () => {
  assert(credentials().length === 0, 409, "A passkey is already registered.");
  const { challenge } = issueChallenge("register", {});
  return { challenge, rpId: HOST, userId: b64url(Buffer.from("wit-owner")) };
});
route("POST", "/api/setup/register", ({ body }) => {
  try {
    register(body);
  } catch (err) {
    throw new HttpError(400, (err as Error).message);
  }
  return { ok: true };
});

route("GET", "/api/repos", () =>
  (db.prepare("SELECT * FROM branches WHERE name = 'main' ORDER BY repo").all() as BranchRow[]).map((main) => ({
    name: main.repo,
    ...rootTitle(treeOf(main.head_rev)),
    mainRev: main.head_rev,
    openBranches: (db.prepare("SELECT COUNT(*) AS n FROM branches WHERE repo = ? AND status = 'open'").get(main.repo) as { n: number }).n,
    openReviews: (db.prepare("SELECT COUNT(*) AS n FROM reviews WHERE repo = ? AND status IN ('open', 'changes_requested')").get(main.repo) as { n: number }).n,
  })));

route("POST", "/api/repos", ({ body }) => {
  assert(/^[a-z0-9][a-z0-9._-]*$/i.test(body.name ?? ""), 400, "Repo names are letters, numbers, dots, dashes, underscores.");
  assert(!getBranch(body.name, "main"), 409, `A repo named ${body.name} already exists.`);
  return transaction(() => {
    db.prepare("INSERT INTO repos (name, created_at) VALUES (?, ?)").run(body.name, now());
    const tree = storeTree(body.tree, body.blobs);
    const rev = insertRevision({ repo: body.name, branch: "main", parent: null, merged_from: null, message: body.message ?? "Initialize", author: "human", tree });
    db.prepare("INSERT INTO branches (repo, name, description, base_rev, head_rev, status, created_at) VALUES (?, 'main', '', NULL, ?, 'main', ?)").run(body.name, rev, now());
    return { rev };
  });
});

route("GET", "/api/repos/:repo", ({ params }) => {
  const main = mainOf(params.repo);
  const branches = (db.prepare("SELECT * FROM branches WHERE repo = ? AND name != 'main' ORDER BY created_at DESC").all(params.repo) as BranchRow[]).map((b) => {
    const review = db.prepare("SELECT id, status, rev FROM reviews WHERE repo = ? AND branch = ? ORDER BY id DESC LIMIT 1").get(params.repo, b.name) as
      | { id: number; status: string; rev: number }
      | undefined;
    return { name: b.name, description: b.description, status: b.status, head: b.head_rev, base: b.base_rev, created_at: b.created_at, revisions: branchRevisions(b).length, review: review ?? null };
  });
  const history: unknown[] = [];
  for (let id: number | null = main.head_rev; id; ) {
    const rev: RevisionRow = getRevision(id)!;
    const approval = db.prepare("SELECT * FROM approvals WHERE merge_rev = ?").get(id) as Record<string, string> | undefined;
    history.push({
      id: rev.id, message: rev.message, author: rev.author, created_at: rev.created_at, mergedFrom: rev.merged_from,
      signed: approval ? auditApproval({ credentialId: approval.credential_id, authenticatorData: approval.authenticator_data, clientDataJSON: approval.client_data_json, signature: approval.signature }, approval.payload) : null,
    });
    id = rev.parent;
  }
  const { rules, nodes } = taxonomy(rulesFiles(treeOf(main.head_rev)));
  return {
    name: params.repo, ...rootTitle(treeOf(main.head_rev)), mainRev: main.head_rev,
    ruleCount: [...rules.values()].filter((r) => r.status !== "retired").length, nodeCount: nodes.size,
    passkey: credentials().length > 0, branches, history,
  };
});

// Every rule ID ever used in the repo, so new rules never reuse one.
route("GET", "/api/repos/:repo/ids", ({ params }) => {
  mainOf(params.repo);
  const ids = new Set<string>();
  for (const { tree } of db.prepare("SELECT tree FROM revisions WHERE repo = ?").all(params.repo) as { tree: string }[]) {
    for (const id of taxonomy(rulesFiles(JSON.parse(tree))).rules.keys()) ids.add(id);
  }
  return { ids: [...ids].sort() };
});

route("GET", "/api/repos/:repo/revisions/:id", ({ params }) => {
  const rev = getRevision(Number(params.id));
  assert(rev && rev.repo === params.repo, 404, "No such revision");
  return { ...rev, tree: JSON.parse(rev.tree) };
});

route("POST", "/api/blobs/fetch", ({ body }) =>
  Object.fromEntries((body.hashes as string[]).map((h) => [h, Buffer.from(getBlob(h) ?? []).toString("base64")])));

route("POST", "/api/repos/:repo/branches", ({ params, body }) => {
  const main = mainOf(params.repo);
  assert(/^[a-z0-9][a-z0-9-]*$/.test(body.name ?? ""), 400, "Branch names are lowercase kebab-case.");
  assert(!getBranch(params.repo, body.name), 409, `Branch ${body.name} already exists.`);
  db.prepare("INSERT INTO branches (repo, name, description, base_rev, head_rev, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)")
    .run(params.repo, body.name, body.description ?? "", main.head_rev, main.head_rev, now());
  return { name: body.name, rev: main.head_rev };
});

route("GET", "/api/repos/:repo/branches/:name", ({ params }) => {
  const branch = getBranch(params.repo, params.name);
  assert(branch, 404, "No such branch");
  const review = db.prepare("SELECT id, status, rev FROM reviews WHERE repo = ? AND branch = ? ORDER BY id DESC LIMIT 1").get(params.repo, params.name) ?? null;
  return { ...branch, mainHead: mainOf(params.repo).head_rev, revisions: branchRevisions(branch), review };
});

route("POST", "/api/repos/:repo/branches/:name/revisions", ({ params, body }) => {
  const branch = getBranch(params.repo, params.name);
  assert(branch && branch.status === "open", 409, `Branch ${params.name} isn't open.`);
  assert(body.parent === branch.head_rev, 409, `Branch moved: its head is r${branch.head_rev}, not r${body.parent}.`);
  assert(["claude", "human"].includes(body.author), 400, "author must be claude or human");
  return transaction(() => {
    const tree = storeTree(body.tree, body.blobs);
    const rev = insertRevision({ repo: params.repo, branch: params.name, parent: branch.head_rev, merged_from: null, message: body.message, author: body.author, tree });
    db.prepare("UPDATE branches SET head_rev = ? WHERE repo = ? AND name = ?").run(rev, params.repo, params.name);
    return { rev };
  });
});

route("POST", "/api/repos/:repo/branches/:name/sync", ({ params }) => {
  const branch = getBranch(params.repo, params.name);
  assert(branch && branch.status === "open", 409, `Branch ${params.name} isn't open.`);
  const main = mainOf(params.repo);
  if (main.head_rev === branch.base_rev) return { upToDate: true, rev: branch.head_rev };
  const { tree, newBlobs, conflicts } = mergeTrees(treeOf(branch.base_rev!), treeOf(main.head_rev), treeOf(branch.head_rev));
  if (conflicts.length) throw Object.assign(new HttpError(409, "Sync has conflicts."), { details: conflicts });
  return transaction(() => {
    for (const [hash, data] of newBlobs) putBlob(hash, data);
    const rev = insertRevision({ repo: params.repo, branch: params.name, parent: branch.head_rev, merged_from: main.head_rev, message: `Sync with main (r${main.head_rev})`, author: "wit", tree: canonicalTree(tree) });
    db.prepare("UPDATE branches SET head_rev = ?, base_rev = ? WHERE repo = ? AND name = ?").run(rev, main.head_rev, params.repo, params.name);
    return { upToDate: false, rev };
  });
});

route("POST", "/api/repos/:repo/branches/:name/abandon", ({ params }) => {
  const branch = getBranch(params.repo, params.name);
  assert(branch && branch.status === "open", 409, `Branch ${params.name} isn't open.`);
  db.prepare("UPDATE branches SET status = 'abandoned' WHERE repo = ? AND name = ?").run(params.repo, params.name);
  db.prepare("UPDATE reviews SET status = 'superseded', updated_at = ? WHERE repo = ? AND branch = ? AND status IN ('open', 'changes_requested')").run(now(), params.repo, params.name);
  return { ok: true };
});

// Opens (or reuses) the review for the branch's current head.
route("POST", "/api/repos/:repo/branches/:name/reviews", ({ params }) => {
  const branch = getBranch(params.repo, params.name);
  assert(branch && branch.status === "open", 409, `Branch ${params.name} isn't open.`);
  assert(branch.head_rev !== branch.base_rev, 409, "Nothing to review yet. Run `wit condense` first.");
  const existing = db.prepare("SELECT * FROM reviews WHERE repo = ? AND branch = ? AND rev = ? AND status IN ('open', 'changes_requested')").get(params.repo, params.name, branch.head_rev) as ReviewRow | undefined;
  if (existing) return { id: existing.id, url: `${ORIGIN}/r/${params.repo}/reviews/${existing.id}` };
  db.prepare("UPDATE reviews SET status = 'superseded', updated_at = ? WHERE repo = ? AND branch = ? AND status IN ('open', 'changes_requested')").run(now(), params.repo, params.name);
  const id = Number(db.prepare("INSERT INTO reviews (repo, branch, rev, status, created_at, updated_at) VALUES (?, ?, ?, 'open', ?, ?)").run(params.repo, params.name, branch.head_rev, now(), now()).lastInsertRowid);
  return { id, url: `${ORIGIN}/r/${params.repo}/reviews/${id}` };
});

// The feedback waiting to be applied: changes requested on the branch's current head.
route("GET", "/api/repos/:repo/branches/:name/feedback", ({ params }) => {
  const branch = getBranch(params.repo, params.name);
  assert(branch, 404, "No such branch");
  const review = db.prepare("SELECT * FROM reviews WHERE repo = ? AND branch = ? AND rev = ? AND status = 'changes_requested' ORDER BY id DESC LIMIT 1").get(params.repo, params.name, branch.head_rev) as ReviewRow | undefined;
  return review ? { reviewId: review.id, rev: review.rev, decisions: JSON.parse(review.decisions!) } : { reviewId: null };
});

route("GET", "/api/reviews/:id", ({ params }) => {
  const review = getReview(Number(params.id));
  assert(review, 404, "No such review");
  return reviewPayload(review);
});

route("POST", "/api/reviews/:id/feedback", ({ params, body }) => {
  const review = getReview(Number(params.id));
  assert(review && review.status === "open", 409, "This review isn't open.");
  db.prepare("UPDATE reviews SET status = 'changes_requested', decisions = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(body), now(), review.id);
  return { ok: true };
});

route("POST", "/api/reviews/:id/challenge", ({ params }) => {
  const review = getReview(Number(params.id));
  assert(review && review.status === "open", 409, "This review isn't open.");
  const creds = credentials();
  assert(creds.length, 409, "No passkey registered. Set one up at /setup first.");
  const { challenge } = issueChallenge("approve", { repo: review.repo, reviewId: review.id, rev: review.rev, treeHash: treeHash(getRevision(review.rev)!.tree) });
  return { challenge, rpId: HOST, credentialIds: creds.map((c) => c.id) };
});

// Approving merges. Requires the owner's passkey signature over this exact revision.
route("POST", "/api/reviews/:id/approve", ({ params, body }) => {
  const review = getReview(Number(params.id));
  assert(review && review.status === "open", 409, "This review isn't open.");
  const assertion = body.assertion as Assertion;
  let signed: Record<string, unknown>;
  try {
    signed = consumeApproval(assertion);
  } catch (err) {
    throw new HttpError(403, (err as Error).message);
  }
  const rev = getRevision(review.rev)!;
  assert(signed.reviewId === review.id && signed.rev === review.rev && signed.treeHash === treeHash(rev.tree), 403, "The signature is for a different review or revision.");

  const branch = getBranch(review.repo, review.branch)!;
  const main = mainOf(review.repo);
  assert(branch.head_rev === review.rev, 409, "The branch has newer revisions than this review. Run `wit review` again.");
  assert(main.head_rev === branch.base_rev, 409, "main has moved since this branch started. Run `wit sync`, then review again.");
  const failures = runChecks(filesOf(treeOf(branch.base_rev!)), filesOf(JSON.parse(rev.tree)));
  assert(failures.length === 0, 409, `Checks failed:\n${failures.join("\n")}`);

  return transaction(() => {
    const mergeRev = insertRevision({ repo: review.repo, branch: "main", parent: main.head_rev, merged_from: review.rev, message: `Merge ${branch.name}: ${branch.description}`, author: "human", tree: rev.tree });
    db.prepare("UPDATE branches SET head_rev = ? WHERE repo = ? AND name = 'main'").run(mergeRev, review.repo);
    db.prepare("UPDATE branches SET status = 'merged' WHERE repo = ? AND name = ?").run(review.repo, branch.name);
    db.prepare("UPDATE reviews SET status = 'merged', decisions = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(body.decisions ?? null), now(), review.id);
    db.prepare("INSERT INTO approvals (review_id, merge_rev, payload, credential_id, authenticator_data, client_data_json, signature, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(review.id, mergeRev, JSON.stringify(signed), assertion.credentialId, assertion.authenticatorData, assertion.clientDataJSON, assertion.signature, now());
    return { mergeRev };
  });
});

// ---------- Server ----------

const readBody = (req: IncomingMessage) =>
  new Promise<any>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new HttpError(400, "Body must be JSON"));
      }
    });
    req.on("error", reject);
  });

export const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", ORIGIN);
  try {
    // Reject cross-site requests: only wit's own pages and the CLI may call the API.
    const origin = req.headers.origin;
    if (origin && origin !== ORIGIN) throw new HttpError(403, "Cross-origin requests aren't allowed.");
    const match = routes.find((r) => r.method === req.method && r.pattern.test(url.pathname));
    if (!match) throw new HttpError(404, "Not found");
    const values = url.pathname.match(match.pattern)!.slice(1).map(decodeURIComponent);
    const params = Object.fromEntries(match.keys.map((k, i) => [k, values[i]]));
    const body = req.method === "POST" ? await readBody(req) : undefined;
    const result = await match.handler({ req, res, params, query: url.searchParams, body });
    if (!res.headersSent) res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result ?? {}));
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) {
      res.writeHead(status, { "content-type": "application/json" })
        .end(JSON.stringify({ error: (err as Error).message, details: (err as { details?: unknown }).details }));
    }
  }
});

if (import.meta.main) {
  server.on("error", (err: NodeJS.ErrnoException) => {
    console.error(err.code === "EADDRINUSE" ? `Port ${PORT} is in use. Is the wit server already running?` : err.message);
    process.exit(1);
  });
  server.listen(PORT, "127.0.0.1", () => console.log(`wit server on ${ORIGIN}\ndata: ${DB_PATH}`));
}
