// Minimal WebAuthn (passkeys) for one owner. Approving a review requires a signature from the
// owner's passkey over a challenge that commits to exactly what's being merged. Claude can call
// every other API, but can't produce that signature.

import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { HOST, ORIGIN } from "../config.ts";
import { db, now } from "./db.ts";

export const b64url = (buf: Uint8Array) => Buffer.from(buf).toString("base64url");
const fromB64url = (s: string) => Buffer.from(s, "base64url");
const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest();

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export type Credential = { id: string; public_key: Uint8Array; alg: number; created_at: string };
export const credentials = () => db.prepare("SELECT * FROM credentials").all() as Credential[];

// The challenge is a hash of the payload plus a nonce, so a signature over it is a signature over the payload.
export const issueChallenge = (purpose: "register" | "approve", payload: Record<string, unknown>) => {
  const full = { ...payload, purpose, nonce: b64url(randomBytes(16)) };
  const challenge = b64url(sha256(JSON.stringify(full)));
  db.prepare("DELETE FROM challenges WHERE expires_at < ?").run(Date.now());
  db.prepare("INSERT INTO challenges (challenge, purpose, payload, expires_at) VALUES (?, ?, ?, ?)")
    .run(challenge, purpose, JSON.stringify(full), Date.now() + CHALLENGE_TTL_MS);
  return { challenge, payload: full };
};

const takeChallenge = (challenge: string, purpose: string) => {
  const row = db.prepare("SELECT * FROM challenges WHERE challenge = ? AND purpose = ?").get(challenge, purpose) as
    | { payload: string; expires_at: number }
    | undefined;
  db.prepare("DELETE FROM challenges WHERE challenge = ?").run(challenge);
  if (!row || row.expires_at < Date.now()) throw new Error("Challenge expired or unknown. Try again.");
  return JSON.parse(row.payload) as Record<string, unknown>;
};

const checkClientData = (clientDataJSON: string, type: string) => {
  const data = JSON.parse(fromB64url(clientDataJSON).toString("utf8"));
  if (data.type !== type) throw new Error(`Unexpected WebAuthn type ${data.type}`);
  if (data.origin !== ORIGIN) throw new Error(`Unexpected origin ${data.origin}; open wit at ${ORIGIN}`);
  return data as { challenge: string };
};

export type Registration = { id: string; publicKey: string; alg: number; clientDataJSON: string };

export const register = (body: Registration) => {
  if (credentials().length > 0) throw new Error("A passkey is already registered. wit supports one owner.");
  const { challenge } = checkClientData(body.clientDataJSON, "webauthn.create");
  takeChallenge(challenge, "register");
  const spki = fromB64url(body.publicKey);
  createPublicKey({ key: spki, format: "der", type: "spki" }); // throws if it isn't a key
  if (![-7, -257].includes(body.alg)) throw new Error(`Unsupported key algorithm ${body.alg}`);
  db.prepare("INSERT INTO credentials (id, public_key, alg, created_at) VALUES (?, ?, ?, ?)").run(body.id, spki, body.alg, now());
};

export type Assertion = { credentialId: string; authenticatorData: string; clientDataJSON: string; signature: string };

// Checks an assertion's signature and flags. Used both when approving and when auditing history later.
export const verifyAssertion = (a: Assertion) => {
  const cred = db.prepare("SELECT * FROM credentials WHERE id = ?").get(a.credentialId) as Credential | undefined;
  if (!cred) throw new Error("Unknown passkey.");
  const authData = fromB64url(a.authenticatorData);
  if (!authData.subarray(0, 32).equals(sha256(HOST))) throw new Error("Passkey was made for a different site.");
  const flags = authData[32];
  if (!(flags & 0x01) || !(flags & 0x04)) throw new Error("Passkey approval needs user presence and verification (Touch ID or PIN).");
  const signed = Buffer.concat([authData, sha256(fromB64url(a.clientDataJSON))]);
  const key = createPublicKey({ key: Buffer.from(cred.public_key), format: "der", type: "spki" });
  if (!verify("sha256", signed, key, fromB64url(a.signature))) throw new Error("Passkey signature is invalid.");
  return checkClientData(a.clientDataJSON, "webauthn.get");
};

// Verifies an approval and returns the payload it signed.
export const consumeApproval = (a: Assertion) => {
  const { challenge } = verifyAssertion(a);
  return takeChallenge(challenge, "approve");
};

// For auditing stored approvals: the signature is valid and the challenge matches the stored payload.
export const auditApproval = (a: Assertion, payload: string) => {
  try {
    const { challenge } = verifyAssertion(a);
    return challenge === b64url(sha256(payload));
  } catch {
    return false;
  }
};
