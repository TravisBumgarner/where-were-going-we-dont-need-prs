import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { DATA_DIR, DB_PATH } from "../config.ts";

export type Tree = Record<string, string>; // path → blob hash

mkdirSync(DATA_DIR, { recursive: true });
export const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS repos (
    name TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS blobs (
    hash TEXT PRIMARY KEY,
    data BLOB NOT NULL
  );
  CREATE TABLE IF NOT EXISTS revisions (
    id INTEGER PRIMARY KEY,
    repo TEXT NOT NULL REFERENCES repos(name),
    branch TEXT NOT NULL,
    parent INTEGER REFERENCES revisions(id),
    merged_from INTEGER REFERENCES revisions(id),
    message TEXT NOT NULL,
    author TEXT NOT NULL,          -- 'human' | 'claude' | 'wit'
    tree TEXT NOT NULL,            -- JSON: path → blob hash
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS branches (
    repo TEXT NOT NULL REFERENCES repos(name),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    base_rev INTEGER REFERENCES revisions(id),
    head_rev INTEGER NOT NULL REFERENCES revisions(id),
    status TEXT NOT NULL,          -- 'main' | 'open' | 'merged' | 'abandoned'
    created_at TEXT NOT NULL,
    PRIMARY KEY (repo, name)
  );
  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY,
    repo TEXT NOT NULL,
    branch TEXT NOT NULL,
    rev INTEGER NOT NULL REFERENCES revisions(id),
    status TEXT NOT NULL,          -- 'open' | 'changes_requested' | 'merged' | 'superseded'
    decisions TEXT,                -- JSON from the review page
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS credentials (
    id TEXT PRIMARY KEY,           -- base64url credential ID
    public_key BLOB NOT NULL,      -- SPKI DER
    alg INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS challenges (
    challenge TEXT PRIMARY KEY,    -- base64url
    purpose TEXT NOT NULL,         -- 'register' | 'approve'
    payload TEXT NOT NULL,         -- JSON the challenge commits to
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS approvals (
    id INTEGER PRIMARY KEY,
    review_id INTEGER NOT NULL REFERENCES reviews(id),
    merge_rev INTEGER NOT NULL REFERENCES revisions(id),
    payload TEXT NOT NULL,         -- what was signed: repo, reviewed revision, tree hash, nonce
    credential_id TEXT NOT NULL,
    authenticator_data TEXT NOT NULL,
    client_data_json TEXT NOT NULL,
    signature TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

export const now = () => new Date().toISOString();

export type RevisionRow = {
  id: number; repo: string; branch: string; parent: number | null; merged_from: number | null;
  message: string; author: string; tree: string; created_at: string;
};
export type BranchRow = {
  repo: string; name: string; description: string; base_rev: number | null; head_rev: number;
  status: string; created_at: string;
};
export type ReviewRow = {
  id: number; repo: string; branch: string; rev: number; status: string; decisions: string | null;
  created_at: string; updated_at: string;
};

export const getRevision = (id: number) => db.prepare("SELECT * FROM revisions WHERE id = ?").get(id) as RevisionRow | undefined;
export const getBranch = (repo: string, name: string) =>
  db.prepare("SELECT * FROM branches WHERE repo = ? AND name = ?").get(repo, name) as BranchRow | undefined;
export const getReview = (id: number) => db.prepare("SELECT * FROM reviews WHERE id = ?").get(id) as ReviewRow | undefined;
export const treeOf = (rev: number): Tree => JSON.parse(getRevision(rev)?.tree ?? "{}");

export const putBlob = (hash: string, data: Buffer) => db.prepare("INSERT OR IGNORE INTO blobs (hash, data) VALUES (?, ?)").run(hash, data);
export const getBlob = (hash: string) => (db.prepare("SELECT data FROM blobs WHERE hash = ?").get(hash) as { data: Uint8Array } | undefined)?.data;
export const hasBlob = (hash: string) => Boolean(db.prepare("SELECT 1 FROM blobs WHERE hash = ?").get(hash));

// Text contents of a tree. Binary files come back empty so the text parsers skip them.
export const filesOf = (tree: Tree, only?: (path: string) => boolean) => {
  const files: Record<string, string> = {};
  for (const [path, hash] of Object.entries(tree)) {
    if (only && !only(path)) continue;
    const data = Buffer.from(getBlob(hash) ?? []);
    files[path] = data.subarray(0, 8000).includes(0) ? "" : data.toString("utf8");
  }
  return files;
};

export const insertRevision = (r: Omit<RevisionRow, "id" | "created_at">) =>
  Number(db.prepare(
    "INSERT INTO revisions (repo, branch, parent, merged_from, message, author, tree, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(r.repo, r.branch, r.parent, r.merged_from, r.message, r.author, r.tree, now()).lastInsertRowid);

export const transaction = <T>(fn: () => T): T => {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
};
