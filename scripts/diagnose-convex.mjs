// =============================================================================
// Diagnostic: probe the deployed Convex backend (happy-otter-123) to pinpoint
// why signup/login fail on production while static code looks correct.
//
// Uses ConvexHttpClient over the standard WebSocket protocol so this works
// regardless of REST endpoint availability.
// =============================================================================
import { ConvexHttpClient } from 'convex/browser'
import { anyApi } from 'convex/server'

const url = process.argv[2] || 'https://happy-otter-123.convex.cloud'
const client = new ConvexHttpClient(url)
const api = anyApi

const stamp = Date.now()
const freshEmail = `probe-${stamp}@example.com`

function report(label, value) {
  console.log(`\n=== ${label} ===`)
  if (value && typeof value === 'object') console.log(JSON.stringify(value, null, 2))
  else console.log(String(value))
}

async function attempt(label, fn) {
  try {
    const result = await fn()
    report(`${label} ✅`, result)
    return result
  } catch (err) {
    console.log(`\n=== ${label} ❌ THREW ===`)
    const props = {}
    let cur = err
    for (let i = 0; cur && i < 4; i++, cur = cur.cause) {
      const level = {}
      for (const k of Object.getOwnPropertyNames(cur)) {
        if (k === 'stack') continue
        try { level[k] = String(cur[k]) } catch { level[k] = '(unstringifiable)' }
      }
      props[`level${i}`] = level
      if (!cur.cause) break
    }
    console.log(JSON.stringify(props, null, 2))
    console.log('message:', err?.message)
    console.log('cause:', err?.cause?.message || '(none)')
    return undefined
  }
}

const results = {}

results.getUserByEmail = await attempt('users:getUserByEmail(probe)', () =>
  client.query(api['users']['getUserByEmail'], { email: 'probe-audit-test@example.com' })
)

results.validateSession = await attempt('auth:validateSession(token:"probe")', () =>
  client.query(api['auth']['validateSession'], { token: 'probe' })
)

results.sessionsValidate = await attempt('sessions:validateSessionToken("probe")', () =>
  client.query(api['sessions']['validateSessionToken'], { token: 'probe' })
)

results.allUsers = await attempt('users:getAllUsers()', () =>
  client.query(api['users']['getAllUsers'], {})
)
if (Array.isArray(results.allUsers)) {
  console.log(`user count: ${results.allUsers.length}`)
  for (const u of results.allUsers.slice(0, 5)) {
    console.log(` - ${u.email} status=${u.status ?? '(none)'} planId=${u.planId ?? '(none)'}`)
  }
}

results.plans = await attempt('plans:getActivePlans()', () =>
  client.query(api['plans']['getActivePlans'], {})
)
if (Array.isArray(results.plans)) console.log(`active plan count: ${results.plans.length}`)

const firstUser = Array.isArray(results.allUsers) ? results.allUsers[0] : null
if (firstUser) {
  results.canGenerateAI = await attempt(
    `subscriptions:canGenerateAI(${firstUser._id})`,
    () => client.query(api['subscriptions']['canGenerateAI'], { userId: firstUser._id })
  )
}

results.signupAction = await attempt(`auth:signup(${freshEmail})`, () =>
  client.action(api['auth']['signup'], {
    name: 'Probe',
    email: freshEmail,
    password: 'probepass123',
  })
)

// If signup created anything, verify:
results.verifyCreatedUser = await attempt('users:getUserByEmail(fresh)', () =>
  client.query(api['users']['getUserByEmail'], { email: freshEmail })
)

console.log('\nDONE')
process.exit(0)
