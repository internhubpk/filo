# Deployment Guide

> **NOTE (payments removed):** This guide previously described the SafePay
> payment integration (checkout, webhooks, manual verification). All payment
> machinery has since been REMOVED from the codebase:
>
> - No payment env vars (`SAFEPAY_*`) are required anywhere.
> - Every signup is activated instantly and can generate immediately.
> - Quota enforcement lives in `convex/subscriptions.ts`
>   (`getMonthlyAiUsage` / `canGenerateAI` / `recordAIGeneration`)
>   against the `usageRecords` table.
> - Admins retain activate/suspend controls at `/admin` for moderation.

## Deploying to Vercel

1. Push this repository to GitHub and import it into Vercel.
2. Set environment variables in Vercel Project Settings:
   - `NEXT_PUBLIC_APP_URL` — your production URL
   - `NEXT_PUBLIC_CONVEX_URL` / `CONVEX_URL` — your Convex deployment URL
   - AI keys: `GEMINI_API_KEY` (primary) and optional
     `OPENROUTER_API_KEY` / `OPENAI_API_KEY` fallbacks
   - R2 storage credentials if file uploads are used
   - Admin panel: `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`
3. Configure the same secrets in the Convex dashboard
   (`npx convex env set GEMINI_API_KEY ...`) so Convex actions can call AI.
4. **REQUIRED — keep the Convex backend in sync** (this is the step that
   historically caused the site-wide signup/login failure):
   ```bash
   npx convex deploy                        # push schema + functions
   npx convex run seed:seedDefaultPlans     # fill the empty plans table
   ```
   Deploying the Next.js app alone is NOT enough: Next.js routes call Convex
   functions by name, so if `convex/` changed (hashing hardening, new internal
   mutations such as `users.createUserWithPassword`, plan seeding), the
   backend must be redeployed too or signup/login fail mid-flight.

## Verifying auth and generation work

1. Backend sanity check (read-only):
   ```bash
   curl https://<your-site>/api/auth/health
   ```
   - HTTP 200 → every table/index the auth flow touches is reachable.
   - HTTP 503 with `auth:authHealthCheck not available` → the deployed Convex
     functions predate this repository; run `npx convex deploy`.
2. Sign up with a fresh account — you are logged in and active immediately.
3. Submit a prompt on the dashboard; a downloadable artifact should be
   produced within normal AI latency.
4. Usage counting increments monthly via `/api/subscription/status`.

> Signup/login errors now return GRANULAR codes instead of one opaque message
> (see the header comments of `src/app/api/auth/login/route.ts`,
> `src/app/api/auth/signup/route.ts`, and `convex/auth.ts`). The code tells
> you exactly which internal step failed — password hashing, user insert,
> session insert, duplicate-check, or a stale deployment
> (`CONVEX_ACTION_ERROR`).
