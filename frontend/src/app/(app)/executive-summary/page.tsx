"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from "recharts";
import { Info, Printer, Download } from "lucide-react";

import { Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { apiFetch } from "@/lib/api";
import { EMPTY_VALUE } from "@/lib/format";
import { formatChartNumber, formatChartPercent } from "@/lib/chart-format";
import { assignCategoricalColors } from "@/lib/chart-colors";
import { useGlobalStore } from "@/lib/store";
import { downloadBlob } from "@/lib/download";
import { translateApiError } from "@/lib/error-messages";

type Dataset = { id: string; display_name: string };
type Model = { id: string; name: string; role: string | null; r2: number | null; adj_r2: number | null };
type GroupContribution = { group_id: string | null; group_name: string | null; contribution: number; percent: number };
type Summary = {
  model: { id: string; name: string; y_var: string };
  total_contribution: number;
  groups: GroupContribution[];
};
type EconomicsTotals = {
  investment: number;
  revenue: number;
  contribution: number;
  roi: number | null;
  roas: number | null;
};
type EconomicsSummary = { economics_configured: boolean; totals: EconomicsTotals };
type DateBounds = { min: string | null; max: string | null };

const clampDateValue = (value: string | null, bounds: DateBounds): string | null => {
  if (!value) return null;
  let next = value;
  if (bounds.min && next < bounds.min) next = bounds.min;
  if (bounds.max && next > bounds.max) next = bounds.max;
  return next;
};

const clampRange = (
  range: { start: string | null; end: string | null },
  bounds: DateBounds,
  changed: "start" | "end" | "bounds" = "bounds"
) => {
  const start = clampDateValue(range.start, bounds);
  const end = clampDateValue(range.end, bounds);
  if (start && end && start > end) {
    if (changed === "end") return { start: end, end };
    return { start, end: start };
  }
  return { start, end };
};

const pctLabel = (value: number | null | undefined, decimals = 1) =>
  value === null || value === undefined || !Number.isFinite(value) ? EMPTY_VALUE : formatChartPercent(value, decimals);
const roasLabel = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value) ? EMPTY_VALUE : `${value.toFixed(2)}x`;

function SecondaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-control-md items-center rounded-lg bg-accent-bg px-4 text-sm font-medium text-accent hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
    >
      {children}
    </Link>
  );
}

function InfoTooltip({ label, content }: { label: string; content: string }) {
  return (
    <Tooltip
      content={
        <span style={{ whiteSpace: "normal", display: "block", maxWidth: 220 }}>{content}</span>
      }
    >
      <button
        type="button"
        aria-label={label}
        className="rounded-full p-0.5 text-muted transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
    </Tooltip>
  );
}

export default function ExecutiveSummaryPage() {
  const t = useTranslations("executiveSummary");
  const tErrors = useTranslations("errors");
  const { resolvedTheme } = useTheme();
  const isDarkTheme = resolvedTheme === "dark";
  const mutedColor = isDarkTheme ? "#81858e" : "#6d7178";
  const lineColor = isDarkTheme ? "#262a2f" : "#e5e6ea";
  const surfaceColor = isDarkTheme ? "#16181b" : "#ffffff";
  const inkColor = isDarkTheme ? "#f2f3f5" : "#17181c";
  const { activeCompanyId } = useGlobalStore();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDataset, setSelectedDataset] = useState("");
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [economics, setEconomics] = useState<EconomicsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [dateBounds, setDateBounds] = useState<DateBounds>({ min: null, max: null });
  const [dateRange, setDateRange] = useState<{ start: string | null; end: string | null }>({ start: null, end: null });
  const [printedAt, setPrintedAt] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const handleBeforePrint = () => setPrintedAt(new Date().toLocaleString());
    window.addEventListener("beforeprint", handleBeforePrint);
    return () => window.removeEventListener("beforeprint", handleBeforePrint);
  }, []);

  const fetchDatasets = useCallback(async () => {
    try {
      const data = await apiFetch<Dataset[]>("/datasets");
      setDatasets(data);
      if (data.length) setSelectedDataset((prev) => prev || data[0].id);
    } catch {
      toast.error("Failed to load datasets");
    } finally {
      setInitializing(false);
    }
  }, []);

  const fetchDatasetMeta = useCallback(async (datasetId: string) => {
    try {
      const raw = await apiFetch<any>(`/datasets/${datasetId}/meta`);
      const bounds: DateBounds = { min: raw.date_min ?? null, max: raw.date_max ?? null };
      setDateBounds(bounds);
      setDateRange(clampRange({ start: bounds.min, end: bounds.max }, bounds, "bounds"));
    } catch {
      setDateBounds({ min: null, max: null });
      setDateRange({ start: null, end: null });
    }
  }, []);

  const fetchModels = useCallback(async (datasetId: string) => {
    try {
      const data = await apiFetch<any[]>(`/datasets/${datasetId}/models-with-roles`);
      const normalized: Model[] = data.map((m: any) => ({
        id: m.id,
        name: m.name,
        role: !m.role || m.role === "none" ? null : m.role,
        r2: m.r2 ?? null,
        adj_r2: m.adj_r2 ?? null,
      }));
      setModels(normalized);
      const hero = normalized.find((m) => m.role === "hero");
      setSelectedModel(hero ? hero.id : normalized[0]?.id ?? "");
    } catch {
      toast.error("Failed to load models");
      setModels([]);
      setSelectedModel("");
    } finally {
      setModelsLoading(false);
    }
  }, []);

  const fetchKpis = useCallback(async (modelId: string, range: { start: string | null; end: string | null }) => {
    setLoading(true);
    setLoadError(false);
    try {
      const params = new URLSearchParams();
      if (range.start) params.set("start_date", range.start);
      if (range.end) params.set("end_date", range.end);
      const qs = params.toString() ? `?${params.toString()}` : "";
      const [summaryData, economicsData] = await Promise.all([
        apiFetch<Summary>(`/analysis/${modelId}/summary${qs}`),
        apiFetch<EconomicsSummary>(`/economics/${modelId}/summary${qs}`),
      ]);
      setSummary(summaryData);
      setEconomics(economicsData);
    } catch {
      setLoadError(true);
      setSummary(null);
      setEconomics(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!activeCompanyId) return;
    fetchDatasets();
  }, [fetchDatasets, activeCompanyId]);

  useEffect(() => {
    if (!selectedDataset) return;
    setModelsLoading(true);
    fetchModels(selectedDataset);
    fetchDatasetMeta(selectedDataset);
  }, [selectedDataset, fetchModels, fetchDatasetMeta]);

  useEffect(() => {
    if (selectedModel) fetchKpis(selectedModel, dateRange);
    else {
      setSummary(null);
      setEconomics(null);
    }
    // Depend on the primitive start/end values, not the `dateRange` object — a new object is
    // created on every render, which would refetch even when the actual dates didn't change.
  }, [selectedModel, dateRange.start, dateRange.end, fetchKpis]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateDateField = (field: "start" | "end", value: string) => {
    setDateRange((prev) => clampRange({ ...prev, [field]: value || null }, dateBounds, field));
  };

  const handleExport = async () => {
    if (!selectedModel) return;
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (dateRange.start) params.set("start_date", dateRange.start);
      if (dateRange.end) params.set("end_date", dateRange.end);
      const qs = params.toString() ? `?${params.toString()}` : "";
      const blob = await apiFetch<Blob>(`/analysis/${selectedModel}/executive-summary/export${qs}`, {
        responseType: "blob",
      });
      downloadBlob(blob, "executive-summary.xlsx");
    } catch (err) {
      toast.error(translateApiError(err, tErrors));
    } finally {
      setExporting(false);
    }
  };

  const selectedModelInfo = models.find((m) => m.id === selectedModel);
  const groups = summary?.groups ?? [];
  const baselineGroup = groups.find((g) => g.group_id === "baseline" || g.group_name?.toLowerCase() === "baseline");
  const nonBaselineGroups = groups.filter((g) => g !== baselineGroup);
  const colorOrder = [...nonBaselineGroups]
    .map((g) => g.group_name || g.group_id || "")
    .sort((a, b) => a.localeCompare(b));
  const colorMap = assignCategoricalColors(colorOrder, isDarkTheme);
  const chartGroups = [...nonBaselineGroups].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  const yVar = summary?.model?.y_var ?? "";

  const chartData = chartGroups.map((g) => {
    const key = g.group_name || g.group_id || "";
    return {
      key,
      name: g.group_name || key,
      contribution: g.contribution,
      percent: g.percent,
      color: colorMap[key],
    };
  });
  if (baselineGroup) {
    chartData.push({
      key: "baseline",
      name: baselineGroup.group_name || "Baseline",
      contribution: baselineGroup.contribution,
      percent: baselineGroup.percent,
      color: mutedColor,
    });
  }

  const fitBadge =
    selectedModelInfo?.r2 !== null && selectedModelInfo?.r2 !== undefined
      ? selectedModelInfo.r2 > 0.7
        ? { variant: "success" as const, label: t("kpis.reliable") }
        : { variant: "warning" as const, label: t("kpis.review") }
      : null;

  const roiValue = economics?.totals.roi ?? null;
  const roiBadge = !economics?.economics_configured
    ? { variant: "neutral" as const, label: t("kpis.notConfigured") }
    : roiValue !== null && Number.isFinite(roiValue)
      ? roiValue > 0
        ? { variant: "success" as const, label: t("kpis.positive") }
        : { variant: "warning" as const, label: t("kpis.negative") }
      : null;

  const yVarOrFallback = yVar || t("kpis.targetFallback");
  let insight: string | null = null;
  if (chartGroups.length >= 2) {
    insight = t("insight.double", {
      group: chartGroups[0].group_name || "",
      percent: pctLabel(chartGroups[0].percent),
      group2: chartGroups[1].group_name || "",
      percent2: pctLabel(chartGroups[1].percent),
      yVar: yVarOrFallback,
    });
  } else if (chartGroups.length === 1) {
    insight = t("insight.single", {
      group: chartGroups[0].group_name || "",
      percent: pctLabel(chartGroups[0].percent),
      yVar: yVarOrFallback,
    });
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title={t("title")}
        subtitle={t("eyebrow")}
        className="no-print"
        actions={
          <>
            <Button variant="ghost" onClick={handleExport} disabled={!summary || exporting}>
              <Download className="mr-2 h-4 w-4" />
              {exporting ? t("exporting") : t("export")}
            </Button>
            <Button variant="ghost" onClick={() => window.print()} disabled={!summary}>
              <Printer className="mr-2 h-4 w-4" />
              {t("print")}
            </Button>
          </>
        }
      />

      <div className="print-only space-y-1 pb-4 border-b border-line">
        <h1 className="text-2xl font-semibold text-ink">{t("title")}</h1>
        <p className="text-sm text-muted">
          {datasets.find((d) => d.id === selectedDataset)?.display_name} · {selectedModelInfo?.name} · {yVar}
        </p>
        {(dateRange.start || dateRange.end) && (
          <p className="text-sm text-muted">
            {dateRange.start ?? EMPTY_VALUE} — {dateRange.end ?? EMPTY_VALUE}
          </p>
        )}
        {printedAt && <p className="text-xs text-muted">{t("printedAt", { value: printedAt })}</p>}
      </div>

      {initializing || modelsLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[104px]" />
          ))}
        </div>
      ) : datasets.length === 0 ? (
        <Card>
          <EmptyState
            title={t("noDatasets.title")}
            description={t("noDatasets.description")}
            action={<SecondaryLink href="/datasets">{t("noDatasets.cta")}</SecondaryLink>}
          />
        </Card>
      ) : !selectedDataset || (models.length === 0 && !selectedModel) ? (
        <Card>
          <EmptyState
            title={t("noModel.title")}
            description={t("noModel.description")}
            action={<SecondaryLink href="/modeling">{t("noModel.cta")}</SecondaryLink>}
          />
        </Card>
      ) : (
        <>
          <FilterBar className="no-print">
            <FilterField label={t("filters.dataset")} className="w-[240px]">
              <Select value={selectedDataset} onChange={(e) => setSelectedDataset(e.target.value)}>
                {datasets.map((ds) => (
                  <option key={ds.id} value={ds.id}>
                    {ds.display_name}
                  </option>
                ))}
              </Select>
            </FilterField>
            <FilterField label={t("filters.model")} className="w-[260px]">
              <Select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.role === "hero" ? " (hero)" : ""}
                  </option>
                ))}
              </Select>
            </FilterField>
            {(dateBounds.min || dateBounds.max) && (
              <FilterField label={t("filters.dateRange")}>
                <div className="flex items-center gap-2">
                  <Input
                    type="date"
                    aria-label={t("filters.dateStart")}
                    style={{ width: 140 }}
                    value={dateRange.start ?? ""}
                    min={dateBounds.min ?? undefined}
                    max={dateBounds.max ?? undefined}
                    onChange={(e) => updateDateField("start", e.target.value)}
                  />
                  <span className="text-muted" aria-hidden>
                    –
                  </span>
                  <Input
                    type="date"
                    aria-label={t("filters.dateEnd")}
                    style={{ width: 140 }}
                    value={dateRange.end ?? ""}
                    min={dateBounds.min ?? undefined}
                    max={dateBounds.max ?? undefined}
                    onChange={(e) => updateDateField("end", e.target.value)}
                  />
                </div>
              </FilterField>
            )}
          </FilterBar>

          {loadError ? (
            <Card>
              <EmptyState
                title={t("error.title")}
                action={
                  <Button variant="secondary" onClick={() => fetchKpis(selectedModel, dateRange)}>
                    {t("error.retry")}
                  </Button>
                }
              />
            </Card>
          ) : (
            <>
              {economics && !economics.economics_configured && (
                <div className="rounded-xl bg-warn-bg px-4 py-3 text-sm text-warn no-print">
                  {t("economicsNotConfigured")}
                </div>
              )}

              {insight && !loading && (
                <p className="text-md text-ink">{insight}</p>
              )}

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy={loading}>
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[104px]" />)
                ) : (
                  <>
                    <StatCard
                      label={t("kpis.fit")}
                      value={
                        selectedModelInfo?.r2 !== null && selectedModelInfo?.r2 !== undefined
                          ? pctLabel(selectedModelInfo.r2 * 100)
                          : EMPTY_VALUE
                      }
                      icon={
                        <InfoTooltip
                          label={t("kpis.fit")}
                          content={t("kpis.fitTooltip", { yVar: yVarOrFallback })}
                        />
                      }
                      trend={
                        fitBadge ? <Badge variant={fitBadge.variant}>{fitBadge.label}</Badge> : undefined
                      }
                    />
                    <StatCard
                      label={t("kpis.totalContribution")}
                      value={summary ? formatChartNumber(summary.total_contribution, 1) : EMPTY_VALUE}
                      icon={
                        <InfoTooltip
                          label={t("kpis.totalContribution")}
                          content={t("kpis.totalContributionTooltip", { yVar: yVarOrFallback })}
                        />
                      }
                    />
                    <StatCard
                      label={t("kpis.roi")}
                      value={economics?.economics_configured ? pctLabel(roiValue !== null ? roiValue * 100 : null) : EMPTY_VALUE}
                      icon={<InfoTooltip label={t("kpis.roi")} content={t("kpis.roiTooltip")} />}
                      trend={roiBadge ? <Badge variant={roiBadge.variant}>{roiBadge.label}</Badge> : undefined}
                    />
                    <StatCard
                      label={t("kpis.roas")}
                      value={economics?.economics_configured ? roasLabel(economics?.totals.roas) : EMPTY_VALUE}
                      icon={<InfoTooltip label={t("kpis.roas")} content={t("kpis.roasTooltip")} />}
                    />
                  </>
                )}
              </div>

              <Card className="space-y-3">
                <CardHeader as="h2" title={t("groups.title")} subtitle={t("groups.subtitle", { yVar: yVarOrFallback })} />
                {loading ? (
                  <Skeleton className="h-chart-md" />
                ) : chartData.length ? (
                  <>
                    <div className="h-chart-md">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 48 }}>
                          <CartesianGrid horizontal={false} stroke={lineColor} />
                          <XAxis
                            type="number"
                            tickFormatter={(v) => formatChartPercent(v, 0)}
                            tick={{ fill: mutedColor, fontSize: 12 }}
                            axisLine={{ stroke: lineColor }}
                            tickLine={false}
                          />
                          <YAxis
                            type="category"
                            dataKey="name"
                            width={120}
                            tick={{ fill: mutedColor, fontSize: 12 }}
                            axisLine={{ stroke: lineColor }}
                            tickLine={false}
                          />
                          <RechartsTooltip
                            cursor={{ fill: lineColor, opacity: 0.4 }}
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null;
                              const d = payload[0].payload as (typeof chartData)[number];
                              return (
                                <div
                                  className="rounded-lg border px-3 py-2 text-xs shadow-[var(--shadow-soft)]"
                                  style={{ background: surfaceColor, borderColor: lineColor }}
                                >
                                  <p className="font-medium text-ink">{d.name}</p>
                                  <p className="text-muted">
                                    {t("groups.tooltipValue")}: {formatChartNumber(d.contribution, 1)}
                                  </p>
                                  <p className="text-muted">
                                    {t("groups.tooltipPercent")}: {formatChartPercent(d.percent, 1)}
                                  </p>
                                </div>
                              );
                            }}
                          />
                          <Bar dataKey="percent" radius={[0, 4, 4, 0]} barSize={22}>
                            {chartData.map((d) => (
                              <Cell key={d.key} fill={d.color} />
                            ))}
                            <LabelList
                              dataKey="percent"
                              position="right"
                              formatter={(v: number) => formatChartPercent(v, 1)}
                              style={{ fill: inkColor, fontSize: 12, fontWeight: 500 }}
                            />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    {baselineGroup && <p className="text-xs text-muted">{t("groups.baselineHint")}</p>}
                  </>
                ) : (
                  <EmptyState title={t("groups.empty")} />
                )}
              </Card>
            </>
          )}
        </>
      )}
    </section>
  );
}
