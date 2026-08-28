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
- **🎨 Two-Stage AI Pipeline** - A dedicated AI *designer* chooses theme, audience, tone and density before the *architect* plans sections and the writer generates content
- **🗂 Professional Theme Engine** - 18 validated design families (Executive, Corporate, Financial, Legal, Academic, Modern Tech, …) — the AI selects from a closed registry, never invents colors
- **📥 Real File Ingestion** - Upload DOCX / PDF / XLSX / PPTX / CSV / TXT and the AI actually reads them (headings, tables, sheets, slides, formulas) to ground generation
- **📊 Multi-Format Output** - Native DOCX (editable), themed PDF, ExcelJS spreadsheets with REAL formulas, PPTX decks, CSV, TXT, HTML
- **📈 Chart & Diagram Engines** - Mathematically correct charts (Apache ECharts → SVG → PNG) and deterministic SVG diagrams (flowcharts, timelines) embedded in every format
- **🔍 Visual QA** - Every artifact passes structural validation (overflow risks, placeholder text, oversized tables, slide density) with a bounded auto-repair pass before it can complete
- **🕘 Version History** - Every generation, AI edit, export and restore is an immutable version — restore any previous version anytime
- **🔁 Format Conversion** - Export any generated artifact to its other supported formats (e.g. DOCX → PDF, XLSX → CSV) as a new version
- **☁️ Cloud Storage Integration** - Cloudflare R2 with versioned object keys (`users/{uid}/artifacts/{id}/v{n}/…`)
- **🔄 Real-Time Database** - Convex for instant data synchronization
- 🚀 **Instant Activation** - Sign up and generate immediately (no payment step)

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
│   │   ├── ai/                # AI provider layer (AgentRouter → Gemini → OpenAI)
│   │   ├── themes.ts          # Theme engine (18 validated design families)
│   │   ├── design-planning.ts # Stage-A AI designer (design plans + validation)
│   │   ├── artifact-planning.ts # Stage-B architect prompts + blueprint parsing
│   │   ├── ingestion/         # File ingestion (DOCX/PDF/XLSX/PPTX/CSV/TXT)
│   │   ├── chart-engine.ts    # ECharts SSR → SVG → PNG
│   │   ├── diagram-engine.ts  # Deterministic SVG diagrams
│   │   ├── renderers/         # DOCX / PDF / PPTX / XLSX / CSV / TXT / HTML
│   │   ├── document-renderer.ts # Renderer facade (renderArtifact)
│   │   ├── qa/structural.ts   # Structural QA + bounded auto-repair
│   │   └── artifact-engine.ts # Legacy engine (dormant)
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

# NOTE: Payments have been removed entirely — no payment env vars needed.
# Every signup is activated instantly.
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

Add to `.gitignore` if desired.

---

## 🔒 Security

### Best Practices
- Never expose secret keys to client (`NEXT_PUBLIC_` prefix only for public values)
- Use HTTPS in production
- Validate all payloads server-side
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
