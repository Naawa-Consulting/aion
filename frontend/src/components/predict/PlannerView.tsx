"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { formatChartNumber } from "@/lib/chart-format";

export type ChannelAllocation = {
  channel_id: string;
  name: string;
  proxy_variable: string;
  suggested_spend: number;
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

const EXCLUSION_LABELS: Record<string, string> = {
  not_modeled: "sin variable en el modelo actual",
  no_transform_params: "sin curva de saturación ajustada",
  no_dollar_rate: "costo no ligado a la variable modelada",
};

export default function PlannerView({
  modelId,
  onApply,
}: {
  modelId: string;
  onApply?: (allocations: ChannelAllocation[]) => void;
}) {
  const [budget, setBudget] = useState<number>(0);
  const [result, setResult] = useState<BudgetOptimizationOut | null>(null);
  const [editedSpend, setEditedSpend] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  const handleOptimize = async () => {
    if (!modelId) {
      toast.error("Selecciona un modelo primero");
      return;
    }
    if (!budget || budget <= 0) {
      toast.error("Ingresa un presupuesto mayor a 0");
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
        toast.error("Ningún canal configurado es optimizable todavía (revisa Transform → Investment channels).");
      }
    } catch (error: any) {
      toast.error(error?.message || "No se pudo optimizar el presupuesto");
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
    toast.success("Asignación aplicada al escenario — usa 'Preview scenario' para ver el resultado proyectado.");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-2 text-sm">
          Presupuesto total
          <input
            type="number"
            min={0}
            className="rounded-lg border border-[var(--color-border)] px-3 py-2 bg-transparent"
            value={budget || ""}
            onChange={(event) => setBudget(Number(event.target.value) || 0)}
          />
        </label>
        <Button onClick={handleOptimize} disabled={loading || !modelId}>
          {loading ? "Optimizando..." : "Optimizar presupuesto"}
        </Button>
        {onApply && result && result.allocations.length > 0 && (
          <Button variant="secondary" onClick={handleApply}>
            Aplicar al escenario
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
                  <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">
                    Gasto sugerido
                    <input
                      type="number"
                      min={0}
                      className="rounded-lg border border-[var(--color-border)] px-3 py-2 bg-transparent text-sm text-[var(--color-foreground)]"
                      value={editedSpend[allocation.proxy_variable] ?? allocation.suggested_spend}
                      onChange={(event) =>
                        setEditedSpend((prev) => ({
                          ...prev,
                          [allocation.proxy_variable]: Number(event.target.value) || 0,
                        }))
                      }
                    />
                  </label>
                  <p className="text-xs text-[var(--color-muted)]">
                    Contribución proyectada: {formatChartNumber(allocation.projected_contribution, 1)}
                  </p>
                  {allocation.projected_revenue !== null && (
                    <p className="text-xs text-[var(--color-muted)]">
                      Ingreso proyectado: {formatChartNumber(allocation.projected_revenue, 1)}
                    </p>
                  )}
                </Card>
              ))}
            </div>
          )}
          {result.excluded_channels.length > 0 && (
            <p className="text-xs text-[var(--color-muted)]">
              Sin optimizar: {result.excluded_channels
                .map((channel) => `${channel.name} (${EXCLUSION_LABELS[channel.reason] ?? channel.reason})`)
                .join(", ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
