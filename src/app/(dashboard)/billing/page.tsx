// =============================================================================
// /billing page - manual admin-verified payment flow
// =============================================================================
// Renders the <BillingPage /> component which provides:
//   - Account activation status display
//   - Latest payment verification status (pending/approved/rejected)
//   - Plans grid with "Submit Payment" buttons (no SafePay checkout)
//   - Manual payment submission dialog (transaction ID, method, etc.)
//   - Payment submission history table
//
// The SafePay automatic checkout flow has been removed. Users now pay
// externally (bank transfer, EasyPaisa, JazzCash, etc.) and submit their
// transaction details for admin review. An admin reviews submissions in
// /admin and either approves (which activates the user account) or rejects
// (with a reason surfaced back to the user).
// =============================================================================

'use client'

import { Suspense } from 'react'
import { BillingPage } from '@/components/billing/billing-page'

export default function Page() {
  return (
    <Suspense fallback={null}>
      <BillingPage />
    </Suspense>
  )
}
