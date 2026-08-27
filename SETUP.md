# Filo AI - Complete Setup Guide

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
```bash
cp .env.example .env.local
# Edit .env.local with your actual values
```

### 3. Set Up Convex Database

**Install Convex CLI:**
```bash
npm install -g convex-dev
```

**Deploy Schema:**
```bash
npx convex deploy
```

**Seed Initial Data:**
```bash
npx convex run convex/seed.ts
```

### 4. Set Up Cloudflare R2

1. Create a Cloudflare account (if you don't have one)
2. Go to R2 Object Storage → Create Bucket (`filo-uploads`)
3. Create API Tokens with R2 Read & Write access
4. Add credentials to `.env.local`:
   ```
   R2_ACCOUNT_ID=your-account-id
   R2_ACCESS_KEY_ID=your-access-key-id
   R2_SECRET_ACCESS_KEY=your-secret-key
   R2_BUCKET_NAME=filo-uploads
   ```

### 5. Run Development Server
```bash
npm run dev
```

Visit: http://localhost:3000

---

## 📁 Project Structure

```
my-project/
├── convex/                    # Convex database schema & functions
│   ├── schema.ts             # Database schema definition
│   ├── plans.ts              # Plan queries & mutations
│   ├── files.ts              # File upload/download functions
│   ├── users.ts              # User management functions
│   ├── payments.ts           # Payment processing functions
│   ├── admin.ts              # Admin operations
│   └── seed.ts               # Database seeder script
├── src/
│   ├── app/                  # Next.js pages
│   │   ├── pricing/          # Public pricing page (no auth required)
│   │   └── api/              # API routes
│   ├── components/           # React components
│   │   ├── providers/        # Context providers
│   │   │   └── convex-provider.tsx
│   │   ├── billing/          # Billing page component
│   │   └── dashboard/        # Main dashboard
│   ├── config/               # Configuration files
│   │   └── plans.ts          # Plan configuration (env-based)
│   └── lib/
│       └── r2/               # R2 storage utilities
│           └── client.ts     # AWS S3 SDK wrapper for R2
├── .env.example              # Environment variables template
└── package.json
```

## 🔧 Key Features Implemented

### ✅ Convex Database Integration
- **Schema**: Complete schema with 10+ tables (users, plans, subscriptions, artifacts, files, etc.)
- **Queries**: Get active plans, user data, usage stats, payment history
- **Mutations**: User CRUD, file uploads, usage recording
- **Seeding**: Script to populate initial plan data

### ✅ Cloudflare R2 Storage
- **Presigned URLs**: Secure direct-to-R2 file uploads
- **Download URLs**: Temporary access links for private files
- **File Management**: Upload, download, delete operations
- **Key Generation**: Unique, sanitized file keys

### ✅ Environment-Based Configuration
- Plans configurable via environment variables
- Currency settings customizable
- All sensitive data in `.env.local`
- No hardcoded secrets in codebase

### ✅ UI Improvements
- Consistent button sizing across the app
- Password visibility toggles (eye icons)
- Theme toggle button in navbar
- Cursor pointers on all interactive elements
- More icons throughout the interface
- Public pricing page at `/pricing`
- Modal close buttons with proper cursor styles

---

## 🌐 Deployment

### Vercel (Recommended)
1. Push to GitHub
2. Import project in Vercel dashboard
3. Add environment variables
4. Deploy

### Self-Hosted
```bash
# Build
npm run build

# Start production server
npm start
```

---

## 🔑 Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_CONVEX_URL` | Your Convex deployment URL | `https://your-app.convex.cloud` |
| `R2_ACCOUNT_ID` | Cloudflare Account ID | `abc123...` |
| `R2_ACCESS_KEY_ID` | R2 API Access Key | `access_key_id` |
| `R2_SECRET_ACCESS_KEY` | R2 API Secret | `secret_key` |
| `R2_BUCKET_NAME` | R2 bucket name | `filo-uploads` |
| `OPENAI_API_KEY` | OpenAI API key | `sk-...` |

---

## 📝 Notes

- **Convex**: Real-time database with built-in caching and optimistic updates
- **R2**: S3-compatible storage with no egress fees
- **Payments**: removed — signups are activated instantly
- **NextAuth.js**: Authentication setup prepared (add your provider)

---

## 🆘 Troubleshooting

**Build Error: Module not found '@/config/plans'**
→ Fixed! Import paths now use correct alias

**Convex Connection Error**
→ Ensure `NEXT_PUBLIC_CONVEX_URL` is set correctly

**R2 Upload Failing**
→ Check R2 credentials and CORS settings on Cloudflare dashboard

**Theme Not Working**
→ ThemeProvider must wrap ConvexClientProvider (done in layout.tsx)

---

## 📄 License

MIT License - Feel free to use for personal or commercial projects.
