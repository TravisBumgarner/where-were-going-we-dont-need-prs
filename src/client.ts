// Talks to the wit server. The server runs from the wit repo (`npm start`), never from a product repo.

import { ORIGIN, PACKAGE_ROOT } from "./config.ts";

export class ApiError extends Error {
  status: number;
  details: string[] | undefined;
  constructor(status: number, message: string, details?: string[]) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const healthy = async () => {
  try {
    return (await fetch(`${ORIGIN}/api/health`)).ok;
  } catch {
    return false;
  }
};

export class ServerDown extends Error {}

export const ensureServer = async () => {
  if (await healthy()) return;
  throw new ServerDown(`The wit server isn't running at ${ORIGIN}. Start it from the wit repo:\n  cd ${PACKAGE_ROOT} && npm start`);
};

export const api = async <T = any>(method: string, path: string, body?: unknown): Promise<T> => {
  await ensureServer();
  const res = await fetch(`${ORIGIN}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, data.error ?? res.statusText, data.details);
  return data as T;
};

export const fetchBlobs = async (hashes: string[]) => {
  const blobs: Record<string, Buffer> = {};
  const unique = [...new Set(hashes)];
  for (let i = 0; i < unique.length; i += 500) {
    const batch = await api<Record<string, string>>("POST", "/api/blobs/fetch", { hashes: unique.slice(i, i + 500) });
    for (const [hash, b64] of Object.entries(batch)) blobs[hash] = Buffer.from(b64, "base64");
  }
  return blobs;
};
