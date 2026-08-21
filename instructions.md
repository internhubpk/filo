# 🚀 Filo AI - Complete API & Setup Instructions

## Table of Contents
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [API Documentation](#api-documentation)
  - [Convex Database API](#convex-database-api)
  - [REST API Endpoints](#rest-api-endpoints)
  - [R2 Storage API](#r2-storage-api)
- [Database Schema](#database-schema)
- [Authentication](#authentication)
- [Payment Integration](#payment-integration)
- [Deployment Guide](#deployment-guide)

---

## Quick Start

### Prerequisites
- Node.js 18+ 
- npm or yarn
- Convex account (free tier available)
- Cloudflare account (for R2 storage)
- PayFast merchant account (optional, for payments)

### Installation

```bash
# Clone the repository
git clone https://github.com/internhubpk/filo.git

# Navigate to project directory
cd filo

# Install dependencies
npm install

# Copy environment template
cp .env.example .env.local

# Edit .env.local with your credentials
nano .env.local

# Run development server
npm run dev
```

**Visit:** http://localhost:3000

---

## Environment Variables

Create a `.env.local` file in the root:

```bash
# ===========================================
# Filo AI - Environment Configuration
# ===========================================

# App Configuration
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_NAME=Filo

# Convex Database (REQUIRED for database features)
NEXT_PUBLIC_CONVEX_URL=https://your-convex-site.convex.cloud
CONVEX_DEPLOYMENT=your-deployment-name
CONVEX_ADMIN_KEY=your-convex-admin-key

# Cloudflare R2 Storage (REQUIRED for file uploads)
R2_ACCOUNT_ID=your-cloudflare-account-id
R2_ACCESS_KEY_ID=your-r2-access-key-id
R2_SECRET_ACCESS_KEY=your-r2-secret-access-key
R2_BUCKET_NAME=filo-uploads
R2_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
R2_PUBLIC_URL=https://pub-your-bucket-id.r2.dev

# AI Provider Configuration (at least one required)
OPENAI_API_KEY=sk-your-openai-api-key
OPENROUTER_API_KEY=sk-or-your-openrouter-api-key

# PayFast Payment Gateway (optional)
PAYFAST_MERCHANT_ID=10000100
PAYFAST_MERCHANT_KEY=testmerchantkey
PAYFAST_PASSPHRASE=your-payfast-passphrase
PAYFAST_SANDBOX=true
NEXT_PUBLIC_PAYFAST_MERCHANT_ID=10000100

# Plan Configuration (Optional - overrides defaults)
NEXT_PUBLIC_PLAN_FREE_ID=free
NEXT_PUBLIC_PLAN_FREE_NAME=Free
NEXT_PUBLIC_PLAN_PRO_MONTHLY_PRICE=190
NEXT_PUBLIC_PLAN_PRO_YEARLY_PRICE=1900
NEXT_PUBLIC_CURRENCY_SYMBOL=R
NEXT_PUBLIC_CURRENCY_CODE=ZAR

# Authentication (NextAuth.js)
NEXTAUTH_SECRET=your-nextauth-secret-key-here
NEXTAUTH_URL=http://localhost:3000
```

---

## API Documentation

### Convex Database API

Convex provides real-time database functionality. All functions are in `/convex/` directory.

#### Plans API

**Get Active Plans**
```typescript
// Client-side usage
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";

function PricingPage() {
  const plans = useQuery(api.plans.getActivePlans);
  
  // Returns array of:
  // {
  //   _id: string,
  //   name: string,
  //   description: string,
  //   priceMonthly: number,
  //   priceYearly: number,
  //   features: string[],
  //   limitations: string[],
  //   popular: boolean,
  //   maxAiGenerations: number,
  //   maxStorageMb: number,
  //   icon: string
  // }
}
```

**Get User Subscription**
```typescript
const subscription = useQuery(api.plans.getUserSubscription, {
  userId: "user_id_here"
});

// Returns subscription object with plan details or null
```

**Get Usage Stats**
```typescript
const usage = useQuery(api.plans.getUserUsage, {
  userId: "user_id",
  periodStart: Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 days ago
  periodEnd: Date.now()
});

// Returns: { aiGenerations: number, fileUploads: number, storageUsed: number }
```

#### Users API

**Create User**
```typescript
import { useMutation } from "convex/react";

const createUser = useMutation(api.users.createUser);

const user = await createUser({
  name: "John Doe",
  email: "john@example.com",
  image: "https://example.com/avatar.jpg"
});

// Returns created user object with _id
```

**Get User by Email**
```typescript
const user = await convex.query(api.users.getUserByEmail, {
  email: "john@example.com"
});
```

**Update User Profile**
```typescript
const updateUser = useMutation(api.users.updateUser);

await updateUser({
  userId: "user_id",
  name: "New Name",
  image: "new-avatar-url"
});
```

#### Files API (R2 Storage)

**Generate Upload URL**
```typescript
const generateUploadUrl = useMutation(api.files.generateUploadUrl);

const { fileId, r2Key } = await generateUploadUrl({
  userId: "user_id",
  originalName: "document.pdf",
  mimeType: "application/pdf",
  size: 1024000 // size in bytes
});

// Use r2Key to upload to R2 directly from client
// Then call markFileUploaded when complete
```

**Mark File as Uploaded**
```typescript
const markFileUploaded = useMutation(api.files.markFileUploaded);

await markFileUploaded({ fileId: "file_id" });
```

**Get User's Files**
```typescript
const files = useQuery(api.files.getUserFiles, {
  userId: "user_id"
});
```

**Delete File**
```typescript
const deleteFile = useMutation(api.files.deleteFile);

await deleteFile({ fileId: "file_id" });
```

#### Payments API

**Create Payment Record**
```typescript
const createPayment = useMutation(api.payments.createPayment);

const payment = await createPayment({
  userId: "user_id",
  amount: 19000, // in cents
  currency: "ZAR",
  description: "Pro Monthly Plan",
  payfastPaymentId: "pf_payment_id"
});
```

**Update Payment Status** (called by webhook)
```typescript
const updateStatus = useMutation(api.payments.updatePaymentStatus);

await updateStatus({
  paymentId: "payment_id",
  status: "completed",
  metadata: { transactionId: "tx_123" }
});
```

**Record Webhook Event** (idempotency)
```typescript
const recordEvent = useMutation(api.payments.recordWebhookEvent);

const result = await recordEvent({
  provider: "payfast",
  eventId: "unique_event_id",
  type: "payment.completed",
  data: { /* webhook payload */ }
});

if (result.exists) {
  // Already processed this event
}
```

---

### REST API Endpoints

#### Artifacts Generation

**POST /api/artifacts**

Generate a new artifact (document, spreadsheet, etc.)

```javascript
// Request
{
  prompt: "Create a business proposal for a coffee shop",
  format: "DOCX", // or PDF, XLSX, PPTX, CSV
  files: ["file_id_1"], // optional uploaded files
  options: {
    branding: "brand_id",
    language: "en"
  }
}

// Response (202 Accepted)
{
  jobId: "job_123",
  status: "processing",
  estimatedTime: "30s"
}

// Response (200 OK) when complete
{
  jobId: "job_123",
  status: "completed",
  artifact: {
    id: "artifact_456",
    title: "Coffee Shop Business Proposal",
    format: "DOCX",
    downloadUrl: "/api/files/download/artifact_456"
  }
}
```

#### File Upload

**POST /api/files**

Handle file uploads to R2

```javascript
// Request (multipart/form-data)
FormData.append("file", fileObject);
FormData.append("userId", "user_id");

// Response
{
  fileId: "file_789",
  url: "https://r2.dev/uploads/user_id/file.pdf",
  key: "uploads/user_id/timestamp-file.pdf"
}
```

**GET /api/files/download/:fileId**

Download a file (generates presigned URL)

```javascript
// Response: Redirect to presigned R2 URL
// Headers: Content-Disposition: attachment; filename="original.pdf"
```

#### PayFast Webhook

**POST /api/webhooks/payfast**

Handle PayFast payment notifications

```javascript
// Request body (PayFast notification)
{
  m_payment_id: "payment_123",
  pf_payment_id: "pf_456",
  payment_status: "COMPLETE",
  amount_gross: "190.00",
  signature: "calculated_signature"
}

// Response
{
  success: true,
  message: "Payment processed"
}
```

---

### R2 Storage API

Cloudflare R2 S3-compatible storage client.

**Import**
```typescript
import {
  generateUploadUrl,
  generateDownloadUrl,
  uploadToR2,
  deleteFromR2,
  fileExistsInR2,
  generateR2Key
} from "@/lib/r2/client";
```

**Generate Presigned Upload URL**
```typescript
const uploadUrl = await generateUploadUrl(
  "uploads/user_id/document.pdf",     // key
  "application/pdf",                   // contentType
  50 * 1024 * 1024                     // maxSize (50MB)
);

// Use this URL with PUT request from client
fetch(uploadUrl, {
  method: 'PUT',
  body: file,
  headers: { 'Content-Type': 'application/pdf' }
});
```

**Generate Presigned Download URL**
```typescript
const downloadUrl = await generateDownloadUrl(
  "uploads/user_id/document.pdf",
  3600 // expires in 1 hour
);

// Redirect user to this URL for download
window.location.href = downloadUrl;
```

**Server-Side Upload**
```typescript
// In API route or server action
import fs from 'fs';
const buffer = fs.readFileSync('/path/to/file.pdf');

await uploadToR2(
  "uploads/user_id/document.pdf",
  buffer,
  "application/pdf",
  { uploadedBy: "user_id" } // optional metadata
);
```

**Delete File**
```typescript
await deleteFromR2("uploads/user_id/document.pdf");
```

**Check File Exists**
```typescript
const exists = await fileExistsInR2("uploads/user_id/document.pdf");
console.log(exists); // true/false
```

**Generate Unique Key**
```typescript
const key = generateR2Key(
  "user_abc123",           // userId
  "My Document.pdf",       // originalName
  "uploads"                // prefix (default: "uploads")
);

// Result: "uploads/user_abc123/1692612345678-a9b2c3My_Document.pdf"
```

---

## Database Schema

### Tables Overview

| Table | Description | Key Fields |
|-------|-------------|------------|
| `users` | User accounts | email, planId, stripeCustomerId |
| `plans` | Pricing plans | name, prices, features, limits |
| `subscriptions` | User subscriptions | userId, planId, status |
| `artifacts` | Generated artifacts | userId, type, format, status |
| `files` | Uploaded files | userId, r2Key, mimeType |
| `usageRecords` | Usage tracking | userId, type, period |
| `payments` | Payment records | userId, status, amount |
| `webhookEvents` | Webhook logs | provider, eventId, processed |

### Relationships

```
users ──1:N── subscriptions ──N:1── plans
  │
  ├──1:N── artifacts
  ├──1:N── files
  ├──1:N── payments
  └──1:N── usageRecords

webhookEvents ──N:1── payments (via metadata)
```

### Indexes

All tables have optimized indexes for common queries:

- **users**: `by_email`, `by_stripeCustomerId`
- **plans**: `by_active`, `by_order`
- **subscriptions**: `by_userId`, `by_status`
- **artifacts**: `by_userId`, `by_status`, `by_userId_status`
- **files**: `by_userId`, `by_artifactId`, `by_r2Key`
- **payments**: `by_userId`, `by_status`, `by_payfastPaymentId`
- **webhookEvents**: `by_provider_eventId`, `by_processed`

---

## Authentication

### Setup NextAuth.js (Recommended)

1. Install NextAuth:
```bash
npm install next-auth @auth/prisma-adapter
```

2. Create auth configuration:
```typescript
// src/lib/auth.ts
import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { convex } from "./convex-server";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        // Verify against Convex users table
        const user = await convex.query(api.users.getUserByEmail, {
          email: credentials?.email as string
        });
        
        if (!user) return null;
        // Verify password hash here
        
        return {
          id: user._id,
          email: user.email,
          name: user.name,
        };
      },
    }),
  ],
  session: { strategy: "jwt" },
});
```

3. Create route handler:
```typescript
// src/app/api/auth/[...nextauth]/route.ts
export { GET, POST } from "@/lib/auth";
```

### Current Auth Implementation

The app currently uses client-side state management for authentication (see `src/components/dashboard/main-dashboard.tsx`). For production, integrate with NextAuth.js or similar.

---

## Payment Integration

### PayFast Setup

1. **Sandbox Testing**:
   ```bash
   # .env.local
   PAYFAST_SANDBOX=true
   PAYFAST_MERCHANT_ID=10000100
   PAYFAST_MERCHANT_KEY=testmerchantkey
   ```

2. **Production**:
   - Get merchant credentials from PayFast dashboard
   - Update environment variables
   - Set up ITN (Instant Transaction Notification) URL:
     ```
     https://yourdomain.com/api/webhooks/payfast
     ```

3. **Signature Verification**:
   The webhook endpoint automatically verifies PayFast signatures.

### Payment Flow

```
User clicks "Upgrade"
    ↓
Frontend calls POST /api/payments/create
    ↓
Server creates payment record in Convex
    ↓
Server generates PayFast payment URL
    ↓
Redirect user to PayFast
    ↓
User completes payment on PayFast
    ↓
PayFast sends webhook to /api/webhooks/payfast
    ↓
Server verifies signature & updates payment status
    ↓
If successful → Activate subscription
    ↓
Redirect user back to /billing?payment=success
```

---

## Deployment Guide

### Vercel (Recommended)

1. **Push to GitHub**:
   ```bash
   git init
   git add .
   git commit -m "Initial Filo AI setup"
   git remote add origin https://github.com/internhubpk/filo.git
   git push -u origin main
   ```

2. **Deploy on Vercel**:
   - Import repository from GitHub
   - Add all environment variables
   - Deploy

3. **Set Up Convex**:
   ```bash
   npm install -g convex-dev
   npx convex deploy
   ```

4. **Seed Database**:
   ```bash
   npx convex run convex/seed.ts
   ```

### Docker Deployment

```dockerfile
# Dockerfile
FROM node:18-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# Rebuild source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000
CMD ["node", "server.js"]
```

```bash
# Build and run
docker build -t filo-ai .
docker run -p 3000:3000 \
  -e NEXT_PUBLIC_CONVEX_URL=$CONVEX_URL \
  -e R2_ACCESS_KEY_ID=$R2_KEY \
  filo-ai
```

### Self-Hosted (Node.js)

```bash
# Build
npm run build

# Start production server
NODE_ENV=production npm start
```

---

## Convex Management Commands

```bash
# Start local development
npx convex dev

# Deploy to production
npx convex deploy

# Run seed script
npx convex run convex/seed.ts

# View Convex dashboard
npx convex dashboard

# Check deployment status
npx convex env list
```

---

## R2 Configuration (Cloudflare Dashboard)

1. **Create Bucket**:
   - Go to Cloudflare Dashboard → R2 Object Storage
   - Click "Create bucket"
   - Name: `filo-uploads` (or your preferred name)

2. **Set CORS Rules** (for direct browser uploads):
   ```json
   [
     {
       "AllowedOrigins": ["http://localhost:3000", "https://yourdomain.com"],
       "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
       "AllowedHeaders": ["*"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

3. **Create API Token**:
   - Go to R2 → Manage R2 API Tokens
   - Create token with "Object Read & Write" permission
   - Save Access Key ID and Secret Access Key

4. **Public Access** (optional):
   - Enable public access for downloads
   - Use the provided public URL pattern

---

## Error Handling

### Common Issues

**Convex Connection Error**
```
Error: No address provided to ConvexReactClient
```
**Solution**: Set `NEXT_PUBLIC_CONVEX_URL` in `.env.local`

**R2 Signature Mismatch**
```
SignatureDoesNotMatch
```
**Solution**: Verify R2 credentials and region setting (`auto`)

**PayFast Webhook Failure**
```
Invalid signature
```
**Solution**: Check `PAYFAST_PASSPHRASE` matches exactly

**Build Fails Without Convex**
**Solution**: The app now builds without Convex (graceful degradation). Features requiring Convex will be disabled until configured.

---

## Rate Limiting

Implement rate limiting for production:

```typescript
// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  // Add rate limiting logic here
  // Consider using: @upstash/ratelimit or similar
  
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
```

---

## Monitoring & Logging

### Recommended Tools
- **Convex Dashboard**: Real-time query performance
- **Cloudflare Analytics**: R2 usage and errors
- **Vercel Analytics**: Frontend performance
- **Sentry**: Error tracking

### Log Format
```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "level": "info",
  "service": "filo-api",
  "action": "artifact.generated",
  "userId": "user_123",
  "duration_ms": 2500
}
```

---

## Security Checklist

- [ ] All environment variables set in production
- [ ] CORS properly configured for R2
- [ ] HTTPS enforced everywhere
- [ ] Rate limiting implemented
- [ ] Input validation on all endpoints
- [ ] SQL/NoSQL injection prevention (Convex handles this)
- [ ] File upload validation (type, size)
- [ ] Webhook signature verification enabled
- [ ] CSP headers configured
- [ ] Regular dependency updates

---

## Support & Resources

- **Documentation**: See inline code comments
- **Issues**: GitHub Issues at repo URL
- **Convex Docs**: https://docs.convex.dev
- **R2 Docs**: https://developers.cloudflare.com/r2/
- **Next.js Docs**: https://nextjs.org/docs
- **PayFast Docs**: https://developers.payfast.co.za/

---

## License

MIT License - Free for personal and commercial use.

---

**Last Updated**: 2024-08-22
**Version**: 1.0.0
**Framework**: Next.js 16.1.3 + Convex 1.44.0 + AWS SDK 3.1116.0
