// Verify the pure-JS SHA-256 in convex/auth.ts produces byte-identical output
// to Node's built-in crypto (which itself matches WebCrypto digest).
import { createHash } from 'crypto'
import { sha256Hex, } from '../convex/lib/sha256.ts'

const PASSWORD_SALT = 'filo_salt_2024_secret'

const vectors = [
  '',
  'abc',
  'testpass123',
  'filo_salt_2024_secret',
  'testpass123' + PASSWORD_SALT,
  'Ünïcodé-Password-🔐-with-emoji',
  'x'.repeat(1000),
  JSON.stringify({ nested: ['arrays', { of: 'stuff' }], n: 42 }),
]

let allOk = true
for (const v of vectors) {
  const expected = createHash('sha256').update(v, 'utf8').digest('hex')
  const actual = sha256Hex(v)
  const ok = expected === actual
  if (!ok) allOk = false
  console.log(
    `${ok ? 'PASS' : 'FAIL'} len=${v.length} ${actual.slice(0, 16)}…`
  )
}

// Also emulate hashPassword/verifyPassword round-trip
const pw = 'MyS3cret!Password'
const h1 = sha256Hex(pw + PASSWORD_SALT)
const h2 = sha256Hex(pw + PASSWORD_SALT)
console.log('round-trip stable:', h1 === h2)
// Old WebCrypto path reference
const nodeRef = createHash('sha256').update(pw + PASSWORD_SALT).digest('hex')
console.log('matches old hashing scheme:', h1 === nodeRef)

if (!allOk) process.exit(1)
console.log('ALL VECTORS PASS')
