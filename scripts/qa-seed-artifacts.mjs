// QA seeding: create REAL artifact rows on the dev deployment, linked to
// REAL file bytes stored in the local mock S3 (tests/artifact-e2e/mock-s3.js
// on :9402). Lets the artifacts window / ZIP export / bulk delete be
// verified end-to-end with real rows without the production server secret.
//
// Usage: node scripts/qa-seed-artifacts.mjs <email> [--purge]
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api.js'

const url = process.env.NEXT_PUBLIC_CONVEX_URL || 'https://strong-yak-713.eu-west-1.convex.cloud'
const email = process.argv[2]
const purge = process.argv.includes('--purge')
const MOCK_S3 = 'http://localhost:9402/filo-uploads'

if (!email) {
  console.error('usage: node scripts/qa-seed-artifacts.mjs <email> [--purge]')
  process.exit(1)
}

const client = new ConvexHttpClient(url)
const user = await client.query(api.users.getUserByEmail, { email })
if (!user) {
  console.error('user not found:', email)
  process.exit(1)
}
console.log('user:', user._id)

if (purge) {
  const rows = await client.query('artifacts:listUserArtifacts', { userId: user._id, limit: 500 })
  for (const a of rows) {
    await client.mutation('artifacts:deleteUserArtifact', { artifactId: a._id, userId: user._id })
  }
  console.log('purged', rows.length, 'artifacts')
  process.exit(0)
}

// ---- file contents (valid ZIP/DOCX-ish bytes; content is irrelevant to the
// pipeline paths under test, but sizes must be real and non-trivial) ----
const mkDocx = (label) =>
  Buffer.from(`PK\x03\x04 QA-DOC ${label} — deterministic bytes for dashboard E2E verification. `.repeat(400))

const samples = [
  { title: 'Q3 Investor Update', type: 'document', format: 'DOCX', status: 'completed', name: 'qa-investor-update.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { title: 'Hospital Rollout Status Report', type: 'document', format: 'PDF', status: 'completed', name: 'qa-rollout-report.pdf', mime: 'application/pdf' },
  { title: '12-Month Startup Budget', type: 'spreadsheet', format: 'XLSX', status: 'completed', name: 'qa-startup-budget.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { title: 'Seed Pitch Deck', type: 'presentation', format: 'PPTX', status: 'completed', name: 'qa-seed-pitch.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  { title: 'Broken Job — should stay deletable', type: 'document', format: 'DOCX', status: 'error', name: null, mime: null },
]

for (const s of samples) {
  let fileId
  if (s.name) {
    const bytes = mkDocx(s.title)
    const r2Key = `artifacts/qa/${s.name}`
    const put = await fetch(`${MOCK_S3}/${r2Key}`, { method: 'PUT', body: bytes })
    if (!put.ok) {
      console.error('mock S3 PUT failed:', put.status, r2Key)
      process.exit(1)
    }
    fileId = await client.mutation(api.files.registerFile, {
      userId: user._id,
      originalName: s.name,
      mimeType: s.mime,
      size: bytes.length,
      r2Key,
    })
  }
  const res = await client.mutation('artifacts:saveArtifactRecord', {
    userId: user._id,
    title: s.title,
    type: s.type,
    format: s.format,
    prompt: `QA seed for dashboard verification — ${s.title}`,
    status: s.status,
  })
  if (!res?.saved) {
    console.error('saveArtifactRecord failed for', s.title, res)
    process.exit(1)
  }
  if (fileId) {
    await client.mutation('artifacts:linkFile', {
      artifactId: res.dbId,
      userId: user._id,
      fileId,
    })
  }
  console.log('seeded:', s.title, '→', res.dbId, s.name ? `(file ${fileId})` : '(no file)')
}
console.log('done')
