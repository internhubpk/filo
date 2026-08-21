# 🚀 Filo - AI Productivity SaaS Platform

<div align="center">

![Filo Logo](public/logo.svg)

**Filo** is an AI-powered productivity platform that transforms how teams create documents, analyze data, and collaborate. Built with Next.js 16, Convex, and modern web technologies.

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-06B6D4?logo=tailwindcss)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

</div>

---

## ✨ Features

### Core Capabilities
- **🤖 AI-Powered Document Generation** - Create professional documents, spreadsheets, presentations with AI
- **📊 Multi-Format Output** - Export to DOCX, PDF, XLSX, PPTX, CSV
- **☁️ Cloud Storage Integration** - Cloudflare R2 for reliable file storage
- **🔄 Real-Time Database** - Convex for instant data synchronization
- 💳 **Multiple Payment Gateways** - PayFast & SafePay integration

### User Features
- 🔐 Secure authentication system
- 🎨 Dark/Light theme support
- 📱 Responsive design (mobile-first)
- 📈 Usage tracking & analytics
- 👥 Team collaboration (Team plan)
- 🏢 Enterprise features (Department plan)

### Admin Features
- 📋 Full CRUD for plan management
- 📊 Dashboard with analytics
- ⚙️ Environment-based configuration
- 🔔 Webhook event handling

---

## 📁 Project Structure

```
filo/
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── admin/             # Admin dashboard (/admin)
│   │   ├── api/               # API routes
│   │   │   ├── webhooks/
│   │   │   │   ├── payfast/   # PayFast webhook handler
│   │   │   │   └── safepay/   # SafePay webhook handler ✨ NEW
│   │   │   ├── artifacts/     # Artifact generation API
│   │   │   └── files/         # File upload/download API
│   │   ├── pricing/           # Public pricing page (/pricing)
│   │   ├── layout.tsx         # Root layout with providers
│   │   └── page.tsx           # Main dashboard
│   ├── components/
│   │   ├── ui/                # shadcn/ui components
│   │   ├── dashboard/         # Main dashboard component
│   │   ├── billing/           # Billing management
│   │   ├── settings/          # User settings
│   │   ├── layout/            # Sidebar, Header layouts
│   │   └── providers/         # Convex, Theme providers
│   ├── config/                # Configuration files
│   │   ├── plans.ts           # Plan definitions (env-configurable)
│   │   ├── payment.ts         # Payment gateway config
│   │   ├── ai.ts              # AI provider config
│   │   └── r2.ts              # Cloudflare R2 config
│   ├── lib/
│   │   ├── r2/client.ts       # R2 storage client
│   │   └── utils.ts           # Utility functions
│   ├── services/              # Business logic
│   │   ├── ai.ts              # AI service layer
│   │   ├── artifact-engine.ts # Document generation engine
│   │   └── file-service.ts    # File handling service
│   └── types/                 # TypeScript type definitions
├── convex/                    # Convex database
│   ├── schema.ts              # Database schema (10 tables)
│   ├── plans.ts               # Plan queries
│   ├── users.ts               # User mutations
│   ├── payments.ts            # Payment handling
│   ├── files.ts               # File operations
│   ├── admin.ts               # Admin mutations
│   └── seed.ts                # Database seeder
├── public/                    # Static assets
├── Caddyfile                  # Web server configuration ⬅️ See below
├── bun.lock                   # Bun package manager lockfile ⬅️ See below
├── .env.example               # Environment variables template
├── instructions.md            # Comprehensive API documentation
└── README.md                  # This file 📖
```

---

## 🛠️ Tech Stack

| Technology | Purpose |
|------------|---------|
| **Next.js 16** | React framework with App Router |
| **TypeScript** | Type-safe JavaScript |
| **Tailwind CSS 4** | Utility-first styling |
| **shadcn/ui** | Component library (Radix UI) |
| **Convex** | Real-time database & backend functions |
| **Cloudflare R2** | S3-compatible object storage |
| **Lucide Icons** | Icon library |
| **next-themes** | Theme switching (dark/light) |
| **PayFast** | South African payment gateway |
| **SafePay** | Alternative payment gateway |

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ or Bun runtime
- npm, yarn, or pnpm package manager
- Convex account (free tier available)
- Cloudflare account (for R2 storage)

### Installation

```bash
# Clone the repository
git clone https://github.com/internhubpk/filo.git
cd filo

# Install dependencies
npm install
# or: bun install
# or: pnpm install

# Copy environment template
cp .env.example .env

# Edit .env with your credentials
nano .env
```

### Environment Configuration

Edit `.env` file with your actual values:

```bash
# Essential - App URL
NEXT_PUBLIC_APP_URL=https://your-domain.com

# Convex Database
NEXT_PUBLIC_CONVEX_URL=https://your-site.convex.cloud
CONVEX_DEPLOYMENT=your-deployment-name
CONVEX_ADMIN_KEY=your-admin-key

# Cloudflare R2
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_BUCKET_NAME=filo-uploads

# Payment Gateways
# PayFast (South Africa)
PAYFAST_MERCHANT_ID=your-id
PAYFAST_MERCHANT_KEY=your-key
PAYFAST_SANDBOX=true

# SafePay (Alternative)
SAFEPAY_PUBLIC_KEY=pk_your-key
SAFEPAY_SECRET_KEY=sk_your-key
SAFEPAY_SANDBOX=true
```

### Running Locally

```bash
# Development mode
npm run dev
# or: bun dev

# Build for production
npm run build

# Start production server
npm start
```

Visit [http://localhost:3000](http://localhost:3000)

---

## 📡 API Endpoints

### Webhooks

#### PayFast Webhook
```
POST /api/webhooks/payfast
GET  /api/webhooks/payfast  (health check)
```

#### SafePay Webhook ✨ NEW
```
POST /api/webhooks/safepay
GET  /api/webhooks/safepay  (health check)
```

**SafePay Events Handled:**
- `payment.succeeded` - Activate subscription
- `payment.failed` / `payment.declined` - Notify user
- `payment.refunded` - Process refund
- `subscription.created` / `subscription.activated` - Setup access
- `subscription.cancelled` - Schedule downgrade
- `subscription.renewed` - Extend billing period
- And more...

### File Operations
```
POST   /api/files          # Generate presigned upload URL
GET    /api/files/:id      # Download file
DELETE /api/files/:id      # Delete file
```

### Artifacts
```
POST   /api/artifacts      # Create new artifact
GET    /api/artifacts      # List user artifacts
GET    /api/artifacts/:id  # Get specific artifact
```

---

## 💰 Pricing Plans

Filo uses a **paid-only model** (no free tier):

| Plan | Price (Monthly) | Price (Yearly) | Best For |
|------|-----------------|----------------|----------|
| **Pro** | R190 | R1,900 | Individual professionals |
| **Team** | R490 | R4,900 | Small teams (up to 5 users) |
| **Department** | Custom | Custom | Enterprises (contact sales) |

All plans are configurable via environment variables:

```bash
# Pro Plan Pricing
NEXT_PUBLIC_PLAN_PRO_MONTHLY_PRICE=190
NEXT_PUBLIC_PLAN_PRO_YEARLY_PRICE=1900

# Team Plan Pricing  
NEXT_PUBLIC_PLAN_TEAM_MONTHLY_PRICE=490
NEXT_PUBLIC_PLAN_TEAM_YEARLY_PRICE=4900

# Department (Contact Sales)
NEXT_PUBLIC_CONTACT_SALES_URL=mailto:sales@filo.ai
```

Manage plans visually at `/admin`

---

## ❓ File Explanations

### 🐧 Caddyfile
**Purpose:** Web server reverse proxy configuration for [Caddy](https://caddyserver.com/)

```caddyfile
:81 {
    # Forwards requests to Next.js on port 3000
    handle {
        reverse_proxy localhost:3000 {
            header_up Host {host}
            header_up X-Forwarded-For {remote_host}
        }
    }
}
```

**Why it exists:**
- Caddy is a modern web server with automatic HTTPS
- Handles SSL/TLS termination automatically
- Provides production-ready reverse proxy
- Useful when deploying to VPS/Dedicated server

**Do you need it?**
- ✅ **Yes** if deploying to your own server (VPS, dedicated)
- ❌ **No** if using Vercel, Railway, or similar platforms (they handle this)

### 📦 bun.lock
**Purpose:** Lockfile for [Bun](https://bun.sh/) package manager

**Why it exists:**
- Ensures reproducible dependency installations
- Faster than npm's `package-lock.json`
- Bun can be used as alternative to Node.js/npm

**Do you need it?**
- ✅ **Keep it** if using Bun as runtime/package manager
- ✅ **Keep it** for consistency even if using npm (doesn't hurt)
- Can safely ignore if only using npm/pnpm

### 🗂️ tool-results/ directory
**Purpose:** Internal working directory for AI assistant

**What's inside:** Temporary read results from large files during development

**Action:** Can be deleted - not needed for production:
```bash
rm -rf tool-results/
```

Add to `.gitignore` if desired.

---

## 🔒 Security

### Webhook Signature Verification

Both PayFast and SafePay webhooks verify signatures:

```typescript
// SafePay uses HMAC-SHA256
function verifySignature(event) {
  const expected = crypto
    .createHmac('sha256', SAFEPAY_CONFIG.webhookSecret)
    .update(JSON.stringify(event))
    .digest('hex')
  
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(event.signature)
  )
}
```

### Best Practices
- Never expose secret keys to client (`NEXT_PUBLIC_` prefix only for public values)
- Use HTTPS in production
- Validate all webhook payloads
- Implement idempotency for webhook processing
- Log events for audit trails

---

## 🌐 Deployment

### Vercel (Recommended for Next.js)
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Set environment variables in dashboard
vercel env add CONVEX_DEPLOYMENT
```

### Docker
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

### Traditional Server (with Caddy)
```bash
# Build the app
npm run build

# Start Next.js
npm start &

# Start Caddy (port 80 → 3000)
caddy run --config Caddyfile
```

---

## 📚 Documentation

- **API Documentation**: See [`instructions.md`](instructions.md) for comprehensive API reference
- **Environment Variables**: See [`.env.example`](.env.example) for all configurable options
- **Admin Dashboard**: Visit `/admin` for plan management UI
- **Pricing Page**: Visit `/pricing` for public pricing display

---

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🆘 Support

- **Email**: support@filo.app
- **Sales**: sales@filo.ai (for Department/Enterprise plans)
- **Issues**: [GitHub Issues](https://github.com/internhubpk/filo/issues)

---

<div align="center">

**Built with ❤️ by the Filo Team**

⭐ Star this repo if you find it useful!

</div>
