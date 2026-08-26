// =============================================================================
// POST /api/auth/signup
// =============================================================================
// Proxy route that handles signup via Convex auth function
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { api } from '@convex/_generated/api'

const IS_DEV = process.env.NODE_ENV === 'development'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, email, password } = body

    // Validate required fields
    if (!name || !email || !password) {
      return NextResponse.json(
        { success: false, error: 'All fields are required (name, email, password)', code: 'MISSING_FIELDS' },
        { status: 400 }
      )
    }

    // Validate name
    if (name.trim().length < 2) {
      return NextResponse.json(
        { success: false, error: 'Name must be at least 2 characters', code: 'INVALID_NAME' },
        { status: 400 }
      )
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { success: false, error: 'Invalid email format', code: 'INVALID_EMAIL' },
        { status: 400 }
      )
    }

    // Validate password
    if (password.length < 6) {
      return NextResponse.json(
        { success: false, error: 'Password must be at least 6 characters', code: 'PASSWORD_TOO_SHORT' },
        { status: 400 }
      )
    }

    const normalizedEmail = email.toLowerCase().trim()
    console.log('[API /auth/signup] Creating account for:', normalizedEmail)

    // ---- DEV MODE: Bypass Convex, create local session ----
    if (IS_DEV || !process.env.NEXT_PUBLIC_CONVEX_URL) {
      console.log('[API /auth/signup] DEV MODE: Skipping Convex auth')
      
      const array = new Uint8Array(32)
      crypto.getRandomValues(array)
      const sessionToken = Array.from(array)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')

      return NextResponse.json({
        success: true,
        data: {
          user: {
            id: 'dev-user-' + Date.now(),
            name: name.trim(),
            email: normalizedEmail,
          },
          sessionToken,
        }
      })
    }

    // ---- PRODUCTION: Use Convex ----
    const { getConvexClient } = await import('@/lib/convex-server')
    const convex = getConvexClient()
    
    try {
      // Step 1: Check if user already exists
      console.log('[API /auth/signup] Step 1: Checking if user exists...')
      
      let existingUser
      try {
        existingUser = await convex.query(api.users.getUserByEmail, {
          email: normalizedEmail,
        })
      } catch (queryError) {
        console.error('[API /auth/signup] Query failed:', queryError)
        // Continue - might be a new user
      }

      if (existingUser) {
        console.log('[API /auth/signup] User already exists:', existingUser._id)
        return NextResponse.json(
          { 
            success: false, 
            error: 'An account with this email already exists',
            code: 'EMAIL_EXISTS' 
          },
          { status: 409 }
        )
      }

      // Step 2: Create the user directly (bypass complex signup action for now)
      console.log('[API /auth/signup] Step 2: Creating user...')
      
      // Simple password hash (same as Convex auth.ts uses)
      const encoder = new TextEncoder()
      const data = encoder.encode(password + "filo_salt_2024_secret")
      const hashBuffer = await crypto.subtle.digest('SHA-256', data)
      const passwordHash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")

      let userId
      try {
        userId = await convex.mutation(api.users.createUserWithPassword, {
          name: name.trim(),
          email: normalizedEmail,
          passwordHash,
        })
        console.log('[API /auth/signup] User created with ID:', userId)
      } catch (mutationError) {
        console.error('[API /auth/signup] createUserWithPassword failed:', mutationError)
        
        // Try alternative mutation name
        try {
          userId = await convex.mutation(api.users.create, {
            name: name.trim(),
            email: normalizedEmail,
          })
          console.log('[API /auth/signup] User created via create() with ID:', userId)
        } catch (createError) {
          console.error('[API /auth/signup] Both mutations failed:', createError)
          return NextResponse.json(
            { 
              success: false, 
              error: 'Failed to create user account',
              code: 'USER_CREATION_FAILED',
              details: String(mutationError)
            },
            { status: 500 }
          )
        }
      }

      // Step 3: Generate session token
      console.log('[API /auth/signup] Step 3: Creating session...')
      
      const array = new Uint8Array(32)
      crypto.getRandomValues(array)
      const sessionToken = Array.from(array)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")

      // Step 4: Try to create session (optional - don't fail if this doesn't work)
      let sessionCreated = false
      try {
        await convex.mutation(api.sessions.createSession, {
          userId,
          token: sessionToken,
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
        })
        sessionCreated = true
        console.log('[API /auth/signup] Session created successfully')
      } catch (sessionError) {
        console.warn('[API /auth/signup] Session creation failed (non-fatal):', sessionError)
        // Continue without session - user can login manually
      }

      // Get the created user data
      let userData
      try {
        userData = await convex.query(api.users.getUser, { userId })
      } catch (getUserError) {
        // Use basic user data from input
        userData = {
          id: userId,
          name: name.trim(),
          email: normalizedEmail,
        }
      }

      console.log('[API /auth/signup] ✅ Account created successfully!')

      return NextResponse.json({
        success: true,
        data: {
          user: userData || {
            id: userId,
            name: name.trim(),
            email: normalizedEmail,
          },
          sessionToken: sessionCreated ? sessionToken : undefined,
          warning: !sessionCreated ? 'Account created but auto-login may not work. Please login manually.' : undefined,
        }
      })

    } catch (convexError) {
      console.error('[API /auth/signup] Convex operation failed:', convexError)
      
      return NextResponse.json(
        { 
          success: false, 
          error: `Backend error: ${convexError instanceof Error ? convexError.message : 'Unknown error'}`,
          code: 'CONVEX_ERROR',
          details: String(convexError)
        },
        { status: 500 }
      )
    }

  } catch (error) {
    console.error('[API /auth/signup] Route error:', error)
    
    return NextResponse.json(
      { 
        success: false, 
        error: 'Internal server error during signup',
        code: 'INTERNAL_ERROR',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    )
  }
}
