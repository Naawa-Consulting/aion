"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { TooltipProps } from "recharts";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { Info, Printer } from "lucide-react";

import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { apiFetch, ApiError } from "@/lib/api";
import { ErrorText } from "@/components/ui/error-text";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip as InfoPopover } from "@/components/ui/tooltip";
import { StatCard } from "@/components/ui/stat-card";
import { Disclosure } from "@/components/ui/disclosure";
import { Tabs } from "@/components/ui/tabs";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Table, TableHeader, TableRow, Th, TableCell } from "@/components/ui/table";
import { assignCategoricalColors, chartColor, useStableCategoricalColor } from "@/lib/chart-colors";
import { formatChartNumber, formatChartPercent, formatCurrency } from "@/lib/chart-format";
import { EMPTY_VALUE } from "@/lib/format";
import { downloadBlob } from "@/lib/download";
import { useGlobalStore } from "@/lib/store";
import { useActiveCurrency } from "@/hooks/useActiveCompany";

type Dataset = { id: string; display_name: string; columns: { name: string; dtype: string }[] };
type ModelRole = "hero" | "challenger1" | "challenger2";
type Model = {
  id: string;
  name: string;
  dataset_id: string;
  role: ModelRole | null;
  r2: number;
  adj_r2: number;
  mae: number;
  rmse: number;
  mape: number | null;
};
type Summary = {
  model: { id: string; name: string; dataset_id: string; y_var: string };
  include_intercept: boolean;
  intercept: number;
  total_contribution: number;
  as_percent: boolean;
  variables: any[];
  groups: any[];
  subgroups: any[];
};
type StackedData = { index: string[]; series: { key: string; values: number[] }[] };
type DatasetMeta = {
  id: string;
  name: string;
  rows: number;
  columns: number;
  time_column: string | null;
  date_min: string | null;
  date_max: string | null;
};
type DateBounds = { min: string | null; max: string | null };
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
type EconomicsSummaryData = {
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
type EconomicsStackedData = {
  index: string[];
  totals: { investment: number[]; revenue: number[] };
  series: { channel_id: string; channel_name: string; is_modeled: boolean; investment: number[]; revenue: (number | null)[] }[];
};
type ModelCoefficient = {
  name: string;
  is_media?: boolean;
  hill_k?: number | null;
  hill_s?: number | null;
  raw_mean?: number | null;
};

const MODEL_ROLES: readonly ModelRole[] = ["hero", "challenger1", "challenger2"];
const MODEL_ROLE_ORDER: Record<ModelRole, number> = {
  hero: 0,
  challenger1: 1,
  challenger2: 2,
};
const MODEL_ROLE_LABEL: Record<ModelRole, string> = {
  hero: "Hero",
  challenger1: "Ch. 1",
  challenger2: "Ch. 2",
};
const TIME_COLUMN_PLACEHOLDER = "__none__";
const BASELINE_KEY = "__baseline__";

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
    if (changed === "start") return { start, end: start };
    if (changed === "end") return { start: end, end };
    return { start, end: start };
  }
  return { start, end };
};

const normalizeDatasetMeta = (raw: any): DatasetMeta => ({
  id: raw.id,
  name: raw.name ?? raw.display_name ?? "",
  rows: raw.rows ?? raw.n_rows ?? 0,
  columns: raw.columns ?? raw.n_cols ?? 0,
  time_column: raw.time_column ?? raw.timeColumn ?? null,
  date_min: raw.date_min ?? raw.dateMin ?? null,
  date_max: raw.date_max ?? raw.dateMax ?? null,
});

const isBaselineKey = (key: string) => key.toLowerCase().includes("baseline") || key === "__intercept__";

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
    <InfoPopover content={<span style={{ whiteSpace: "normal", display: "block", maxWidth: 220 }}>{content}</span>}>
      <button
        type="button"
        aria-label={label}
        className="rounded-full p-0.5 text-muted transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
    </InfoPopover>
  );
}

export default function AnalysisPage() {
  const t = useTranslations("analysis");
  const tCommon = useTranslations("common");
  const { resolvedTheme } = useTheme();
  const isDarkTheme = resolvedTheme === "dark";
  const mutedColor = isDarkTheme ? "#81858e" : "#6d7178";
  const lineColor = isDarkTheme ? "#262a2f" : "#e5e6ea";
  const surfaceColor = isDarkTheme ? "#16181b" : "#ffffff";
  const inkColor = isDarkTheme ? "#f2f3f5" : "#17181c";
  const { activeCompanyId } = useGlobalStore();
  const currency = useActiveCurrency();

  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDataset, setSelectedDataset] = useState("");
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [stacked, setStacked] = useState<StackedData | null>(null);
  const [timeCol, setTimeCol] = useState(TIME_COLUMN_PLACEHOLDER);
  const [timeColumnDefault, setTimeColumnDefault] = useState<string | null>(null);
  const [freq, setFreq] = useState<"day" | "week" | "month">("month");
  const [groupBy, setGroupBy] = useState<"group" | "subgroup">("group");
  const [asPercent, setAsPercent] = useState(false);
  const [includeBaseline, setIncludeBaseline] = useState(true);
  const [viewMode, setViewMode] = useState<"stacked" | "grouped">("stacked");
  const [tableView, setTableView] = useState<"group" | "group_subgroup" | "variable">("group");
  const [economics, setEconomics] = useState<EconomicsSummaryData | null>(null);
  const [economicsStacked, setEconomicsStacked] = useState<EconomicsStackedData | null>(null);
  const [economicsStackedLoading, setEconomicsStackedLoading] = useState(false);
  const [economicsStackedError, setEconomicsStackedError] = useState<string | null>(null);
  const [printedAt, setPrintedAt] = useState<string | null>(null);
  const [highlightedChannel, setHighlightedChannel] = useState<string>("");
  const [modelCoefficients, setModelCoefficients] = useState<ModelCoefficient[]>([]);
  const [loading, setLoading] = useState(false);
  const [summaryError, setSummaryError] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("table");
  const [dateRange, setDateRange] = useState<{ start: string | null; end: string | null }>({
    start: null,
    end: null,
  });
  const [dateBounds, setDateBounds] = useState<DateBounds>({ min: null, max: null });
  const [stackedLoading, setStackedLoading] = useState(false);
  const [stackedError, setStackedError] = useState<string | null>(null);
  const dateRangeInitializedRef = useRef(false);
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const [chartSeries, setChartSeries] = useState<Record<string, any>[]>([]);
  const colorFor = useStableCategoricalColor(selectedModel);

  useEffect(() => {
    setTimeCol(timeColumnDefault || TIME_COLUMN_PLACEHOLDER);
  }, [timeColumnDefault]);

  const boundsMin = dateBounds.min;
  const boundsMax = dateBounds.max;

  useEffect(() => {
    const bounds = { min: boundsMin, max: boundsMax };
    setDateRange((prev) => {
      const next = clampRange(prev, bounds, "bounds");
      if (next.start === prev.start && next.end === prev.end) return prev;
      return next;
    });
  }, [boundsMin, boundsMax]);

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

  useEffect(() => {
    // activeCompanyId hydrates asynchronously (AuthBootstrap fetches /me/memberships and
    // auto-selects the first company) — fetching before it's set sends no X-Company-Id
    // header and the backend 422s. Wait for it, then re-fetch once it's ready.
    if (!activeCompanyId) return;
    fetchDatasets();
  }, [fetchDatasets, activeCompanyId]);

  const fetchDatasetMeta = useCallback(async (datasetId: string) => {
    setTimeColumnDefault(null);
    setDateBounds({ min: null, max: null });
    try {
      const raw = await apiFetch<any>(`/datasets/${datasetId}/meta`);
      const data = normalizeDatasetMeta(raw);
      setTimeColumnDefault(data.time_column);
      const bounds = { min: data.date_min ?? null, max: data.date_max ?? null };
      setDateBounds(bounds);
      if (!dateRangeInitializedRef.current && (bounds.min || bounds.max)) {
        setDateRange(clampRange({ start: bounds.min, end: bounds.max }, bounds, "bounds"));
        dateRangeInitializedRef.current = true;
      }
    } catch {
      setTimeColumnDefault(null);
    }
  }, []);

  const fetchModels = useCallback(async (datasetId: string) => {
    setModelsLoading(true);
    try {
      const data = await apiFetch<any[]>(`/datasets/${datasetId}/models-with-roles`);
      const normalized: Model[] = data.map((m: any) => ({
        id: m.id,
        name: m.name,
        dataset_id: m.dataset_id,
        role: !m.role || m.role === "none" ? null : m.role,
        r2: m.r2,
        adj_r2: m.adj_r2,
        mae: m.mae,
        rmse: m.rmse,
        mape: m.mape ?? null,
      }));
      const prioritized = normalized
        .filter((m) => m.role && MODEL_ROLES.includes(m.role as ModelRole))
        .sort((a, b) => {
          const roleA = (a.role as ModelRole) || "challenger2";
          const roleB = (b.role as ModelRole) || "challenger2";
          return MODEL_ROLE_ORDER[roleA] - MODEL_ROLE_ORDER[roleB];
        });
      const available = prioritized.length ? prioritized : normalized;
      setModels(available);
      if (!available.length) {
        setSelectedModel("");
        return;
      }
      const hero = available.find((m) => m.role === "hero");
      setSelectedModel(hero ? hero.id : available[0].id);
    } catch {
      toast.error("Failed to load models");
      setModels([]);
      setSelectedModel("");
    } finally {
      setModelsLoading(false);
    }
  }, []);

  const fetchSummary = useCallback(
    async (modelId: string) => {
      setLoading(true);
      setSummaryError(false);
      try {
        const params = new URLSearchParams({
          include_intercept: String(includeBaseline),
          as_percent: String(asPercent),
        });
        if (dateRange.start) params.set("start_date", dateRange.start);
        if (dateRange.end) params.set("end_date", dateRange.end);
        const data = await apiFetch<Summary>(`/analysis/${modelId}/summary?${params.toString()}`);
        setSummary(data);
      } catch (err) {
        toast.error((err instanceof ApiError ? err.message : (err as Error)?.message) || "Failed to load summary");
        setSummary(null);
        setSummaryError(true);
      } finally {
        setLoading(false);
      }
    },
    [includeBaseline, asPercent, dateRange.start, dateRange.end]
  );

  useEffect(() => {
    if (selectedDataset) {
      setDateRange({ start: null, end: null });
      setDateBounds({ min: null, max: null });
      dateRangeInitializedRef.current = false;
      setStacked(null);
      setStackedError(null);
      fetchModels(selectedDataset);
      fetchDatasetMeta(selectedDataset);
    }
  }, [selectedDataset, fetchModels, fetchDatasetMeta]);

  useEffect(() => {
    if (selectedModel) {
      fetchSummary(selectedModel);
    } else {
      setSummary(null);
    }
  }, [selectedModel, fetchSummary]);

  const fetchEconomics = useCallback(
    async (modelId: string) => {
      try {
        const params = new URLSearchParams();
        if (dateRange.start) params.set("start_date", dateRange.start);
        if (dateRange.end) params.set("end_date", dateRange.end);
        const data = await apiFetch<EconomicsSummaryData>(`/economics/${modelId}/summary?${params.toString()}`);
        setEconomics(data);
      } catch {
        setEconomics(null);
      }
    },
    [dateRange.start, dateRange.end]
  );

  useEffect(() => {
    if (selectedModel) {
      fetchEconomics(selectedModel);
    } else {
      setEconomics(null);
    }
  }, [selectedModel, fetchEconomics]);

  useEffect(() => {
    if (!selectedModel) {
      setModelCoefficients([]);
      return;
    }
    apiFetch<{ coefficients: ModelCoefficient[] }>(`/models/${selectedModel}/summary`)
      .then((data) => setModelCoefficients(data.coefficients || []))
      .catch(() => setModelCoefficients([]));
  }, [selectedModel]);

  const readyForStacked = Boolean(selectedModel && timeCol && timeCol !== TIME_COLUMN_PLACEHOLDER);

  const fetchStacked = useCallback(async () => {
    if (!selectedModel || !timeCol || timeCol === TIME_COLUMN_PLACEHOLDER) return;
    setStackedLoading(true);
    setStackedError(null);
    try {
      const params = new URLSearchParams({
        time_col: timeCol,
        freq,
        by: groupBy,
        include_intercept: String(includeBaseline),
        as_percent: String(asPercent),
      });
      if (dateRange.start) params.set("start_date", dateRange.start);
      if (dateRange.end) params.set("end_date", dateRange.end);
      const data = await apiFetch<StackedData>(`/analysis/${selectedModel}/stacked?${params.toString()}`);
      setStacked(data);
    } catch (err) {
      setStacked(null);
      setStackedError(
        (err instanceof ApiError ? err.message : (err as Error)?.message) || t("timeseries.error")
      );
    } finally {
      setStackedLoading(false);
    }
  }, [selectedModel, timeCol, freq, groupBy, includeBaseline, asPercent, dateRange.start, dateRange.end, t]);

  const stackDeps = [selectedModel, timeCol, freq, groupBy, includeBaseline, asPercent, dateRange.start, dateRange.end];

  useEffect(() => {
    if (!selectedModel || !timeCol || timeCol === TIME_COLUMN_PLACEHOLDER) return;
    const handle = setTimeout(() => {
      fetchStacked();
    }, 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, stackDeps);

  const updateDateField = (field: "start" | "end", rawValue: string) => {
    setDateRange((prev) => {
      const candidate = { ...prev, [field]: rawValue ? rawValue : null };
      const next = clampRange(candidate, dateBounds, field);
      if (next.start === prev.start && next.end === prev.end) return prev;
      return next;
    });
  };

  useEffect(() => {
    const handleBeforePrint = () => setPrintedAt(new Date().toLocaleString());
    window.addEventListener("beforeprint", handleBeforePrint);
    return () => window.removeEventListener("beforeprint", handleBeforePrint);
  }, []);

  const downloadSummary = async () => {
    if (!selectedModel) return;
    const params = new URLSearchParams({
      include_intercept: String(includeBaseline),
      as_percent: String(asPercent),
    });
    if (dateRange.start) params.set("start_date", dateRange.start);
    if (dateRange.end) params.set("end_date", dateRange.end);
    try {
      const blob = await apiFetch<Blob>(`/analysis/${selectedModel}/export/summary.xlsx?${params.toString()}`, {
        responseType: "blob",
      });
      downloadBlob(blob, "analysis-summary.xlsx");
    } catch (err) {
      toast.error((err instanceof ApiError ? err.message : (err as Error)?.message) || "Failed to export summary");
    }
  };

  const downloadSummaryTable = async () => {
    if (!selectedDataset || !selectedModel) {
      toast.error("Select a dataset and model first");
      return;
    }
    const payload: Record<string, unknown> = {
      dataset_id: selectedDataset,
      model_id: selectedModel,
      include_intercept: includeBaseline,
      group_mode: tableView,
    };
    if (dateRange.start) payload.start_date = dateRange.start;
    if (dateRange.end) payload.end_date = dateRange.end;
    try {
      const blob = await apiFetch<Blob>("/analysis/summary/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        responseType: "blob",
      });
      downloadBlob(blob, "summary-table.xlsx");
    } catch (err) {
      toast.error((err instanceof ApiError ? err.message : (err as Error)?.message) || "Failed to export summary table");
    }
  };

  const downloadStacked = async () => {
    if (!selectedModel || !timeCol || timeCol === TIME_COLUMN_PLACEHOLDER) return;
    const params = new URLSearchParams({
      time_col: timeCol,
      freq,
      by: groupBy,
      include_intercept: String(includeBaseline),
      as_percent: String(asPercent),
    });
    if (dateRange.start) params.set("start_date", dateRange.start);
    if (dateRange.end) params.set("end_date", dateRange.end);
    try {
      const blob = await apiFetch<Blob>(`/analysis/${selectedModel}/export/stacked.xlsx?${params.toString()}`, {
        responseType: "blob",
      });
      downloadBlob(blob, "stacked.xlsx");
    } catch (err) {
      toast.error((err instanceof ApiError ? err.message : (err as Error)?.message) || "Failed to export stacked data");
    }
  };

  const timeColumns = useMemo(() => {
    const ds = datasets.find((d) => d.id === selectedDataset);
    return ds ? ds.columns.map((c) => c.name) : [];
  }, [datasets, selectedDataset]);

  const fmtRoi = (value: number | null | undefined) =>
    value === null || value === undefined || !Number.isFinite(value) ? EMPTY_VALUE : `${(value * 100).toFixed(1)}%`;

  const fmtRoas = (value: number | null | undefined) =>
    value === null || value === undefined || !Number.isFinite(value) ? EMPTY_VALUE : `${value.toFixed(2)}x`;

  const percentOfTotal = (value: number | null | undefined) => {
    if (!summary || summary.total_contribution === 0 || value === null || value === undefined) return EMPTY_VALUE;
    return formatChartPercent((value / summary.total_contribution) * 100, 1);
  };

  const fetchEconomicsStacked = useCallback(async () => {
    if (!selectedModel || !readyForStacked) return;
    setEconomicsStackedLoading(true);
    setEconomicsStackedError(null);
    try {
      const params = new URLSearchParams({ time_col: timeCol, freq });
      if (dateRange.start) params.set("start_date", dateRange.start);
      if (dateRange.end) params.set("end_date", dateRange.end);
      const data = await apiFetch<EconomicsStackedData>(`/economics/${selectedModel}/stacked?${params.toString()}`);
      setEconomicsStacked(data);
    } catch (err) {
      setEconomicsStacked(null);
      setEconomicsStackedError(
        (err instanceof ApiError ? err.message : (err as Error)?.message) || t("economics.error")
      );
    } finally {
      setEconomicsStackedLoading(false);
    }
  }, [selectedModel, readyForStacked, timeCol, freq, dateRange.start, dateRange.end, t]);

  useEffect(() => {
    const handle = setTimeout(() => {
      fetchEconomicsStacked();
    }, 250);
    return () => clearTimeout(handle);
  }, [fetchEconomicsStacked]);

  useEffect(() => {
    setHighlightedChannel("");
  }, [selectedModel]);

  const economicsChartData = useMemo(() => {
    if (!economicsStacked) return [];
    const selectedSeries = economicsStacked.series.find((s) => s.channel_id === highlightedChannel);
    return economicsStacked.index.map((label, idx) => ({
      period: label,
      investment: economicsStacked.totals.investment[idx],
      revenue: economicsStacked.totals.revenue[idx],
      channel_investment: selectedSeries ? selectedSeries.investment[idx] : undefined,
      channel_revenue: selectedSeries ? selectedSeries.revenue[idx] ?? undefined : undefined,
    }));
  }, [economicsStacked, highlightedChannel]);

  const formatStackedValue = useCallback(
    (value: number | string | null | undefined) => (asPercent ? formatChartPercent(value, 1) : formatChartNumber(value, 0)),
    [asPercent]
  );

  const sortedSeries = useMemo(() => {
    if (!stacked) return [];
    const arr = [...stacked.series];
    arr.sort((a, b) => {
      if (isBaselineKey(a.key) && !isBaselineKey(b.key)) return -1;
      if (!isBaselineKey(a.key) && isBaselineKey(b.key)) return 1;
      return a.key.localeCompare(b.key);
    });
    return arr;
  }, [stacked]);

  const seriesColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    sortedSeries.forEach((series) => {
      // Baseline is a fixed neutral, not a categorical slot — "no es un canal" (same rule
      // executive-summary's proportion chart already established for this exact case).
      map[series.key] = isBaselineKey(series.key) ? mutedColor : colorFor(series.key, isDarkTheme);
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedSeries, isDarkTheme]);

  const groupedSeries = useMemo(() => {
    if (!stacked) return [];
    return stacked.index.map((label, idx) => {
      const row: Record<string, any> = { period: label };
      sortedSeries.forEach((series) => {
        row[series.key] = series.values[idx];
      });
      return row;
    });
  }, [stacked, sortedSeries]);

  useEffect(() => {
    if (!stacked || groupedSeries.length === 0) {
      setChartSeries([]);
      return;
    }
    setChartSeries((prev) => {
      if (prev.length !== groupedSeries.length) return groupedSeries;
      return prev.map((row, idx) => ({ ...row, ...groupedSeries[idx] }));
    });
  }, [stacked, groupedSeries]);

  const stackOffset = viewMode === "stacked" ? "sign" : undefined;

  const yVar = summary?.model?.y_var || "";
  const yVarOrFallback = yVar || t("kpis.targetFallback");

  const nonBaselineGroups = useMemo(
    () => (summary?.groups || []).filter((g: any) => g.group_id && g.group_id !== "baseline"),
    [summary]
  );
  const baselineGroup = summary?.groups.find((g: any) => g.group_id === "baseline");

  // Same two-step pattern as executive-summary/page.tsx: color assignment is keyed off an
  // alphabetically-sorted name list (order-of-appearance-independent, so a group always maps
  // to the same color regardless of which page/chart renders first), while the *display*
  // order below stays sorted by magnitude — a group's color never changes with its rank.
  const groupColorMap = useMemo(() => {
    if (!summary) return {};
    const colorOrder = [...nonBaselineGroups]
      .map((g: any) => g.group_name || g.group_id || "")
      .sort((a, b) => a.localeCompare(b));
    return assignCategoricalColors(colorOrder, isDarkTheme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, nonBaselineGroups, isDarkTheme]);

  // Proportion bar: one 100%-stacked bar instead of N separate cards/bars — resolves the
  // KPI-grid "holes" the Fase 7 audit flagged (fewer than 4 groups left empty slots).
  const proportionSegments = useMemo(() => {
    if (!summary) return [];
    const segments = [...nonBaselineGroups]
      .sort((a: any, b: any) => Math.abs(b.contribution) - Math.abs(a.contribution))
      .map((g: any) => {
        const key = g.group_name || g.group_id;
        return {
          key,
          name: key,
          percent: g.percent ?? (summary.total_contribution ? (g.contribution / summary.total_contribution) * 100 : 0),
          contribution: g.contribution,
          color: groupColorMap[key] ?? mutedColor,
        };
      });
    if (baselineGroup) {
      segments.unshift({
        key: BASELINE_KEY,
        name: baselineGroup.group_name || t("proportion.baselineLabel"),
        percent:
          baselineGroup.percent ??
          (summary.total_contribution ? (baselineGroup.contribution / summary.total_contribution) * 100 : 0),
        contribution: baselineGroup.contribution,
        // Fixed neutral, not a categorical slot — "no es un canal en el que se pueda invertir".
        color: mutedColor,
      });
    }
    return segments;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, nonBaselineGroups, baselineGroup, groupColorMap, t]);

  const hasSubgroups = summary?.subgroups?.some((sg: any) => sg.subgroup_id && sg.subgroup_id !== "baseline") ?? false;

  const tableRows = useMemo(() => {
    if (!summary) return [];
    if (tableView === "group") return summary.groups;
    if (tableView === "group_subgroup") {
      if (hasSubgroups) return summary.subgroups;
      return summary.groups.map((g: any, idx: number) => ({
        subgroup_id: `group-fallback-${g.group_id ?? idx}`,
        subgroup_name: EMPTY_VALUE,
        group_id: g.group_id,
        group_name: g.group_name,
        contribution: g.contribution,
        percent: g.percent,
      }));
    }
    return summary.variables;
  }, [summary, tableView, hasSubgroups]);

  const varMetaMap = useMemo(() => {
    const map = new Map<string, { group_id?: string; subgroup_id?: string }>();
    (summary?.variables || []).forEach((v: any) => map.set(v.name, { group_id: v.group_id, subgroup_id: v.subgroup_id }));
    return map;
  }, [summary]);

  const channelByVariable = useMemo(() => {
    const map = new Map<string, ChannelEconomics>();
    (economics?.channels || []).forEach((ch) => {
      if (ch.proxy_variable && ch.proxy_in_current_model) map.set(ch.proxy_variable, ch);
    });
    return map;
  }, [economics]);

  const unmatchedChannels = useMemo(
    () => (economics?.channels || []).filter((ch) => !ch.proxy_variable || !ch.proxy_in_current_model),
    [economics]
  );

  // Folds ROI/ROAS/investment/revenue onto the same contribution rows instead of a separate
  // "Economía" table — variable-grain rows match 1:1 via proxy_variable; group/subgroup-grain
  // rows sum every channel whose proxy variable belongs to that group/subgroup. Channels with no
  // usable proxy still show up (as "unmodeled") so real spend is never silently dropped.
  const enrichedTableRows = useMemo(() => {
    const rows = tableRows as any[];
    if (!economics) return rows;

    if (tableView === "variable") {
      const withEcon = rows.map((row) => {
        const ch = channelByVariable.get(row.name);
        return ch
          ? { ...row, investment: ch.investment, revenue: ch.revenue, roi: ch.roi, roas: ch.roas }
          : { ...row, investment: null, revenue: null, roi: null, roas: null };
      });
      if (unmatchedChannels.length) {
        withEcon.push(
          ...unmatchedChannels.map((ch) => ({
            name: ch.name,
            group_name: t("table.unmodeled"),
            subgroup_name: null,
            contribution: null,
            percent: null,
            investment: ch.investment,
            revenue: ch.revenue,
            roi: ch.roi,
            roas: ch.roas,
          }))
        );
      }
      return withEcon;
    }

    const keyField = tableView === "group_subgroup" && hasSubgroups ? "subgroup_id" : "group_id";
    const byKey = new Map<string, { investment: number; revenue: number }>();
    channelByVariable.forEach((ch, varName) => {
      const meta = varMetaMap.get(varName);
      const key = (keyField === "subgroup_id" ? meta?.subgroup_id : meta?.group_id) || "__other__";
      const agg = byKey.get(key) || { investment: 0, revenue: 0 };
      agg.investment += ch.investment;
      agg.revenue += ch.revenue ?? 0;
      byKey.set(key, agg);
    });
    const withEcon = rows.map((row) => {
      const key = row[keyField] || "__other__";
      const agg = byKey.get(key);
      if (!agg) return { ...row, investment: null, revenue: null, roi: null, roas: null };
      const roi = agg.investment ? (agg.revenue - agg.investment) / agg.investment : null;
      const roas = agg.investment ? agg.revenue / agg.investment : null;
      return { ...row, investment: agg.investment, revenue: agg.revenue, roi, roas };
    });
    if (unmatchedChannels.length) {
      const investment = unmatchedChannels.reduce((sum, ch) => sum + ch.investment, 0);
      withEcon.push({
        group_id: "__unmatched__",
        group_name: t("table.unmodeled"),
        subgroup_id: "__unmatched__",
        subgroup_name: t("table.unmodeled"),
        contribution: null,
        percent: null,
        investment,
        revenue: null,
        roi: null,
        roas: null,
      });
    }
    return withEcon;
  }, [tableRows, tableView, hasSubgroups, channelByVariable, unmatchedChannels, varMetaMap, economics, t]);

  const hasMediaCoefficients = modelCoefficients.some((c) => c.is_media);
  const hasEconomicsChannels = Boolean(economics && economics.channels.length > 0);

  const roiValue = economics?.totals.roi ?? null;
  const roiBadge = !economics?.economics_configured
    ? { variant: "neutral" as const, label: t("kpis.notConfigured") }
    : roiValue !== null && Number.isFinite(roiValue)
      ? roiValue > 0
        ? { variant: "success" as const, label: t("kpis.positive") }
        : { variant: "warning" as const, label: t("kpis.negative") }
      : null;

  const tabItems = [
    {
      id: "table",
      label: t("tabs.table"),
      content: (
        <Card className="space-y-4">
          <CardHeader title={t("tabs.table")} />
          <div className="flex flex-wrap items-center justify-between gap-3 no-print">
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-2 text-ink">
                <input
                  type="checkbox"
                  checked={includeBaseline}
                  onChange={(e) => setIncludeBaseline(e.target.checked)}
                />
                {t("table.includeBaseline")}
              </label>
              <Select wrapperClassName="w-auto" value={tableView} onChange={(e) => setTableView(e.target.value as any)}>
                <option value="group">{t("table.viewGroup")}</option>
                <option value="group_subgroup">{t("table.viewGroupSubgroup")}</option>
                <option value="variable">{t("table.viewVariable")}</option>
              </Select>
            </div>
            <Button variant="ghost" onClick={downloadSummaryTable} disabled={!summary}>
              {t("table.export")}
            </Button>
          </div>
          {loading ? (
            <Skeleton className="h-64" />
          ) : summary ? (
            <Table wrapperClassName="max-h-[420px] overflow-auto">
              <TableHeader className="sticky top-0 z-10">
                <TableRow>
                  <Th>{t("table.colGroup")}</Th>
                  {tableView !== "group" && <Th>{t("table.colSubgroup")}</Th>}
                  {tableView === "variable" && <Th>{t("table.colVariable")}</Th>}
                  <Th className="text-right">{t("table.colContribution")}</Th>
                  <Th className="text-right">{t("table.colPercent")}</Th>
                  {economics && (
                    <>
                      <Th className="text-right">{t("table.colInvestment")}</Th>
                      <Th className="text-right">{t("table.colRevenue")}</Th>
                      <Th className="text-right">{t("table.colRoi")}</Th>
                      <Th className="text-right">{t("table.colRoas")}</Th>
                    </>
                  )}
                </TableRow>
              </TableHeader>
              <tbody>
                {enrichedTableRows.map((row: any, idx: number) => (
                  <TableRow key={`${row.group_id || row.subgroup_id || row.name}-${idx}`} className="hover:bg-surface-2">
                    <TableCell>{row.group_name || EMPTY_VALUE}</TableCell>
                    {tableView !== "group" && <TableCell>{row.subgroup_name || EMPTY_VALUE}</TableCell>}
                    {tableView === "variable" && <TableCell>{row.display_name ?? row.name}</TableCell>}
                    <TableCell className="text-right tabular-nums">
                      {row.contribution != null ? formatChartNumber(row.contribution, 1) : EMPTY_VALUE}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.percent != null ? formatChartPercent(row.percent, 1) : percentOfTotal(row.contribution)}
                    </TableCell>
                    {economics && (
                      <>
                        <TableCell className="text-right tabular-nums">
                          {row.investment != null ? formatCurrency(row.investment, currency, 0) : EMPTY_VALUE}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.revenue != null ? formatCurrency(row.revenue, currency, 0) : EMPTY_VALUE}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.roi != null ? fmtRoi(row.roi) : EMPTY_VALUE}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.roas != null ? fmtRoas(row.roas) : EMPTY_VALUE}
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState title={t("table.empty")} />
          )}
        </Card>
      ),
    },
    {
      id: "timeseries",
      label: t("tabs.timeseries"),
      content: (
        <Card className="space-y-4">
          <CardHeader title={t("tabs.timeseries")} />
          <div className="flex flex-wrap items-end gap-3 text-sm no-print">
            <FilterField label={t("timeseries.timeColumn")} className="w-auto">
              <Select wrapperClassName="w-auto" value={timeCol} onChange={(e) => setTimeCol(e.target.value)}>
                <option value={TIME_COLUMN_PLACEHOLDER}>{t("timeseries.timeColumnPlaceholder")}</option>
                {timeColumns.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </Select>
            </FilterField>
            <FilterField label={t("timeseries.freq")} className="w-auto">
              <Select wrapperClassName="w-auto" value={freq} onChange={(e) => setFreq(e.target.value as any)}>
                <option value="day">{t("timeseries.freqDay")}</option>
                <option value="week">{t("timeseries.freqWeek")}</option>
                <option value="month">{t("timeseries.freqMonth")}</option>
              </Select>
            </FilterField>
            <FilterField label={t("timeseries.groupBy")} className="w-auto">
              <Select wrapperClassName="w-auto" value={groupBy} onChange={(e) => setGroupBy(e.target.value as any)}>
                <option value="group">{t("timeseries.groupByGroup")}</option>
                <option value="subgroup">{t("timeseries.groupBySubgroup")}</option>
              </Select>
            </FilterField>
            <label className="flex h-control-md items-center gap-2 text-ink">
              <input type="checkbox" checked={asPercent} onChange={(e) => setAsPercent(e.target.checked)} />
              {t("timeseries.percentMode")}
            </label>
            <div className="flex items-center gap-2">
              <span className="text-2xs font-medium uppercase tracking-wide text-muted">{t("timeseries.view")}</span>
              <div className="flex gap-1">
                <ToggleChip active={viewMode === "stacked"} onClick={() => setViewMode("stacked")}>
                  {t("timeseries.viewStacked")}
                </ToggleChip>
                <ToggleChip active={viewMode === "grouped"} onClick={() => setViewMode("grouped")}>
                  {t("timeseries.viewGrouped")}
                </ToggleChip>
              </div>
            </div>
            <Button variant="ghost" onClick={downloadStacked} disabled={!stacked || stackedLoading} className="ml-auto">
              {t("timeseries.export")}
            </Button>
          </div>
          {!readyForStacked ? (
            <EmptyState title={t("timeseries.noTimeColumn")} />
          ) : stackedLoading && chartSeries.length === 0 ? (
            <Skeleton className="h-chart-lg" />
          ) : (
            <div className="h-chart-lg overflow-visible pl-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartSeries.length ? chartSeries : [{ period: "" }]}
                  stackOffset={stackOffset}
                  margin={{ top: 10, right: 24, left: 48, bottom: 16 }}
                  onMouseLeave={() => setHighlightedKey(null)}
                  onMouseMove={(state: any) => {
                    const activeKey = state?.activePayload?.[0]?.dataKey;
                    setHighlightedKey(typeof activeKey === "string" ? activeKey : activeKey != null ? String(activeKey) : null);
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={lineColor} />
                  <XAxis dataKey="period" tickMargin={8} tick={{ fill: mutedColor, fontSize: 12 }} axisLine={{ stroke: lineColor }} />
                  <YAxis
                    tickMargin={12}
                    tickFormatter={(value) => formatStackedValue(value)}
                    tick={{ fill: mutedColor, fontSize: 12 }}
                    axisLine={{ stroke: lineColor }}
                  />
                  <Tooltip content={<StackChartTooltip percentMode={asPercent} onSeriesHover={setHighlightedKey} totalLabel={tCommon("total")} />} />
                  <Legend wrapperStyle={{ fontSize: 12, color: mutedColor }} />
                  {sortedSeries.map((series) => (
                    <Bar
                      key={series.key}
                      dataKey={series.key}
                      stackId={viewMode === "stacked" ? "a" : undefined}
                      fill={seriesColorMap[series.key]}
                      stroke={seriesColorMap[series.key]}
                      fillOpacity={highlightedKey && highlightedKey !== series.key ? 0.25 : 1}
                      strokeOpacity={highlightedKey && highlightedKey !== series.key ? 0.4 : 1}
                      isAnimationActive
                      animationDuration={450}
                      animationEasing="ease-in-out"
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {stackedError && !stackedLoading && <ErrorText className="text-xs">{t("timeseries.error")}</ErrorText>}
          {!stackedError && !stackedLoading && chartSeries.length === 0 && readyForStacked && (
            <p className="text-sm text-muted">{t("timeseries.empty")}</p>
          )}
        </Card>
      ),
    },
  ];

  if (hasEconomicsChannels) {
    tabItems.push({
      id: "economics",
      label: t("tabs.economics"),
      content: (
        <Card className="space-y-4">
          <CardHeader title={t("economics.title")} subtitle={t("economics.subtitle")} />
          {economics && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span className="text-muted">
                {t("economics.totalInvestment")}: <span className="tabular-nums text-ink">{formatCurrency(economics.totals.investment, currency, 0)}</span>
              </span>
              <span className="text-muted">
                {t("economics.totalRevenue")}: <span className="tabular-nums text-ink">{formatCurrency(economics.totals.revenue, currency, 0)}</span>
              </span>
            </div>
          )}
          {!readyForStacked ? (
            <EmptyState title={t("economics.noTimeColumn")} />
          ) : (
            <>
              <FilterField label={t("economics.highlight")} className="w-auto no-print">
                <Select wrapperClassName="min-w-[220px]" value={highlightedChannel} onChange={(e) => setHighlightedChannel(e.target.value)}>
                  <option value="">{t("economics.highlightPlaceholder")}</option>
                  {(economicsStacked?.series || []).map((s) => (
                    <option key={s.channel_id} value={s.channel_id}>
                      {s.channel_name}
                    </option>
                  ))}
                </Select>
              </FilterField>
              {economicsStackedLoading && economicsChartData.length === 0 ? (
                <Skeleton className="h-chart-md" />
              ) : (
                <div className="h-chart-md">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={economicsChartData} margin={{ top: 10, right: 24, left: 24, bottom: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={lineColor} />
                      <XAxis dataKey="period" tickMargin={8} tick={{ fill: mutedColor, fontSize: 12 }} axisLine={{ stroke: lineColor }} />
                      <YAxis
                        tickMargin={12}
                        tickFormatter={(v) => formatChartNumber(v, 0)}
                        tick={{ fill: mutedColor, fontSize: 12 }}
                        axisLine={{ stroke: lineColor }}
                      />
                      <Tooltip
                        cursor={{ stroke: lineColor, strokeDasharray: "3 3" }}
                        formatter={(value: number) => formatChartNumber(value, 0)}
                        contentStyle={{ background: surfaceColor, borderColor: lineColor, fontSize: 12 }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12, color: mutedColor }} />
                      <Line
                        type="monotone"
                        dataKey="investment"
                        name={t("economics.seriesInvestmentTotal")}
                        stroke={chartColor(1, isDarkTheme)}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="revenue"
                        name={t("economics.seriesRevenueTotal")}
                        stroke={chartColor(2, isDarkTheme)}
                        dot={false}
                      />
                      {highlightedChannel && (
                        <Line
                          type="monotone"
                          dataKey="channel_investment"
                          name={t("economics.seriesInvestmentChannel")}
                          stroke={chartColor(1, isDarkTheme)}
                          strokeDasharray="4 4"
                          dot={false}
                        />
                      )}
                      {highlightedChannel && (
                        <Line
                          type="monotone"
                          dataKey="channel_revenue"
                          name={t("economics.seriesRevenueChannel")}
                          stroke={chartColor(2, isDarkTheme)}
                          strokeDasharray="4 4"
                          dot={false}
                        />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
              {economicsStackedError && !economicsStackedLoading && (
                <ErrorText className="text-xs">{t("economics.error")}</ErrorText>
              )}
            </>
          )}
        </Card>
      ),
    });
  }

  if (hasMediaCoefficients) {
    tabItems.push({
      id: "saturation",
      label: t("tabs.saturation"),
      content: (
        <Card className="space-y-4">
          <CardHeader title={t("saturation.title")} subtitle={t("saturation.subtitle")} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {modelCoefficients
              .filter((c) => c.is_media)
              .map((c) => (
                <SaturationCurveChart
                  key={c.name}
                  coef={c}
                  isDark={isDarkTheme}
                  channel={channelByVariable.get(c.name)}
                  currency={currency}
                  currentLevelLabel={t("saturation.currentLevel")}
                  ceilingLabel={t("saturation.ceiling")}
                  saturationCaption={(pct) => t("saturation.saturationCaption", { percent: formatChartPercent(pct, 0) })}
                  investmentCaption={(value, name) => t("saturation.investmentCaption", { value, name })}
                />
              ))}
          </div>
        </Card>
      ),
    });
  }

  useEffect(() => {
    if (!tabItems.some((item) => item.id === activeTab)) setActiveTab("table");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasEconomicsChannels, hasMediaCoefficients]);

  const showEmptyDatasets = !initializing && datasets.length === 0;
  const showEmptyModel = !initializing && selectedDataset && !modelsLoading && models.length === 0 && !selectedModel;

  return (
    <section className="space-y-6">
      <PageHeader
        title={t("title")}
        subtitle={t("eyebrow")}
        className="no-print"
        actions={
          <Button variant="ghost" onClick={() => window.print()} disabled={!summary}>
            <Printer className="mr-2 h-4 w-4" />
            {t("print")}
          </Button>
        }
      />

      <div className="print-only space-y-1 pb-4 border-b border-line">
        <h1 className="text-2xl font-semibold text-ink">{t("title")}</h1>
        <p className="text-sm text-muted">
          {datasets.find((ds) => ds.id === selectedDataset)?.display_name || "Dataset"} · {summary?.model?.name || "Model"} · {yVar}
        </p>
        {(dateRange.start || dateRange.end) && (
          <p className="text-sm text-muted">
            {dateRange.start || EMPTY_VALUE} — {dateRange.end || EMPTY_VALUE}
          </p>
        )}
        {printedAt && <p className="text-xs text-muted">{t("printedAt", { value: printedAt })}</p>}
      </div>

      {initializing ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[104px]" />
          ))}
        </div>
      ) : showEmptyDatasets ? (
        <Card>
          <EmptyState
            title={t("noDatasets.title")}
            description={t("noDatasets.description")}
            action={<SecondaryLink href="/datasets">{t("noDatasets.cta")}</SecondaryLink>}
          />
        </Card>
      ) : showEmptyModel ? (
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
                    {m.role && MODEL_ROLE_LABEL[m.role as ModelRole] ? `${m.name} [${MODEL_ROLE_LABEL[m.role as ModelRole]}]` : m.name}
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
            <div className="ml-auto flex items-end">
              <Button onClick={downloadSummary} disabled={!summary}>
                {t("table.export")}
              </Button>
            </div>
          </FilterBar>

          {summaryError ? (
            <Card>
              <EmptyState
                title={t("error.title")}
                action={
                  <Button variant="secondary" onClick={() => fetchSummary(selectedModel)}>
                    {t("error.retry")}
                  </Button>
                }
              />
            </Card>
          ) : (
            <>
              {economics && economics.channels.length > 0 && !economics.economics_configured && (
                <div className="rounded-xl bg-warn-bg px-4 py-3 text-sm text-warn no-print">
                  {t("economicsNotConfigured")}
                </div>
              )}

              {/* Resumen: siempre visible, la vitrina de la tesis (KPIs + proporción por grupo). */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy={loading}>
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[104px]" />)
                ) : (
                  <>
                    <StatCard
                      label={t("kpis.totalContribution", { yVar: yVarOrFallback })}
                      value={summary ? formatChartNumber(summary.total_contribution, 1) : EMPTY_VALUE}
                      icon={
                        <InfoTooltip
                          label={t("kpis.totalContribution", { yVar: yVarOrFallback })}
                          content={t("kpis.totalContributionTooltip", { yVar: yVarOrFallback })}
                        />
                      }
                    />
                    {/* One card per group instead of a single "Baseline" card — dynamic count
                        (baseline + however many groups this model has), reusing the same
                        `proportionSegments` already computed for the bar below so the numbers
                        and colors can never drift out of sync between the two views. */}
                    {proportionSegments.map((segment) => (
                      <StatCard
                        key={segment.key}
                        label={segment.name}
                        value={formatChartNumber(segment.contribution, 1)}
                        icon={
                          segment.key === BASELINE_KEY ? (
                            <InfoTooltip label={t("kpis.baseline")} content={t("kpis.baselineTooltip")} />
                          ) : (
                            <span
                              className="inline-block h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: segment.color }}
                              aria-hidden
                            />
                          )
                        }
                        trend={<Badge variant="neutral">{formatChartPercent(segment.percent, 1)}</Badge>}
                      />
                    ))}
                    <StatCard
                      label={t("kpis.roi")}
                      value={economics?.economics_configured ? fmtRoi(roiValue) : EMPTY_VALUE}
                      icon={<InfoTooltip label={t("kpis.roi")} content={t("kpis.roiTooltip")} />}
                      trend={roiBadge ? <Badge variant={roiBadge.variant}>{roiBadge.label}</Badge> : undefined}
                    />
                    <StatCard
                      label={t("kpis.roas")}
                      value={economics?.economics_configured ? fmtRoas(economics?.totals.roas) : EMPTY_VALUE}
                      icon={<InfoTooltip label={t("kpis.roas")} content={t("kpis.roasTooltip")} />}
                    />
                  </>
                )}
              </div>

              <Card className="space-y-3">
                <CardHeader as="h2" title={t("proportion.title")} subtitle={t("proportion.subtitle", { yVar: yVarOrFallback })} />
                {loading ? (
                  <Skeleton className="h-12" />
                ) : proportionSegments.length ? (
                  <GroupProportionBar
                    segments={proportionSegments}
                    valueLabel={t("proportion.legendValue")}
                    percentLabel={t("proportion.legendPercent")}
                  />
                ) : (
                  <EmptyState title={t("proportion.empty")} />
                )}
              </Card>

              {/* Detalle: técnico, oculto hasta que se pide — control explícito de la tesis. */}
              <Disclosure
                title={t("detail.show")}
                toggleLabel={detailOpen ? t("detail.hide") : t("detail.show")}
                subtitle={t("detail.subtitle")}
                open={detailOpen}
                onOpenChange={setDetailOpen}
              >
                <Tabs items={tabItems} active={activeTab} onChange={setActiveTab} />
              </Disclosure>
            </>
          )}
        </>
      )}
    </section>
  );
}

function GroupProportionBar({
  segments,
  valueLabel,
  percentLabel,
}: {
  segments: { key: string; name: string; percent: number; contribution: number; color: string }[];
  valueLabel: string;
  percentLabel: string;
}) {
  // Render widths (percent, floored at 0.5 so a ~0% group stays visible/hoverable) — computed
  // once here so the hover tooltip can be positioned by cumulative offset instead of relying on
  // DOM measurement.
  const widths = segments.map((s) => Math.max(s.percent, 0.5));
  const totalWidth = widths.reduce((sum, w) => sum + w, 0) || 1;
  let cumulative = 0;
  const laidOut = segments.map((segment, i) => {
    const width = widths[i];
    const centerPercent = ((cumulative + width / 2) / totalWidth) * 100;
    cumulative += width;
    return { ...segment, renderWidth: width, centerPercent };
  });
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const hovered = laidOut.find((s) => s.key === hoveredKey);

  return (
    <div className="space-y-3">
      <div className="relative">
        {/* `overflow-hidden` clips the square-cornered segments to the row's rounded border —
            it also clips anything that pokes outside the row, which is why the hover tooltip
            below is a sibling positioned against this wrapper (no overflow), not a child of
            this row: nested here, it silently never became visible. */}
        <div className="flex h-8 w-full overflow-hidden rounded-lg border border-line" role="list">
          {laidOut.map((segment) => (
            <div
              key={segment.key}
              tabIndex={0}
              role="listitem"
              aria-label={`${segment.name}: ${formatChartPercent(segment.percent, 1)}`}
              onMouseEnter={() => setHoveredKey(segment.key)}
              onMouseLeave={() => setHoveredKey(null)}
              onFocus={() => setHoveredKey(segment.key)}
              onBlur={() => setHoveredKey(null)}
              className="flex h-full min-w-[6px] items-center justify-center overflow-hidden text-2xs font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              style={{ width: `${segment.renderWidth}%`, backgroundColor: segment.color }}
            >
              {segment.percent >= 6 && <span className="truncate px-1">{formatChartPercent(segment.percent, 0)}</span>}
            </div>
          ))}
        </div>
        {hovered && (
          <span
            role="tooltip"
            aria-hidden
            className="pointer-events-none absolute bottom-full z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink shadow-[var(--shadow-soft)]"
            style={{ left: `${hovered.centerPercent}%` }}
          >
            <strong>{hovered.name}</strong>
            <br />
            {valueLabel}: {formatChartNumber(hovered.contribution, 1)}
            <br />
            {percentLabel}: {formatChartPercent(hovered.percent, 1)}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map((segment) => (
          <span key={segment.key} className="inline-flex items-center gap-1.5 text-xs text-muted">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: segment.color }} aria-hidden />
            {segment.name} <span className="tabular-nums text-ink">{formatChartPercent(segment.percent, 1)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function SaturationCurveChart({
  coef,
  isDark,
  channel,
  currency,
  currentLevelLabel,
  ceilingLabel,
  saturationCaption,
  investmentCaption,
}: {
  coef: ModelCoefficient;
  isDark: boolean;
  channel?: ChannelEconomics;
  currency: string;
  currentLevelLabel: string;
  ceilingLabel: string;
  saturationCaption: (percent: number) => string;
  investmentCaption: (value: string, name: string) => string;
}) {
  const k = coef.hill_k ?? 0;
  const s = coef.hill_s ?? 1;
  if (!k || !s) return null;
  const rawMean = coef.raw_mean ?? null;
  // Domain must cover the operating point too — a channel used well past 4×K would otherwise
  // push `raw_mean` off the plotted range and silently drop the reference line/dot (recharts
  // does not auto-extend a `type="number"` axis to fit ReferenceLine/ReferenceDot coordinates).
  const domainMax = Math.max(k * 4, (rawMean ?? 0) * 1.15);
  const points = Array.from({ length: 61 }, (_, i) => {
    const x = (domainMax * i) / 60;
    const xs = Math.pow(x, s);
    const ks = Math.pow(k, s);
    return { x, y: xs / (ks + xs || 1) };
  });
  const operatingY = rawMean != null ? Math.pow(rawMean, s) / (Math.pow(k, s) + Math.pow(rawMean, s) || 1) : null;
  return (
    <div className="space-y-1">
      <p className="truncate text-xs font-medium text-ink">{coef.name}</p>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={points} margin={{ top: 14, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
          <XAxis
            dataKey="x"
            type="number"
            domain={[0, domainMax]}
            tick={{ fontSize: 10 }}
            tickFormatter={(v) => formatChartNumber(v, 0)}
          />
          <YAxis domain={[0, 1]} tick={{ fontSize: 10 }} tickFormatter={(v) => formatChartPercent(Number(v) * 100, 0)} />
          <Tooltip
            formatter={(v: number) => formatChartPercent(v * 100, 1)}
            labelFormatter={(v: number) => `x=${formatChartNumber(v, 1)}`}
          />
          <Line type="monotone" dataKey="y" stroke={chartColor(0, isDark)} dot={false} strokeWidth={2} />
          <ReferenceLine
            y={1}
            stroke={chartColor(7, isDark)}
            strokeDasharray="2 2"
            label={{ value: ceilingLabel, fontSize: 10, position: "insideTopRight" }}
          />
          {rawMean != null && (
            <ReferenceLine
              x={rawMean}
              stroke={chartColor(7, isDark)}
              strokeDasharray="4 4"
              label={{ value: currentLevelLabel, fontSize: 10, position: "insideBottomRight" }}
            />
          )}
          {rawMean != null && operatingY != null && (
            <ReferenceDot x={rawMean} y={operatingY} r={4} fill={chartColor(0, isDark)} stroke={chartColor(0, isDark)} />
          )}
        </LineChart>
      </ResponsiveContainer>
      <div className="space-y-0.5">
        {operatingY != null && <p className="text-2xs text-muted">{saturationCaption(operatingY * 100)}</p>}
        {channel && (
          <p className="text-2xs text-muted">
            {investmentCaption(formatCurrency(channel.investment, currency, 0), channel.name)}
          </p>
        )}
      </div>
    </div>
  );
}

type CustomTooltipProps = TooltipProps<number, string> & {
  percentMode: boolean;
  onSeriesHover?: (key: string | null) => void;
  totalLabel: string;
};

const StackChartTooltip: React.FC<CustomTooltipProps> = ({ active, payload, label, percentMode, onSeriesHover, totalLabel }) => {
  const isEmpty = !active || !payload || payload.length === 0;

  // Clearing the parent's highlight is a setState on AnalysisPage; doing it in the render
  // body triggered React's "Cannot update a component while rendering a different component"
  // warning. It has to happen after commit.
  useEffect(() => {
    if (isEmpty) onSeriesHover?.(null);
  }, [isEmpty, onSeriesHover]);

  if (isEmpty) return null;

  const total = payload!.reduce((sum, entry) => sum + (entry.value ?? 0), 0);

  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 shadow-[var(--shadow-soft)]">
      <div className="mb-1 text-xs font-semibold text-ink">{label}</div>
      <div className="space-y-1">
        {payload!.map((entry) => {
          const key = entry.dataKey?.toString() ?? "";
          const value = entry.value ?? 0;
          const pct = total ? (value / total) * 100 : 0;
          return (
            <div key={key} className="flex items-center justify-between gap-4 text-xs text-ink">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded" style={{ backgroundColor: entry.color || entry.fill }} />
                {entry.name ?? key}
              </span>
              <span className="tabular-nums font-medium">
                {formatChartNumber(value, 2)}
                {percentMode && ` (${formatChartPercent(pct, 1)})`}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between gap-4 border-t border-line pt-1 text-xs font-semibold text-ink">
        <span>{totalLabel}</span>
        <span className="tabular-nums">
          {formatChartNumber(total, 2)}
          {percentMode && " (100%)"}
        </span>
      </div>
    </div>
  );
};
