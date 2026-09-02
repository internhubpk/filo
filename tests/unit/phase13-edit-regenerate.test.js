// =============================================================================
// Phase 13 — EDIT / REGENERATE / COPY TRANSCRIPT ACTIONS
// =============================================================================
// Pins the contract for the message action bar added to the chat workspace:
//
//   USER ROW     — copy + edit icons below the user's message (hover-reveal
//                  on desktop); the optimistic pending bubble has neither.
//   EDIT         — an inline editor replaces the bubble; saving truncates
//                  the thread FROM that turn INCLUSIVE (old turn + every
//                  later message die) and re-sends the edited prompt through
//                  the normal chat pipeline, so the AI answers the NEW text.
//   REGENERATE   — a button below the newest completed response truncates
//                  everything AFTER the most recent user turn (the prompt
//                  row itself survives) and re-streams an answer for it.
//   SERVER       — convex.chats.truncateFrom is ownership-checked on BOTH
//                  the chat and the anchor message and repairs the chat's
//                  preview/counters; /api/chat/send accepts regenerate:true,
//                  skips persisting a user row (the prompt already sits in
//                  the transcript), and builds context from the transcript
//                  alone. Regenerate is chat-mode only and requires a chat.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '..', '..')

const read = (...p) => readFileSync(resolve(REPO_ROOT, ...p), 'utf8')

const chats = read('convex', 'chats.ts')
const sendRoute = read('src', 'app', 'api', 'chat', 'send', 'route.ts')
const workspace = read('src', 'components', 'chat', 'workspace.tsx')

// ==================== CONVEX truncateFrom ====================

test('§13-T1 truncateFrom exists and is auth + ownership hardened', () => {
  assert.match(chats, /export const truncateFrom = mutation\(/, 'mutation must exist')
  assert.match(
    chats,
    /truncateFrom[\s\S]{0,400}messageId: v\.id\("messages"\)[\s\S]{0,200}inclusive: v\.boolean\(\)/,
    'takes the anchor message id and an inclusive flag'
  )
  const body = chats.slice(chats.indexOf('export const truncateFrom'))
  assert.match(body, /requireUser\(ctx, args\.session\)/, 'session verified inside Convex')
  assert.match(body, /chat\.userId !== user\._id/, 'chat ownership enforced')
  assert.match(
    body,
    /anchor\.chatId !== args\.chatId/,
    'anchor message must belong to the same chat'
  )
  assert.match(body, /ctx\.db\.delete\(/, 'actually deletes rows')
})

test('§13-T2 truncateFrom keeps the survivor tail as the chat preview', () => {
  const body = chats.slice(chats.indexOf('export const truncateFrom'))
  assert.match(body, /lastMessagePreview/, 'preview falls back to the surviving tail')
  assert.match(body, /messageCount: Math\.max\(0,/, 'counters are repaired, never negative')
})

// ==================== /api/chat/send regenerate mode ====================

test('§13-T3 send route accepts regenerate and skips the user-row persist', () => {
  assert.match(sendRoute, /regenerate\?: boolean/, 'body carries the regenerate flag')
  assert.match(
    sendRoute,
    /if \(!message && !regenerate\)/,
    'EMPTY_MESSAGE only applies to non-regenerate sends'
  )
  assert.match(
    sendRoute,
    /if \(!regenerate\) \{[\s\S]{0,300}appendMessage[\s\S]{0,200}role: "user"/,
    'user row persist is skipped for regenerate (prompt already in transcript)'
  )
})

test('§13-T4 regenerate is chat-only, requires a chat, and guards empty threads', () => {
  assert.match(
    sendRoute,
    /const mode: "chat" \| "document" = !regenerate && body\.mode === "document"/,
    'regenerate forces chat mode'
  )
  assert.match(
    sendRoute,
    /if \(regenerate && !chatId\)/,
    'regenerate without a chat id is rejected'
  )
  assert.match(
    sendRoute,
    /if \(regenerate && !history\.some\(\(m\) => m\.role === "user"/,
    'regenerate with no user turn to re-answer fails fast'
  )
})

test('§13-T5 regenerate context is the transcript alone (no extra user turn)', () => {
  assert.match(
    sendRoute,
    /const contextMessages = regenerate\s*\?\s*boundedHistory\(history\)\s*:\s*buildContextMessages\(history, message\)/,
    'regenerate builds context from the transcript; a normal send appends the new prompt'
  )
  assert.match(sendRoute, /function boundedHistory\(/, 'bounded history helper exists')
})

// ==================== Workspace UI ====================

test('§13-T6 edit truncates inclusive then re-answers through the stream', () => {
  assert.match(
    workspace,
    /const submitEdit = useCallback\([\s\S]{0,400}truncateFrom\(\{[\s\S]{0,200}inclusive: true,?\s*\}\);[\s\S]{0,100}await runStream\(\{ text: trimmed \}\)/,
    'edit = truncate(from, inclusive) + runStream(edited text)'
  )
})

test('§13-T7 regenerate truncates after the prompt and re-streams it', () => {
  assert.match(
    workspace,
    /const regenerateResponse = useCallback\([\s\S]{0,600}\.reverse\(\)\.find\(\(m\) => m\.role === "user"\)[\s\S]{0,300}inclusive: false,?\s*\}\);[\s\S]{0,100}await runStream\(\{ text: lastUser\.content, regenerate: true \}\)/,
    'regenerate = truncate(after last user turn) + runStream(regenerate)'
  )
})

test('§13-T8 user rows expose copy + edit; assistant rows expose regenerate', () => {
  assert.match(
    workspace,
    /aria-label="Copy message"[\s\S]{0,800}aria-label="Edit message — the AI will answer the edited text"/,
    'copy and edit icons render below the user message'
  )
  assert.match(workspace, /<Pencil className="size-3\.5"/, 'edit affordance present')
  assert.match(
    workspace,
    /canRegenerate && onRegenerate \? \([\s\S]{0,400}<RotateCcw className="size-3\.5" \/>\s*Regenerate/,
    'regenerate button below the newest response'
  )
  assert.match(
    workspace,
    /isLast=\{i === visibleMessages\.length - 1\}/,
    'regenerate is offered on the newest row only'
  )
  assert.match(
    workspace,
    /canAct=\{!inFlight\}/,
    'actions are suppressed while a stream is in flight'
  )
})

test('§13-T9 optimistic pending bubbles carry no action bar', () => {
  const bubble = workspace.slice(workspace.indexOf('function UserBubble'))
  assert.match(
    bubble,
    /\{!pending \? \(/,
    'the action row is gated on not-pending'
  )
})
