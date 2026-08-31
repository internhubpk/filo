// =============================================================================
// FILO SESSION VERIFICATION INSIDE CONVEX (pure JS, no runtime deps)
// =============================================================================
// The Next.js app issues self-contained HMAC-SHA256 session tokens
// (src/lib/session.ts):  base64url(payload) + "." + base64url(HMAC)
//
// Convex functions that the BROWSER calls reactively (useQuery) no longer
// trust a bare `userId` argument — anyone with the public deployment URL
// could pass someone else's id and read their data. Instead they take the
// session TOKEN and verify it here, cryptographically, inside Convex:
//
//   const user = await requireUser(ctx, args.session);
//   // → live user row, status-checked, or throws
//
// HMAC-SHA256 is built on lib/sha256.ts's verified core (sha256FromBytes —
// the same code path that hashes passwords), so verification behaves
// identically across every Convex runtime. The signature comparison is
// constant-time. Secrets never leave the server: SESSION_SECRET (set in BOTH
// Next.js and Convex envs) or, absent that, the deployment URL — the same
// fallback chain src/lib/session.ts uses, so tokens round-trip without
// extra configuration.
// =============================================================================

import { utf8Bytes, sha256FromBytes } from "./sha256";
import type { Doc } from "../_generated/dataModel";

export interface SessionPayload {
  uid: string;
  em: string;
  nm: string;
  st: string;
  pid: string | null;
  exp: number;
  iat: number;
}

function getSecret(): string {
  return (
    process.env.SESSION_SECRET ||
    process.env.CONVEX_CLOUD_URL ||
    process.env.CONVEX_URL ||
    "filo_session_secret_2024"
  );
}

// ---- HMAC-SHA256 (RFC 2104) over UTF-8 key + message ----

function hmacSha256Bytes(key: string, data: string): number[] {
  let keyBytes = utf8Bytes(key);
  if (keyBytes.length > 64) {
    keyBytes = sha256FromBytes(keyBytes);
  }
  const block = keyBytes.slice(0, 64);
  while (block.length < 64) block.push(0);

  const ipad = block.map((b) => b ^ 0x36);
  const opad = block.map((b) => b ^ 0x5c);

  const inner = sha256FromBytes([...ipad, ...utf8Bytes(data)]);
  return sha256FromBytes([...opad, ...inner]);
}

function bytesToBase64url(bytes: number[]): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  // btoa is available in Convex's V8 runtime (web standard).
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Constant-time string comparison (length-safe, no early exit on mismatch). */
function constantTimeEqual(a: string, b: string): boolean {
  const aBytes = utf8Bytes(a);
  const bBytes = utf8Bytes(b);
  const len = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < len; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

// ---- Base64url decode (payload parsing) ----

function base64urlDecodeToString(input: string): string {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes: number[] = [];
  for (let i = 0; i < bin.length; i++) bytes.push(bin.charCodeAt(i));
  // UTF-8 decode
  try {
    return new TextDecoder().decode(new Uint8Array(bytes));
  } catch {
    // Fallback for runtimes without TextDecoder: ASCII passthrough.
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return s;
  }
}

/**
 * Verify a Filo session token. Returns the payload when the signature is
 * valid AND the token is unexpired; null otherwise (never throws).
 */
export function verifySessionToken(token: string): SessionPayload | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;

  const expected = bytesToBase64url(hmacSha256Bytes(getSecret(), payloadB64));
  if (!constantTimeEqual(sigB64, expected)) return null;

  try {
    const payload = JSON.parse(
      base64urlDecodeToString(payloadB64)
    ) as SessionPayload;
    if (!payload || typeof payload.uid !== "string" || !payload.uid) return null;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Resolve the LIVE user behind a session token. Enforced in one place:
 *   1. Cryptographic signature + expiry check.
 *   2. Fresh database read — a deleted or suspended account fails closed
 *      even when its token is still unexpired.
 * Throws "Unauthorized" (client shows a re-auth prompt) on any failure.
 */
export async function requireUser(ctx: { db: any }, token: string): Promise<Doc<"users">> {
  const payload = verifySessionToken(token);
  if (!payload) throw new Error("Unauthorized: invalid session");
  const user = await ctx.db.get(payload.uid as any);
  if (!user) throw new Error("Unauthorized: account no longer exists");
  if (user.status === "suspended") {
    throw new Error("Unauthorized: account suspended");
  }
  return user as Doc<"users">;
}
