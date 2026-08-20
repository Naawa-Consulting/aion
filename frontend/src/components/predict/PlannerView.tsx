"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Badge } from "@/components/ui/badge";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { apiFetch, ApiError } from "@/lib/api";
import { translateApiError } from "@/lib/error-messages";
import { formatChartNumber, formatCurrency } from "@/lib/chart-format";
import { chartColor } from "@/lib/chart-colors";
import { useActiveCurrency } from "@/hooks/useActiveCompany";
import { useGlobalStore } from "@/lib/store";
import { useTheme } from "next-themes";

export type BudgetObjective = "max_revenue" | "max_roi" | "min_spend";

export type CurrentAllocation = { proxy_variable: string; name: string; current_spend: number };

export type ChannelAllocation = {
  channel_id: string;
  name: string;
  proxy_variable: string;
  suggested_spend: number;
  // Dollars per unit of proxy_variable. `suggested_spend` is in dollars, but the scenario/model
  // pipeline works in the variable's native units — divide by this before writing an allocation
  // into a scenario's adjustments (see predict/page.tsx::handleApplyAllocations).
  dollar_rate: number;
  projected_contribution: number;
  projected_revenue: number | null;
  // Fase 5/P5: historical_max_spend is null when it couldn't be computed (no usable history) —
  // treat as "no known ceiling", not zero.
  historical_max_spend: number | null;
  out_of_historical_range: boolean;
  low_marginal_return: boolean;
};

type ExcludedChannel = { channel_id: string; name: string; reason: string };

export type BudgetOptimizationOut = {
  allocations: ChannelAllocation[];
  excluded_channels: ExcludedChannel[];
  total_budget: number;
  total_projected_contribution: number;
  total_projected_revenue: number | null;
  economics_configured: boolean;
};

const EXCLUSION_KEYS: Record<string, string> = {
  not_modeled: "notModeled",
  no_transform_params: "noTransformParams",
  no_dollar_rate: "noDollarRate",
};

// Native <input type="number"> can't show thousands separators and renders the raw float
// (many decimals) untouched, which is what made suggested spend look wrong to users even when
// the underlying value was fine. This mirrors ScenarioSheetGlide's formatNumericDisplay: a plain
// text input that displays a formatted, 2-decimal value and only re-parses on blur (formatting
// on every keystroke would fight the cursor while typing).
function SpendInput({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  const [text, setText] = useState(() => formatChartNumber(value, 2));

  useEffect(() => {
    setText(formatChartNumber(value, 2));
  }, [value]);

  return (
    <Input
      type="text"
      inputMode="decimal"
      className="mt-1"
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        const parsed = Number(text.replace(/,/g, ""));
        const next = Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
        onChange(next);
        setText(formatChartNumber(next, 2));
      }}
    />
  );
}

// Fase 5/P7: Base (current grid state) vs. Optimized (this panel's live suggestion) media mix —
// two stacked-proportion bars, plain divs rather than a new chart dependency for something this
// simple. Percent of each bar, not absolute $, since the two totals usually differ (a suggestion
// rarely sums to exactly today's spend).
function MediaMixComparison({
  allocations,
  editedSpend,
  baseByProxy,
  isDarkTheme,
  baseLabel,
  optimizedLabel,
  title,
}: {
  allocations: ChannelAllocation[];
  editedSpend: Record<string, number>;
  baseByProxy: Record<string, number>;
  isDarkTheme: boolean;
  baseLabel: string;
  optimizedLabel: string;
  title: string;
}) {
  const proxies = allocations.map((a) => a.proxy_variable);
  const baseTotal = proxies.reduce((sum, p) => sum + (baseByProxy[p] ?? 0), 0);
  const optimizedTotal = allocations.reduce((sum, a) => sum + (editedSpend[a.proxy_variable] ?? a.suggested_spend), 0);

  const segments = (getValue: (proxy: string) => number, total: number) =>
    allocations.map((a, idx) => ({
      key: a.proxy_variable,
      name: a.name,
      pct: total > 0 ? (getValue(a.proxy_variable) / total) * 100 : 0,
      color: chartColor(idx, isDarkTheme),
    }));

  const baseSegments = segments((p) => baseByProxy[p] ?? 0, baseTotal);
  const optimizedSegments = segments((p) => editedSpend[p] ?? allocations.find((a) => a.proxy_variable === p)?.suggested_spend ?? 0, optimizedTotal);

  const Bar = ({ segs, label }: { segs: ReturnType<typeof segments>; label: string }) => (
    <div className="space-y-1">
      <p className="text-xs text-muted">{label}</p>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-line">
        {segs.map((s) => (s.pct > 0 ? <div key={s.key} style={{ width: `${s.pct}%`, backgroundColor: s.color }} title={`${s.name}: ${s.pct.toFixed(1)}%`} /> : null))}
      </div>
    </div>
  );

  return (
    <div className="space-y-2 rounded-xl border border-line p-3">
      <p className="text-sm font-medium text-ink">{title}</p>
      <Bar segs={baseSegments} label={baseLabel} />
      <Bar segs={optimizedSegments} label={optimizedLabel} />
      <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
        {allocations.map((a, idx) => (
          <span key={a.proxy_variable} className="inline-flex items-center gap-1.5 text-xs text-muted">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: chartColor(idx, isDarkTheme) }} />
            {a.name}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function PlannerView({
  modelId,
  onApply,
  currentAllocations = [],
}: {
  modelId: string;
  onApply?: (allocations: ChannelAllocation[]) => void;
  // Fase 5/P4: the grid's own current $ allocation per channel (same unit as `suggested_spend` —
  // steady-state $ total across the whole horizon), so this panel can precharge the budget input
  // and show "current vs. suggested" instead of always starting from a blank slate.
  currentAllocations?: CurrentAllocation[];
}) {
  const t = useTranslations("planner");
  const tErrors = useTranslations("errors");
  const currency = useActiveCurrency();
  const { resolvedTheme } = useTheme();
  const isDarkTheme = resolvedTheme === "dark";
  const { startLongOperation, endLongOperation } = useGlobalStore();
  const [budget, setBudget] = useState<number>(0);
  const [objective, setObjective] = useState<BudgetObjective>("max_revenue");
  const [marginalRoiThresholdPct, setMarginalRoiThresholdPct] = useState<number>(0);
  const [targetRevenue, setTargetRevenue] = useState<number>(0);
  const [result, setResult] = useState<BudgetOptimizationOut | null>(null);
  const [editedSpend, setEditedSpend] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  const currentTotal = useMemo(
    () => currentAllocations.reduce((sum, c) => sum + (Number.isFinite(c.current_spend) ? c.current_spend : 0), 0),
    [currentAllocations]
  );
  const currentByProxy = useMemo(() => {
    const map: Record<string, number> = {};
    currentAllocations.forEach((c) => {
      map[c.proxy_variable] = c.current_spend;
    });
    return map;
  }, [currentAllocations]);

  // Precharge the budget input from the grid's current total exactly once, the first time a
  // nonzero current total becomes available — never overwrites a budget the user already typed.
  const prechargedRef = useRef(false);
  useEffect(() => {
    if (prechargedRef.current) return;
    if (budget > 0) {
      prechargedRef.current = true;
      return;
    }
    if (currentTotal > 0) {
      setBudget(Math.round(currentTotal));
      prechargedRef.current = true;
    }
  }, [currentTotal, budget]);

  const handleOptimize = async () => {
    if (!modelId) {
      toast.error(t("selectModelFirst"));
      return;
    }
    if (!budget || budget <= 0) {
      toast.error(t("budgetRequired"));
      return;
    }
    if (objective === "min_spend" && (!targetRevenue || targetRevenue <= 0)) {
      toast.error(t("targetRevenueRequired"));
      return;
    }
    setLoading(true);
    startLongOperation(t("optimizing"));
    try {
      const data = await apiFetch<BudgetOptimizationOut>(`/economics/${modelId}/optimize-budget`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          budget,
          objective,
          marginal_roi_threshold: objective === "max_roi" ? marginalRoiThresholdPct / 100 : undefined,
          target_revenue: objective === "min_spend" ? targetRevenue : undefined,
        }),
      });
      setResult(data);
      setEditedSpend(
        Object.fromEntries(data.allocations.map((allocation) => [allocation.proxy_variable, allocation.suggested_spend]))
      );
      if (!data.allocations.length) {
        toast.error(t("noOptimizableChannels"));
      }
    } catch (error) {
      toast.error(error instanceof ApiError ? translateApiError(error, tErrors) : t("optimizeFailed"));
    } finally {
      setLoading(false);
      endLongOperation();
    }
  };

  const handleApply = () => {
    if (!result || !onApply) return;
    onApply(
      result.allocations.map((allocation) => ({
        ...allocation,
        suggested_spend: editedSpend[allocation.proxy_variable] ?? allocation.suggested_spend,
      }))
    );
    toast.success(t("applied"));
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Eyebrow>{t("objectiveLabel")}</Eyebrow>
        <div className="inline-flex flex-wrap gap-1">
          <ToggleChip active={objective === "max_revenue"} onClick={() => setObjective("max_revenue")}>
            {t("objectives.maxRevenue")}
          </ToggleChip>
          <ToggleChip active={objective === "max_roi"} onClick={() => setObjective("max_roi")}>
            {t("objectives.maxRoi")}
          </ToggleChip>
          <ToggleChip active={objective === "min_spend"} onClick={() => setObjective("min_spend")}>
            {t("objectives.minSpend")}
          </ToggleChip>
        </div>
        <p className="text-xs text-muted">{t(`objectives.${objective === "max_revenue" ? "maxRevenueHint" : objective === "max_roi" ? "maxRoiHint" : "minSpendHint"}`)}</p>
      </div>

      {currentAllocations.length > 0 && (
        <div className="rounded-xl border border-line bg-surface-2 p-3 text-xs text-muted">
          <p className="font-medium text-ink">
            {t("currentStateTitle", { value: formatCurrency(currentTotal, currency, 0) })}
          </p>
          <ul className="mt-1 space-y-0.5">
            {currentAllocations.map((c) => (
              <li key={c.proxy_variable} className="flex justify-between gap-4">
                <span className="truncate">{c.name}</span>
                <span className="tabular-nums text-ink">{formatCurrency(c.current_spend, currency, 0)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-2 text-sm text-ink">
          {objective === "min_spend" ? t("budgetCapLabel") : t("budgetLabel")}
          <Input
            type="number"
            min={0}
            value={budget || ""}
            onChange={(event) => setBudget(Number(event.target.value) || 0)}
          />
        </label>
        {objective === "max_roi" && (
          <label className="flex flex-col gap-2 text-sm text-ink">
            {t("marginalRoiThresholdLabel")}
            <Input
              type="number"
              min={0}
              value={marginalRoiThresholdPct || ""}
              onChange={(event) => setMarginalRoiThresholdPct(Number(event.target.value) || 0)}
            />
          </label>
        )}
        {objective === "min_spend" && (
          <label className="flex flex-col gap-2 text-sm text-ink">
            {t("targetRevenueLabel")}
            <Input
              type="number"
              min={0}
              value={targetRevenue || ""}
              onChange={(event) => setTargetRevenue(Number(event.target.value) || 0)}
            />
          </label>
        )}
        <Button onClick={handleOptimize} disabled={!modelId} loading={loading}>
          {loading ? t("optimizing") : t("optimize")}
        </Button>
        {onApply && result && result.allocations.length > 0 && (
          <Button variant="secondary" onClick={handleApply}>
            {t("apply")}
          </Button>
        )}
      </div>

      {result && (
        <div className="space-y-3">
          {result.allocations.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {result.allocations.map((allocation) => (
                <Card key={allocation.channel_id} padding="sm" className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardHeader title={allocation.name} subtitle={allocation.proxy_variable} />
                    <div className="flex flex-col items-end gap-1">
                      {allocation.out_of_historical_range && (
                        <Badge variant="warning">{t("outOfHistoricalRange")}</Badge>
                      )}
                      {allocation.low_marginal_return && (
                        <Badge variant="neutral">{t("lowMarginalReturn")}</Badge>
                      )}
                    </div>
                  </div>
                  <label className="flex flex-col gap-1">
                    <Eyebrow>{t("suggestedSpend")}</Eyebrow>
                    <SpendInput
                      value={editedSpend[allocation.proxy_variable] ?? allocation.suggested_spend}
                      onChange={(next) =>
                        setEditedSpend((prev) => ({
                          ...prev,
                          [allocation.proxy_variable]: next,
                        }))
                      }
                    />
                  </label>
                  {currentByProxy[allocation.proxy_variable] != null && (
                    <p className="text-xs text-muted">
                      {t("currentSpend", { value: formatCurrency(currentByProxy[allocation.proxy_variable], currency, 0) })}
                    </p>
                  )}
                  {allocation.historical_max_spend != null && (
                    <p className="text-xs text-muted">
                      {t("historicalMax", { value: formatCurrency(allocation.historical_max_spend, currency, 0) })}
                    </p>
                  )}
                  <p className="text-xs text-muted">
                    {t("projectedContribution", { value: formatChartNumber(allocation.projected_contribution, 1) })}
                  </p>
                  {allocation.projected_revenue !== null && (
                    <p className="text-xs text-muted">
                      {t("projectedRevenue", { value: formatCurrency(allocation.projected_revenue, currency, 1) })}
                    </p>
                  )}
                </Card>
              ))}
            </div>
          )}
          {result.allocations.length > 0 && currentTotal > 0 && (
            <MediaMixComparison
              allocations={result.allocations}
              editedSpend={editedSpend}
              baseByProxy={currentByProxy}
              isDarkTheme={isDarkTheme}
              baseLabel={t("mediaMixBase")}
              optimizedLabel={t("mediaMixOptimized")}
              title={t("mediaMixTitle")}
            />
          )}
          {result.excluded_channels.length > 0 && (
            <p className="text-xs text-muted">
              {t("excluded", {
                value: result.excluded_channels
                  .map((channel) => {
                    const key = EXCLUSION_KEYS[channel.reason];
                    const reasonLabel = key ? t(`exclusions.${key}`) : channel.reason;
                    return `${channel.name} (${reasonLabel})`;
                  })
                  .join(", "),
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
