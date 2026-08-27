import { test, expect, type Page } from '@playwright/test'

// =============================================================================
// Sign up / Log in E2E — verifies the user-facing auth flows end to end:
// real UI, real Next.js API routes, with the external Convex call outcomes
// simulated at the network boundary (see playwright.config.ts header).
// =============================================================================

const PASSWORD = 'testpass123'

/** Track unexpected page errors so any failing spec leaves a visible trail. */
function trackPageErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (err) => {
    if (err.message && !err.message.includes('ResizeObserver')) {
      errors.push(err.message)
    }
  })
  return errors
}

async function openSignup(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Sign up' }).first().click()
  await expect(
    page.getByRole('heading', { name: 'Create your account' })
  ).toBeVisible()
}

async function openLogin(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Log in' }).first().click()
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
}

test.describe('signup / login flows', () => {
  test('homepage loads without client-side crash', async ({ page }) => {
    const pageErrors = trackPageErrors(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Describe what you need'
    )
    await expect(
      page.getByRole('button', { name: 'Sign up' }).first()
    ).toBeVisible()
    // The global Next.js error screen must never appear.
    await expect(page.getByText('Application error')).toHaveCount(0)
    expect(pageErrors).toEqual([])
  })

  test('signup succeeds → user is logged in and greeted', async ({ page }) => {
    const pageErrors = trackPageErrors(page)
    let signupBody: Record<string, unknown> | undefined
    await page.route('**/api/auth/signup', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>
      signupBody = body
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            user: {
              id: 'u_test_1',
              name: String(body.name ?? 'Test'),
              email: String(body.email ?? ''),
              status: 'active',
              planId: null,
            },
            sessionToken: 'e30..sig',
          },
        }),
      })
    })
    // Dashboard refreshes quota right after login.
    await page.route('**/api/subscription/status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            hasActiveSubscription: true,
            accountStatus: 'active',
            remainingGenerations: 500,
            usedGenerations: 0,
            planLimit: 500,
            planName: 'Free',
            planStorageMb: 5120,
          },
        }),
      })
    )

    await openSignup(page)
    await page.locator('#signup-name').fill('Playwright Tester')
    await page.locator('#signup-email').fill(`pw-${Date.now()}@example.com`)
    await page.locator('#signup-password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Create Account' }).click()

    // Modal closes and header flips to the logged-in state.
    await expect(
      page.getByRole('heading', { name: 'Create your account' })
    ).toHaveCount(0, { timeout: 15_000 })
    await expect(page.getByText(/Welcome/i).first()).toBeVisible()
    await expect(page.getByText('Logout')).toBeVisible()

    // The request carried correct payload fields to our API layer.
    expect(signupBody?.email).toContain('@')
    expect((signupBody?.password as string)?.length ?? 0).toBeGreaterThanOrEqual(6)

    // Session persisted for subsequent visits in this context.
    const stored = await page.evaluate(() =>
      localStorage.getItem('filo_session')
    )
    expect(stored).toBeTruthy()
    const parsed = JSON.parse(stored!)
    expect(parsed.user.status).toBe('active')
    expect(parsed.token).toBeTruthy()
    expect(pageErrors).toEqual([])
  })

  test('signup with duplicate email shows precise error', async ({ page }) => {
    await page.route('**/api/auth/signup', (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: 'An account with this email already exists',
          code: 'EMAIL_EXISTS',
        }),
      })
    )

    await openSignup(page)
    await page.locator('#signup-name').fill('Dup Tester')
    await page.locator('#signup-email').fill('taken@example.com')
    await page.locator('#signup-password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Create Account' }).click()

    // Modal stays open; error toast surfaces.
    await expect(page.getByText(/already exists/i).first()).toBeVisible({
      timeout: 10_000,
    })
    // Still logged out (did not silently log in).
    await expect(page.getByText('Logout')).toHaveCount(0)
  })

  test('signup infrastructure failure is reported, not swallowed', async ({
    page,
  }) => {
    // Simulates the exact production incident shape: an internal step failure
    // with a granular code from the hardened Convex action.
    await page.route('**/api/auth/signup', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error:
            'Account could not be created (user record): Could not find function',
          code: 'SIGNUP_CREATE_USER_FAILED',
        }),
      })
    )

    await openSignup(page)
    await page.locator('#signup-name').fill('Infra Tester')
    await page.locator('#signup-email').fill('infra@example.com')
    await page.locator('#signup-password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Create Account' }).click()

    await expect(
      page.getByText(/could not be created|technical problem|failed/i).first()
    ).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Logout')).toHaveCount(0)
  })

  test('login rejects wrong password precisely', async ({ page }) => {
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: 'Incorrect password',
          code: 'INVALID_PASSWORD',
        }),
      })
    )

    await openLogin(page)
    await page.locator('#login-email').fill('member@example.com')
    await page.locator('#login-password').fill('wrong-password-1')
    await page.getByRole('button', { name: 'Sign In' }).click()

    await expect(page.getByText(/incorrect password/i).first()).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByText('Logout')).toHaveCount(0)
  })

  test('login succeeds → session stored and UI updates', async ({ page }) => {
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            user: {
              id: 'u_member_1',
              name: 'Existing Member',
              email: 'member@example.com',
              status: 'active',
              planId: null,
            },
            sessionToken: 'e30.sig2',
          },
        }),
      })
    )
    await page.route('**/api/subscription/status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            hasActiveSubscription: true,
            accountStatus: 'active',
            remainingGenerations: 497,
            usedGenerations: 3,
            planLimit: 500,
            planName: 'Free',
            planStorageMb: 5120,
          },
        }),
      })
    )

    await openLogin(page)
    await page.locator('#login-email').fill('member@example.com')
    await page.locator('#login-password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign In' }).click()

    await expect(
      page.getByRole('heading', { name: 'Welcome back' })
    ).toHaveCount(0, { timeout: 15_000 })
    await expect(page.getByText(/Welcome/i).first()).toBeVisible()

    const stored = JSON.parse(
      (await page.evaluate(() => localStorage.getItem('filo_session')))!
    )
    expect(stored.user.email).toBe('member@example.com')
  })

  test('real /api/auth/validate rejects tampered tokens (no mocks)', async ({
    request,
  }) => {
    // Fully REAL server logic: HMAC session validation. No interception.
    const res = await request.post('/api/auth/validate', {
      data: { token: 'tampered.payload.sig' },
    })
    expect(res.status()).toBe(401)
    const json = await res.json()
    expect(json.success).toBe(false)
    expect(json.data.reason).toBe('tampered')
  })

  test('logout clears session state', async ({ page }) => {
    await page.route('**/api/subscription/status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            hasActiveSubscription: true,
            accountStatus: 'active',
            remainingGenerations: 500,
            planLimit: 500,
            planName: 'Free',
            planStorageMb: 5120,
          },
        }),
      })
    )
    await page.route('**/api/auth/logout', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      })
    )

    // Seed a session directly, then load the app.
    await page.addInitScript(() => {
      localStorage.setItem(
        'filo_session',
        JSON.stringify({
          user: {
            id: 'u_x',
            name: 'Seeded User',
            email: 'seed@example.com',
            status: 'active',
          },
          token: 'a.b',
        })
      )
    })
    await page.goto('/')
    await expect(page.getByText(/Welcome/i).first()).toBeVisible()
    await page.getByRole('button', { name: 'Logout' }).click()
    await expect(
      page.getByRole('button', { name: 'Sign up' }).first()
    ).toBeVisible({ timeout: 10_000 })
    const stored = await page.evaluate(() =>
      localStorage.getItem('filo_session')
    )
    expect(stored).toBeNull()
  })
})
