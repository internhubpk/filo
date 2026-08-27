// =============================================================================
// FILO BILLING — server-side helpers for API routes
// =============================================================================
// The billing authorization chain for every route:
//   1. HMAC session token (self-contained, signed)
//   2. LIVE user re-read from Convex (suspension/deletion applies instantly,
//      admin flag is never trusted from the token)
//   3. Convex-side serverToken (shared secret) checked inside every billing
//      function — so the public Convex URL alone grants nothing.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { validateSessionToken, type SessionUser } from "@/lib/session";
import { getConvexClient } from "@/lib/convex-server";

export interface AuthedRequest {
  user: SessionUser;
  liveUser: Record<string, unknown> | null;
}

export function extractToken(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.substring(7);
  return null;
}

/** Validate the HMAC session AND re-read the live user from Convex. */
export async function requireUser(request: NextRequest): Promise<
  { ok: true; data: AuthedRequest } | { ok: false; response: NextResponse }
> {
  const token = extractToken(request);
  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: "Authentication required", code: "UNAUTHORIZED" },
        { status: 401 }
      ),
    };
  }
  const session = validateSessionToken(token);
  if (!session.valid || !session.user) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: "Invalid or expired session", code: "INVALID_SESSION" },
        { status: 401 }
      ),
    };
  }

  let liveUser: Record<string, unknown> | null = null;
  try {
    const convex = getConvexClient();
    liveUser = (await convex.query("users:getUser" as never, { userId: session.user.id as never })) as Record<
      string,
      unknown
    > | null;
  } catch (err) {
    console.warn("[billing-server] live user lookup failed:", err);
  }

  if (liveUser === null) {
    // Could not verify against the database — do not proceed on billing paths.
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: "Account not found or database unavailable", code: "ACCOUNT_NOT_FOUND" },
        { status: liveUser === null ? 401 : 503 }
      ),
    };
  }
  if ((liveUser as { status?: string }).status === "suspended") {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: "Account suspended", code: "ACCOUNT_SUSPENDED" },
        { status: 403 }
      ),
    };
  }

  return { ok: true, data: { user: session.user, liveUser } };
}

/** The shared Convex server token (must be set on both runtimes). */
export function serverToken(): string {
  const token = process.env.FILO_SERVER_SECRET;
  if (!token) {
    throw new Error("FILO_SERVER_SECRET is not configured on the Next.js runtime");
  }
  return token;
}

/** Typed-ish string-reference calls so new Convex modules work pre-codegen. */
export async function convexQuery<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
  const convex = getConvexClient();
  return (await convex.query(name as never, args as never)) as T;
}

export async function convexMutation<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
  const convex = getConvexClient();
  return (await convex.mutation(name as never, args as never)) as T;
}

/** Validate that the acting user is an admin against the LIVE Convex record. */
export function isAdminUser(liveUser: Record<string, unknown>): boolean {
  return liveUser.isAdmin === true && liveUser.status === "active";
}

// -----------------------------------------------------------------------------
// UNIFIED ADMIN GUARD
// -----------------------------------------------------------------------------
// Accepts two admin identities, BOTH verified against the live database:
//   1. admin_session cookie  — sub is either a Convex userId (new logins) or
//      "env:<username>" (legacy cookie); resolved + re-checked in the DB.
//   2. Bearer HMAC session   — the user's own token; live record must have
//      isAdmin === true.
// The returned adminUserId is passed to Convex functions, which run a SECOND
// admin check inside Convex (defense in depth).
// -----------------------------------------------------------------------------

export interface AdminAccess {
  adminUserId: string;
  adminEmail: string;
}

export async function requireAdminAccess(
  request: NextRequest
): Promise<{ ok: true; data: AdminAccess } | { ok: false; response: NextResponse }> {
  const notAdmin = () =>
    NextResponse.json(
      { success: false, error: "Admin authentication required", code: "UNAUTHORIZED" },
      { status: 401 }
    );

  const { verifyAdminSessionToken, ADMIN_COOKIE_NAME } = await import("@/lib/admin-auth");

  // ---- Flow 1: admin cookie ----
  const cookieToken = request.cookies.get(ADMIN_COOKIE_NAME)?.value;
  const cookieCheck = await verifyAdminSessionToken(cookieToken);
  if (cookieCheck.valid && cookieCheck.subject) {
    const subject = cookieCheck.subject;
    if (!subject.startsWith("env:")) {
      try {
        const live = (await convexQuery<Record<string, unknown> | null>("users:getUser", {
          userId: subject,
        })) as Record<string, unknown> | null;
        if (live && isAdminUser(live)) {
          return {
            ok: true,
            data: { adminUserId: String(live._id), adminEmail: String(live.email ?? "admin") },
          };
        }
        return { ok: false, response: notAdmin() };
      } catch {
        // DB unavailable — fall through to legacy acceptance below only for
        // non-DB subjects; for DB subjects fail-closed.
        return { ok: false, response: notAdmin() };
      }
    }
    // Legacy cookie without DB identity (pre-bootstrap). Accept for the
    // legacy endpoints only — NEW billing/admin-data endpoints require a DB
    // admin, so callers needing adminUserId should treat this as 401.
    return { ok: false, response: notAdmin() };
  }

  // ---- Flow 2: user HMAC session with isAdmin ----
  const token = extractToken(request);
  if (!token) return { ok: false, response: notAdmin() };
  const session = validateSessionToken(token);
  if (!session.valid || !session.user) return { ok: false, response: notAdmin() };

  try {
    const live = (await convexQuery<Record<string, unknown> | null>("users:getUser", {
      userId: session.user.id,
    })) as Record<string, unknown> | null;
    if (live && isAdminUser(live)) {
      return {
        ok: true,
        data: { adminUserId: String(live._id), adminEmail: String(live.email ?? "admin") },
      };
    }
  } catch {
    /* fail-closed */
  }
  return { ok: false, response: notAdmin() };
}

export function jsonError(status: number, error: string, code: string) {
  return NextResponse.json({ success: false, error, code }, { status });
}

export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
}
