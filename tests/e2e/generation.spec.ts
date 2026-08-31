import { test, expect, type Page } from '@playwright/test'

// =============================================================================
// AI Generation E2E — the REBUILT chat-centric flow:
//   /chat auth gate → chat streaming (SSE) → Document Mode enqueue (real
//   payload contract) → quota + provider errors surfaced honestly.
// The Next.js server + UI are fully real; only the Convex/AI outcomes are
// simulated at the network boundary (see playwright.config.ts header).
// =============================================================================

const PROMPT =
  'Create a professional business proposal for a digital marketing agency targeting small businesses'

/** Build an SSE body string from explicit frames. */
function sseBody(frames: Array<{ data: unknown }>): string {
  return frames.map((f) => `data: ${JSON.stringify(f.data)}\n\n`).join('')
}

const SSE_HEADERS = { 'Content-Type': 'text/event-stream' }

async function seedLogin(page: Page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('e2e_session_seeded')) return
    sessionStorage.setItem('e2e_session_seeded', '1')
    localStorage.setItem(
      'filo_session',
      JSON.stringify({
        user: {
          id: 'u_gen_1',
          name: 'Gen Tester',
          email: 'gen@example.com',
          status: 'active',
        },
        token: 'gen.token.sig',
      })
    )
  })
}

test.describe('AI generation flow', () => {
  test.beforeEach(async ({ page }) => {
    // The Next.js DEV overlay (dev-server only) intercepts pointer events;
    // remove it. (See auth.spec.ts for the full rationale.)
    await page.addInitScript(() => {
      try {
        console.error = () => {}
        console.warn = () => {}
        const css = document.createElement('style')
        css.textContent = 'nextjs-portal{display:none!important}'
        document.documentElement.appendChild(css)
        new MutationObserver(() => {
          document.querySelectorAll('nextjs-portal').forEach((el) => el.remove())
        }).observe(document.documentElement, { childList: true, subtree: true })
      } catch {
        /* noop */
      }
    })
  })

  test('generation requires login when logged out (real client gate)', async ({
    page,
  }) => {
    await page.goto('/chat')
    // The workspace shell redirects unauthenticated visitors to the login
    // page, preserving the destination.
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible({
      timeout: 15_000,
    })
    expect(page.url()).toContain('next=%2Fchat')
  })

  test('chat mode sends the real session + streams without error', async ({
    page,
  }) => {
    await seedLogin(page)

    let sendPayload: Record<string, unknown> | undefined
    let authHeader: string | undefined
    await page.route('**/api/chat/send', async (route) => {
      sendPayload = route.request().postDataJSON() as Record<string, unknown>
      authHeader = (await route.request().headerValue('authorization')) ?? undefined
      // Realistic latency so the optimistic state is observable.
      await new Promise((r) => setTimeout(r, 1200))
      await route.fulfill({
        status: 200,
        headers: SSE_HEADERS,
        body: sseBody([
          { data: { type: 'meta', chatId: 'chat_e2e_1', mode: 'chat' } },
          { data: { type: 'delta', text: 'Solid-state batteries ' } },
          { data: { type: 'delta', text: 'replace liquid electrolytes with a solid layer.' } },
          { data: { type: 'done', chatId: 'chat_e2e_1' } },
        ]),
      })
    })

    await page.goto('/chat')
    const composer = page.getByRole('textbox', { name: 'Message' })
    await expect(composer).toBeVisible({ timeout: 15_000 })
    await composer.fill('Research the state of solid-state batteries')

    // The optimistic user turn appears IMMEDIATELY (before any response).
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(
      page.getByText('Research the state of solid-state batteries', { exact: true })
    ).toBeVisible()

    // The stream completed: no error banner, composer usable again.
    await expect(page.getByTestId('send-error')).toHaveCount(0, {
      timeout: 20_000,
    })
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeEnabled()

    // The request carried the real session token and the chat payload.
    expect(sendPayload?.message).toContain('solid-state batteries')
    expect(sendPayload?.mode).toBe('chat')
    expect(authHeader).toBe('Bearer gen.token.sig')
  })

  test('document mode sends format + mode to the enqueue endpoint', async ({
    page,
  }) => {
    await seedLogin(page)

    let sendPayload: Record<string, unknown> | undefined
    await page.route('**/api/chat/send', async (route) => {
      sendPayload = route.request().postDataJSON() as Record<string, unknown>
      await new Promise((r) => setTimeout(r, 1200))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { chatId: 'chat_e2e_doc', jobId: 'job_e2e_1', status: 'queued', artifactType: 'document', outputFormat: 'docx' },
        }),
      })
    })

    await page.goto('/chat')
    const composer = page.getByRole('textbox', { name: 'Message' })
    await expect(composer).toBeVisible({ timeout: 15_000 })

    // Switch to Document mode and pick the format.
    await page.getByRole('tab', { name: /Document/ }).click()
    await page.getByRole('button', { name: /Output format: Word/ }).click()
    await page.getByRole('menuitem', { name: /Excel/ }).click()
    await composer.fill(PROMPT)
    await page.getByRole('button', { name: 'Send message' }).click()

    // The optimistic user turn shows immediately.
    await expect(
      page.getByText('Create a professional business proposal for a digital marketing agency targeting small businesses')
    ).toBeVisible()

    // The payload contract: document mode with the chosen format.
    expect(sendPayload?.mode).toBe('document')
    expect(sendPayload?.artifactType).toBe('spreadsheet')
    expect(sendPayload?.outputFormat).toBe('xlsx')
  })

  test('limit-reached generation surfaces quota error', async ({ page }) => {
    await seedLogin(page)

    await page.route('**/api/chat/send', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: 'Monthly generation limit reached (500/500). Your limit resets next month.',
          code: 'LIMIT_REACHED',
          data: { remaining: 0, limit: 500 },
        }),
      })
    )

    await page.goto('/chat')
    const composer = page.getByRole('textbox', { name: 'Message' })
    await expect(composer).toBeVisible({ timeout: 15_000 })
    await page.getByRole('tab', { name: /Document/ }).click()
    await composer.fill(PROMPT)
    await page.getByRole('button', { name: 'Send message' }).click()

    await expect(page.getByText(/limit reached/i).first()).toBeVisible({
      timeout: 20_000,
    })
    // The specific send-error banner carried the quota message.
    await expect(page.getByTestId('send-error')).toContainText(/limit reached/i)
  })

  test('chat provider failure surfaces an honest error, transcript intact', async ({
    page,
  }) => {
    await seedLogin(page)

    await page.route('**/api/chat/send', (route) =>
      route.fulfill({
        status: 200,
        headers: SSE_HEADERS,
        body: sseBody([
          { data: { type: 'meta', chatId: 'chat_e2e_err', mode: 'chat' } },
          { data: { type: 'error', error: 'The AI service is temporarily unavailable. Please try again.' } },
        ]),
      })
    )

    await page.goto('/chat')
    const composer = page.getByRole('textbox', { name: 'Message' })
    await expect(composer).toBeVisible({ timeout: 15_000 })
    await composer.fill('Say something')
    await page.getByRole('button', { name: 'Send message' }).click()

    // The optimistic message stays, and the failure is surfaced — not swallowed.
    await expect(page.getByText(/AI service is temporarily unavailable/i).first()).toBeVisible({
      timeout: 20_000,
    })
    // The composer is usable again (no dead-end state).
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeEnabled()
  })
})
