// =============================================================================
// FILO Admin User Seeder
// =============================================================================
// Creates an admin user account that can:
//   1. Log in via the normal user auth flow (email/password)
//   2. Access all app features without activation checks (role="admin")
//   3. Access the /admin dashboard via the separate admin auth flow
//
// Usage:
//   CONVEX_URL=https://your-project.convex.cloud npx tsx scripts/seed-admin.ts
//
// The admin user credentials are configured via environment variables:
//   ADMIN_USER_EMAIL    (default: admin@filo.pk)
//   ADMIN_USER_PASSWORD (default: FiloAdmin@2024)
//   ADMIN_USER_NAME    (default: Filo Admin)
// =============================================================================

import { api } from "../convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL;

if (!CONVEX_URL) {
  throw new Error(
    "CONVEX_URL is not set. Set NEXT_PUBLIC_CONVEX_URL or CONVEX_URL."
  );
}

const ADMIN_EMAIL = process.env.ADMIN_USER_EMAIL || "admin@filo.pk";
const ADMIN_PASSWORD = process.env.ADMIN_USER_PASSWORD || "FiloAdmin@2024";
const ADMIN_NAME = process.env.ADMIN_USER_NAME || "Filo Admin";

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + "filo_salt_2024_secret");
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function seedAdmin() {
  console.log("\n========================================");
  console.log("  FILO Admin User Seeder");
  console.log("========================================\n");

  const convex = new ConvexHttpClient(CONVEX_URL);
  const passwordHash = await hashPassword(ADMIN_PASSWORD);

  console.log(`[SEED] Creating admin user: ${ADMIN_EMAIL}`);
  console.log(`[SEED] Name: ${ADMIN_NAME}`);
  console.log(`[SEED] Convex URL: ${CONVEX_URL}\n`);

  try {
    const user = await convex.mutation(api.users.createAdminUser, {
      name: ADMIN_NAME,
      email: ADMIN_EMAIL,
      passwordHash,
    });

    console.log("\n[OK] Admin user created/updated successfully!");
    console.log(`
  ========================================
  ADMIN CREDENTIALS
  ========================================
  Email:    ${ADMIN_EMAIL}
  Password: ${ADMIN_PASSWORD}
  Role:     admin
  Status:   active
  ========================================

  You can now:

  1. LOG INTO THE APP:
     Use the email/password above at /api/auth/login
     → Full access to all features, no activation needed

  2. ACCESS THE ADMIN DASHBOARD:
     Go to /admin/login
     → Use ADMIN_USERNAME/ADMIN_PASSWORD from your .env
     → Manage users, verify payments, view analytics

  NOTE: These are TWO SEPARATE login systems:
     - App login: email + password (for testing the app)
     - Admin panel: username + password (for managing users)
  ========================================
`);
  } catch (error) {
    console.error("[FAIL] Failed to create admin user:", error);
    process.exit(1);
  }
}

seedAdmin().catch(console.error);
