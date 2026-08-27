// =============================================================================
// FILO — Database Seed Script (idempotent)
// =============================================================================
// Seeds the default pricing plans into the Convex `plans` table.
//
// WHY THIS EXISTS:
//   A fresh deployment ships with an EMPTY plans table. The pricing page and
//   admin panel read plans from the database, and quota enforcement reads
//   `plans.maxAiGenerations`. An empty table makes those surfaces fall back
//   to hard-coded defaults (or show nothing at all).
//
// USAGE:
//   npx convex run seed:seedDefaultPlans
//
// IDEMPOTENT:
//   Safe to run repeatedly — each plan is matched by name; existing plans are
//   updated in place, missing ones are inserted. Nothing is duplicated.
// =============================================================================

import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

interface PlanSeed {
  name: string;
  tier: string;
  description: string;
  priceMonthly: number; // PKR
  priceYearly: number; // PKR
  features: string[];
  limitations: string[];
  popular: boolean;
  maxAiGenerations: number;
  maxStorageMb: number;
  maxTeamMembers?: number;
  icon: string;
  order: number;
  contactSales?: boolean;
  safepayPlanIdMonthly?: string;
  safepayPlanIdYearly?: string;
}

// Values mirror the pricing page. `safepayPlanId*` values must match
// subscription plans created in the Safepay merchant SANDBOX dashboard —
// set them via `npx convex env update` or the dashboard, or by editing here
// and re-running the seed. Checkout refuses a plan whose Safepay plan id is
// missing (fail-closed: no real charge can be attempted for a misconfigured
// plan).
const DEFAULT_PLANS: PlanSeed[] = [
  {
    name: "Free",
    tier: "free",
    description: "For trying Filo and light personal use",
    priceMonthly: 0,
    priceYearly: 0,
    features: [
      "25 AI generations per month",
      "200MB cloud storage",
      "DOCX, PDF and CSV export",
      "Community support",
    ],
    limitations: ["Watermark on some exports", "No custom brand profiles"],
    popular: false,
    maxAiGenerations: 25,
    maxStorageMb: 200,
    icon: "Sparkles",
    order: 0,
  },
  {
    name: "Pro",
    tier: "pro",
    description: "For individual professionals and power users",
    priceMonthly: 1900,
    priceYearly: 19000,
    features: [
      "500 AI generations per month",
      "5GB cloud storage",
      "All document types (DOCX, PDF, XLSX, PPTX)",
      "Priority processing queue",
      "Custom brand profiles",
      "Advanced export formats",
      "Email support (48hr response)",
      "No watermarks on exports",
    ],
    limitations: ["Single user account", "Standard API access"],
    popular: true,
    maxAiGenerations: 500,
    maxStorageMb: 5120,
    icon: "Crown",
    order: 1,
    safepayPlanIdMonthly: "pro-monthly",
    safepayPlanIdYearly: "pro-yearly",
  },
  {
    name: "Team",
    tier: "team",
    description: "For small teams and growing businesses",
    priceMonthly: 4900,
    priceYearly: 49000,
    features: [
      "2,500 AI generations per month (shared)",
      "25GB cloud storage (shared)",
      "Up to 5 team members",
      "All document types + custom templates",
      "Team collaboration features",
      "Admin dashboard & controls",
      "Priority email support (24hr response)",
      "API access with higher rate limits",
      "Shared brand profiles & assets",
      "Usage analytics & reporting",
    ],
    limitations: [],
    popular: false,
    maxAiGenerations: 2500,
    maxStorageMb: 25600,
    maxTeamMembers: 5,
    icon: "Users",
    order: 2,
    safepayPlanIdMonthly: "team-monthly",
    safepayPlanIdYearly: "team-yearly",
  },
  {
    name: "Department",
    tier: "department",
    description: "For departments and large organizations",
    priceMonthly: 0,
    priceYearly: 0,
    features: [
      "Unlimited AI generations",
      "Unlimited cloud storage",
      "Unlimited team members",
      "SSO & advanced security (SAML, OAuth)",
      "Dedicated account manager",
      "Custom integrations & API",
      "SLA guarantee (99.9% uptime)",
      "Priority phone & chat support",
    ],
    limitations: [],
    popular: false,
    maxAiGenerations: 1000000,
    maxStorageMb: 1000000,
    maxTeamMembers: 1000000,
    icon: "Building2",
    order: 3,
    contactSales: true,
  },
];

export const seedDefaultPlans = internalMutation({
  args: {},
  returns: v.object({
    inserted: v.array(v.string()),
    updated: v.array(v.string()),
  }),
  handler: async (ctx) => {
    const inserted: string[] = [];
    const updated: string[] = [];

    for (const plan of DEFAULT_PLANS) {
      const existing = await ctx.db
        .query("plans")
        .withIndex("by_order", (q) => q.eq("order", plan.order))
        .collect();

      const match = existing.find((p) => p.name === plan.name);

      if (match) {
        await ctx.db.patch(match._id, {
          description: plan.description,
          priceMonthly: plan.priceMonthly,
          priceYearly: plan.priceYearly,
          currency: "PKR",
          features: plan.features,
          limitations: plan.limitations,
          popular: plan.popular,
          active: true,
          maxAiGenerations: plan.maxAiGenerations,
          maxStorageMb: plan.maxStorageMb,
          maxTeamMembers: plan.maxTeamMembers,
          icon: plan.icon,
          order: plan.order,
          contactSales: plan.contactSales,
          tier: plan.tier,
          safepayPlanIdMonthly: plan.safepayPlanIdMonthly,
          safepayPlanIdYearly: plan.safepayPlanIdYearly,
          updatedAt: Date.now(),
        });
        updated.push(plan.name);
      } else {
        await ctx.db.insert("plans", {
          name: plan.name,
          description: plan.description,
          priceMonthly: plan.priceMonthly,
          priceYearly: plan.priceYearly,
          currency: "PKR",
          features: plan.features,
          limitations: plan.limitations,
          popular: plan.popular,
          active: true,
          maxAiGenerations: plan.maxAiGenerations,
          maxStorageMb: plan.maxStorageMb,
          maxTeamMembers: plan.maxTeamMembers,
          icon: plan.icon,
          order: plan.order,
          contactSales: plan.contactSales,
          tier: plan.tier,
          safepayPlanIdMonthly: plan.safepayPlanIdMonthly,
          safepayPlanIdYearly: plan.safepayPlanIdYearly,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        inserted.push(plan.name);
      }
    }

    console.log(
      `[SEED] plans: inserted=[${inserted.join(", ")}] updated=[${updated.join(", ")}]`
    );
    return { inserted, updated };
  },
});
