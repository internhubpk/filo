"use client";

// =============================================================================
// ShareChatDialog — create / rotate / revoke a public link to a chat.
// =============================================================================
// Permission model (enforced server-side in Convex + the shared routes):
//   view — visitors can read the transcript
//   edit — visitors can also send messages (AI replies spend the owner's
//          quota, so entitlement is checked before every reply)
// Every permission change ROTATES the token: old links die immediately and
// a leaked "edit" link can never be downgraded into or reused. Revocation
// clears the token — the same effect.
// =============================================================================

import { useEffect, useState } from "react";
import { Check, Copy, Eye, Link2, Pencil, RefreshCw, ShieldOff } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Permission = "view" | "edit";

interface ApiResponse {
  success: boolean;
  data?: { url?: string; shareToken?: string; permission?: string };
  error?: string;
  code?: string;
}

export function ShareChatDialog({
  chatId,
  open,
  onOpenChange,
  onRevoked,
}: {
  chatId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onRevoked?: () => void;
}) {
  const [permission, setPermission] = useState<Permission>("view");
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) {
      setError(null);
      setCopied(false);
    }
  }, [open]);

  async function createLink() {
    if (!chatId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/chat/share", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...apiClient.getAuthHeaders() },
        body: JSON.stringify({ chatId, permission }),
      });
      const json = (await res.json().catch(() => null)) as ApiResponse | null;
      if (res.ok && json?.success && json.data?.url) {
        setUrl(json.data.url);
      } else {
        setError(json?.error || "Could not create the link");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the link");
    } finally {
      setBusy(false);
    }
  }

  async function rotate() {
    await createLink();
  }

  async function revoke() {
    if (!chatId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/chat/share?chatId=${encodeURIComponent(chatId)}`, {
        method: "DELETE",
        headers: { ...apiClient.getAuthHeaders() },
      });
      const json = (await res.json().catch(() => null)) as ApiResponse | null;
      if (res.ok && json?.success) {
        setUrl(null);
        onRevoked?.();
      } else {
        setError(json?.error || "Could not revoke the link");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke the link");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="size-4 text-primary" /> Share this chat
          </DialogTitle>
          <DialogDescription>
            Anyone with the link can open a read-only view of the conversation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <RadioGroup
            value={permission}
            onValueChange={(v) => setPermission(v as Permission)}
            className="grid grid-cols-2 gap-2"
            disabled={Boolean(url)}
          >
            <label
              className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 transition-colors ${
                permission === "view" ? "border-primary/60 bg-primary/5" : "hover:bg-accent/40"
              }`}
            >
              <RadioGroupItem value="view" id="perm-view" className="mt-0.5" />
              <div>
                <Label htmlFor="perm-view" className="flex items-center gap-1.5 text-sm font-medium">
                  <Eye className="size-3.5" /> View
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">Read the transcript only</p>
              </div>
            </label>
            <label
              className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 transition-colors ${
                permission === "edit" ? "border-primary/60 bg-primary/5" : "hover:bg-accent/40"
              }`}
            >
              <RadioGroupItem value="edit" id="perm-edit" className="mt-0.5" />
              <div>
                <Label htmlFor="perm-edit" className="flex items-center gap-1.5 text-sm font-medium">
                  <Pencil className="size-3.5" /> Edit
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">Visitors can also send messages</p>
              </div>
            </label>
          </RadioGroup>

          {url ? (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Input readOnly value={url} className="h-9 font-mono text-xs" onFocus={(e) => e.target.select()} aria-label="Share link" />
                <Button
                  size="icon"
                  variant="outline"
                  className="size-9 shrink-0"
                  aria-label="Copy link"
                  onClick={() => {
                    void navigator.clipboard.writeText(url).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1600);
                    });
                  }}
                >
                  {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
                </Button>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-muted-foreground">
                  {permission === "edit" ? "Edit access — visitors can contribute." : "View-only access."}
                </p>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => void rotate()} disabled={busy}>
                    <RefreshCw className="size-3" /> New link
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
                    onClick={() => void revoke()}
                    disabled={busy}
                  >
                    <ShieldOff className="size-3" /> Revoke
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <Button onClick={() => void createLink()} disabled={busy} className="w-full">
              {busy ? "Creating…" : "Create share link"}
            </Button>
          )}

          {error ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
