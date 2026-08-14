"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Area,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";

import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ErrorText } from "@/components/ui/error-text";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Info } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip as InfoPopover } from "@/components/ui/tooltip";
import { StatCard } from "@/components/ui/stat-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, Th, TableCell } from "@/components/ui/table";
import { Modal } from "@/components/ui/modal";
import ScenarioSheetGlide, { type MultipliersMap } from "@/components/predict/ScenarioSheetGlide";
import ScenarioSheetTable from "@/components/predict/ScenarioSheetTable";
import PlannerView, { type ChannelAllocation } from "@/components/predict/PlannerView";
import { apiFetch } from "@/lib/api";
import { translateApiError } from "@/lib/error-messages";
import { useCanEdit } from "@/hooks/useCanEdit";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { chartColor, useStableCategoricalColor } from "@/lib/chart-colors";
import { formatChartNumber, formatChartPercent, formatCurrency } from "@/lib/chart-format";
import { EMPTY_VALUE } from "@/lib/format";
import { downloadBlob } from "@/lib/download";
import { useGlobalStore } from "@/lib/store";
import { useActiveCurrency } from "@/hooks/useActiveCompany";

type Dataset = { id: string; display_name: string; columns: { name: string; dtype: string }[] };
type Model = {
  id: string;
  name: string;
  dataset_id: string;
  role?: string;
  is_hero: boolean;
  y_var?: string;
};

type VariableRow = {
  name: string;
  baseline_mean: number;
  group_name?: string | null;
  subgroup_name?: string | null;
};

type PeriodValue = {
  mode: "multiplier" | "value";
  value: number;
};

type ContributionSlice = { id?: string | null; name?: string | null; value: number };
type ScenarioSeriesPoint = { period: string; y_pred: number };

type ScenarioChannelEconomics = {
  channel_id: string;
  name: string;
  proxy_variable: string;
  investment: number;
  contribution: number;
  revenue: number | null;
  roi: number | null;
  roas: number | null;
};

type ScenarioEconomics = {
  channels: ScenarioChannelEconomics[];
  total_investment: number;
  total_revenue: number | null;
  roi_total: number | null;
  roas_total: number | null;
  economics_configured: boolean;
};

type ScenarioSummary = {
  periods: string[];
  total: number;
  average_per_period: number;
  groups: ContributionSlice[];
  subgroups: ContributionSlice[];
  series: ScenarioSeriesPoint[];
  economics?: ScenarioEconomics | null;
};

type Scenario = {
  id: string;
  model_id: string;
  dataset_id?: string | null;
  name: string;
  horizon: number;
  start_date: string;
  freq: "day" | "week" | "month";
  adjustments: Record<string, Record<string, PeriodValue>>;
  summary: ScenarioSummary;
  last_edited_at: string;
  base_total?: number | null;
  delta_pct_vs_base?: number | null;
};

const DEFAULT_MULTIPLIER = 1;
const SCENARIO_LIMIT = 5;
const DESKTOP_QUERY = "(min-width: 1024px)";

function SecondaryLink({ href, children }: { href: string; children: React.ReactNode }) {
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

function deltaBadgeVariant(delta: number | null): "success" | "danger" | "neutral" | null {
  if (delta === null || Number.isNaN(delta)) return null;
  if (delta > 0) return "success";
  if (delta < 0) return "danger";
  return "neutral";
}

function formatSignedPercent(delta: number, formatter: Intl.NumberFormat) {
  const sign = delta > 0 ? "+" : "";
  return `${sign}${formatter.format(delta)}`;
}

export default function PredictPage() {
  const t = useTranslations("predict");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const canEdit = useCanEdit();
  const { activeCompanyId } = useGlobalStore();
  const currency = useActiveCurrency();
  const { resolvedTheme } = useTheme();
  const isDarkTheme = resolvedTheme === "dark";
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const mutedColor = isDarkTheme ? "#81858e" : "#6d7178";
  const lineColor = isDarkTheme ? "#262a2f" : "#e5e6ea";

  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDataset, setSelectedDataset] = useState("");
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState("");

  const [variables, setVariables] = useState<VariableRow[]>([]);
  const [adjustments, setAdjustments] = useState<Record<string, Record<string, PeriodValue>>>({});

  const [horizon, setHorizon] = useState(12);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [freq, setFreq] = useState<"day" | "week" | "month">("month");

  const [preview, setPreview] = useState<ScenarioSummary | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [scenarioName, setScenarioName] = useState("Scenario 1");
  const [currentScenarioId, setCurrentScenarioId] = useState<string | null>(null);
  const [renamingScenarioId, setRenamingScenarioId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [heroSeries, setHeroSeries] = useState<ScenarioSeriesPoint[]>([]);
  const [heroLoading, setHeroLoading] = useState(false);
  const [showProjectedTable, setShowProjectedTable] = useState(false);
  const [viewMode, setViewMode] = useState<"advanced" | "planner">("planner");
  const [assumptionsExporting, setAssumptionsExporting] = useState(false);
  const [totalsExporting, setTotalsExporting] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [variablesError, setVariablesError] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Scenario | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const colorFor = useStableCategoricalColor(selectedModel);

  const percentFormatter = useMemo(
    () => new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    []
  );
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }), []);
  const formatScenarioDate = useCallback(
    (value: string | null | undefined) => {
      if (!value) return EMPTY_VALUE;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return EMPTY_VALUE;
      return dateFormatter.format(date);
    },
    [dateFormatter]
  );

  const periodLabels = useMemo(() => buildPeriodLabels(startDate, horizon, freq), [startDate, horizon, freq]);
  const displayPeriods = preview?.periods?.length ? preview.periods : periodLabels;
  const editablePeriods = displayPeriods.length ? displayPeriods : periodLabels;
  const gridVariables = useMemo(
    () =>
      variables.map((variable) => ({
        name: variable.name,
        baselineMean: variable.baseline_mean,
        group: variable.group_name ?? "Other",
      })),
    [variables]
  );
  const multipliersByVariable = useMemo(
    () => buildMultipliersFromAdjustments(variables, editablePeriods, adjustments),
    [variables, editablePeriods, adjustments]
  );
  const absoluteValuesByVariable = useMemo(
    () => buildAbsoluteValuesFromAdjustments(variables, editablePeriods, adjustments),
    [variables, editablePeriods, adjustments]
  );
  const selectedModelInfo = useMemo(
    () => models.find((model) => model.id === selectedModel),
    [models, selectedModel]
  );
  const dependentLabel = selectedModelInfo?.y_var ?? "Y";
  const freqLabel = t(`freq.${freq}`);
  const editMode: "absolute" = "absolute";
  const reachedScenarioLimit = !currentScenarioId && scenarios.length >= SCENARIO_LIMIT;
  const saveButtonLabel = currentScenarioId ? t("params.saveChanges") : t("params.save");

  const fetchDatasets = useCallback(async () => {
    try {
      const data = await apiFetch<Dataset[]>("/datasets");
      setDatasets(data);
      if (data.length) {
        setSelectedDataset((prev) => (prev ? prev : data[0].id));
      }
    } catch {
      toast.error("Failed to load datasets");
    } finally {
      setInitializing(false);
    }
  }, []);

  const fetchModels = useCallback(async (datasetId: string) => {
    setModelsLoading(true);
    try {
      const data = await apiFetch<any[]>(`/models?dataset_id=${datasetId}`);
      const normalized: Model[] = data.map((m: any) => ({
        id: m.id,
        name: m.name,
        dataset_id: m.dataset_id,
        role: m.role,
        is_hero: Boolean(m.is_hero),
        y_var: m.y_var,
      }));
      setModels(normalized);
      const hero = normalized.find((m) => m.role === "hero" || m.is_hero) || normalized[0];
      if (hero) setSelectedModel(hero.id);
    } catch {
      toast.error("Failed to load models");
    } finally {
      setModelsLoading(false);
    }
  }, []);

  const requestScenarioSummary = useCallback(
    async (customAdjustments: Record<string, Record<string, PeriodValue>>) => {
      if (!selectedModel) {
        throw new Error("Select a model first");
      }
      const payload = {
        model_id: selectedModel,
        horizon,
        start_date: startDate,
        freq,
        adjustments: customAdjustments,
      };
      const data = await apiFetch<ScenarioSummary>("/predict/scenarios/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return data;
    },
    [selectedModel, horizon, startDate, freq]
  );

  const fetchPreview = useCallback(async () => {
    if (!selectedModel) return;
    setPreviewLoading(true);
    try {
      const data = await requestScenarioSummary(adjustments);
      setPreview(data);
    } catch (error: any) {
      toast.error(error?.message || "Preview failed");
    } finally {
      setPreviewLoading(false);
    }
  }, [selectedModel, adjustments, requestScenarioSummary]);

  const fetchBaselineVariables = useCallback(
    async (modelId: string) => {
      setVariablesError(false);
      try {
        const data = await apiFetch<any>(`/predict/${modelId}/simulate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ adjustments: [] }),
        });
        setVariables(data.variables || []);
        fetchPreview();
      } catch {
        setVariables([]);
        setVariablesError(true);
        toast.error("Failed to load baseline variables");
      }
    },
    [fetchPreview]
  );

  const fetchScenarios = useCallback(async (modelId: string) => {
    try {
      const data = await apiFetch<Scenario[]>(`/predict/scenarios?model_id=${modelId}`);
      setScenarios(data);
    } catch {
      toast.error("Failed to load scenarios");
    }
  }, []);

  useEffect(() => {
    // activeCompanyId hydrates asynchronously (AuthBootstrap fetches /me/memberships and
    // auto-selects the first company) — fetching before it's set sends no X-Company-Id
    // header and the backend 422s. Wait for it, then re-fetch once it's ready.
    if (!activeCompanyId) return;
    fetchDatasets();
  }, [fetchDatasets, activeCompanyId]);

  useEffect(() => {
    if (selectedDataset) {
      fetchModels(selectedDataset);
    }
  }, [selectedDataset, fetchModels]);

  useEffect(() => {
    setCurrentScenarioId(null);
    setRenamingScenarioId(null);
    setRenameValue("");
    setScenarioName("Scenario 1");
  }, [selectedModel]);

  useEffect(() => {
    if (!selectedModel) return;
    fetchBaselineVariables(selectedModel);
    fetchScenarios(selectedModel);
  }, [selectedModel, fetchBaselineVariables, fetchScenarios]);

  useEffect(() => {
    if (currentScenarioId && !scenarios.some((scenario) => scenario.id === currentScenarioId)) {
      setCurrentScenarioId(null);
    }
  }, [scenarios, currentScenarioId]);

  useEffect(() => {
    ensureAdjustmentDefaults(periodLabels, variables, setAdjustments);
  }, [periodLabels, variables]);

  useEffect(() => {
    if (!selectedModel || !variables.length || !editablePeriods.length) {
      setHeroSeries([]);
      return;
    }
    const baselineAdjustments = buildBaselineAdjustments(editablePeriods, variables);
    setHeroLoading(true);
    requestScenarioSummary(baselineAdjustments)
      .then((data) => setHeroSeries(data.series || []))
      .catch(() => setHeroSeries([]))
      .finally(() => setHeroLoading(false));
  }, [selectedModel, editablePeriods, variables, requestScenarioSummary]);

  const handleGridMultipliersChange = useCallback(
    (nextMultipliers: MultipliersMap, absoluteOverrides?: Record<string, Record<string, number>>) => {
      setAdjustments(
        multipliersToAdjustments(nextMultipliers, editablePeriods, variables, absoluteOverrides)
      );
    },
    [editablePeriods, variables]
  );
  const handleApplyAllocations = useCallback(
    (allocations: ChannelAllocation[]) => {
      const periodCount = editablePeriods.length;
      setAdjustments((prev) => {
        const next = cloneAdjustments(prev);
        editablePeriods.forEach((period) => {
          if (!next[period]) next[period] = {};
          allocations.forEach((allocation) => {
            // suggested_spend is the optimizer's steady-state total across the whole horizon, in
            // dollars. The scenario applies the same absolute value to every period, so divide by
            // the period count first (else the horizon total ends up periodCount× the requested
            // budget) and by dollar_rate second (the scenario's raw model-variable value is in the
            // variable's native units — impressions, GRPs, ... — not dollars).
            const perPeriodSpend = allocation.suggested_spend / periodCount;
            const units = perPeriodSpend / allocation.dollar_rate;
            next[period][allocation.proxy_variable] = { mode: "value", value: units };
          });
        });
        return next;
      });
      setCurrentScenarioId(null);
    },
    [editablePeriods]
  );
  const performResetAll = useCallback(() => {
    setAdjustments(() => {
      const next: Record<string, Record<string, PeriodValue>> = {};
      editablePeriods.forEach((period) => {
        const mapping: Record<string, PeriodValue> = {};
        variables.forEach((variable) => {
          mapping[variable.name] = { mode: "multiplier", value: 1 };
        });
        next[period] = mapping;
      });
      return next;
    });
    setCurrentScenarioId(null);
    setRenamingScenarioId(null);
    setRenameValue("");
    setResetConfirmOpen(false);
  }, [editablePeriods, variables]);

  const handleSaveScenario = async () => {
    if (!selectedModel) {
      toast.error("Select a model first");
      return;
    }
    if (!currentScenarioId && scenarios.length >= SCENARIO_LIMIT) {
      toast.error(t("params.limitReached", { limit: SCENARIO_LIMIT }));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        model_id: selectedModel,
        name: scenarioName || "Scenario",
        horizon,
        start_date: startDate,
        freq,
        adjustments,
      };
      const path = currentScenarioId
        ? `/predict/scenarios/${currentScenarioId}`
        : `/predict/scenarios`;
      const method = currentScenarioId ? "PATCH" : "POST";
      const data = await apiFetch<Scenario>(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setScenarioName(data.name);
      setHorizon(data.horizon);
      setStartDate(data.start_date);
      setFreq(data.freq);
      setAdjustments(cloneAdjustments(data.adjustments));
      setPreview(data.summary);
      setCurrentScenarioId(data.id);
      setRenamingScenarioId(null);
      setRenameValue("");
      toast.success(currentScenarioId ? "Scenario updated" : "Scenario saved");
      await fetchScenarios(selectedModel);
    } catch (error: any) {
      toast.error(error?.message || "Unable to save scenario");
    } finally {
      setSaving(false);
    }
  };

  const handleLoadScenario = (scenario: Scenario) => {
    setScenarioName(scenario.name);
    setHorizon(scenario.horizon);
    setStartDate(scenario.start_date);
    setFreq(scenario.freq);
    setAdjustments(cloneAdjustments(scenario.adjustments));
    setCurrentScenarioId(scenario.id);
    setRenamingScenarioId(null);
    setRenameValue("");
    setPreview(scenario.summary);
  };

  const confirmDeleteScenario = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await apiFetch<void>(`/predict/scenarios/${deleteTarget.id}`, { method: "DELETE" });
      toast.success("Scenario deleted");
      if (currentScenarioId === deleteTarget.id) {
        setCurrentScenarioId(null);
      }
      if (renamingScenarioId === deleteTarget.id) {
        setRenamingScenarioId(null);
        setRenameValue("");
      }
      if (selectedModel) await fetchScenarios(selectedModel);
      setDeleteTarget(null);
    } catch (error: any) {
      toast.error(error?.message || "Unable to delete scenario");
    } finally {
      setDeleteLoading(false);
    }
  };

  const cancelRename = useCallback(() => {
    setRenamingScenarioId(null);
    setRenameValue("");
  }, []);

  const handleStartRename = (scenario: Scenario) => {
    setRenamingScenarioId(scenario.id);
    setRenameValue(scenario.name);
  };

  const submitRename = useCallback(
    async (scenarioId: string, newName: string) => {
      if (!selectedModel) return;
      const trimmed = newName.trim();
      if (!trimmed) {
        cancelRename();
        return;
      }
      try {
        await apiFetch<Scenario>(`/predict/scenarios/${scenarioId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed }),
        });
        toast.success("Scenario renamed");
        if (currentScenarioId === scenarioId) {
          setScenarioName(trimmed);
        }
        await fetchScenarios(selectedModel);
      } catch (error: any) {
        toast.error(error?.message || "Unable to rename scenario");
      } finally {
        cancelRename();
      }
    },
    [selectedModel, currentScenarioId, fetchScenarios, cancelRename]
  );

  const handleRenameBlur = (scenario: Scenario) => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === scenario.name) {
      cancelRename();
      return;
    }
    submitRename(scenario.id, trimmed);
  };

  const handleRenameKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, scenario: Scenario) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleRenameBlur(scenario);
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelRename();
    }
  };

  const scenarioSeries = useMemo(() => preview?.series ?? [], [preview]);
  const groups = useMemo(() => preview?.groups ?? [], [preview]);
  const projectedTotal = preview?.total ?? null;
  const baselineEntry = groups.find(
    (group) => group.id === "baseline" || group.name?.toLowerCase() === "baseline"
  );
  const otherEntry = groups.find(
    (group) => !group.id && (!group.name || group.name.toLowerCase() === "other")
  );
  const baselineContribution = baselineEntry?.value ?? null;
  const otherContribution = otherEntry?.value ?? null;
  const dynamicGroupSlices = useMemo(
    () =>
      groups
        .filter((group) => {
          const normalized = group.name?.toLowerCase() ?? "";
          if (group.id === "baseline" || normalized === "baseline") return false;
          if (!group.id && (!group.name || normalized === "other")) return false;
          return true;
        })
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
    [groups]
  );
  const shareOfTotal = useCallback(
    (value: number | null | undefined) => {
      if (!projectedTotal || projectedTotal === 0 || value === null || value === undefined) return null;
      return (value / projectedTotal) * 100;
    },
    [projectedTotal]
  );

  const heroTotal = useMemo(
    () => heroSeries.reduce((sum, point) => sum + (Number.isFinite(point.y_pred) ? point.y_pred : 0), 0),
    [heroSeries]
  );
  const liveDeltaPct = useMemo(() => {
    if (!heroSeries.length || projectedTotal === null || !heroTotal) return null;
    return ((projectedTotal - heroTotal) / heroTotal) * 100;
  }, [heroSeries.length, projectedTotal, heroTotal]);
  const liveDeltaVariant = deltaBadgeVariant(liveDeltaPct);

  type KpiItem = {
    key: string;
    label: string;
    value: string;
    icon?: React.ReactNode;
    trend?: React.ReactNode;
  };

  const kpiItems = useMemo<KpiItem[]>(() => {
    const items: KpiItem[] = [
      {
        key: "projected-total",
        label: t("kpis.projectedTotal"),
        value: preview?.total != null ? formatChartNumber(preview.total, 1) : EMPTY_VALUE,
        icon: (
          <InfoTooltip
            label={t("kpis.projectedTotal")}
            content={t("kpis.projectedTotalTooltip", { yVar: dependentLabel })}
          />
        ),
        trend: liveDeltaVariant ? (
          <Badge variant={liveDeltaVariant}>
            {formatSignedPercent(liveDeltaPct as number, percentFormatter)}%
          </Badge>
        ) : undefined,
      },
      {
        key: "average-period",
        label: t("kpis.averagePerPeriod"),
        value: preview?.average_per_period != null ? formatChartNumber(preview.average_per_period, 1) : EMPTY_VALUE,
        trend: <span className="text-xs text-muted">{freqLabel}</span>,
      },
    ];
    if (baselineEntry) {
      items.push({
        key: "baseline",
        label: t("kpis.baseline"),
        value: baselineContribution != null ? formatChartNumber(baselineContribution, 1) : EMPTY_VALUE,
        icon: <InfoTooltip label={t("kpis.baseline")} content={t("kpis.baselineTooltip", { yVar: dependentLabel })} />,
        trend: (() => {
          const share = shareOfTotal(baselineContribution);
          return share !== null ? <Badge variant="neutral">{formatChartPercent(share, 1)}</Badge> : undefined;
        })(),
      });
    }
    dynamicGroupSlices.forEach((slice, index) => {
      const name = slice.name || "Group";
      const share = shareOfTotal(slice.value);
      items.push({
        key: `group-${slice.id ?? name ?? index}`,
        label: name,
        value: formatChartNumber(slice.value, 1),
        icon: (
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: colorFor(name, isDarkTheme) }}
            aria-hidden
          />
        ),
        trend: share !== null ? <Badge variant="neutral">{formatChartPercent(share, 1)}</Badge> : undefined,
      });
    });
    if (otherEntry && otherContribution !== undefined && otherContribution !== null && Math.abs(otherContribution) > 1e-9) {
      const share = shareOfTotal(otherContribution);
      items.push({
        key: "other",
        label: otherEntry.name || t("kpis.other"),
        value: formatChartNumber(otherContribution, 1),
        trend: share !== null ? <Badge variant="neutral">{formatChartPercent(share, 1)}</Badge> : undefined,
      });
    }
    return items;
  }, [
    t,
    preview,
    dependentLabel,
    freqLabel,
    baselineEntry,
    baselineContribution,
    dynamicGroupSlices,
    otherEntry,
    otherContribution,
    shareOfTotal,
    colorFor,
    isDarkTheme,
    liveDeltaVariant,
    liveDeltaPct,
    percentFormatter,
  ]);

  const economics = preview?.economics ?? null;
  const roiLabel = (value: number | null | undefined) =>
    value === null || value === undefined || !Number.isFinite(value) ? EMPTY_VALUE : `${(value * 100).toFixed(1)}%`;
  const roasLabel = (value: number | null | undefined) =>
    value === null || value === undefined || !Number.isFinite(value) ? EMPTY_VALUE : `${value.toFixed(2)}x`;

  const economicsKpiItems = useMemo<KpiItem[]>(() => {
    if (!economics) return [];
    return [
      {
        key: "investment",
        label: t("kpis.investment"),
        value: formatCurrency(economics.total_investment, currency, 1),
        icon: <InfoTooltip label={t("kpis.investment")} content={t("kpis.investmentTooltip")} />,
      },
      {
        key: "revenue",
        label: t("kpis.revenue"),
        value: economics.total_revenue !== null ? formatCurrency(economics.total_revenue, currency, 1) : EMPTY_VALUE,
        icon: <InfoTooltip label={t("kpis.revenue")} content={t("kpis.revenueTooltip")} />,
      },
      {
        key: "roi",
        label: t("kpis.roi"),
        value: roiLabel(economics.roi_total),
        icon: <InfoTooltip label={t("kpis.roi")} content={t("kpis.roiTooltip")} />,
      },
      {
        key: "roas",
        label: t("kpis.roas"),
        value: roasLabel(economics.roas_total),
        icon: <InfoTooltip label={t("kpis.roas")} content={t("kpis.roasTooltip")} />,
      },
    ];
  }, [economics, t, currency]);

  const chartData = useMemo(() => {
    const map = new Map<string, { hero?: number | null; scenario?: number | null }>();
    scenarioSeries.forEach((point) => {
      const entry = map.get(point.period) || {};
      entry.scenario = point.y_pred;
      map.set(point.period, entry);
    });
    heroSeries.forEach((point) => {
      const entry = map.get(point.period) || {};
      entry.hero = point.y_pred;
      map.set(point.period, entry);
    });
    const ordered = displayPeriods.length ? displayPeriods : Array.from(map.keys());
    return ordered.map((period) => {
      const entry = map.get(period) || {};
      const hero = entry.hero ?? null;
      const scenario = entry.scenario ?? null;
      const hasBand = hero !== null && scenario !== null;
      return {
        period,
        hero,
        scenario,
        deltaBase: hasBand ? Math.min(hero as number, scenario as number) : null,
        deltaHeight: hasBand ? Math.abs((scenario as number) - (hero as number)) : null,
      };
    });
  }, [scenarioSeries, heroSeries, displayPeriods]);
  const hasChartData = chartData.some((row) => row.hero !== null || row.scenario !== null);
  const renderTimeseriesTooltip = useCallback(
    ({ active, payload, label }: any) => {
      if (!active || !payload?.length) return null;
      const visible = payload.filter((item: any) => item.dataKey === "hero" || item.dataKey === "scenario");
      if (!visible.length) return null;
      return (
        <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-[var(--shadow-soft)]">
          <p className="font-semibold text-ink">{label}</p>
          {visible.map((item: any) => (
            <p key={item.dataKey} className="flex items-center justify-between gap-4 text-muted">
              <span>{item.name}</span>
              <span className="font-semibold tabular-nums text-ink">
                {formatChartNumber(typeof item.value === "number" ? item.value : Number(item.value), 1)}
              </span>
            </p>
          ))}
        </div>
      );
    },
    []
  );
  const handleExportAssumptions = useCallback(async () => {
    if (!selectedModel) {
      toast.error("Select a model first");
      return;
    }
    if (!variables.length || !editablePeriods.length) {
      toast.error("Nothing to export yet");
      return;
    }
    setAssumptionsExporting(true);
    try {
      const payload = {
        model_id: selectedModel,
        horizon,
        start_date: startDate,
        freq,
        adjustments,
        mode: editMode,
        scenario_name: scenarioName || dependentLabel,
      };
      const blob = await apiFetch<Blob>("/predict/scenarios/assumptions/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        responseType: "blob",
      });
      const filename = buildExportFilename(scenarioName || dependentLabel || "scenario", "assumptions");
      downloadBlob(blob, filename);
    } catch (error) {
      toast.error(translateApiError(error, tErrors) || "Failed to export assumptions");
    } finally {
      setAssumptionsExporting(false);
    }
  }, [
    selectedModel,
    variables.length,
    editablePeriods.length,
    horizon,
    startDate,
    freq,
    adjustments,
    editMode,
    scenarioName,
    dependentLabel,
    tErrors,
  ]);
  const handleExportTimeseries = useCallback(async () => {
    if (!selectedModel || !chartData.length) {
      toast.error("Preview the scenario before exporting");
      return;
    }
    setTotalsExporting(true);
    try {
      const payload = {
        model_id: selectedModel,
        horizon,
        start_date: startDate,
        freq,
        adjustments,
        scenario_name: scenarioName || dependentLabel,
        include_hero: true,
      };
      const blob = await apiFetch<Blob>("/predict/scenarios/projected/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        responseType: "blob",
      });
      const filename = buildExportFilename(scenarioName || dependentLabel || "scenario", "projected");
      downloadBlob(blob, filename);
    } catch (error) {
      toast.error(translateApiError(error, tErrors) || "Failed to export totals");
    } finally {
      setTotalsExporting(false);
    }
  }, [
    selectedModel,
    chartData.length,
    horizon,
    startDate,
    freq,
    adjustments,
    scenarioName,
    dependentLabel,
    tErrors,
  ]);

  const showEmptyDatasets = !initializing && datasets.length === 0;
  const showEmptyModels = !initializing && !modelsLoading && datasets.length > 0 && models.length === 0;
  const scenarioBandColor = chartColor(1, isDarkTheme);

  return (
    <section className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("eyebrow")} />

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
      ) : (
        <>
          <FilterBar>
            <FilterField label={t("filters.dataset")} className="w-[240px]">
              <Select value={selectedDataset} onChange={(e) => setSelectedDataset(e.target.value)}>
                {datasets.map((ds) => (
                  <option key={ds.id} value={ds.id}>
                    {ds.display_name}
                  </option>
                ))}
              </Select>
            </FilterField>
            <FilterField label={t("filters.model")} className="w-[240px]">
              <Select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} disabled={!models.length}>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </FilterField>
          </FilterBar>

          {showEmptyModels ? (
            <Card>
              <EmptyState
                title={t("noModels.title")}
                description={t("noModels.description")}
                action={<SecondaryLink href="/modeling">{t("noModels.cta")}</SecondaryLink>}
              />
            </Card>
          ) : (
            <>
              {economics && !economics.economics_configured && (
                <div className="rounded-xl bg-warn-bg px-4 py-3 text-sm text-warn no-print">
                  {t("economicsNotConfigured")}
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy={previewLoading}>
                {modelsLoading || (previewLoading && !preview) ? (
                  Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[104px]" />)
                ) : (
                  <>
                    {kpiItems.map((item) => (
                      <StatCard key={item.key} label={item.label} value={item.value} icon={item.icon} trend={item.trend} />
                    ))}
                    {economicsKpiItems.map((item) => (
                      <StatCard key={item.key} label={item.label} value={item.value} icon={item.icon} trend={item.trend} />
                    ))}
                  </>
                )}
              </div>

              <Card className="space-y-4">
                <CardHeader title={t("params.title")} subtitle={t("params.subtitle")} />
                <div className="flex flex-wrap gap-4">
                  <div className="w-28 space-y-2">
                    <Eyebrow htmlFor="predict-horizon">{t("params.horizon")}</Eyebrow>
                    <Input
                      id="predict-horizon"
                      type="number"
                      min={1}
                      value={horizon}
                      onChange={(e) => setHorizon(Math.max(1, Number(e.target.value) || 1))}
                    />
                  </div>
                  <div className="w-44 space-y-2">
                    <Eyebrow htmlFor="predict-start-date">{t("params.startDate")}</Eyebrow>
                    <Input
                      id="predict-start-date"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Eyebrow htmlFor="predict-freq">{t("params.frequency")}</Eyebrow>
                    <Select
                      id="predict-freq"
                      wrapperClassName="w-auto"
                      value={freq}
                      onChange={(e) => setFreq(e.target.value as any)}
                    >
                      <option value="day">{t("freq.day")}</option>
                      <option value="week">{t("freq.week")}</option>
                      <option value="month">{t("freq.month")}</option>
                    </Select>
                  </div>
                  <div className="min-w-[200px] flex-1 space-y-2">
                    <Eyebrow htmlFor="predict-scenario-name">{t("params.scenarioName")}</Eyebrow>
                    <Input
                      id="predict-scenario-name"
                      type="text"
                      placeholder={t("params.scenarioNamePlaceholder")}
                      value={scenarioName}
                      onChange={(e) => setScenarioName(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button onClick={fetchPreview} disabled={previewLoading || !selectedModel}>
                    {previewLoading ? t("params.previewing") : t("params.preview")}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={handleSaveScenario}
                    disabled={!canEdit || saving || !selectedModel || reachedScenarioLimit}
                    title={!canEdit ? tCommon("readOnlyTooltip") : undefined}
                  >
                    {saving ? t("params.saving") : saveButtonLabel}
                  </Button>
                </div>
                {reachedScenarioLimit && (
                  <ErrorText className="text-xs">{t("params.limitReached", { limit: SCENARIO_LIMIT })}</ErrorText>
                )}
              </Card>

              <Card className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardHeader title={t("builder.title")} subtitle={t("builder.subtitle")} />
                  <div className="inline-flex gap-1">
                    <ToggleChip active={viewMode === "planner"} onClick={() => setViewMode("planner")}>
                      {t("builder.modePlanner")}
                    </ToggleChip>
                    <ToggleChip active={viewMode === "advanced"} onClick={() => setViewMode("advanced")}>
                      {t("builder.modeAdvanced")}
                    </ToggleChip>
                  </div>
                </div>
                {viewMode === "advanced" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Eyebrow>{t("builder.modeAbsolute")}</Eyebrow>
                    <Button variant="ghost" size="sm" onClick={() => setResetConfirmOpen(true)}>
                      {t("builder.reset")}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleExportAssumptions}
                      disabled={assumptionsExporting || !variables.length}
                    >
                      {assumptionsExporting ? t("builder.exporting") : t("builder.export")}
                    </Button>
                  </div>
                )}
                {variablesError ? (
                  <EmptyState
                    title={t("variablesError.title")}
                    action={
                      <Button variant="secondary" onClick={() => fetchBaselineVariables(selectedModel)}>
                        {t("variablesError.retry")}
                      </Button>
                    }
                  />
                ) : !variables.length ? (
                  <p className="text-sm text-muted">{t("builder.empty")}</p>
                ) : viewMode === "planner" ? (
                  <PlannerView modelId={selectedModel} onApply={handleApplyAllocations} />
                ) : isDesktop ? (
                  <ScenarioSheetGlide
                    variables={gridVariables}
                    periods={editablePeriods}
                    multipliers={multipliersByVariable}
                    absoluteValues={absoluteValuesByVariable}
                    editMode={editMode}
                    onMultipliersChange={handleGridMultipliersChange}
                    groupColumnLabel={t("builder.colGroup")}
                    variableColumnLabel={t("builder.colVariable")}
                  />
                ) : (
                  <ScenarioSheetTable
                    variables={gridVariables}
                    periods={editablePeriods}
                    multipliers={multipliersByVariable}
                    absoluteValues={absoluteValuesByVariable}
                    onMultipliersChange={handleGridMultipliersChange}
                    groupColumnLabel={t("builder.colGroup")}
                    variableColumnLabel={t("builder.colVariable")}
                  />
                )}
              </Card>

              <Card className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardHeader as="h2" title={t("totals.title")} subtitle={t("totals.subtitle")} />
                  {liveDeltaVariant && (
                    <Badge variant={liveDeltaVariant}>
                      {t("totals.deltaLabel", { value: formatSignedPercent(liveDeltaPct as number, percentFormatter) })}
                    </Badge>
                  )}
                </div>
                {hasChartData ? (
                  <>
                    <div className="h-chart-lg w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke={lineColor} />
                          <XAxis dataKey="period" tick={{ fill: mutedColor, fontSize: 11 }} axisLine={{ stroke: lineColor }} />
                          <YAxis
                            tick={{ fill: mutedColor, fontSize: 11 }}
                            axisLine={{ stroke: lineColor }}
                            tickFormatter={(value) => formatChartNumber(Number(value), 1)}
                          />
                          <RechartsTooltip content={renderTimeseriesTooltip} />
                          <Legend wrapperStyle={{ fontSize: 12, color: mutedColor }} />
                          <Area
                            dataKey="deltaBase"
                            stackId="delta"
                            stroke="none"
                            fill="transparent"
                            legendType="none"
                            isAnimationActive={false}
                            connectNulls
                          />
                          <Area
                            dataKey="deltaHeight"
                            stackId="delta"
                            name={t("totals.seriesScenario")}
                            stroke="none"
                            fill={scenarioBandColor}
                            fillOpacity={0.15}
                            legendType="none"
                            isAnimationActive={false}
                            connectNulls
                          />
                          <Line
                            type="monotone"
                            dataKey="hero"
                            name={t("totals.seriesBase")}
                            stroke={chartColor(0, isDarkTheme)}
                            strokeWidth={2}
                            dot={false}
                            connectNulls
                          />
                          <Line
                            type="monotone"
                            dataKey="scenario"
                            name={t("totals.seriesScenario")}
                            stroke={chartColor(1, isDarkTheme)}
                            strokeWidth={2}
                            dot={false}
                            connectNulls
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="text-2xs text-muted">{t("totals.deltaCaption")}</p>
                    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                      <label className="inline-flex items-center gap-2 text-xs text-muted">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-accent"
                          checked={showProjectedTable}
                          onChange={(event) => setShowProjectedTable(event.target.checked)}
                        />
                        {t("totals.showTable")}
                      </label>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleExportTimeseries}
                        disabled={!chartData.length || totalsExporting}
                      >
                        {totalsExporting ? t("totals.exporting") : t("totals.export")}
                      </Button>
                    </div>
                    {showProjectedTable && (
                      <Table wrapperClassName="max-h-[420px] overflow-auto">
                        <TableHeader className="sticky top-0 z-10">
                          <TableRow>
                            <Th>{t("totals.colPeriod")}</Th>
                            <Th className="text-right">{t("totals.colBase")}</Th>
                            <Th className="text-right">{t("totals.colScenario")}</Th>
                          </TableRow>
                        </TableHeader>
                        <tbody>
                          {chartData.map((row) => (
                            <TableRow key={row.period} className="hover:bg-surface-2">
                              <TableCell>{row.period}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {row.hero !== null ? formatChartNumber(row.hero, 1) : EMPTY_VALUE}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {row.scenario !== null ? formatChartNumber(row.scenario, 1) : EMPTY_VALUE}
                              </TableCell>
                            </TableRow>
                          ))}
                        </tbody>
                      </Table>
                    )}
                  </>
                ) : (
                  <EmptyState title={previewLoading || heroLoading ? t("totals.loading") : t("totals.empty")} />
                )}
              </Card>

              <Card className="space-y-4">
                <CardHeader title={t("scenarios.title")} subtitle={t("scenarios.subtitle", { limit: SCENARIO_LIMIT })} />
                {scenarios.length ? (
                  <div className="grid gap-4 md:grid-cols-3">
                    {scenarios.map((scenario) => {
                      const isActive = currentScenarioId === scenario.id;
                      const isRenaming = renamingScenarioId === scenario.id;
                      const delta = typeof scenario.delta_pct_vs_base === "number" ? scenario.delta_pct_vs_base : null;
                      const variant = deltaBadgeVariant(delta);
                      return (
                        <Card
                          key={scenario.id}
                          padding="sm"
                          className={isActive ? "space-y-3 border border-accent bg-accent-bg" : "space-y-3 border border-line"}
                        >
                          <div className="space-y-2">
                            {isRenaming ? (
                              <Input
                                autoFocus
                                value={renameValue}
                                onChange={(event) => setRenameValue(event.target.value)}
                                onBlur={() => handleRenameBlur(scenario)}
                                onKeyDown={(event) => handleRenameKeyDown(event, scenario)}
                              />
                            ) : (
                              <div className="flex items-start justify-between gap-2">
                                <p className="truncate text-sm font-semibold text-ink">{scenario.name}</p>
                                <div className="flex items-center gap-2">
                                  {isActive && <Badge variant="accent">{t("scenarios.active")}</Badge>}
                                  <button
                                    type="button"
                                    className="text-xs text-muted hover:text-ink"
                                    onClick={() => handleStartRename(scenario)}
                                  >
                                    {t("scenarios.rename")}
                                  </button>
                                </div>
                              </div>
                            )}
                            <div className="space-y-0.5">
                              <Eyebrow>{t("scenarios.projectedTotal")}</Eyebrow>
                              <p className="text-3xl font-semibold tabular-nums leading-tight text-ink">
                                {formatChartNumber(scenario.summary.total, 1)}
                              </p>
                              {variant && (
                                <Badge variant={variant}>
                                  {t("totals.deltaLabel", { value: formatSignedPercent(delta as number, percentFormatter) })}
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted">
                              {t("scenarios.periods", { count: scenario.horizon, freq: t(`freq.${scenario.freq}`) })}
                            </p>
                            <p className="text-xs text-muted">
                              {t("scenarios.lastEdited", { date: formatScenarioDate(scenario.last_edited_at) })}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <Button variant="secondary" size="sm" onClick={() => handleLoadScenario(scenario)}>
                              {t("scenarios.load")}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeleteTarget(scenario)}
                              disabled={!canEdit}
                              title={!canEdit ? tCommon("readOnlyTooltip") : undefined}
                              className="!text-bad hover:!bg-bad-bg"
                            >
                              {t("scenarios.delete")}
                            </Button>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState title={t("scenarios.empty")} />
                )}
              </Card>
            </>
          )}
        </>
      )}

      <Modal open={resetConfirmOpen} onClose={() => setResetConfirmOpen(false)} title={t("builder.resetConfirmTitle")}>
        <p className="text-sm text-ink">{t("builder.resetConfirmBody")}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setResetConfirmOpen(false)}>
            {tCommon("cancel")}
          </Button>
          <Button variant="danger" onClick={performResetAll}>
            {t("builder.resetConfirmAction")}
          </Button>
        </div>
      </Modal>

      <Modal open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title={t("scenarios.deleteConfirmTitle")}>
        <p className="text-sm text-ink">{t("scenarios.deleteConfirmBody", { name: deleteTarget?.name || "" })}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleteLoading}>
            {tCommon("cancel")}
          </Button>
          <Button variant="danger" onClick={confirmDeleteScenario} disabled={deleteLoading}>
            {t("scenarios.deleteConfirmAction")}
          </Button>
        </div>
      </Modal>
    </section>
  );
}

function buildPeriodLabels(startDate: string, horizon: number, freq: "day" | "week" | "month") {
  const labels: string[] = [];
  if (!startDate || horizon <= 0) return labels;
  let current = new Date(`${startDate}T00:00:00`);
  for (let i = 0; i < horizon; i += 1) {
    labels.push(labelForDate(current, freq));
    current = incrementDate(current, freq);
  }
  return labels;
}

function incrementDate(value: Date, freq: "day" | "week" | "month") {
  const next = new Date(value);
  if (freq === "day") {
    next.setDate(next.getDate() + 1);
  } else if (freq === "week") {
    next.setDate(next.getDate() + 7);
  } else {
    const month = next.getMonth();
    next.setMonth(month + 1);
  }
  return next;
}

function labelForDate(value: Date, freq: "day" | "week" | "month") {
  if (freq === "day") {
    return value.toISOString().slice(0, 10);
  }
  if (freq === "week") {
    const temp = new Date(value);
    const firstDay = temp.getDate() - temp.getDay() + 1;
    temp.setDate(firstDay);
    const iso = temp.toISOString().slice(0, 10);
    const [year] = iso.split("-");
    const week = getWeekNumber(value);
    return `${year}-W${String(week).padStart(2, "0")}`;
  }
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}

function sanitizeMultiplierValue(value: number | undefined) {
  const num = Number(value);
  if (!Number.isFinite(num) || Number.isNaN(num)) return DEFAULT_MULTIPLIER;
  if (num < 0) return 0;
  if (num > 1_000_000) return 1_000_000;
  return Number(num);
}

function buildMultipliersFromAdjustments(
  variables: VariableRow[],
  periods: string[],
  adjustments: Record<string, Record<string, PeriodValue>>
): MultipliersMap {
  const result: MultipliersMap = {};
  const periodList = periods.length ? periods : [];
  variables.forEach((variable) => {
    const baseline = Number(variable.baseline_mean ?? 0);
    const periodValues: Record<string, number> = {};
    periodList.forEach((period) => {
      const entry = adjustments[period]?.[variable.name];
      const fallback = DEFAULT_MULTIPLIER;
      if (!entry) {
        periodValues[period] = fallback;
      } else if (entry.mode === "value") {
        const safeBaseline = baseline === 0 ? 1 : baseline;
        periodValues[period] = sanitizeMultiplierValue(entry.value / safeBaseline);
      } else {
        periodValues[period] = sanitizeMultiplierValue(entry.value);
      }
    });
    result[variable.name] = periodValues;
  });
  return result;
}

function multipliersToAdjustments(
  multipliers: MultipliersMap,
  periods: string[],
  variables: VariableRow[],
  absoluteOverrides?: Record<string, Record<string, number>>
): Record<string, Record<string, PeriodValue>> {
  const next: Record<string, Record<string, PeriodValue>> = {};
  const periodList = periods.length ? periods : [];
  periodList.forEach((period) => {
    const mapping: Record<string, PeriodValue> = {};
    variables.forEach((variable) => {
      const value = sanitizeMultiplierValue(multipliers[variable.name]?.[period]);
      const absoluteValue = absoluteOverrides?.[variable.name]?.[period];
      if (typeof absoluteValue === "number" && Number.isFinite(absoluteValue)) {
        mapping[variable.name] = { mode: "value", value: absoluteValue };
      } else {
        mapping[variable.name] = { mode: "multiplier", value };
      }
    });
    next[period] = mapping;
  });
  return next;
}

function buildAbsoluteValuesFromAdjustments(
  variables: VariableRow[],
  periods: string[],
  adjustments: Record<string, Record<string, PeriodValue>>
): Record<string, Record<string, number>> {
  // Only surface genuine "value" overrides here — this map feeds back into the grid as
  // `absoluteValues`, and ScenarioSheetGlide's applyAbsoluteChanges clones the FULL map on
  // every single-cell edit, then that whole clone gets converted into explicit per-cell
  // PeriodValue overrides. If untouched "multiplier" cells were included (even at their
  // computed baseline*1 display value), editing just one cell would freeze every other
  // period/variable to a flat absolute number, wiping out the backend's calendar-seasonal
  // defaults and flattening the projected series. Cells still on "multiplier" mode must stay
  // absent here so they remain implicit and keep following the seasonal baseline.
  const result: Record<string, Record<string, number>> = {};
  const periodList = periods.length ? periods : [];
  variables.forEach((variable) => {
    const mapping: Record<string, number> = {};
    periodList.forEach((period) => {
      const entry = adjustments[period]?.[variable.name];
      if (!entry || entry.mode !== "value") return;
      mapping[period] = roundAbsoluteValue(entry.value);
    });
    result[variable.name] = mapping;
  });
  return result;
}

function roundAbsoluteValue(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(2));
}

function buildExportFilename(base: string, suffix: string) {
  const safe = sanitizeFilenameFragment(base);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0];
  return `${safe}-${suffix}-${stamp}.xlsx`;
}

function sanitizeFilenameFragment(value: string) {
  const trimmed = value?.trim() || "scenario";
  const safe = trimmed.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return (safe || "scenario").toLowerCase();
}

function getWeekNumber(date: Date) {
  const target = new Date(date.valueOf());
  const dayNr = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
  }
  return 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
}

function ensureAdjustmentDefaults(
  periods: string[],
  variables: VariableRow[],
  setAdjustments: React.Dispatch<React.SetStateAction<Record<string, Record<string, PeriodValue>>>>
) {
  if (!periods.length || !variables.length) return;
  setAdjustments((prev) => {
    const next: Record<string, Record<string, PeriodValue>> = {};
    periods.forEach((period) => {
      const existing = prev[period] || {};
      const periodValues: Record<string, PeriodValue> = {};
      variables.forEach((variable) => {
        periodValues[variable.name] = existing[variable.name] || { mode: "multiplier", value: 1 };
      });
      next[period] = periodValues;
    });

    const same =
      Object.keys(prev).length === Object.keys(next).length &&
      Object.keys(next).every((period) => {
        const prevVars = prev[period] || {};
        const nextVars = next[period];
        return (
          Object.keys(prevVars).length === Object.keys(nextVars).length &&
          Object.keys(nextVars).every(
            (key) =>
              prevVars[key] &&
              prevVars[key].mode === nextVars[key].mode &&
              Number(prevVars[key].value) === Number(nextVars[key].value)
          )
        );
      });
    return same ? prev : next;
  });
}

function cloneAdjustments(source: Record<string, Record<string, PeriodValue>>) {
  const clone: Record<string, Record<string, PeriodValue>> = {};
  Object.entries(source || {}).forEach(([period, mapping]) => {
    clone[period] = {};
    Object.entries(mapping || {}).forEach(([variable, value]) => {
      clone[period][variable] = { ...value };
    });
  });
  return clone;
}

function buildBaselineAdjustments(periods: string[], variables: VariableRow[]) {
  const result: Record<string, Record<string, PeriodValue>> = {};
  periods.forEach((period) => {
    const mapping: Record<string, PeriodValue> = {};
    variables.forEach((variable) => {
      mapping[variable.name] = { mode: "multiplier", value: 1 };
    });
    result[period] = mapping;
  });
  return result;
}
