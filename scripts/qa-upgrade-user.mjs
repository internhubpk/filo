// One-off QA helper: upgrade the probe user on the dev deployment so the
// dashboard / artifacts window can be verified end-to-end with REAL data.
// NOTE: the updateUser token-guard lands with the next `convex deploy`;
// this uses the currently-deployed (pre-fix) function.
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api.js'

const url = process.env.NEXT_PUBLIC_CONVEX_URL || 'https://strong-yak-713.eu-west-1.convex.cloud'
const email = process.argv[2]
const planTier = process.argv[3] || 'pro'

if (!email) {
  console.error('usage: node scripts/qa-upgrade-user.mjs <email> [tier]')
  process.exit(1)
}

const client = new ConvexHttpClient(url)
const plans = await client.query(api.plans.getAllPlans, {})
const plan = plans.find((p) => p.tier === planTier) || plans.find((p) => p.tier !== 'free')
if (!plan) {
  console.error('no paid plan found; plans:', plans.map((p) => ({ id: p._id, tier: p.tier, name: p.name })))
  process.exit(1)
}

// find user by email
const user = await client.query(api.users.getUserByEmail, { email }).catch(() => null)
if (!user) {
  console.error('user not found via getUserByEmail')
  process.exit(1)
}

await client.mutation(api.users.updateUser, { userId: user._id, planId: plan._id })
console.log('upgraded', email, '→ plan', plan.name, plan.tier, 'user', user._id)
