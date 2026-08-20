"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useLocaleToggle } from "@/components/providers/locale-provider";
import { Info, Printer, Download } from "lucide-react";

import { Card, CardHeader } from "@/components/ui/card";
import { Table, TableHeader, TableRow, Th, TableCell } from "@/components/ui/table";
import { WaterfallChart } from "@/components/charts/waterfall-chart";
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
import { apiFetch, ApiError } from "@/lib/api";
import { EMPTY_VALUE } from "@/lib/format";
import { formatChartNumber, formatChartPercent, formatCurrency } from "@/lib/chart-format";
import { assignCategoricalColors } from "@/lib/chart-colors";
import { buildContributionInsight } from "@/lib/insight-text";
import { useGlobalStore } from "@/lib/store";
import { useActiveCurrency } from "@/hooks/useActiveCompany";
import { downloadBlob } from "@/lib/download";
import { translateApiError } from "@/lib/error-messages";

type Dataset = { id: string; display_name: string };
type Model = { id: string; name: string; role: string | null; r2: number | null; adj_r2: number | null };
type GroupContribution = {
  group_id: string | null;
  group_name: string | null;
  contribution: number;
  percent: number;
  is_seasonal?: boolean;
};
type Summary = {
  model: { id: string; name: string; y_var: string; y_var_display_name?: string | null; y_var_unit?: string | null };
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
type FeaturedScenario = {
  id: string;
  name: string;
  is_featured: boolean;
  delta_pct_vs_base: number | null;
  summary: { economics?: { total_investment: number; total_revenue: number | null; roi_total: number | null } | null };
};

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

function InfoTooltip({
  label,
  content,
  side,
  align,
  maxWidth = 220,
}: {
  label: string;
  content: string;
  side?: "top" | "bottom";
  align?: "center" | "end";
  maxWidth?: number;
}) {
  return (
    <Tooltip
      side={side}
      align={align}
      content={
        <span style={{ whiteSpace: "normal", display: "block", width: "max-content", maxWidth }}>{content}</span>
      }
    >
      <button
        type="button"
        aria-label={label}
        className="-m-1.5 rounded-full p-1.5 text-muted transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Info className="h-3 w-3" />
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
  const { activeCompanyId } = useGlobalStore();
  const currency = useActiveCurrency();
  const { locale } = useLocaleToggle();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDataset, setSelectedDataset] = useState("");
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [economics, setEconomics] = useState<EconomicsSummary | null>(null);
  const [featuredScenarios, setFeaturedScenarios] = useState<FeaturedScenario[]>([]);
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
    } catch (err) {
      toast.error(err instanceof ApiError ? translateApiError(err, tErrors) : t("toasts.loadDatasetsFailed"));
    } finally {
      setInitializing(false);
    }
  }, [t, tErrors]);

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
    } catch (err) {
      toast.error(err instanceof ApiError ? translateApiError(err, tErrors) : t("toasts.loadModelsFailed"));
      setModels([]);
      setSelectedModel("");
    } finally {
      setModelsLoading(false);
    }
  }, [t, tErrors]);

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

  const fetchFeaturedScenarios = useCallback(
    async (modelId: string) => {
      try {
        const data = await apiFetch<FeaturedScenario[]>(`/predict/scenarios?model_id=${modelId}`);
        setFeaturedScenarios(data.filter((s) => s.is_featured));
      } catch (err) {
        setFeaturedScenarios([]);
        toast.error(err instanceof ApiError ? translateApiError(err, tErrors) : t("toasts.loadScenariosFailed"));
      }
    },
    [t, tErrors]
  );

  useEffect(() => {
    if (selectedModel) fetchFeaturedScenarios(selectedModel);
    else setFeaturedScenarios([]);
  }, [selectedModel, fetchFeaturedScenarios]);

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
      params.set("lang", locale);
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
  const yVarLabel = summary?.model?.y_var_display_name || yVar;
  const yVarUnit = summary?.model?.y_var_unit ?? null;

  // Waterfall data (extracted to the shared `WaterfallChart`, Fase 8 A4): baseline first, then
  // groups sorted by magnitude with their assigned color — the component itself builds the
  // running-total steps and the closing Total bar.
  const waterfallBaseline = baselineGroup
    ? {
        key: "baseline",
        name: baselineGroup.group_name || "Baseline",
        contribution: baselineGroup.contribution,
        percent: baselineGroup.percent,
        color: mutedColor,
        actionable: false,
      }
    : null;
  const waterfallSegments = chartGroups.map((g) => {
    const key = g.group_name || g.group_id || "";
    return {
      key,
      name: g.group_name || key,
      contribution: g.contribution,
      percent: g.percent,
      color: colorMap[key],
      actionable: !g.is_seasonal,
    };
  });

  // Fase 6/A03-R9: actionable = a planner could actually move this contribution (media/other
  // non-seasonal groups); baseline and any Group.is_seasonal group are the floor, not a lever.
  const actionableContribution = chartGroups
    .filter((g) => !g.is_seasonal)
    .reduce((sum, g) => sum + g.contribution, 0);
  const totalContributionAbs = summary?.total_contribution ?? 0;
  const actionableSharePct = totalContributionAbs ? (actionableContribution / totalContributionAbs) * 100 : null;

  // Fase 6/A09-R4: flag an actionable group with negative contribution — economically odd
  // (a media/investment group usually shouldn't subtract from the target) and worth a second
  // look before trusting the model as-is.
  const suspiciousGroups = chartGroups.filter((g) => !g.is_seasonal && g.contribution < 0);

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

  const yVarOrFallback = yVarLabel || t("kpis.targetFallback");
  const insight = buildContributionInsight(
    chartGroups.map((g) => ({ label: g.group_name || "", percent: g.percent })),
    yVarOrFallback,
    t,
    pctLabel
  );

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
          {datasets.find((d) => d.id === selectedDataset)?.display_name} · {selectedModelInfo?.name} · {yVarLabel}
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
            <FilterField
              label={
                <span className="inline-flex items-center gap-1">
                  {t("filters.model")}
                  <InfoTooltip label={t("filters.model")} content={t("filters.modelRoleTooltip")} />
                </span>
              }
              className="w-[260px]"
            >
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
                  {t("economicsNotConfigured")}{" "}
                  <Link href="/transform" className="font-medium underline">
                    {t("economicsNotConfiguredLink")}
                  </Link>
                </div>
              )}

              {insight && !loading && (
                <p className="text-md text-ink">{insight}</p>
              )}

              {suspiciousGroups.length > 0 && !loading && (
                <div className="rounded-xl bg-warn-bg px-4 py-3 text-sm text-warn no-print">
                  {t("suspicious.negativeContribution", {
                    groups: suspiciousGroups.map((g) => g.group_name).join(", "),
                  })}
                </div>
              )}

              <p className="text-xs text-muted">{t("causalityNote")}</p>

              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-busy={loading} aria-live="polite">
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
                      value={
                        summary
                          ? `${formatChartNumber(summary.total_contribution, 1)}${yVarUnit ? ` ${yVarUnit}` : ""}`
                          : EMPTY_VALUE
                      }
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
                ) : (
                  <WaterfallChart
                    baseline={waterfallBaseline}
                    segments={waterfallSegments}
                    totalLabel={t("groups.totalLabel")}
                    tooltipValueLabel={t("groups.tooltipValue")}
                    tooltipPercentLabel={t("groups.tooltipPercent")}
                    tooltipDeltaLabel={t("groups.tooltipDelta")}
                    emptyLabel={t("groups.empty")}
                    baselineHint={t("groups.baselineHint")}
                    nonActionableLabel={t("groups.nonActionableHint")}
                  />
                )}
                {!loading && actionableSharePct !== null && chartGroups.some((g) => g.is_seasonal) && (
                  <p className="text-xs text-muted">
                    {t("groups.actionableShare", {
                      percent: pctLabel(actionableSharePct),
                      value: formatChartNumber(actionableContribution, 1),
                    })}
                  </p>
                )}
              </Card>

              <Card className="space-y-3">
                <CardHeader as="h2" title={t("featured.title")} subtitle={t("featured.subtitle")} />
                {featuredScenarios.length === 0 ? (
                  <EmptyState
                    title={t("featured.empty")}
                    action={<SecondaryLink href="/predict">{t("featured.cta")}</SecondaryLink>}
                  />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <Th>{t("featured.colName")}</Th>
                        <Th className="text-right">{t("featured.colInvestment")}</Th>
                        <Th className="text-right">{t("featured.colRevenue")}</Th>
                        <Th className="text-right">{t("featured.colRoi")}</Th>
                        <Th className="text-right">
                          <span className="inline-flex items-center justify-end gap-1">
                            {t("featured.colDelta")}
                            <InfoTooltip
                              label={t("featured.colDelta")}
                              content={t("featured.colDeltaTooltip")}
                              side="bottom"
                              align="end"
                              maxWidth={320}
                            />
                          </span>
                        </Th>
                      </TableRow>
                    </TableHeader>
                    <tbody>
                      {featuredScenarios.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell className="font-medium">{s.name}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {s.summary.economics ? formatCurrency(s.summary.economics.total_investment, currency, 0) : EMPTY_VALUE}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {s.summary.economics?.total_revenue != null
                              ? formatCurrency(s.summary.economics.total_revenue, currency, 0)
                              : EMPTY_VALUE}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {s.summary.economics?.roi_total != null ? pctLabel(s.summary.economics.roi_total * 100) : EMPTY_VALUE}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {s.delta_pct_vs_base != null ? pctLabel(s.delta_pct_vs_base) : EMPTY_VALUE}
                          </TableCell>
                        </TableRow>
                      ))}
                    </tbody>
                  </Table>
                )}
              </Card>
            </>
          )}
        </>
      )}
    </section>
  );
}
