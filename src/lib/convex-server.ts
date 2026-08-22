// =============================================================================
// Convex Server Client - For API Routes (Server-Side Only)
// =============================================================================
// This is used by Next.js API routes to call Convex functions
// Avoids circular dependency issues by using HTTP client
// =============================================================================

import { ConvexHttpClient } from 'convex/server'

let convexClient: ConvexHttpClient | null = null

/**
 * Get or create Convex HTTP client instance
 * Must be called with CONVEX_URL from environment
 */
export function getConvexClient(): ConvexHttpClient {
  if (!convexClient) {
    const convexUrl = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL
    
    if (!convexUrl) {
      throw new Error('CONVEX_URL environment variable is not set')
    }
    
    convexClient = new ConvexHttpClient(convexUrl)
  }
  
  return convexClient
}

/**
 * Type-safe wrapper for calling Convex queries
 */
export async function callConvexQuery<
  Args extends Record<string, any>,
  Result
>(
  functionReference: string,
  args: Args
): Promise<Result> {
  const client = getConvexClient()
  return client.query(functionReference as any, args)
}

/**
 * Type-safe wrapper for calling Convex mutations
 */
export async function callConvexMutation<
  Args extends Record<string, any>,
  Result
>(
  functionReference: string,
  args: Args
): Promise<Result> {
  const client = getConvexClient()
  return client.mutation(functionReference as any, args)
}

/**
 * Type-safe wrapper for calling Convex actions
 */
export async function callConvexAction<
  Args extends Record<string, any>,
  Result
>(
  functionReference: string,
  args: Args
): Promise<Result> {
  const client = getConvexClient()
  return client.action(functionReference as any, args)
}
