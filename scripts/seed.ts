import { api } from "../convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";

// Load CONVEX_URL from .env.local or environment
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL;

if (!CONVEX_URL) {
  throw new Error(
    "CONVEX_URL is not set. Make sure NEXT_PUBLIC_CONVEX_URL is in your .env.local"
  );
}

const convex = new ConvexHttpClient(CONVEX_URL);

async function seed() {
  console.log("🌱 Seeding Convex database with initial data...");

  // Clear existing plans (optional - comment out if you want to keep existing)
  // const existingPlans = await convex.query(api.plans.getActivePlans);
  // for (const plan of existingPlans) {
  //   await convex.mutation(api.admin.deletePlan, { planId: plan._id });
  // }

  // Create plans
  const plans = [
    {
      name: "Free",
      description: "Perfect for trying Filo",
      priceMonthly: 0,
      priceYearly: 0,
      features: [
        "50 AI generations per month",
        "100MB cloud storage",
        "Basic document types",
        "Standard exports (DOCX, PDF)",
        "Community support",
      ],
      limitations: [
        "Limited AI models",
        "No brand profiles",
        "Watermark on exports",
        "Standard processing priority",
      ],
      popular: false,
      active: true,
      maxAiGenerations: 50,
      maxStorageMb: 100,
      icon: "Zap",
      order: 1,
    },
    {
      name: "Pro Monthly",
      description: "For professionals and power users",
      priceMonthly: 190,
      priceYearly: 0,
      features: [
        "500 AI generations per month",
        "5GB cloud storage",
        "All document types",
        "Priority processing",
        "Brand profiles",
        "Advanced exports (XLSX, PPTX, CSV)",
        "Email support",
        "No watermarks",
      ],
      limitations: [],
      popular: true,
      active: true,
      maxAiGenerations: 500,
      maxStorageMb: 5120,
      icon: "Crown",
      order: 2,
    },
    {
      name: "Pro Yearly",
      description: "Best value - save 2 months",
      priceMonthly: 0,
      priceYearly: 1900,
      features: [
        "600 AI generations per month",
        "5GB cloud storage",
        "All document types",
        "Priority processing",
        "Brand profiles",
        "Advanced exports",
        "Priority email support",
        "No watermarks",
        "Save ~₨3,800 vs monthly",
      ],
      limitations: [],
      popular: false,
      active: true,
      maxAiGenerations: 600,
      maxStorageMb: 5120,
      icon: "Crown",
      order: 3,
    },
  ];

  for (const plan of plans) {
    try {
      const planId = await convex.mutation(api.admin.createPlan, plan);
      console.log(`✅ Created plan: ${plan.name} (${planId})`);
    } catch (error) {
      console.error(`❌ Failed to create plan ${plan.name}:`, error);
    }
  }

  console.log("\n🎉 Seeding complete!");
}

seed().catch(console.error);
