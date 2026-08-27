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
4. Run `npx convex deploy` to push the current schema/functions, then deploy
   the Next.js app.

## Verifying generation works

1. Sign up with a fresh account — you are logged in and active immediately.
2. Submit a prompt on the dashboard; a downloadable artifact should be
   produced within normal AI latency.
3. Usage counting increments monthly via `/api/subscription/status`.
