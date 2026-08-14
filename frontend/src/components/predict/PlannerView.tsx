"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eyebrow } from "@/components/ui/eyebrow";
import { apiFetch } from "@/lib/api";
import { formatChartNumber, formatCurrency } from "@/lib/chart-format";
import { useActiveCurrency } from "@/hooks/useActiveCompany";

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

export default function PlannerView({
  modelId,
  onApply,
}: {
  modelId: string;
  onApply?: (allocations: ChannelAllocation[]) => void;
}) {
  const t = useTranslations("planner");
  const currency = useActiveCurrency();
  const [budget, setBudget] = useState<number>(0);
  const [result, setResult] = useState<BudgetOptimizationOut | null>(null);
  const [editedSpend, setEditedSpend] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  const handleOptimize = async () => {
    if (!modelId) {
      toast.error(t("selectModelFirst"));
      return;
    }
    if (!budget || budget <= 0) {
      toast.error(t("budgetRequired"));
      return;
    }
    setLoading(true);
    try {
      const data = await apiFetch<BudgetOptimizationOut>(`/economics/${modelId}/optimize-budget`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budget }),
      });
      setResult(data);
      setEditedSpend(
        Object.fromEntries(data.allocations.map((allocation) => [allocation.proxy_variable, allocation.suggested_spend]))
      );
      if (!data.allocations.length) {
        toast.error(t("noOptimizableChannels"));
      }
    } catch (error: any) {
      toast.error(error?.message || t("optimizeFailed"));
    } finally {
      setLoading(false);
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
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-2 text-sm text-ink">
          {t("budgetLabel")}
          <Input
            type="number"
            min={0}
            value={budget || ""}
            onChange={(event) => setBudget(Number(event.target.value) || 0)}
          />
        </label>
        <Button onClick={handleOptimize} disabled={loading || !modelId}>
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
                  <CardHeader title={allocation.name} subtitle={allocation.proxy_variable} />
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
