"use client";

// =============================================================================
// ADMIN PLANS — plan management (create / edit / activate / deactivate).
// Prices and limits stored in Convex; Safepay plan identifiers are configured
// here to keep Filo plans synchronized with the Safepay merchant dashboard.
// Every change is audited server-side.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Loader2, Plus, Pencil, PlugZap, Power, RefreshCw, Search, Webhook } from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { formatPkr } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AdminPageHeader, AdminTable } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface PlanRow {
  _id: string;
  name: string;
  description: string;
  tier?: string;
  priceMonthly: number;
  priceYearly: number;
  features: string[];
  popular: boolean;
  active: boolean;
  contactSales?: boolean;
  maxAiGenerations: number;
  maxStorageMb: number;
  aiChatEnabled?: boolean;
  safepayPlanIdMonthly?: string;
  safepayPlanIdYearly?: string;
}

const EMPTY_FORM = {
  _id: "",
  name: "",
  description: "",
  tier: "",
  priceMonthly: 0,
  priceYearly: 0,
  maxAiGenerations: 100,
  maxStorageMb: 1024,
  popular: false,
  active: true,
  contactSales: false,
  aiChatEnabled: true,
  safepayPlanIdMonthly: "",
  safepayPlanIdYearly: "",
};

interface SafepayStatus {
  mode: string;
  apiBase: string;
  checkoutBase: string;
  paymentModel: string;
  secretKey: { envVar: string; label: string; configured: boolean; preview?: string; looksLikePublicKey: boolean; looksMalformed: boolean };
  webhookSecret: { envVar: string; label: string; configured: boolean };
  publicKey: { envVar: string; label: string; configured: boolean };
  ignoredLegacyVarsDetected: string[];
  warnings: string[];
  probe: { ok: boolean; httpStatus: number | null; message: string; kind?: string } | null;
}

interface AiProviderRow {
  id: string;
  displayName: string;
  configured: boolean;
  enabled?: boolean;
  status?: string;
  defaultModel: string;
  models: string[];
  listModels?: { httpStatus: number | null; latencyMs: number; availableConfiguredModels: string[]; missingConfiguredModels: string[]; error?: string };
  ping?: { ok: boolean; httpStatus: number | null; latencyMs: number; model: string; errorCode?: string; error?: string };
  keyInfo?: { valid: boolean; httpStatus: number | null; latencyMs: number; label?: string; usage?: number; limit?: number | null; isFreeTier?: boolean; error?: string };
}

interface AiStatus {
  environment: string;
  generatedAt: number;
  routerHealth: Array<{ provider: string; state: string; cooldownRemainingMs: number }>;
  providers: AiProviderRow[];
}

export default function AdminPlansPage() {
  const plans = useApi<PlanRow[]>(() => apiClient.adminPlans().then((r) => (r.success ? (r.data as unknown as PlanRow[]) : null)));
  const [editing, setEditing] = useState<typeof EMPTY_FORM | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [toggleTarget, setToggleTarget] = useState<PlanRow | null>(null);
  const [safepayStatus, setSafepayStatus] = useState<SafepayStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [probing, setProbing] = useState(false);
  const [selfTesting, setSelfTesting] = useState(false);
  const [selfTestResult, setSelfTestResult] = useState<{ pass: boolean; message: string; target: string } | null>(null);
  const [diagnostics, setDiagnostics] = useState<Record<string, any> | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [aiStatusLoading, setAiStatusLoading] = useState(false);
  const [aiProbing, setAiProbing] = useState(false);

  const refreshAiStatus = useCallback(async () => {
    setAiStatusLoading(true);
    try {
      const res = await apiClient.adminAiStatus();
      setAiStatus(res.success ? (res.data as unknown as AiStatus) : null);
    } finally {
      setAiStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshAiStatus();
  }, [refreshAiStatus]);

  /** LIVE probes from the Convex runtime (Agent Router default + per-model
   *  chat pings). Reports HTTP status/latency/error codes — no secrets. */
  async function probeAiProviders() {
    setAiProbing(true);
    try {
      const res = await apiClient.adminAiProbe();
      if (!res.success || !res.data) {
        toast.error("AI probe failed", { description: res.error, duration: 15000 });
        return;
      }
      const status = res.data as unknown as AiStatus;
      setAiStatus(status);
      const agentRouter = status.providers?.find((p) => p.id === "AGENT_ROUTER") as AiProviderRow | undefined;
      const ping = agentRouter?.ping as
        | { ok?: boolean; model?: string; latencyMs?: number; errorCode?: string; httpStatus?: number; error?: string }
        | undefined;
      if (ping?.ok) {
        toast.success("Agent Router reachable from Convex", {
          description: `${ping.model} answered in ${ping.latencyMs}ms`,
        });
      } else if (ping) {
        toast.error("Agent Router probe FAILED", {
          description: `${ping.errorCode ?? "ERROR"}${ping.httpStatus ? ` (HTTP ${ping.httpStatus})` : ""}: ${ping.error ?? "unknown"}`,
          duration: 20000,
        });
      } else {
        toast.warning("Probe ran — Agent Router not configured (set AGENT_ROUTER_API_KEY in Convex)", { duration: 10000 });
      }
    } finally {
      setAiProbing(false);
    }
  }

  const refreshSafepayStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const res = await apiClient.adminSafepayStatus(false);
      setSafepayStatus(res.success ? (res.data as unknown as SafepayStatus) : null);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSafepayStatus();
  }, [refreshSafepayStatus]);

  /** Live authentication probe against Safepay's passport endpoint. */
  async function probeSafepay() {
    setProbing(true);
    try {
      const res = await apiClient.adminSafepayStatus(true);
      if (!res.success || !res.data) {
        toast.error("Could not run the Safepay probe", { description: res.error });
        return;
      }
      const status = res.data as unknown as SafepayStatus;
      setSafepayStatus(status);
      if (status.probe?.ok) {
        toast.success("Safepay connection OK", { description: status.probe.message });
      } else {
        toast.error("Safepay rejected the probe", {
          description: status.probe?.message ?? "Unknown failure",
          duration: 15000,
        });
      }
    } finally {
      setProbing(false);
    }
  }

  /** End-to-end webhook pipeline test: signs a synthetic event with the real
   *  webhook secret and POSTs it to our own webhook route. */
  async function runWebhookSelfTest() {
    setSelfTesting(true);
    try {
      const res = await apiClient.adminWebhookSelfTest();
      if (!res.success || !res.data) {
        toast.error("Webhook self-test failed", { description: res.error, duration: 20000 });
        return;
      }
      setSelfTestResult(res.data);
      if (res.data.pass) {
        toast.success("Webhook self-test PASS", { description: res.data.message, duration: 12000 });
      } else {
        toast.error("Webhook self-test FAIL", { description: res.data.message, duration: 20000 });
      }
    } finally {
      setSelfTesting(false);
    }
  }

  /** Fetch the billing diagnostics summary (webhook deliveries + pending checkouts). */
  async function loadBillingDiagnostics() {
    setDiagLoading(true);
    try {
      const res = await apiClient.adminBillingDiagnostics();
      if (!res.success || !res.data) {
        toast.error("Could not load billing diagnostics", { description: res.error });
        return;
      }
      setDiagnostics(res.data);
    } finally {
      setDiagLoading(false);
    }
  }

  const rows = useMemo(() => plans.data ?? [], [plans.data]);

  async function save() {
    if (!editing) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: editing.name,
        description: editing.description,
        tier: editing.tier || editing.name.toLowerCase(),
        priceMonthly: editing.priceMonthly,
        priceYearly: editing.priceYearly,
        maxAiGenerations: editing.maxAiGenerations,
        maxStorageMb: editing.maxStorageMb,
        popular: editing.popular,
        active: editing.active,
        contactSales: editing.contactSales,
        aiChatEnabled: editing.aiChatEnabled,
        safepayPlanIdMonthly: editing.safepayPlanIdMonthly || undefined,
        safepayPlanIdYearly: editing.safepayPlanIdYearly || undefined,
      };
      const res = editing._id
        ? await apiClient.adminUpdatePlan(editing._id, payload)
        : await apiClient.adminCreatePlan({ ...payload, features: [editing.description || "AI generations"], limitations: [] });
      if (!res.success) {
        toast.error(res.error || "Save failed");
        return;
      }
      toast.success(editing._id ? "Plan updated" : "Plan created");
      setEditing(null);
      await plans.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    if (!toggleTarget) return;
    setSaving(true);
    try {
      const res = await apiClient.adminUpdatePlan(toggleTarget._id, { active: !toggleTarget.active });
      if (!res.success) {
        toast.error(res.error || "Could not update plan");
        return;
      }
      toast.success(`${toggleTarget.name} ${toggleTarget.active ? "deactivated" : "activated"}`);
      setToggleTarget(null);
      await plans.refresh();
    } finally {
      setSaving(false);
    }
  }

  /**
   * Create the recurring plans on Safepay (client/plans/v1 API) and store the
   * returned Safepay plan ids on the plan rows. `force` recreates even when a
   * mapping already exists (only after the Safepay account's plans were
   * rebuilt).
   */
  async function syncSafepayPlans(force: boolean) {
    if (
      force &&
      !window.confirm("Recreate ALL Safepay plans and overwrite existing mappings? Only do this if the plans on Safepay were deleted.")
    ) {
      return;
    }
    setSyncing(true);
    try {
      const res = await apiClient.adminSyncSafepayPlans({ force });
      if (!res.success) {
        toast.error("Safepay plan sync failed", { description: res.error });
        return;
      }
      const failed = (res.data?.results ?? []).filter((r) => r.status === "failed");
      if (failed.length > 0) {
        toast.warning(res.data?.summary ?? "Plan sync finished with errors", {
          description: failed.map((f) => `${f.plan} (${f.interval}): ${f.detail}`).join(" · ").slice(0, 300),
          duration: 10000,
        });
      } else {
        toast.success("Safepay plans synced", { description: res.data?.summary });
      }
      await plans.refresh();
    } catch {
      toast.error("Safepay plan sync failed — check the server logs.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <AdminPageHeader
        title="Plans"
        description="Pricing, limits, and Safepay plan mapping. Stored in Convex — the pricing page reads from here."
        actions={
          <>
            <Button
              variant="outline"
              disabled={syncing}
              onClick={() => void syncSafepayPlans(false)}
              title="Create recurring plans on Safepay via the plans API and map their ids here"
            >
              {syncing ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <RefreshCw className="mr-1.5 size-4" />}
              Sync Safepay plans
            </Button>
            <Button onClick={() => setEditing({ ...EMPTY_FORM })}>
              <Plus className="mr-1.5 size-4" /> New plan
            </Button>
          </>
        }
      />

      {/* Safepay connection status — first stop whenever checkout or plan sync fails */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <PlugZap className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">Safepay connection</span>
            {safepayStatus && (
              <Badge variant="outline" className="font-mono text-[11px]">
                {safepayStatus.mode} · {safepayStatus.paymentModel}
              </Badge>
            )}
            {statusLoading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void loadBillingDiagnostics()} disabled={diagLoading}>
              {diagLoading ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Search className="mr-1.5 size-4" />}
              Billing diagnostics
            </Button>
            <Button variant="outline" size="sm" onClick={() => void runWebhookSelfTest()} disabled={selfTesting}>
              {selfTesting ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Webhook className="mr-1.5 size-4" />}
              Webhook self-test
            </Button>
            <Button variant="outline" size="sm" onClick={() => void probeSafepay()} disabled={probing}>
              {probing ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <PlugZap className="mr-1.5 size-4" />}
              Test Safepay connection
            </Button>
          </div>
        </div>
        {safepayStatus && (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-[11px] text-muted-foreground">
              <span className={safepayStatus.secretKey.configured ? "" : "text-destructive"}>
                SAFEPAY_SECRET_KEY: {safepayStatus.secretKey.configured ? safepayStatus.secretKey.preview : "NOT SET"}
              </span>
              <span className={safepayStatus.webhookSecret.configured ? "" : "text-amber-600 dark:text-amber-400"}>
                SAFEPAY_WEBHOOK_SECRET: {safepayStatus.webhookSecret.configured ? "set" : "not set"}
              </span>
              <span>SAFEPAY_PUBLIC_KEY: {safepayStatus.publicKey.configured ? "set" : "not set"}</span>
              <span>{safepayStatus.apiBase}</span>
            </div>
            {(safepayStatus.warnings.length > 0 || safepayStatus.ignoredLegacyVarsDetected.length > 0) && (
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-600 dark:text-amber-400">
                {safepayStatus.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            {safepayStatus.probe && (
              <p className={`text-xs ${safepayStatus.probe.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                {safepayStatus.probe.ok ? "PASS" : "FAIL"}
                {safepayStatus.probe.httpStatus != null ? ` (HTTP ${safepayStatus.probe.httpStatus})` : ""}: {safepayStatus.probe.message}
              </p>
            )}
            {selfTestResult && (
              <p className={`text-xs ${selfTestResult.pass ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                Webhook self-test {selfTestResult.pass ? "PASS" : "FAIL"} → {selfTestResult.target}
                <span className="mt-1 block whitespace-pre-wrap font-sans text-muted-foreground">{selfTestResult.message}</span>
              </p>
            )}
            {diagnostics && (
              <div className="rounded-md border bg-muted/40 p-2.5 text-xs">
                <p className="font-medium">
                  Webhook deliveries recorded: {diagnostics.summary?.webhookEventsRecorded ?? 0} · pending payments: {diagnostics.summary?.pendingPayments ?? 0}
                </p>
                {diagnostics.summary?.webhookHint && (
                  <p className="mt-1 text-amber-600 dark:text-amber-400">{diagnostics.summary.webhookHint}</p>
                )}
                {(diagnostics.webhookEvents ?? []).slice(0, 5).map((e: any, i: number) => (
                  <p key={i} className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {new Date(e.receivedAt).toLocaleTimeString()} · {e.eventType} · {e.status}
                    {e.error ? ` · ${String(e.error).slice(0, 80)}` : ""}
                  </p>
                ))}
                {(diagnostics.pendingCheckouts ?? []).slice(0, 5).map((p: any) => (
                  <p key={p.paymentId} className="mt-1 font-mono text-[11px] text-muted-foreground">
                    pending · sub {String(p.subscriptionId ?? "?").slice(0, 10)}… · {p.currency} {p.amount} · tracker: {p.hasTracker ? "yes" : "NO"}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* AI providers — generation runs in Convex, so this is the truthful
          view of what the AI layer can actually reach (AI-repair spec §17).
          Rows render GENERALLY from the API payload, so any provider
          (AGENT_ROUTER, OPENAI, …) displays consistently with model chips,
          a configured badge and live ping status. */}
      <div className="card-sheen rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Bot className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">AI providers</span>
            {aiStatus && (
              <Badge variant="outline" className="font-mono text-[11px]">
                runtime: {aiStatus.environment}
              </Badge>
            )}
            {aiStatusLoading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="press" onClick={() => void refreshAiStatus()} disabled={aiStatusLoading}>
              {aiStatusLoading ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <RefreshCw className="mr-1.5 size-4" />}
              Refresh
            </Button>
            <Button variant="outline" size="sm" className="press" onClick={() => void probeAiProviders()} disabled={aiProbing}>
              {aiProbing ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Bot className="mr-1.5 size-4" />}
              Run live AI probe
            </Button>
          </div>
        </div>
        {aiStatus && (
          <div className="mt-3 space-y-2.5">
            {(aiStatus.routerHealth ?? []).map((h) => (
              <span key={h.provider} className="mr-3 inline-block font-mono text-[11px] text-muted-foreground">
                router {h.provider}: {h.state}
                {h.cooldownRemainingMs > 0 ? ` (cooldown ${Math.ceil(h.cooldownRemainingMs / 1000)}s)` : ""}
              </span>
            ))}
            {(aiStatus.providers ?? []).map((p) => {
              const models = p.models ?? [];
              return (
                <div key={p.id} className="rounded-lg border bg-muted/40 p-3 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{p.displayName}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">{p.id}</span>
                    {p.configured ? (
                      <Badge className="border-transparent bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                        configured
                      </Badge>
                    ) : (
                      <Badge variant="outline">not configured</Badge>
                    )}
                    {p.configured === false && p.status && (
                      <span className="text-muted-foreground">{p.status}</span>
                    )}
                  </div>
                  {models.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {models.map((m) => (
                        <span
                          key={m}
                          className={cn(
                            "rounded-md border px-1.5 py-0.5 font-mono text-[11px]",
                            m === p.defaultModel
                              ? "border-primary/30 bg-primary/10 text-primary"
                              : "bg-background text-muted-foreground"
                          )}
                        >
                          {m}
                          {m === p.defaultModel ? " · default" : ""}
                        </span>
                      ))}
                    </div>
                  )}
                  {p.ping && (
                    <p className={`mt-2 ${p.ping.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                      ping: {p.ping.ok ? "ok" : "failed"}
                      {p.ping.latencyMs != null ? ` · ${p.ping.latencyMs}ms` : ""}
                      {p.ping.httpStatus != null ? ` · HTTP ${p.ping.httpStatus}` : ""}
                      {p.ping.model ? ` · ${p.ping.model}` : ""}
                      {p.ping.errorCode ? ` · ${p.ping.errorCode}` : ""}
                      {p.ping.error ? <span className="block whitespace-pre-wrap font-sans text-muted-foreground">{p.ping.error}</span> : null}
                    </p>
                  )}
                  {p.listModels && (
                    <p className="mt-1 text-muted-foreground">
                      models valid: {p.listModels.availableConfiguredModels.length}/{p.listModels.availableConfiguredModels.length + p.listModels.missingConfiguredModels.length}
                      {p.listModels.missingConfiguredModels.length > 0 ? ` · missing: ${p.listModels.missingConfiguredModels.join(", ")}` : ""}
                      {p.listModels.error ? ` · ${p.listModels.error}` : ""}
                    </p>
                  )}
                  {p.keyInfo && (
                    <p className={`mt-1 ${p.keyInfo.valid ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                      {p.displayName} key: {p.keyInfo.valid ? "VALID" : "INVALID"}
                      {p.keyInfo.httpStatus != null ? ` (HTTP ${p.keyInfo.httpStatus})` : ""}
                      {p.keyInfo.isFreeTier ? " · free tier" : ""}
                      {p.keyInfo.usage != null ? ` · used ${p.keyInfo.usage}` : ""}
                      {p.keyInfo.limit != null ? ` / ${p.keyInfo.limit}` : ""}
                      {p.keyInfo.error ? <span className="block whitespace-pre-wrap font-sans text-muted-foreground">{p.keyInfo.error}</span> : null}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <AdminTable
        columns={["Plan", "Monthly", "Yearly", "Generations/mo", "Storage", "Safepay plan IDs", "State", "Actions"]}
        loading={plans.loading && !plans.data}
        error={plans.error}
        onRetry={() => void plans.refresh()}
        rowsCount={rows.length}
      >
        {rows.map((p) => (
          <tr key={p._id} className="border-b last:border-0 hover:bg-accent/30">
            <td className="px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{p.name}</span>
                {p.popular && <Badge className="bg-primary/10 text-primary">popular</Badge>}
                {p.contactSales && <Badge variant="outline">contact sales</Badge>}
              </div>
              <p className="mt-0.5 max-w-64 truncate text-xs text-muted-foreground">{p.description}</p>
            </td>
            <td className="px-4 py-3 text-sm tabular-nums">{p.priceMonthly > 0 ? formatPkr(p.priceMonthly) : "—"}</td>
            <td className="px-4 py-3 text-sm tabular-nums">{p.priceYearly > 0 ? formatPkr(p.priceYearly) : "—"}</td>
            <td className="px-4 py-3 text-sm tabular-nums">{p.maxAiGenerations >= 1000000 ? "∞" : p.maxAiGenerations.toLocaleString()}</td>
            <td className="px-4 py-3 text-sm tabular-nums">{(p.maxStorageMb / 1024).toFixed(p.maxStorageMb % 1024 === 0 ? 0 : 1)} GB</td>
            <td className="px-4 py-3">
              <div className="space-y-0.5 font-mono text-[11px] text-muted-foreground">
                <p className={p.safepayPlanIdMonthly ? "" : "text-amber-600 dark:text-amber-400"}>
                  M: {p.safepayPlanIdMonthly || "not mapped"}
                </p>
                <p className={p.safepayPlanIdYearly ? "" : "text-amber-600 dark:text-amber-400"}>
                  Y: {p.safepayPlanIdYearly || "not mapped"}
                </p>
              </div>
            </td>
            <td className="px-4 py-3">
              {p.active ? (
                <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">active</Badge>
              ) : (
                <Badge variant="outline">inactive</Badge>
              )}
            </td>
            <td className="px-4 py-3">
              <div className="flex justify-end gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() =>
                    setEditing({
                      _id: p._id,
                      name: p.name,
                      description: p.description,
                      tier: p.tier ?? "",
                      priceMonthly: p.priceMonthly,
                      priceYearly: p.priceYearly,
                      maxAiGenerations: p.maxAiGenerations,
                      maxStorageMb: p.maxStorageMb,
                      popular: p.popular,
                      active: p.active,
                      contactSales: Boolean(p.contactSales),
                      aiChatEnabled: p.aiChatEnabled !== false,
                      safepayPlanIdMonthly: p.safepayPlanIdMonthly ?? "",
                      safepayPlanIdYearly: p.safepayPlanIdYearly ?? "",
                    })
                  }
                  aria-label={`Edit ${p.name}`}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" className="size-8" onClick={() => setToggleTarget(p)} aria-label={`Toggle ${p.name}`}>
                  <Power className={`size-4 ${p.active ? "text-destructive" : "text-emerald-500"}`} />
                </Button>
              </div>
            </td>
          </tr>
        ))}
      </AdminTable>

      {/* Create/edit dialog */}
      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?._id ? `Edit ${editing.name}` : "Create plan"}</DialogTitle>
            <DialogDescription>
              Plans drive pricing and limits everywhere. Safepay plan IDs must match subscription plans in the Safepay
              merchant dashboard — checkout refuses plans without them.
            </DialogDescription>
          </DialogHeader>

          {editing && (
            <div className="grid gap-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Tier id</Label>
                  <Input value={editing.tier} placeholder="pro" onChange={(e) => setEditing({ ...editing, tier: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Monthly price (PKR)</Label>
                  <Input type="number" min={0} value={editing.priceMonthly} onChange={(e) => setEditing({ ...editing, priceMonthly: Number(e.target.value) })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Yearly price (PKR)</Label>
                  <Input type="number" min={0} value={editing.priceYearly} onChange={(e) => setEditing({ ...editing, priceYearly: Number(e.target.value) })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Generations / month</Label>
                  <Input type="number" min={-1} value={editing.maxAiGenerations} onChange={(e) => setEditing({ ...editing, maxAiGenerations: Number(e.target.value) })} />
                  <p className="text-[11px] text-muted-foreground">-1 = unlimited</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Storage (MB)</Label>
                  <Input type="number" min={1} value={editing.maxStorageMb} onChange={(e) => setEditing({ ...editing, maxStorageMb: Number(e.target.value) })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Safepay plan ID (monthly)</Label>
                  <Input value={editing.safepayPlanIdMonthly} placeholder="pro-monthly" onChange={(e) => setEditing({ ...editing, safepayPlanIdMonthly: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Safepay plan ID (yearly)</Label>
                  <Input value={editing.safepayPlanIdYearly} placeholder="pro-yearly" onChange={(e) => setEditing({ ...editing, safepayPlanIdYearly: e.target.value })} />
                </div>
              </div>
              <div className="flex flex-wrap gap-6 pt-1">
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={editing.active} onCheckedChange={(v) => setEditing({ ...editing, active: v })} /> Active
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={editing.popular} onCheckedChange={(v) => setEditing({ ...editing, popular: v })} /> Popular badge
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={editing.contactSales} onCheckedChange={(v) => setEditing({ ...editing, contactSales: v })} /> Contact sales
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={editing.aiChatEnabled} onCheckedChange={(v) => setEditing({ ...editing, aiChatEnabled: v })} /> AI generation
                </label>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                "AI generation" controls whether subscribers on this plan may create documents with AI. Turn it off to
                make the plan storage-only (this is the Free plan's default).
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => void save()} disabled={saving || !editing?.name}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              {editing?._id ? "Save changes" : "Create plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(toggleTarget)}
        onOpenChange={(o) => !o && setToggleTarget(null)}
        title={`${toggleTarget?.active ? "Deactivate" : "Activate"} ${toggleTarget?.name ?? ""}?`}
        description={
          toggleTarget?.active
            ? "The plan disappears from pricing and can't be purchased. Existing subscribers keep their entitlements."
            : "The plan becomes purchasable again on pricing and billing pages."
        }
        confirmLabel={toggleTarget?.active ? "Deactivate" : "Activate"}
        destructive={toggleTarget?.active}
        loading={saving}
        onConfirm={() => void toggleActive()}
      />
    </div>
  );
}
