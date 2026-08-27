#!/bin/bash
# =============================================================================
# FILO - Convex Cloud Setup Script
# =============================================================================
# Run this on your LOCAL MACHINE to deploy to Convex Cloud
# This will fix the "Couldn't resolve api.auth.createSession" error
# =============================================================================

set -e

echo "🚀 FILO - Convex Cloud Deployment Setup"
echo "========================================"
echo ""

# Check if convex CLI is installed
if ! command -v npx &> /dev/null; then
    echo "❌ Error: npx is not installed"
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi

echo "Step 1: 📝 Logging into Convex..."
echo "-----------------------------------"
echo "A browser window will open. Login with your Convex account."
echo "(If you don't have one, you can create it for free)"
echo ""
npx convex login
echo ""

echo "Step 2: 🌤️  Deploying functions to Convex Cloud..."
echo "---------------------------------------------------"
echo "This will upload all your auth, users, artifacts, etc. functions"
echo ""
npx convex deploy --verbose
echo ""

echo "Step 3: ✅ Getting your Convex Cloud URL..."
echo "--------------------------------------------"
# Try to get the deployment URL
CONVEX_URL=$(npx convex env get CONVEX_URL 2>/dev/null || echo "")

if [ -z "$CONVEX_URL" ]; then
    echo ""
    echo "📋 MANUAL STEP REQUIRED:"
    echo "------------------------"
    echo "1. Go to https://dashboard.convex.cloud"
    echo "2. Select your project"
    echo "3. Find your deployment URL under 'Settings'"
    echo "4. It looks like: https://xxxxx-xxxxx.convex.cloud"
    echo ""
    read -p "Paste your Convex Cloud URL here: " CONVEX_URL
fi

echo ""
echo "========================================"
echo "✅ SETUP COMPLETE!"
echo "========================================"
echo ""
echo "Now update your Vercel Environment Variables:"
echo ""
echo "  Variable Name                    Value"
echo "  ──────────────────────────────────────────────────────"
echo "  CONVEX_DEPLOYMENT                production"
echo "  NEXT_PUBLIC_CONVEX_URL           $CONVEX_URL"
echo "  NEXT_PUBLIC_CONVEX_SITE_URL      https://your-vercel-app.vercel.app"
echo ""
echo "After updating Vercel env vars, redeploy on Vercel dashboard."
echo ""
echo "🎉 Your signup/auth will work after this!"
