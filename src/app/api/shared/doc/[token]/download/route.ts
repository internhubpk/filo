// =============================================================================
// GET /api/shared/doc/[token]/download — public download behind a share token
// =============================================================================
// The 32-byte random share token IS the credential. It is re-verified against
// the live artifact row inside Convex (convex/sharing.getSharedFileByToken)
// at request time — revoking the link kills downloads instantly. No session,
// no cookies, no owner identity in the response.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { generateDownloadUrl } from "@/lib/r2/client";
import { getConvexClient } from "@/lib/convex-server";
import { api } from "@convex/_generated/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const shareToken = typeof token === "string" ? token.trim() : "";
  if (shareToken.length < 20) {
    return NextResponse.json({ success: false, error: "Share link is not valid", code: "INVALID_TOKEN" }, { status: 404 });
  }

  try {
    const convex = getConvexClient();
    const file = (await convex.query(api.sharing.getSharedFileByToken, { token: shareToken })) as
      | { r2Key: string; filename: string; format: string; title: string }
      | null;
    if (!file) {
      return NextResponse.json({ success: false, error: "Share link is not valid", code: "INVALID_TOKEN" }, { status: 404 });
    }

    const url = await generateDownloadUrl(file.r2Key);
    return NextResponse.json({
      success: true,
      data: {
        url,
        fileName: file.filename,
        format: file.format,
        expiresIn: 3600,
      },
    });
  } catch (err) {
    console.error("[SHARED/DOC] Download failed:", err);
    return NextResponse.json({ success: false, error: "Download failed", code: "DOWNLOAD_ERROR" }, { status: 500 });
  }
}
