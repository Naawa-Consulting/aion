"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

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
type DatasetMeta = { id: string; name: string; rows: number; columns: number; time_column: string | null };

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const MODEL_ROLES: readonly ModelRole[] = ["hero", "challenger1", "challenger2"];
const TIME_COLUMN_PLACEHOLDER = "—";

export default function AnalysisPage() {
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
  const [tableView, setTableView] = useState<"group" | "group_subgroup" | "variable">("group");
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState<{ start: string | null; end: string | null }>({
    start: null,
    end: null,
  });
  const [stackedLoading, setStackedLoading] = useState(false);
  const [stackedError, setStackedError] = useState<string | null>(null);

  useEffect(() => {
    fetchDatasets();
  }, []);

  useEffect(() => {
    if (selectedDataset) {
      setDateRange({ start: null, end: null });
      setStacked(null);
      setStackedError(null);
      fetchModels(selectedDataset);
      fetchDatasetMeta(selectedDataset);
    }
  }, [selectedDataset]);

  useEffect(() => {
    if (selectedModel) {
      fetchSummary(selectedModel);
    } else {
      setSummary(null);
    }
  }, [selectedModel, includeBaseline, asPercent, dateRange.start, dateRange.end]);

  useEffect(() => {
    if (timeColumnDefault) {
      setTimeCol(timeColumnDefault);
    } else {
      setTimeCol(TIME_COLUMN_PLACEHOLDER);
    }
  }, [timeColumnDefault]);

  const fetchDatasets = async () => {
    try {
      const res = await fetch(`${API_URL}/datasets`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setDatasets(data);
      if (!selectedDataset && data.length) setSelectedDataset(data[0].id);
    } catch {
      toast.error("Failed to load datasets");
    }
  };

  const fetchDatasetMeta = async (datasetId: string) => {
    setTimeColumnDefault(null);
    setTimeCol(TIME_COLUMN_PLACEHOLDER);
    try {
      const res = await fetch(`${API_URL}/datasets/${datasetId}/meta`);
      if (!res.ok) throw new Error();
      const data: DatasetMeta = await res.json();
      setTimeColumnDefault(data.time_column);
    } catch {
      setTimeColumnDefault(null);
    }
  };

  const fetchModels = async (datasetId: string) => {
    try {
      const res = await fetch(`${API_URL}/datasets/${datasetId}/models-with-roles`);
      if (!res.ok) throw new Error();
      const data = await res.json();
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
      const prioritized = normalized.filter(
        (m) => m.role && MODEL_ROLES.includes(m.role as ModelRole)
      );
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
  };

  const fetchSummary = async (modelId: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        include_intercept: String(includeBaseline),
        as_percent: String(asPercent),
      });
      if (dateRange.start) params.set("start_date", dateRange.start);
      if (dateRange.end) params.set("end_date", dateRange.end);
      const res = await fetch(`${API_URL}/analysis/${modelId}/summary?${params.toString()}`);
      if (!res.ok) throw new Error(await res.text());
      setSummary(await res.json());
    } catch (err: any) {
      toast.error(err?.message || "Failed to load summary");
      setSummary(null);
    } finally {
      setLoading(false);
    }
  };

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
      const url = `${API_URL}/analysis/${selectedModel}/stacked?${params.toString()}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(await res.text());
      setStacked(await res.json());
    } catch (err: any) {
      setStacked(null);
      setStackedError(err?.message || "Failed to load stacked data");
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

  useEffect(() => {
    if (!selectedModel || !timeCol || timeCol === TIME_COLUMN_PLACEHOLDER) {
      return;
    }
    fetchStacked();
  }, [fetchStacked, selectedModel, timeCol]);

  const downloadSummary = async () => {
    if (!selectedModel) return;
    const params = new URLSearchParams({
      include_intercept: String(includeBaseline),
      as_percent: String(asPercent),
    });
    if (dateRange.start) params.set("start_date", dateRange.start);
    if (dateRange.end) params.set("end_date", dateRange.end);
    const url = `${API_URL}/analysis/${selectedModel}/export/summary.xlsx?${params.toString()}`;
    const res = await fetch(url);
    const blob = await res.blob();
    downloadBlob(blob, "analysis-summary.xlsx");
  };

  const downloadStacked = async () => {
    if (!selectedModel || !timeCol || timeCol === TIME_COLUMN_PLACEHOLDER) return;
    const params = new URLSearchParams({
      time_col,
      freq,
      by: groupBy,
      include_intercept: String(includeBaseline),
      as_percent: String(asPercent),
    });
    if (dateRange.start) params.set("start_date", dateRange.start);
    if (dateRange.end) params.set("end_date", dateRange.end);
    const url = `${API_URL}/analysis/${selectedModel}/export/stacked.xlsx?${params.toString()}`;
    const res = await fetch(url);
    const blob = await res.blob();
    downloadBlob(blob, "stacked.xlsx");
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

  const percentOfTotal = (value: number | null | undefined) => {

    if (!summary || summary.total_contribution === 0 || value === null || value === undefined) {

      return DASH;

    }

    return `${percentFormatter.format((value / summary.total_contribution) * 100)}%`;

  };

  const readyForStacked = Boolean(selectedModel && timeCol && timeCol !== TIME_COLUMN_PLACEHOLDER);

  const formatStackedValue = (value: number | string | null | undefined) => {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return asPercent ? "0.00%" : "0.00";
    }
    const formatted = num.toFixed(2);
    return asPercent ? `${formatted}%` : formatted;
  };



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



  const stackOffset = "sign";



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

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-[var(--color-muted)]">Module 4</p>
          <h1 className="text-2xl font-semibold">Analysis & Attribution</h1>
        </div>
        <div className="flex gap-3 items-center">
          <div>
            <label className="text-xs uppercase text-[var(--color-muted)]">Dataset</label>
            <select
              className="ml-2 rounded-full border border-[var(--color-border)] px-4 py-2 bg-transparent"
              value={selectedDataset}
              onChange={(e) => setSelectedDataset(e.target.value)}
            >
              {datasets.map((ds) => (
                <option key={ds.id} value={ds.id}>
                  {ds.display_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs uppercase text-[var(--color-muted)]">Model</label>
            <select
              className="ml-2 rounded-full border border-[var(--color-border)] px-4 py-2 bg-transparent"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col">
            <label className="text-xs uppercase text-[var(--color-muted)]">Date range</label>
            <div className="ml-2 flex items-center gap-2 text-sm">
              <input
                type="date"
                className="rounded-full border border-[var(--color-border)] px-3 py-1.5 bg-transparent text-[var(--color-foreground)]"
                value={dateRange.start ?? ""}
                onChange={(e) =>
                  setDateRange((prev) => ({ ...prev, start: e.target.value || null }))
                }
              />
              <span className="text-xs text-[var(--color-muted)]">to</span>
              <input
                type="date"
                className="rounded-full border border-[var(--color-border)] px-3 py-1.5 bg-transparent text-[var(--color-foreground)]"
                value={dateRange.end ?? ""}
                onChange={(e) =>
                  setDateRange((prev) => ({ ...prev, end: e.target.value || null }))
                }
              />
            </div>
          </div>
          <Button onClick={downloadSummary}>Download Summary</Button>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

      <Card className="space-y-4">
        <CardHeader title="Summary Table" subtitle="Variable contributions and group mapping" />
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={includeBaseline} onChange={(e) => setIncludeBaseline(e.target.checked)} />
            Include baseline
          </label>
          <select
            className="rounded-full border border-[var(--color-border)] px-3 py-1.5 bg-transparent"
            value={tableView}
            onChange={(e) => setTableView(e.target.value as any)}
          >
            <option value="group">Group</option>
            <option value="group_subgroup">Group / Subgroup</option>
            <option value="variable">Group / Subgroup / Variable</option>
          </select>
        </div>
        {summary ? (
          <div className="overflow-auto max-h-[420px]">
            <table className="min-w-full text-sm">
              <thead className="bg-[var(--color-bg)]/60">
                <tr>
                  <th className="px-2 py-2 text-left">Group</th>
                  {tableView !== "group" && <th className="px-2 py-2 text-left">Subgroup</th>}
                  {tableView === "variable" && <th className="px-2 py-2 text-left">Variable</th>}
                  <th className="px-2 py-2 text-left">Contribution</th>
                  <th className="px-2 py-2 text-left">% of total</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row: any, idx: number) => (
                  <tr key={`${row.group_id || row.subgroup_id || row.name}-${idx}`} className="odd:bg-transparent even:bg-[var(--color-border)]/20">
                    <td className="px-2 py-2">{row.group_name || DASH}</td>
                    {tableView !== "group" && <td className="px-2 py-2">{row.subgroup_name || DASH}</td>}
                    {tableView === "variable" && <td className="px-2 py-2">{row.name}</td>}
                    <td className="px-2 py-2">{formatNumber(row.contribution)}</td>
                    <td className="px-2 py-2">{row.percent != null ? `${percentFormatter.format(row.percent)}%` : percentOfTotal(row.contribution)}</td>
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
        <CardHeader title="Stacked contributions over time" subtitle="Stride through periods and groups" />
        <div className="flex flex-wrap gap-3 text-sm">
          <select
            className="rounded-full border border-[var(--color-border)] px-3 py-1.5 bg-transparent"
            value={timeCol}
            onChange={(e) => setTimeCol(e.target.value)}
          >
            <option value={TIME_COLUMN_PLACEHOLDER}>Time column</option>
            {timeColumns.map((col) => (
              <option key={col} value={col}>
                {col}
              </option>
            ))}
          </select>
          <select
            className="rounded-full border border-[var(--color-border)] px-3 py-1.5 bg-transparent"
            value={freq}
            onChange={(e) => setFreq(e.target.value as any)}
          >
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
          <select
            className="rounded-full border border-[var(--color-border)] px-3 py-1.5 bg-transparent"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as any)}
          >
            <option value="group">Group</option>
            <option value="subgroup">Subgroup</option>
          </select>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={asPercent} onChange={(e) => setAsPercent(e.target.checked)} />
            Percent mode
          </label>
          <Button
            variant="secondary"
            onClick={fetchStacked}
            disabled={!readyForStacked || stackedLoading}
          >
            {stackedLoading ? "Loading..." : "Generate"}
          </Button>
          <Button variant="ghost" onClick={downloadStacked} disabled={!stacked || stackedLoading}>
            Export Excel
          </Button>
        </div>
        {stackedLoading && (
          <p className="text-xs text-[var(--color-muted)]">Loading contributions…</p>
        )}
        {stackedError && !stackedLoading && (
          <p className="text-xs text-red-500">Couldn’t load stacked contributions. Please try again.</p>
        )}
        {!stackedLoading && !stackedError && stacked && groupedSeries.length > 0 ? (
          <div className="h-96">
            <ResponsiveContainer>
              <BarChart data={groupedSeries} stackOffset={stackOffset}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="period" />
                <YAxis tickFormatter={(value) => formatStackedValue(value)} />
                <Tooltip formatter={(value) => formatStackedValue(value)} />
                <Legend />
                {sortedSeries.map((series) => (
                  <Bar
                    key={series.key}
                    dataKey={series.key}
                    stackId="a"
                    fill={colorFor(series.key)}
                    stroke={colorFor(series.key)}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          !stackedLoading &&
          !stackedError && (
            <p className="text-sm text-[var(--color-muted)]">
              {readyForStacked
                ? "No data for the selected filters."
                : "Select a dataset, model, and time column to view stacked contributions."}
            </p>
          )
        )}
      </Card>
    </section>
  );
}

function colorFor(key: string) {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash);
  }
  const color = Math.floor((Math.abs(hash) % 16777215));
  return `#${color.toString(16).padStart(6, "0")}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}


