"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TooltipProps } from "recharts";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { apiFetch, ApiError } from "@/lib/api";
import { ErrorText } from "@/components/ui/error-text";
import { Select } from "@/components/ui/select";
import { assignCategoricalColors, chartColor } from "@/lib/chart-colors";
import { formatChartNumber, formatChartPercent } from "@/lib/chart-format";
import { downloadBlob } from "@/lib/download";
import { useGlobalStore } from "@/lib/store";

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
const TIME_COLUMN_PLACEHOLDER = "—";

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
    if (changed === "start") {
      return { start, end: start };
    }
    if (changed === "end") {
      return { start: end, end };
    }
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


export default function AnalysisPage() {
  const { resolvedTheme } = useTheme();
  const isDarkTheme = resolvedTheme === "dark";
  const { activeCompanyId } = useGlobalStore();
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

  useEffect(() => {
    if (timeColumnDefault) {
      setTimeCol(timeColumnDefault);
    } else {
      setTimeCol(TIME_COLUMN_PLACEHOLDER);
    }
  }, [timeColumnDefault]);

  const boundsMin = dateBounds.min;
  const boundsMax = dateBounds.max;

  useEffect(() => {
    const bounds = { min: boundsMin, max: boundsMax };
    setDateRange((prev) => {
      const next = clampRange(prev, bounds, "bounds");
      if (next.start === prev.start && next.end === prev.end) {
        return prev;
      }
      return next;
    });
  }, [boundsMin, boundsMax]);

  const fetchDatasets = useCallback(async () => {
    try {
      const data = await apiFetch<Dataset[]>("/datasets");
      setDatasets(data);
      if (data.length) {
        setSelectedDataset((prev) => (prev ? prev : data[0].id));
      }
    } catch {
      toast.error("Failed to load datasets");
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
    setTimeCol(TIME_COLUMN_PLACEHOLDER);
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
    }
  }, []);

  const fetchSummary = useCallback(async (modelId: string) => {
    setLoading(true);
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
    } finally {
      setLoading(false);
    }
  }, [includeBaseline, asPercent, dateRange.start, dateRange.end]);

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

  const fetchEconomics = useCallback(async (modelId: string) => {
    try {
      const params = new URLSearchParams();
      if (dateRange.start) params.set("start_date", dateRange.start);
      if (dateRange.end) params.set("end_date", dateRange.end);
      const data = await apiFetch<EconomicsSummaryData>(`/economics/${modelId}/summary?${params.toString()}`);
      setEconomics(data);
    } catch {
      setEconomics(null);
    }
  }, [dateRange.start, dateRange.end]);

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

  const fetchStacked = useCallback(async () => {
    if (!selectedModel || !timeCol || timeCol === TIME_COLUMN_PLACEHOLDER) {
      return;
    }
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
        (err instanceof ApiError ? err.message : (err as Error)?.message) || "Failed to load stacked data"
      );
    } finally {
      setStackedLoading(false);
    }
  }, [
    selectedModel,
    timeCol,
    freq,
    groupBy,
    includeBaseline,
    asPercent,
    dateRange.start,
    dateRange.end,
  ]);

  const stackDeps = [
    selectedModel,
    timeCol,
    freq,
    groupBy,
    includeBaseline,
    asPercent,
    dateRange.start,
    dateRange.end,
  ];

  useEffect(() => {
    if (!selectedModel || !timeCol || timeCol === TIME_COLUMN_PLACEHOLDER) {
      return;
    }
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
      if (next.start === prev.start && next.end === prev.end) {
        return prev;
      }
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
      const blob = await apiFetch<Blob>(
        `/analysis/${selectedModel}/export/summary.xlsx?${params.toString()}`,
        { responseType: "blob" }
      );
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
      toast.error(
        (err instanceof ApiError ? err.message : (err as Error)?.message) || "Failed to export summary table"
      );
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
      const blob = await apiFetch<Blob>(
        `/analysis/${selectedModel}/export/stacked.xlsx?${params.toString()}`,
        { responseType: "blob" }
      );
      downloadBlob(blob, "stacked.xlsx");
    } catch (err) {
      toast.error(
        (err instanceof ApiError ? err.message : (err as Error)?.message) || "Failed to export stacked data"
      );
    }
  };

  const timeColumns = useMemo(() => {
    const ds = datasets.find((d) => d.id === selectedDataset);
    return ds ? ds.columns.map((c) => c.name) : [];
  }, [datasets, selectedDataset]);

  const numberFormatter = useMemo(

    () => new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),

    []

  );

  const percentFormatter = useMemo(

    () => new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),

    []

  );



  const DASH = "-";



  const formatNumber = (value: number | null | undefined) =>

    value === null || value === undefined ? DASH : numberFormatter.format(value);

  const fmtRoi = (value: number | null | undefined) =>
    value === null || value === undefined || !Number.isFinite(value) ? DASH : `${(value * 100).toFixed(1)}%`;

  const fmtRoas = (value: number | null | undefined) =>
    value === null || value === undefined || !Number.isFinite(value) ? DASH : `${value.toFixed(2)}x`;

  const percentOfTotal = (value: number | null | undefined) => {

    if (!summary || summary.total_contribution === 0 || value === null || value === undefined) {

      return DASH;

    }

    return `${percentFormatter.format((value / summary.total_contribution) * 100)}%`;

  };

  const readyForStacked = Boolean(selectedModel && timeCol && timeCol !== TIME_COLUMN_PLACEHOLDER);

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
        (err instanceof ApiError ? err.message : (err as Error)?.message) || "Failed to load economics timeseries"
      );
    } finally {
      setEconomicsStackedLoading(false);
    }
  }, [selectedModel, readyForStacked, timeCol, freq, dateRange.start, dateRange.end]);

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
    (value: number | string | null | undefined) =>
      asPercent ? formatChartPercent(value, 1) : formatChartNumber(value, 0),
    [asPercent]
  );



  const sortedSeries = useMemo(() => {

    if (!stacked) return [];

    const arr = [...stacked.series];

    const isBaseline = (key: string) => key.toLowerCase().includes("baseline") || key === "__intercept__";

    arr.sort((a, b) => {

      if (isBaseline(a.key) && !isBaseline(b.key)) return -1;

      if (!isBaseline(a.key) && isBaseline(b.key)) return 1;

      return a.key.localeCompare(b.key);

    });

    return arr;

  }, [stacked]);

  const seriesColorMap = useMemo(
    () => assignCategoricalColors(sortedSeries.map((series) => series.key), isDarkTheme),
    [sortedSeries, isDarkTheme]
  );



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
      if (prev.length !== groupedSeries.length) {
        return groupedSeries;
      }
      return prev.map((row, idx) => ({ ...row, ...groupedSeries[idx] }));
    });
  }, [stacked, groupedSeries]);



  const stackOffset = viewMode === "stacked" ? "sign" : undefined;



  const topGroups = useMemo(() => {

    if (!summary) return [];

    return summary.groups

      .filter((g: any) => g.group_id && g.group_name !== "Baseline")

      .sort((a: any, b: any) => b.contribution - a.contribution)

      .slice(0, 3);

  }, [summary]);



  const totalValue = summary?.total_contribution ?? null;

  const totalPercentLabel = summary ? "100.0%" : DASH;



  const hasSubgroups =

    summary?.subgroups?.some((sg: any) => sg.subgroup_id && sg.subgroup_id !== "baseline") ?? false;


  
  const tableRows = useMemo(() => {

    if (!summary) return [];

    if (tableView === "group") return summary.groups;

    if (tableView === "group_subgroup") {

      if (hasSubgroups) return summary.subgroups;

      return summary.groups.map((g: any, idx: number) => ({

        subgroup_id: `group-fallback-${g.group_id ?? idx}`,

        subgroup_name: DASH,

        group_id: g.group_id,

        group_name: g.group_name,

        contribution: g.contribution,

        percent: g.percent,

      }));

    }

    return summary.variables;

  }, [summary, tableView, hasSubgroups]);

  const baselineGroup = summary?.groups.find((g: any) => g.group_id === "baseline");

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
  // usable proxy still show up (as "Sin modelar") so real spend is never silently dropped.
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
            group_name: "Sin modelar",
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
        group_name: "Sin modelar",
        subgroup_id: "__unmatched__",
        subgroup_name: "Sin modelar",
        contribution: null,
        percent: null,
        investment,
        revenue: null,
        roi: null,
        roas: null,
      });
    }
    return withEcon;
  }, [tableRows, tableView, hasSubgroups, channelByVariable, unmatchedChannels, varMetaMap, economics]);

  return (
    <section className="space-y-6">
      <header className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 no-print">
          <div>
            <p className="text-sm text-[var(--color-muted)]">Module 4</p>
            <h1 className="text-2xl font-semibold">Analysis & Attribution</h1>
          </div>
          <Button variant="ghost" onClick={() => window.print()} disabled={!summary}>
            Imprimir reporte
          </Button>
        </div>
        <div className="print-only space-y-1 pb-4 border-b border-[var(--color-border)]">
          <p className="text-sm text-[var(--color-muted)]">Aion — Reporte ejecutivo</p>
          <h1 className="text-xl font-semibold">
            {datasets.find((ds) => ds.id === selectedDataset)?.display_name || "Dataset"} · {summary?.model?.name || "Model"}
          </h1>
          <p className="text-sm text-[var(--color-muted)]">
            Variable objetivo: {summary?.model?.y_var || "—"}
            {dateRange.start || dateRange.end
              ? ` · Periodo: ${dateRange.start || "inicio"} – ${dateRange.end || "actual"}`
              : ""}
          </p>
          {printedAt && <p className="text-xs text-[var(--color-muted)]">Generado: {printedAt}</p>}
        </div>
        <FilterBar className="no-print">
          <FilterField label="DATASET" className="w-[240px]">
            <Select value={selectedDataset} onChange={(e) => setSelectedDataset(e.target.value)}>
              {datasets.map((ds) => (
                <option key={ds.id} value={ds.id}>
                  {ds.display_name}
                </option>
              ))}
            </Select>
          </FilterField>
          <FilterField label="MODEL" className="w-[260px]">
            <Select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.role && MODEL_ROLE_LABEL[m.role as ModelRole]
                    ? `${m.name} [${MODEL_ROLE_LABEL[m.role as ModelRole]}]`
                    : m.name}
                </option>
              ))}
            </Select>
          </FilterField>
          <FilterField label="DATE RANGE" className="flex-1 min-w-[280px]">
            <div className="flex flex-wrap gap-3">
              <input
                type="date"
                className="w-[180px] rounded-full border border-[var(--color-border)] px-3 py-1.5 text-[var(--color-foreground)]"
                value={dateRange.start ?? ""}
                min={dateBounds.min ?? undefined}
                max={dateBounds.max ?? undefined}
                onChange={(e) => updateDateField("start", e.target.value)}
              />
              <input
                type="date"
                className="w-[180px] rounded-full border border-[var(--color-border)] px-3 py-1.5 text-[var(--color-foreground)]"
                value={dateRange.end ?? ""}
                min={dateBounds.min ?? undefined}
                max={dateBounds.max ?? undefined}
                onChange={(e) => updateDateField("end", e.target.value)}
              />
            </div>
          </FilterField>
          <div className="flex items-end">
            <Button onClick={downloadSummary}>Download Summary</Button>
          </div>
        </FilterBar>
      </header>

      {economics && economics.channels.length > 0 && !economics.economics_configured && (
        <Card className="border-[var(--color-warning)]/60 bg-[var(--color-warning-soft)]">
          <p className="text-sm">
            Configura tasa de conversión y valor promedio en{" "}
            <span className="underline font-medium">Transform → Conversion settings</span> para calcular ROI/ROAS de
            este modelo.
          </p>
        </Card>
      )}

      {/* `loading` tracks fetchSummary, which feeds this grid. Same dimming convention the
          charts below already use, so a stale KPI is visibly stale while recalculating. */}
      <div
        className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-4 transition-opacity duration-300 ${
          loading ? "opacity-40 pointer-events-none" : "opacity-100"
        }`}
        aria-busy={loading}
      >
        <Card padding="sm">
          <CardHeader title="Total" subtitle={summary?.model?.y_var || "—"} />
          <p className="text-lg font-semibold">
            {formatNumber(totalValue)}{" "}
            <span className="text-sm text-[var(--color-muted)]">({totalPercentLabel})</span>
          </p>
        </Card>
        <Card padding="sm">
          <CardHeader title="Baseline" subtitle="Intercept impact" />
          <p className="text-lg font-semibold">
            {formatNumber(summary?.intercept)}{" "}
            <span className="text-sm text-[var(--color-muted)]">{percentOfTotal(summary?.intercept)}</span>
          </p>
        </Card>
        {topGroups.map((group) => (
          <Card key={group.group_id} padding="sm">
            <CardHeader title={group.group_name || "Group"} subtitle="Contribution" />
            <p className="text-lg font-semibold">
              {formatNumber(group.contribution)}{" "}
              <span className="text-sm text-[var(--color-muted)]">{percentOfTotal(group.contribution)}</span>
            </p>
          </Card>
        ))}
      </div>

      {economics && economics.channels.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card padding="sm">
            <CardHeader title="Inversión total" subtitle="Todos los canales" />
            <p className="text-lg font-semibold">{formatNumber(economics.totals.investment)}</p>
          </Card>
          <Card padding="sm">
            <CardHeader title="Ingreso total" subtitle="Canales modelados" />
            <p className="text-lg font-semibold">{formatNumber(economics.totals.revenue)}</p>
          </Card>
          <Card padding="sm">
            <CardHeader title="ROI" subtitle="(ingreso − inversión) / inversión" />
            <p className="text-lg font-semibold">{fmtRoi(economics.totals.roi)}</p>
          </Card>
          <Card padding="sm">
            <CardHeader title="ROAS" subtitle="ingreso / inversión" />
            <p className="text-lg font-semibold">{fmtRoas(economics.totals.roas)}</p>
          </Card>
        </div>
      )}

      <div className="my-6 border-t border-[var(--color-border)]" />

      <Card className="space-y-4">
        <CardHeader title="Summary Table" subtitle="Variable contributions and group mapping" />
        <div className="flex flex-wrap items-center justify-between gap-3 no-print">
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={includeBaseline} onChange={(e) => setIncludeBaseline(e.target.checked)} />
              Include baseline
            </label>
            <Select wrapperClassName="w-auto" value={tableView} onChange={(e) => setTableView(e.target.value as any)}>
              <option value="group">Group</option>
              <option value="group_subgroup">Group / Subgroup</option>
              <option value="variable">Group / Subgroup / Variable</option>
            </Select>
          </div>
          <Button variant="ghost" onClick={downloadSummaryTable} disabled={!summary}>
            Export Excel
          </Button>
        </div>
        {summary ? (
          <div className="overflow-auto max-h-[420px]">
            <table className="min-w-full text-sm">
              <thead className="bg-[var(--color-bg)] sticky top-0 z-10">
                <tr>
                  <th className="px-2 py-2 text-left">Group</th>
                  {tableView !== "group" && <th className="px-2 py-2 text-left">Subgroup</th>}
                  {tableView === "variable" && <th className="px-2 py-2 text-left">Variable</th>}
                  <th className="px-2 py-2 text-left">Contribution</th>
                  <th className="px-2 py-2 text-left">% of total</th>
                  {economics && (
                    <>
                      <th className="px-2 py-2 text-right">Inversión</th>
                      <th className="px-2 py-2 text-right">Ingreso</th>
                      <th className="px-2 py-2 text-right">ROI</th>
                      <th className="px-2 py-2 text-right">ROAS</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {enrichedTableRows.map((row: any, idx: number) => (
                  <tr
                    key={`${row.group_id || row.subgroup_id || row.name}-${idx}`}
                    className="odd:bg-transparent even:bg-[var(--color-border)]/20"
                  >
                    <td className="px-2 py-2">{row.group_name || DASH}</td>
                    {tableView !== "group" && <td className="px-2 py-2">{row.subgroup_name || DASH}</td>}
                    {tableView === "variable" && <td className="px-2 py-2">{row.name}</td>}
                    <td className="px-2 py-2">{row.contribution != null ? formatNumber(row.contribution) : DASH}</td>
                    <td className="px-2 py-2">
                      {row.percent != null
                        ? `${percentFormatter.format(row.percent)}%`
                        : percentOfTotal(row.contribution)}
                    </td>
                    {economics && (
                      <>
                        <td className="px-2 py-2 text-right">{row.investment != null ? formatNumber(row.investment) : DASH}</td>
                        <td className="px-2 py-2 text-right">{row.revenue != null ? formatNumber(row.revenue) : DASH}</td>
                        <td className="px-2 py-2 text-right">{row.roi != null ? fmtRoi(row.roi) : DASH}</td>
                        <td className="px-2 py-2 text-right">{row.roas != null ? fmtRoas(row.roas) : DASH}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-[var(--color-muted)]">Select a model to view contributions.</p>
        )}
      </Card>

      <Card className="space-y-4">
        <CardHeader title="Contributions over time" subtitle="Stride through periods and groups" />
        <div className="flex flex-wrap gap-3 text-sm no-print">
          <Select wrapperClassName="w-auto" value={timeCol} onChange={(e) => setTimeCol(e.target.value)}>
            <option value={TIME_COLUMN_PLACEHOLDER}>Time column</option>
            {timeColumns.map((col) => (
              <option key={col} value={col}>
                {col}
              </option>
            ))}
          </Select>
          <Select wrapperClassName="w-auto" value={freq} onChange={(e) => setFreq(e.target.value as any)}>
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </Select>
          <Select wrapperClassName="w-auto" value={groupBy} onChange={(e) => setGroupBy(e.target.value as any)}>
            <option value="group">Group</option>
            <option value="subgroup">Subgroup</option>
          </Select>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={asPercent} onChange={(e) => setAsPercent(e.target.checked)} />
            Percent mode
          </label>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[var(--color-muted)]">View</span>
            <div className="inline-flex overflow-hidden rounded-full border border-[var(--color-border)] text-xs">
              <button
                type="button"
                className={`px-3 py-1 transition ${
                  viewMode === "stacked"
                    ? "bg-[var(--color-foreground)] text-white"
                    : "text-[var(--color-muted)]"
                }`}
                onClick={() => setViewMode("stacked")}
              >
                Stacked
              </button>
              <button
                type="button"
                className={`px-3 py-1 transition ${
                  viewMode === "grouped"
                    ? "bg-[var(--color-foreground)] text-white"
                    : "text-[var(--color-muted)]"
                }`}
                onClick={() => setViewMode("grouped")}
              >
                Grouped
              </button>
            </div>
          </div>
          <Button variant="ghost" onClick={downloadStacked} disabled={!stacked || stackedLoading}>
            Export Excel
          </Button>
        </div>
        <div
          className={`h-96 overflow-visible pl-4 transition-opacity duration-300 ${
            stackedLoading ? "opacity-40 pointer-events-none" : "opacity-100"
          }`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartSeries.length ? chartSeries : [{ period: "" }]}
              stackOffset={stackOffset}
              margin={{ top: 10, right: 24, left: 64, bottom: 16 }}
              onMouseLeave={() => setHighlightedKey(null)}
              onMouseMove={(state: any) => {
                const activeKey = state?.activePayload?.[0]?.dataKey;
                setHighlightedKey(
                  typeof activeKey === "string"
                    ? activeKey
                    : activeKey != null
                    ? String(activeKey)
                    : null
                );
              }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="period" tickMargin={8} />
              <YAxis
                tickMargin={12}
                tickFormatter={(value) => formatStackedValue(value)}
                tick={{ dx: -4 }}
              />
              <Tooltip
                content={
                  <StackChartTooltip percentMode={asPercent} onSeriesHover={setHighlightedKey} />
                }
              />
              <Legend />
              {sortedSeries.map((series) => (
                <Bar
                  key={series.key}
                  dataKey={series.key}
                  stackId={viewMode === "stacked" ? "a" : undefined}
                  fill={seriesColorMap[series.key]}
                  stroke={seriesColorMap[series.key]}
                  fillOpacity={
                    highlightedKey && highlightedKey !== series.key ? 0.25 : 1
                  }
                  strokeOpacity={
                    highlightedKey && highlightedKey !== series.key ? 0.4 : 1
                  }
                  isAnimationActive
                  animationDuration={450}
                  animationEasing="ease-in-out"
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
        {stackedError && !stackedLoading && (
          <ErrorText className="text-xs">Couldn&rsquo;t load stacked contributions. Please try again.</ErrorText>
        )}
        {!stackedError && !stackedLoading && chartSeries.length === 0 && readyForStacked && (
          <p className="text-sm text-[var(--color-muted)]">No data for the selected filters.</p>
        )}
        {!readyForStacked && (
          <p className="text-sm text-[var(--color-muted)]">
            Select a dataset, model, and time column to view stacked contributions.
          </p>
        )}
      </Card>

      {economics && economics.channels.length > 0 && (
        <Card className="space-y-4">
          <CardHeader title="Inversión vs. ingreso en el tiempo" subtitle="Total por periodo, con canal opcional resaltado" />
          {!readyForStacked ? (
            <p className="text-sm text-[var(--color-muted)]">
              Selecciona una columna de tiempo arriba para ver la serie.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <Select
                  wrapperClassName="min-w-[220px]"
                  value={highlightedChannel}
                  onChange={(e) => setHighlightedChannel(e.target.value)}
                >
                  <option value="">Resaltar canal (opcional)</option>
                  {(economicsStacked?.series || []).map((s) => (
                    <option key={s.channel_id} value={s.channel_id}>
                      {s.channel_name}
                    </option>
                  ))}
                </Select>
              </div>
              <div
                className={`h-80 transition-opacity duration-300 ${
                  economicsStackedLoading ? "opacity-40 pointer-events-none" : "opacity-100"
                }`}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={economicsChartData} margin={{ top: 10, right: 24, left: 24, bottom: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="period" tickMargin={8} />
                    <YAxis tickMargin={12} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="investment" name="Inversión total" stroke={chartColor(1, isDarkTheme)} dot={false} />
                    <Line type="monotone" dataKey="revenue" name="Ingreso total" stroke={chartColor(2, isDarkTheme)} dot={false} />
                    {highlightedChannel && (
                      <Line
                        type="monotone"
                        dataKey="channel_investment"
                        name="Inversión (canal)"
                        stroke={chartColor(1, isDarkTheme)}
                        strokeDasharray="4 4"
                        dot={false}
                      />
                    )}
                    {highlightedChannel && (
                      <Line
                        type="monotone"
                        dataKey="channel_revenue"
                        name="Ingreso (canal)"
                        stroke={chartColor(2, isDarkTheme)}
                        strokeDasharray="4 4"
                        dot={false}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {economicsStackedError && !economicsStackedLoading && (
                <ErrorText className="text-xs">Couldn&rsquo;t load economics timeseries. Please try again.</ErrorText>
              )}
            </>
          )}
        </Card>
      )}

      {modelCoefficients.some((c) => c.is_media) && (
        <Card className="space-y-4">
          <CardHeader
            title="Curvas de saturación"
            subtitle="Punto de inversión actual vs. la curva de respuesta completa del canal — para justificar decisiones de inversión"
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {modelCoefficients
              .filter((c) => c.is_media)
              .map((c) => (
                <SaturationCurveChart
                  key={c.name}
                  coef={c}
                  isDark={isDarkTheme}
                  channel={channelByVariable.get(c.name)}
                />
              ))}
          </div>
        </Card>
      )}
    </section>
  );
}

function SaturationCurveChart({
  coef,
  isDark,
  channel,
}: {
  coef: ModelCoefficient;
  isDark: boolean;
  channel?: ChannelEconomics;
}) {
  const k = coef.hill_k ?? 0;
  const s = coef.hill_s ?? 1;
  if (!k || !s) return null;
  const maxX = k * 4;
  const points = Array.from({ length: 61 }, (_, i) => {
    const x = (maxX * i) / 60;
    const xs = Math.pow(x, s);
    const ks = Math.pow(k, s);
    return { x, y: xs / (ks + xs || 1) };
  });
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium truncate">{coef.name}</p>
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
          <XAxis dataKey="x" tick={{ fontSize: 10 }} tickFormatter={(v) => Number(v).toFixed(0)} />
          <YAxis domain={[0, 1]} tick={{ fontSize: 10 }} />
          <Tooltip formatter={(v: number) => v.toFixed(3)} labelFormatter={(v: number) => `x=${Number(v).toFixed(1)}`} />
          <Line type="monotone" dataKey="y" stroke={chartColor(0, isDark)} dot={false} strokeWidth={2} />
          {coef.raw_mean != null && (
            <ReferenceLine
              x={coef.raw_mean}
              stroke={chartColor(7, isDark)}
              strokeDasharray="4 4"
              label={{ value: "nivel actual", fontSize: 10, position: "insideTopRight" }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
      {channel && (
        <p className="text-2xs text-[var(--color-muted)]">
          Inversión real: {channel.investment.toLocaleString(undefined, { maximumFractionDigits: 0 })} ({channel.name})
        </p>
      )}
    </div>
  );
}


const formatStackedTooltipValue = (value: number | string | null | undefined, asPercent: boolean) => {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return asPercent ? "0%" : "0";
  }
  if (asPercent) {
    return num.toFixed(2);
  }
  return num.toFixed(2);
};

type CustomTooltipProps = TooltipProps<number, string> & {
  percentMode: boolean;
  onSeriesHover?: (key: string | null) => void;
};

const StackChartTooltip: React.FC<CustomTooltipProps> = ({
  active,
  payload,
  label,
  percentMode,
  onSeriesHover,
}) => {
  const isEmpty = !active || !payload || payload.length === 0;

  // Clearing the parent's highlight is a setState on AnalysisPage; doing it in the render
  // body triggered React's "Cannot update a component while rendering a different component"
  // warning. It has to happen after commit.
  useEffect(() => {
    if (isEmpty) onSeriesHover?.(null);
  }, [isEmpty, onSeriesHover]);

  if (isEmpty) return null;

  const total = payload!.reduce((sum, entry) => sum + (entry.value ?? 0), 0);
  const formatValue = (value: number) =>
    Number.isFinite(value)
      ? value.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : "0.00";

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 shadow-lg">
      <div className="mb-1 text-xs font-semibold text-[var(--color-foreground)]">{label}</div>
      <div className="space-y-1">
        {payload!.map((entry) => {
          const key = entry.dataKey?.toString() ?? "";
          const value = entry.value ?? 0;
          const pct = total ? (value / total) * 100 : 0;
          return (
            <div key={key} className="flex items-center justify-between text-xs text-[var(--color-foreground)]">
              <span className="inline-flex items-center gap-1">
                <span
                  className="inline-block h-2 w-2 rounded"
                  style={{ backgroundColor: entry.color || entry.fill }}
                />
                {entry.name ?? key}
              </span>
              <span className="font-medium">
                {formatValue(value)}
                {percentMode && ` (${pct.toFixed(1)}%)`}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between border-t border-[var(--color-border)] pt-1 text-xs font-semibold text-[var(--color-foreground)]">
        <span>Total</span>
        <span>
          {formatValue(total)}
          {percentMode && " (100%)"}
        </span>
      </div>
    </div>
  );
};
