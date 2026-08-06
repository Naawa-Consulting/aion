"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiFetch, ApiError } from "@/lib/api";

type ChannelEconomics = {
  id: string;
  name: string;
  source_mode: string;
  proxy_variable: string | null;
  is_modeled: boolean;
  proxy_in_current_model: boolean;
  misconfigured: boolean;
  investment: number;
  revenue: number | null;
  contribution: number | null;
  roi: number | null;
  roas: number | null;
  share_of_investment: number;
  share_of_contribution: number | null;
};

type EconomicsSummary = {
  model: {
    id: string;
    name: string;
    dataset_id: string;
    y_var: string;
    x_vars: string[];
    conversion_rate: number | null;
    avg_value: number | null;
  };
  economics_configured: boolean;
  totals: {
    investment: number;
    revenue: number;
    contribution: number;
    roi: number | null;
    roas: number | null;
    modeled_investment: number;
    non_modeled_investment: number;
  };
  channels: ChannelEconomics[];
};

type EconomicsStacked = {
  index: string[];
  totals: { investment: number[]; revenue: number[] };
  series: {
    channel_id: string;
    channel_name: string;
    is_modeled: boolean;
    investment: number[];
    revenue: (number | null)[];
  }[];
};

const DASH = "-";

function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

const fmt = (value: number | null | undefined, digits = 0) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? DASH
    : value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });

const fmtPct = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value) ? DASH : `${(value * 100).toFixed(1)}%`;

const fmtMultiple = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value) ? DASH : `${value.toFixed(2)}x`;

export function EconomicsSection({
  modelId,
  timeCol,
  freq,
  dateRange,
  readyForTimeseries,
}: {
  modelId: string;
  timeCol: string;
  freq: "day" | "week" | "month";
  dateRange: { start: string | null; end: string | null };
  readyForTimeseries: boolean;
}) {
  const [summary, setSummary] = useState<EconomicsSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [stacked, setStacked] = useState<EconomicsStacked | null>(null);
  const [stackedLoading, setStackedLoading] = useState(false);
  const [stackedError, setStackedError] = useState<string | null>(null);
  const [highlightedChannel, setHighlightedChannel] = useState<string>("");

  const fetchSummary = useCallback(async () => {
    if (!modelId) {
      setSummary(null);
      return;
    }
    setSummaryLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateRange.start) params.set("start_date", dateRange.start);
      if (dateRange.end) params.set("end_date", dateRange.end);
      const data = await apiFetch<EconomicsSummary>(`/economics/${modelId}/summary?${params.toString()}`);
      setSummary(data);
    } catch (err) {
      toast.error(
        (err instanceof ApiError ? err.message : (err as Error)?.message) || "Failed to load economics summary"
      );
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  }, [modelId, dateRange.start, dateRange.end]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const fetchStacked = useCallback(async () => {
    if (!modelId || !readyForTimeseries) return;
    setStackedLoading(true);
    setStackedError(null);
    try {
      const params = new URLSearchParams({ time_col: timeCol, freq });
      if (dateRange.start) params.set("start_date", dateRange.start);
      if (dateRange.end) params.set("end_date", dateRange.end);
      const data = await apiFetch<EconomicsStacked>(`/economics/${modelId}/stacked?${params.toString()}`);
      setStacked(data);
    } catch (err) {
      setStacked(null);
      setStackedError(
        (err instanceof ApiError ? err.message : (err as Error)?.message) || "Failed to load economics timeseries"
      );
    } finally {
      setStackedLoading(false);
    }
  }, [modelId, readyForTimeseries, timeCol, freq, dateRange.start, dateRange.end]);

  useEffect(() => {
    const handle = setTimeout(() => {
      fetchStacked();
    }, 250);
    return () => clearTimeout(handle);
  }, [fetchStacked]);

  useEffect(() => {
    setHighlightedChannel("");
  }, [modelId]);

  const chartData = useMemo(() => {
    if (!stacked) return [];
    const selected = stacked.series.find((s) => s.channel_id === highlightedChannel);
    return stacked.index.map((label, idx) => ({
      period: label,
      investment: stacked.totals.investment[idx],
      revenue: stacked.totals.revenue[idx],
      channel_investment: selected ? selected.investment[idx] : undefined,
      channel_revenue: selected ? selected.revenue[idx] ?? undefined : undefined,
    }));
  }, [stacked, highlightedChannel]);

  const downloadSummaryXlsx = async () => {
    if (!modelId) return;
    const params = new URLSearchParams();
    if (dateRange.start) params.set("start_date", dateRange.start);
    if (dateRange.end) params.set("end_date", dateRange.end);
    try {
      const blob = await apiFetch<Blob>(`/economics/${modelId}/export/summary.xlsx?${params.toString()}`, {
        responseType: "blob",
      });
      downloadBlob(blob, "economics-summary.xlsx");
    } catch (err) {
      toast.error(
        (err instanceof ApiError ? err.message : (err as Error)?.message) || "Failed to export economics summary"
      );
    }
  };

  const downloadStackedXlsx = async () => {
    if (!modelId || !readyForTimeseries) return;
    const params = new URLSearchParams({ time_col: timeCol, freq });
    if (dateRange.start) params.set("start_date", dateRange.start);
    if (dateRange.end) params.set("end_date", dateRange.end);
    try {
      const blob = await apiFetch<Blob>(`/economics/${modelId}/export/stacked.xlsx?${params.toString()}`, {
        responseType: "blob",
      });
      downloadBlob(blob, "economics-stacked.xlsx");
    } catch (err) {
      toast.error(
        (err instanceof ApiError ? err.message : (err as Error)?.message) || "Failed to export economics timeseries"
      );
    }
  };

  if (summaryLoading && !summary) {
    return (
      <Card>
        <p className="text-sm text-[var(--color-muted)]">Loading economics…</p>
      </Card>
    );
  }
  if (!summary) {
    return (
      <Card>
        <p className="text-sm text-[var(--color-muted)]">Select a model to view economics.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {!summary.economics_configured && (
        <Card className="border-amber-400/60 bg-amber-50/50 dark:bg-amber-500/10">
          <p className="text-sm">
            Configura tasa de conversión y valor promedio en{" "}
            <Link href="/modeling" className="underline font-medium">
              Modelado
            </Link>{" "}
            para calcular ROI/ROAS de este modelo.
          </p>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card padding="sm">
          <CardHeader title="Inversión total" subtitle="Todos los canales" />
          <p className="text-lg font-semibold">{fmt(summary.totals.investment)}</p>
        </Card>
        <Card padding="sm">
          <CardHeader title="Ingreso total" subtitle="Canales modelados" />
          <p className="text-lg font-semibold">{fmt(summary.totals.revenue)}</p>
        </Card>
        <Card padding="sm">
          <CardHeader title="ROI" subtitle="(ingreso − inversión) / inversión" />
          <p className="text-lg font-semibold">{fmtPct(summary.totals.roi)}</p>
        </Card>
        <Card padding="sm">
          <CardHeader title="ROAS" subtitle="ingreso / inversión" />
          <p className="text-lg font-semibold">{fmtMultiple(summary.totals.roas)}</p>
        </Card>
      </div>

      <Card className="space-y-4">
        <CardHeader title="Canales" subtitle="Inversión real vs. contribución modelada" />
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--color-bg)]/70">
              <tr>
                <th className="px-3 py-2 text-left">Canal</th>
                <th className="px-3 py-2 text-left">Estado</th>
                <th className="px-3 py-2 text-right">Inversión</th>
                <th className="px-3 py-2 text-right">Ingreso</th>
                <th className="px-3 py-2 text-right">ROI</th>
                <th className="px-3 py-2 text-right">ROAS</th>
                <th className="px-3 py-2 text-right">% inversión</th>
                <th className="px-3 py-2 text-right">% contribución</th>
              </tr>
            </thead>
            <tbody>
              {summary.channels.map((ch) => (
                <tr key={ch.id} className="odd:bg-transparent even:bg-[var(--color-border)]/20">
                  <td className="px-3 py-2">
                    <span className="mr-2">{ch.name}</span>
                    {ch.misconfigured && <Badge variant="warning">mal configurado</Badge>}
                  </td>
                  <td className="px-3 py-2">
                    {ch.is_modeled ? (
                      <Badge variant="success">modelado</Badge>
                    ) : ch.proxy_variable && !ch.proxy_in_current_model ? (
                      <Badge variant="warning">proxy no usado por este modelo</Badge>
                    ) : (
                      <Badge>no modelado</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">{fmt(ch.investment)}</td>
                  <td className="px-3 py-2 text-right">{ch.revenue != null ? fmt(ch.revenue) : DASH}</td>
                  <td className="px-3 py-2 text-right">{ch.roi != null ? fmtPct(ch.roi) : DASH}</td>
                  <td className="px-3 py-2 text-right">{ch.roas != null ? fmtMultiple(ch.roas) : DASH}</td>
                  <td className="px-3 py-2 text-right">{fmtPct(ch.share_of_investment)}</td>
                  <td className="px-3 py-2 text-right">
                    {ch.share_of_contribution != null ? fmtPct(ch.share_of_contribution) : DASH}
                  </td>
                </tr>
              ))}
              {summary.channels.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-4 text-center text-[var(--color-muted)]">
                    Sin canales configurados. Ve a Transform para agregar canales de inversión.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end">
          <Button variant="ghost" onClick={downloadSummaryXlsx}>
            Export Excel
          </Button>
        </div>
      </Card>

      <Card className="space-y-4">
        <CardHeader title="Inversión vs. ingreso en el tiempo" subtitle="Total por periodo, con canal opcional resaltado" />
        {!readyForTimeseries ? (
          <p className="text-sm text-[var(--color-muted)]">
            Selecciona una columna de tiempo en la sección de Contribución para ver la serie.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <select
                className="rounded-full border border-[var(--color-border)] px-3 py-1.5 bg-transparent"
                value={highlightedChannel}
                onChange={(e) => setHighlightedChannel(e.target.value)}
              >
                <option value="">Resaltar canal (opcional)</option>
                {(stacked?.series || []).map((s) => (
                  <option key={s.channel_id} value={s.channel_id}>
                    {s.channel_name}
                  </option>
                ))}
              </select>
            </div>
            <div
              className={`h-80 transition-opacity duration-300 ${
                stackedLoading ? "opacity-40 pointer-events-none" : "opacity-100"
              }`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 24, left: 24, bottom: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" tickMargin={8} />
                  <YAxis tickMargin={12} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="investment" name="Inversión total" stroke="#ef4444" dot={false} />
                  <Line type="monotone" dataKey="revenue" name="Ingreso total" stroke="#22c55e" dot={false} />
                  {highlightedChannel && (
                    <Line
                      type="monotone"
                      dataKey="channel_investment"
                      name="Inversión (canal)"
                      stroke="#ef4444"
                      strokeDasharray="4 4"
                      dot={false}
                    />
                  )}
                  {highlightedChannel && (
                    <Line
                      type="monotone"
                      dataKey="channel_revenue"
                      name="Ingreso (canal)"
                      stroke="#22c55e"
                      strokeDasharray="4 4"
                      dot={false}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
            {stackedError && !stackedLoading && (
              <p className="text-xs text-red-500">Couldn&rsquo;t load economics timeseries. Please try again.</p>
            )}
            <div className="flex justify-end">
              <Button variant="ghost" onClick={downloadStackedXlsx} disabled={!stacked || stackedLoading}>
                Export Excel
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
