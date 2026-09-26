import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PORT = Number(process.env.WIT_PORT ?? 4711);
// Passkeys need a real hostname: WebAuthn won't accept an IP address as the relying party.
export const HOST = "localhost";
export const ORIGIN = `http://${HOST}:${PORT}`;
export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// The server runs from this repo and keeps its data here (gitignored).
export const DATA_DIR = process.env.WIT_DATA ?? join(PACKAGE_ROOT, "data");
export const DB_PATH = join(DATA_DIR, "wit.db");
export const RULES_FORMAT_DOC = join(PACKAGE_ROOT, "docs", "rules-format.md");
