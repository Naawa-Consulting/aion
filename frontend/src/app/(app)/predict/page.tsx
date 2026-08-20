"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Info, Star, Copy, Undo2, Redo2 } from "lucide-react";
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
import { Disclosure } from "@/components/ui/disclosure";
import ScenarioSheetGlide, { type MultipliersMap } from "@/components/predict/ScenarioSheetGlide";
import ScenarioSheetTable from "@/components/predict/ScenarioSheetTable";
import PlannerView, { type ChannelAllocation } from "@/components/predict/PlannerView";
import { apiFetch, ApiError } from "@/lib/api";
import { translateApiError } from "@/lib/error-messages";
import { useCanEdit } from "@/hooks/useCanEdit";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useKeyboardShortcut } from "@/hooks/useKeyboardShortcut";
import { chartColor, useStableCategoricalColor } from "@/lib/chart-colors";
import { formatChartNumber, formatChartPercent, formatCurrency } from "@/lib/chart-format";
import { EMPTY_VALUE } from "@/lib/format";
import { downloadBlob } from "@/lib/download";
import { useGlobalStore } from "@/lib/store";
import { useActiveCurrency } from "@/hooks/useActiveCompany";

type Dataset = {
  id: string;
  display_name: string;
  columns: { name: string; dtype: string }[];
  frequency?: "daily" | "weekly" | "monthly" | null;
};
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
  display_name?: string | null;
  baseline_mean: number;
  group_name?: string | null;
  subgroup_name?: string | null;
  dollar_rate?: number | null;
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
  variable_baselines?: Record<string, Record<string, number>> | null;
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
  is_featured?: boolean;
};

const DEFAULT_MULTIPLIER = 1;
const SCENARIO_LIMIT = 5;
const FEATURED_LIMIT = 3;
const DESKTOP_QUERY = "(min-width: 1024px)";

// P1: Dataset.frequency ("daily"|"weekly"|"monthly") uses different literals than Scenario.freq
// ("day"|"week"|"month") — map + rank so it can act as a default/floor for scenario granularity.
const FREQ_FLOOR_MAP: Record<"daily" | "weekly" | "monthly", "day" | "week" | "month"> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
};
const FREQ_RANK: Record<"day" | "week" | "month", number> = { day: 0, week: 1, month: 2 };

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
    <InfoPopover content={<span style={{ whiteSpace: "normal", display: "block", width: "max-content", maxWidth: 220 }}>{content}</span>}>
      <button
        type="button"
        aria-label={label}
        className="-m-1.5 rounded-full p-1.5 text-muted transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Info className="h-3 w-3" />
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

// Fase 5/A04-R6: order-independent comparison key for `adjustments` — a plain `JSON.stringify`
// would false-positive as "dirty" whenever the backend's period/variable key order differs from
// the frontend's (e.g. right after a save/load round-trip), since JS object key order follows
// insertion order and isn't guaranteed to match between two independently-built objects holding
// the same data.
function stableAdjustmentsKey(adjustments: Record<string, Record<string, PeriodValue>>): string {
  const periods = Object.keys(adjustments).sort();
  return JSON.stringify(
    periods.map((period) => {
      const vars = Object.keys(adjustments[period] || {}).sort();
      return [period, vars.map((name) => [name, adjustments[period][name].mode, Number(adjustments[period][name].value)])];
    })
  );
}

export default function PredictPage() {
  const t = useTranslations("predict");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const canEdit = useCanEdit();
  const {
    activeCompanyId,
    datasetId: storedDatasetId,
    setDatasetId: setStoredDatasetId,
    modelId: storedModelId,
    setModelId: setStoredModelId,
    startLongOperation,
    endLongOperation,
    setUnsavedChangesActive,
  } = useGlobalStore();
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
  const [yVarLabel, setYVarLabel] = useState<string | null>(null);
  const [adjustments, setAdjustments] = useState<Record<string, Record<string, PeriodValue>>>({});

  // Fase 5/A07-R3: local undo/redo over `adjustments` — a plain stack of full snapshots (ref, not
  // state, so pushing on every edit doesn't itself trigger a render) capped at 50 entries.
  // `suppressHistoryPushRef` is set right before undo/redo/load rewrite `adjustments` themselves,
  // so the generic "record every change" effect below doesn't re-push the state it just restored.
  const historyStackRef = useRef<Record<string, Record<string, PeriodValue>>[]>([]);
  const historyIndexRef = useRef(-1);
  const suppressHistoryPushRef = useRef(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  useEffect(() => {
    if (suppressHistoryPushRef.current) {
      suppressHistoryPushRef.current = false;
      return;
    }
    const truncated = historyStackRef.current.slice(0, historyIndexRef.current + 1);
    truncated.push(cloneAdjustments(adjustments));
    historyStackRef.current = truncated.length > 50 ? truncated.slice(truncated.length - 50) : truncated;
    historyIndexRef.current = historyStackRef.current.length - 1;
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(false);
  }, [adjustments]);

  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    suppressHistoryPushRef.current = true;
    setAdjustments(cloneAdjustments(historyStackRef.current[historyIndexRef.current]));
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(true);
  }, []);

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyStackRef.current.length - 1) return;
    historyIndexRef.current += 1;
    suppressHistoryPushRef.current = true;
    setAdjustments(cloneAdjustments(historyStackRef.current[historyIndexRef.current]));
    setCanUndo(true);
    setCanRedo(historyIndexRef.current < historyStackRef.current.length - 1);
  }, []);

  // Ctrl+Z alone must NOT also fire when Shift is held — `useKeyboardShortcut`'s `options.shift`
  // only requires shift to be down when set, it doesn't require it to be UP when unset, so without
  // this guard Ctrl+Shift+Z would fire both this and the redo shortcut below in the same keystroke.
  useKeyboardShortcut(
    "z",
    (event) => {
      if (event.shiftKey) return;
      event.preventDefault();
      undo();
    },
    { ctrl: true }
  );
  useKeyboardShortcut(
    "z",
    (event) => {
      event.preventDefault();
      redo();
    },
    { ctrl: true, shift: true }
  );
  useKeyboardShortcut(
    "y",
    (event) => {
      event.preventDefault();
      redo();
    },
    { ctrl: true }
  );

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
  const [investmentMode, setInvestmentMode] = useState<"units" | "dollars">("units");
  // A05-R5: el grid en <canvas> (ScenarioSheetGlide) hoy solo cede a la tabla HTML accesible por
  // debajo de `lg` (hooks/useMediaQuery.ts). No hay forma de pedirla en escritorio — p.ej. lector
  // de pantalla, zoom alto, o simple preferencia — sin achicar la ventana. Toggle manual, además
  // (no en vez) del fallback automático.
  const [forceAccessibleTable, setForceAccessibleTable] = useState(false);
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
        displayName: variable.display_name ?? variable.name,
        baselineMean: variable.baseline_mean,
        // Fase 5/P2: seasonal per-period baseline from the last preview — falls back to the
        // flat mean (inside the grid components) until a preview has actually run.
        baselineByPeriod: preview?.variable_baselines?.[variable.name],
        dollarRate: variable.dollar_rate,
        group: variable.group_name ?? "Other",
      })),
    [variables, preview]
  );
  // Fase 5/A07-R2: media channels (resolvable $/unit rate) rendered as their own section,
  // separate from structural/control variables — two grid instances, not one flat table.
  const mediaGridVariables = useMemo(() => gridVariables.filter((v) => v.dollarRate != null), [gridVariables]);
  const structuralGridVariables = useMemo(() => gridVariables.filter((v) => v.dollarRate == null), [gridVariables]);
  const multipliersByVariable = useMemo(
    () => buildMultipliersFromAdjustments(variables, editablePeriods, adjustments),
    [variables, editablePeriods, adjustments]
  );
  const absoluteValuesByVariable = useMemo(
    () => buildAbsoluteValuesFromAdjustments(variables, editablePeriods, adjustments),
    [variables, editablePeriods, adjustments]
  );
  // Fase 5/P4: current $ spend implied by the grid's own state, in the SAME unit the optimizer
  // works in (steady-state $ total across the whole horizon, see PlannerView's `suggested_spend`
  // doc comment) — lets PlannerView precharge its budget input and show "current vs. suggested"
  // instead of always starting from a blank/zero state.
  const currentMediaAllocations = useMemo(
    () =>
      mediaGridVariables
        .filter((v) => v.dollarRate)
        .map((v) => {
          const totalRaw = editablePeriods.reduce((sum, period) => {
            const override = absoluteValuesByVariable[v.name]?.[period];
            const baseline = v.baselineByPeriod?.[period] ?? v.baselineMean;
            const multiplier = multipliersByVariable[v.name]?.[period] ?? 1;
            const raw = override != null && Number.isFinite(override) ? override : baseline * multiplier;
            return sum + raw;
          }, 0);
          return { proxy_variable: v.name, name: v.name, current_spend: totalRaw * (v.dollarRate as number) };
        }),
    [mediaGridVariables, editablePeriods, absoluteValuesByVariable, multipliersByVariable]
  );

  // Fase 5/A04-R6: "dirty" = differs from the last saved scenario's adjustments (or, for a fresh
  // unsaved scenario, from the all-multiplier-1 default `ensureAdjustmentDefaults` establishes).
  // A ref, not state — updated on save/load without needing its own re-render.
  const savedAdjustmentsKeyRef = useRef<string | null>(null);
  const defaultAdjustmentsKey = useMemo(() => {
    const next: Record<string, Record<string, PeriodValue>> = {};
    editablePeriods.forEach((period) => {
      const periodValues: Record<string, PeriodValue> = {};
      variables.forEach((variable) => {
        periodValues[variable.name] = { mode: "multiplier", value: DEFAULT_MULTIPLIER };
      });
      next[period] = periodValues;
    });
    return stableAdjustmentsKey(next);
  }, [editablePeriods, variables]);
  const isDirty = useMemo(() => {
    const baseline = currentScenarioId ? savedAdjustmentsKeyRef.current : defaultAdjustmentsKey;
    if (baseline === null) return false;
    return stableAdjustmentsKey(adjustments) !== baseline;
  }, [adjustments, currentScenarioId, defaultAdjustmentsKey]);

  useEffect(() => {
    setUnsavedChangesActive(isDirty);
  }, [isDirty, setUnsavedChangesActive]);
  // Clear the guard on unmount — otherwise navigating AWAY from Predict via something other than
  // the Sidebar/company-switcher (e.g. a deep link, browser back) would leave the flag armed for
  // whatever page loads next.
  useEffect(() => () => setUnsavedChangesActive(false), [setUnsavedChangesActive]);

  useEffect(() => {
    if (!isDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);
  const selectedModelInfo = useMemo(
    () => models.find((model) => model.id === selectedModel),
    [models, selectedModel]
  );
  const selectedDatasetInfo = useMemo(
    () => datasets.find((dataset) => dataset.id === selectedDataset),
    [datasets, selectedDataset]
  );
  // P1: Dataset.frequency acts as the default AND the floor for a scenario's own granularity —
  // a dataset detected/set as "monthly" shouldn't let a scenario plan week-by-week off it.
  const freqFloor = selectedDatasetInfo?.frequency ? FREQ_FLOOR_MAP[selectedDatasetInfo.frequency] : null;
  const dependentLabel = yVarLabel || selectedModelInfo?.y_var || "Y";
  const freqLabel = t(`freq.${freq}`);
  const hasDollarRateVariable = gridVariables.some((v) => v.dollarRate != null);
  const reachedScenarioLimit = !currentScenarioId && scenarios.length >= SCENARIO_LIMIT;
  const reachedFeaturedLimit = scenarios.filter((scenario) => scenario.is_featured).length >= FEATURED_LIMIT;
  const saveButtonLabel = currentScenarioId ? t("params.saveChanges") : t("params.save");

  const fetchDatasets = useCallback(async () => {
    try {
      const data = await apiFetch<Dataset[]>("/datasets");
      setDatasets(data);
      if (data.length) {
        // Prefer the dataset selected elsewhere in the app (A10-R1) over "first in the list".
        const preferred = storedDatasetId && data.some((d) => d.id === storedDatasetId) ? storedDatasetId : data[0].id;
        setSelectedDataset((prev) => (prev ? prev : preferred));
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? translateApiError(err, tErrors) : t("toasts.loadDatasetsFailed"));
    } finally {
      setInitializing(false);
    }
  }, [t, tErrors, storedDatasetId]);

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
      // Prefer the model selected elsewhere in the app (A10-R1), falling back to hero/first.
      const preferredValid = storedModelId && normalized.some((m) => m.id === storedModelId) ? storedModelId : null;
      const hero = normalized.find((m) => m.role === "hero" || m.is_hero) || normalized[0];
      const next = preferredValid || hero?.id;
      if (next) setSelectedModel(next);
    } catch (err) {
      toast.error(err instanceof ApiError ? translateApiError(err, tErrors) : t("toasts.loadModelsFailed"));
    } finally {
      setModelsLoading(false);
    }
  }, [t, tErrors, storedModelId]);

  const requestScenarioSummary = useCallback(
    async (customAdjustments: Record<string, Record<string, PeriodValue>>, signal?: AbortSignal) => {
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
        signal,
      });
      return data;
    },
    [selectedModel, horizon, startDate, freq]
  );

  // Guards against the race BITACORA documented on 2026-08-13: without this, an older
  // in-flight preview (e.g. the auto-fetch from fetchBaselineVariables) can resolve after a
  // newer one (e.g. a manual "Previsualizar escenario" click) and silently overwrite it with
  // stale KPIs. Same pattern as transform/page.tsx's previewAbortRef.
  const previewAbortRef = useRef<AbortController | null>(null);

  const fetchPreview = useCallback(async () => {
    if (!selectedModel) return;
    if (previewAbortRef.current) {
      previewAbortRef.current.abort();
    }
    const controller = new AbortController();
    previewAbortRef.current = controller;
    setPreviewLoading(true);
    startLongOperation(t("params.previewing"));
    try {
      const data = await requestScenarioSummary(adjustments, controller.signal);
      setPreview(data);
    } catch (error: any) {
      if (error?.name === "AbortError") return;
      toast.error(error instanceof ApiError ? translateApiError(error, tErrors) : t("toasts.previewFailed"));
    } finally {
      if (previewAbortRef.current === controller) {
        setPreviewLoading(false);
        previewAbortRef.current = null;
        endLongOperation();
      }
    }
  }, [selectedModel, adjustments, requestScenarioSummary, t, tErrors, startLongOperation, endLongOperation]);

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
        setYVarLabel(data.model?.y_var_display_name || null);
        fetchPreview();
      } catch (err) {
        setVariables([]);
        setYVarLabel(null);
        setVariablesError(true);
        toast.error(err instanceof ApiError ? translateApiError(err, tErrors) : t("toasts.loadVariablesFailed"));
      }
    },
    [fetchPreview, t, tErrors]
  );

  const fetchScenarios = useCallback(
    async (modelId: string) => {
      try {
        const data = await apiFetch<Scenario[]>(`/predict/scenarios?model_id=${modelId}`);
        setScenarios(data);
      } catch (err) {
        toast.error(err instanceof ApiError ? translateApiError(err, tErrors) : t("toasts.loadScenariosFailed"));
      }
    },
    [t, tErrors]
  );

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
    // P1: default a fresh scenario's granularity to the dataset's own detected/set frequency.
    if (freqFloor) setFreq(freqFloor);
    // A07-R3: a different model has a different variable set — old undo/redo entries would
    // reference variables that don't exist here, so start a clean stack (the next
    // `ensureAdjustmentDefaults` write naturally becomes its first entry).
    historyStackRef.current = [];
    historyIndexRef.current = -1;
    setCanUndo(false);
    setCanRedo(false);
  }, [selectedModel, freqFloor]);

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
      // Fase 5/A07-R2 split the grid into a media section and a structural section, each its own
      // component instance — each only knows its own subset of variable names, so its callback's
      // `nextMultipliers`/`absoluteOverrides` only cover that subset. Merge by variable name (top
      // level) onto the FULL current maps rather than rebuild `adjustments` from the partial map
      // directly — otherwise every variable in the *other* section would silently reset to its
      // default multiplier (1.0) on every edit, wiping any adjustment already made there.
      const mergedMultipliers: MultipliersMap = { ...multipliersByVariable, ...nextMultipliers };
      const mergedAbsolute: Record<string, Record<string, number>> = {
        ...absoluteValuesByVariable,
        ...absoluteOverrides,
      };
      setAdjustments(multipliersToAdjustments(mergedMultipliers, editablePeriods, variables, mergedAbsolute));
    },
    [editablePeriods, variables, multipliersByVariable, absoluteValuesByVariable]
  );
  const handleInvalidGridInput = useCallback(
    (count: number) => {
      toast.error(t("builder.invalidInput", { count }));
    },
    [t]
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

  // Fase 5/P3 (revised): changing frequency converts the scenario itself — horizon follows a
  // calendar-based ratio (12 months <-> 52 weeks) and every variable's grid values are re-gridded
  // (aggregated exactly when going coarser, distributed as an estimate when going finer) — see
  // `convertHorizon`/`retimeAdjustments` below the component. Only fires for a real user-driven
  // change (the `freq` <Select>), never for the P1 default-on-model-switch, which starts a fresh
  // scenario with nothing to convert.
  const handleFreqChange = useCallback(
    (nextFreq: "day" | "week" | "month") => {
      if (nextFreq === freq) return;
      const nextHorizon = convertHorizon(horizon, freq, nextFreq);
      const oldPeriods = editablePeriods.length ? editablePeriods : periodLabels;
      const newPeriods = buildPeriodLabels(startDate, nextHorizon, nextFreq);
      const nextAdjustments = retimeAdjustments(gridVariables, oldPeriods, adjustments, newPeriods);
      setFreq(nextFreq);
      setHorizon(nextHorizon);
      setAdjustments(nextAdjustments);
      const isFiner = FREQ_RANK[nextFreq] < FREQ_RANK[freq];
      const message = t(isFiner ? "params.frequencyConvertedEstimate" : "params.frequencyConverted", {
        horizon: nextHorizon,
        freq: t(`freq.${nextFreq}`),
      });
      if (isFiner) {
        toast.info(message);
      } else {
        toast.success(message);
      }
    },
    [freq, horizon, editablePeriods, periodLabels, startDate, gridVariables, adjustments, t]
  );

  const handleSaveScenario = async () => {
    if (!selectedModel) {
      toast.error(t("toasts.selectModelFirst"));
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
      const savedAdjustments = cloneAdjustments(data.adjustments);
      setAdjustments(savedAdjustments);
      savedAdjustmentsKeyRef.current = stableAdjustmentsKey(savedAdjustments);
      setPreview(data.summary);
      // Fase 5/A04-R6 fallout: refetch `scenarios` BEFORE setting `currentScenarioId` — a brand
      // new scenario's id isn't in the (still-stale) `scenarios` list yet, and the effect below
      // that clears `currentScenarioId` when it's missing from `scenarios` (meant for "this
      // scenario was deleted elsewhere") would otherwise fire immediately and incorrectly null it
      // right back out, which in turn made the unsaved-changes guard compare against the "brand
      // new scenario" default forever — the just-saved scenario always looked dirty.
      if (selectedModel) await fetchScenarios(selectedModel);
      setCurrentScenarioId(data.id);
      setRenamingScenarioId(null);
      setRenameValue("");
      toast.success(currentScenarioId ? t("toasts.scenarioUpdated") : t("toasts.scenarioSaved"));
    } catch (error) {
      toast.error(error instanceof ApiError ? translateApiError(error, tErrors) : t("toasts.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleLoadScenario = (scenario: Scenario) => {
    setScenarioName(scenario.name);
    setHorizon(scenario.horizon);
    setStartDate(scenario.start_date);
    setFreq(scenario.freq);
    const loadedAdjustments = cloneAdjustments(scenario.adjustments);
    suppressHistoryPushRef.current = true;
    historyStackRef.current = [cloneAdjustments(loadedAdjustments)];
    historyIndexRef.current = 0;
    setCanUndo(false);
    setCanRedo(false);
    setAdjustments(loadedAdjustments);
    savedAdjustmentsKeyRef.current = stableAdjustmentsKey(loadedAdjustments);
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
      toast.success(t("toasts.scenarioDeleted"));
      if (currentScenarioId === deleteTarget.id) {
        setCurrentScenarioId(null);
      }
      if (renamingScenarioId === deleteTarget.id) {
        setRenamingScenarioId(null);
        setRenameValue("");
      }
      if (selectedModel) await fetchScenarios(selectedModel);
      setDeleteTarget(null);
    } catch (error) {
      toast.error(error instanceof ApiError ? translateApiError(error, tErrors) : t("toasts.deleteFailed"));
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleDuplicateScenario = async (scenario: Scenario) => {
    if (!selectedModel) return;
    if (scenarios.length >= SCENARIO_LIMIT) {
      toast.error(t("params.limitReached", { limit: SCENARIO_LIMIT }));
      return;
    }
    try {
      await apiFetch<Scenario>(`/predict/scenarios/${scenario.id}/duplicate`, { method: "POST" });
      toast.success(t("toasts.scenarioDuplicated"));
      await fetchScenarios(selectedModel);
    } catch (error) {
      toast.error(error instanceof ApiError ? translateApiError(error, tErrors) : t("toasts.duplicateFailed"));
    }
  };

  const handleToggleFeatured = async (scenario: Scenario) => {
    const nextFeatured = !scenario.is_featured;
    if (nextFeatured && reachedFeaturedLimit) {
      toast.error(t("scenarios.featuredLimitReached", { limit: FEATURED_LIMIT }));
      return;
    }
    try {
      await apiFetch<Scenario>(`/predict/scenarios/${scenario.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_featured: nextFeatured }),
      });
      toast.success(nextFeatured ? t("toasts.featuredSaved") : t("toasts.featuredRemoved"));
      if (selectedModel) await fetchScenarios(selectedModel);
    } catch (error) {
      toast.error(error instanceof ApiError ? translateApiError(error, tErrors) : t("toasts.featuredFailed"));
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
        toast.success(t("toasts.scenarioRenamed"));
        if (currentScenarioId === scenarioId) {
          setScenarioName(trimmed);
        }
        await fetchScenarios(selectedModel);
      } catch (error) {
        toast.error(error instanceof ApiError ? translateApiError(error, tErrors) : t("toasts.renameFailed"));
      } finally {
        cancelRename();
      }
    },
    [selectedModel, currentScenarioId, fetchScenarios, cancelRename, t, tErrors]
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

  // Fase 5/A08-R2: ~10 KPIs (2 base + up to 4 group slices + baseline + other + 4 economics) is
  // too many to show at equal weight — split into a primary tier (always visible: the headline
  // total/average, plus ROI/ROAS when economics is configured) and a secondary tier (everything
  // else) tucked behind a Disclosure, open by default for `modelador` (the role that actually acts
  // on this detail) and closed for `visualizador`.
  const primaryKpiItems = useMemo(() => {
    const roi = economicsKpiItems.find((item) => item.key === "roi");
    const roas = economicsKpiItems.find((item) => item.key === "roas");
    return [kpiItems[0], kpiItems[1], roi, roas].filter((item): item is KpiItem => Boolean(item));
  }, [kpiItems, economicsKpiItems]);
  const secondaryKpiItems = useMemo(() => {
    const primaryKeys = new Set(primaryKpiItems.map((item) => item.key));
    return [...kpiItems, ...economicsKpiItems].filter((item) => !primaryKeys.has(item.key));
  }, [kpiItems, economicsKpiItems, primaryKpiItems]);

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
      toast.error(t("toasts.selectModelFirst"));
      return;
    }
    if (!variables.length || !editablePeriods.length) {
      toast.error(t("toasts.nothingToExport"));
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
        // Always exports absolute per-cell values — unrelated to the grid's units/$ display
        // toggle (`investmentMode`), which only affects on-screen editing, never what's sent
        // to the backend (adjustments are always stored/exported in the variable's native unit).
        mode: "absolute" as const,
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
      toast.error(translateApiError(error, tErrors));
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
    scenarioName,
    dependentLabel,
    t,
    tErrors,
  ]);
  const handleExportTimeseries = useCallback(async () => {
    if (!selectedModel || !chartData.length) {
      toast.error(t("toasts.previewBeforeExport"));
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
      toast.error(translateApiError(error, tErrors));
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
    t,
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
              <Select
                value={selectedDataset}
                onChange={(e) => {
                  setSelectedDataset(e.target.value);
                  setStoredDatasetId(e.target.value);
                }}
              >
                {datasets.map((ds) => (
                  <option key={ds.id} value={ds.id}>
                    {ds.display_name}
                  </option>
                ))}
              </Select>
            </FilterField>
            <FilterField label={t("filters.model")} className="w-[240px]">
              <Select
                value={selectedModel}
                onChange={(e) => {
                  setSelectedModel(e.target.value);
                  setStoredModelId(e.target.value);
                }}
                disabled={!models.length}
              >
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
                  {t("economicsNotConfigured")}{" "}
                  <Link href="/transform" className="font-medium underline">
                    {t("economicsNotConfiguredLink")}
                  </Link>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-busy={previewLoading} aria-live="polite">
                {modelsLoading || (previewLoading && !preview) ? (
                  Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[104px]" />)
                ) : (
                  primaryKpiItems.map((item) => (
                    <StatCard key={item.key} label={item.label} value={item.value} icon={item.icon} trend={item.trend} />
                  ))
                )}
              </div>

              {!modelsLoading && secondaryKpiItems.length > 0 && (
                <Disclosure
                  as="h3"
                  title={t("kpis.moreDetails")}
                  defaultOpen={canEdit}
                  className="rounded-xl border border-line p-4"
                >
                  <div className="grid grid-cols-2 gap-4 pt-2 lg:grid-cols-4" aria-busy={previewLoading} aria-live="polite">
                    {secondaryKpiItems.map((item) => (
                      <StatCard key={item.key} label={item.label} value={item.value} icon={item.icon} trend={item.trend} />
                    ))}
                  </div>
                </Disclosure>
              )}

              <Card className="space-y-4">
                <CardHeader as="h2" title={t("params.title")} subtitle={t("params.subtitle")} />
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
                      onChange={(e) => handleFreqChange(e.target.value as "day" | "week" | "month")}
                    >
                      <option value="day" disabled={freqFloor ? FREQ_RANK.day < FREQ_RANK[freqFloor] : false}>
                        {t("freq.day")}
                      </option>
                      <option value="week" disabled={freqFloor ? FREQ_RANK.week < FREQ_RANK[freqFloor] : false}>
                        {t("freq.week")}
                      </option>
                      <option value="month" disabled={freqFloor ? FREQ_RANK.month < FREQ_RANK[freqFloor] : false}>
                        {t("freq.month")}
                      </option>
                    </Select>
                    {freqFloor && (
                      <p className="text-xs text-muted">{t("params.frequencyFloorHint", { freq: t(`freq.${freqFloor}`) })}</p>
                    )}
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
                  <Button onClick={fetchPreview} disabled={!selectedModel} loading={previewLoading}>
                    {previewLoading ? t("params.previewing") : t("params.preview")}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={handleSaveScenario}
                    disabled={!canEdit || saving || !selectedModel || reachedScenarioLimit}
                    disabledReason={!canEdit ? tCommon("readOnlyTooltip") : undefined}
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
                  <CardHeader as="h2" title={t("builder.title")} subtitle={t("builder.subtitle")} />
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
                    {hasDollarRateVariable && (
                      <div className="inline-flex gap-1">
                        <ToggleChip active={investmentMode === "units"} onClick={() => setInvestmentMode("units")}>
                          {t("builder.investmentModeUnits")}
                        </ToggleChip>
                        <ToggleChip active={investmentMode === "dollars"} onClick={() => setInvestmentMode("dollars")}>
                          {t("builder.investmentModeDollars")}
                        </ToggleChip>
                      </div>
                    )}
                    <Button variant="ghost" size="sm" onClick={undo} disabled={!canUndo} title={t("builder.undo")}>
                      <Undo2 className="mr-1 h-3 w-3" /> {t("builder.undo")}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={redo} disabled={!canRedo} title={t("builder.redo")}>
                      <Redo2 className="mr-1 h-3 w-3" /> {t("builder.redo")}
                    </Button>
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
                    {isDesktop && (
                      <ToggleChip active={forceAccessibleTable} onClick={() => setForceAccessibleTable((v) => !v)}>
                        {t("builder.accessibleTableToggle")}
                      </ToggleChip>
                    )}
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
                  <PlannerView
                    modelId={selectedModel}
                    onApply={handleApplyAllocations}
                    currentAllocations={currentMediaAllocations}
                  />
                ) : (
                  <div className="space-y-6">
                    {mediaGridVariables.length > 0 && (
                      <div className="space-y-2">
                        <Eyebrow>{t("builder.mediaSection")}</Eyebrow>
                        {isDesktop && !forceAccessibleTable ? (
                          <ScenarioSheetGlide
                            variables={mediaGridVariables}
                            periods={editablePeriods}
                            multipliers={multipliersByVariable}
                            absoluteValues={absoluteValuesByVariable}
                            editMode={investmentMode}
                            onMultipliersChange={handleGridMultipliersChange}
                            groupColumnLabel={t("builder.colGroup")}
                            variableColumnLabel={t("builder.colVariable")}
                            totalColumnLabel={t("builder.totalColumn")}
                            totalRowLabel={t("builder.totalRow")}
                            fillRightLabel={t("builder.fillRight")}
                            onInvalidInput={handleInvalidGridInput}
                          />
                        ) : (
                          <ScenarioSheetTable
                            variables={mediaGridVariables}
                            periods={editablePeriods}
                            multipliers={multipliersByVariable}
                            absoluteValues={absoluteValuesByVariable}
                            editMode={investmentMode}
                            onMultipliersChange={handleGridMultipliersChange}
                            groupColumnLabel={t("builder.colGroup")}
                            variableColumnLabel={t("builder.colVariable")}
                            totalColumnLabel={t("builder.totalColumn")}
                            totalRowLabel={t("builder.totalRow")}
                            fillRightLabel={t("builder.fillRight")}
                            onInvalidInput={handleInvalidGridInput}
                          />
                        )}
                      </div>
                    )}
                    {structuralGridVariables.length > 0 && (
                      <div className="space-y-2">
                        <Eyebrow>{t("builder.structuralSection")}</Eyebrow>
                        {isDesktop && !forceAccessibleTable ? (
                          <ScenarioSheetGlide
                            variables={structuralGridVariables}
                            periods={editablePeriods}
                            multipliers={multipliersByVariable}
                            absoluteValues={absoluteValuesByVariable}
                            editMode="units"
                            onMultipliersChange={handleGridMultipliersChange}
                            groupColumnLabel={t("builder.colGroup")}
                            variableColumnLabel={t("builder.colVariable")}
                            totalColumnLabel={t("builder.totalColumn")}
                            totalRowLabel={t("builder.totalRow")}
                            fillRightLabel={t("builder.fillRight")}
                            onInvalidInput={handleInvalidGridInput}
                          />
                        ) : (
                          <ScenarioSheetTable
                            variables={structuralGridVariables}
                            periods={editablePeriods}
                            multipliers={multipliersByVariable}
                            absoluteValues={absoluteValuesByVariable}
                            editMode="units"
                            onMultipliersChange={handleGridMultipliersChange}
                            groupColumnLabel={t("builder.colGroup")}
                            variableColumnLabel={t("builder.colVariable")}
                            totalColumnLabel={t("builder.totalColumn")}
                            totalRowLabel={t("builder.totalRow")}
                            fillRightLabel={t("builder.fillRight")}
                            onInvalidInput={handleInvalidGridInput}
                          />
                        )}
                      </div>
                    )}
                  </div>
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
                        <ComposedChart
                          accessibilityLayer
                          data={chartData}
                          margin={{ top: 10, right: 20, bottom: 10, left: 0 }}
                        >
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
                <CardHeader as="h2" title={t("scenarios.title")} subtitle={t("scenarios.subtitle", { limit: SCENARIO_LIMIT })} />
                <p className="text-xs text-muted">{t("scenarios.featuredHint", { limit: FEATURED_LIMIT })}</p>
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
                                  {scenario.is_featured && <Badge variant="warning">{t("scenarios.featured")}</Badge>}
                                  <button
                                    type="button"
                                    aria-label={scenario.is_featured ? t("scenarios.unmarkFeatured") : t("scenarios.markFeatured")}
                                    title={scenario.is_featured ? t("scenarios.unmarkFeatured") : t("scenarios.markFeatured")}
                                    className={`rounded p-0.5 transition ${
                                      scenario.is_featured ? "text-warn" : "text-muted hover:text-ink"
                                    }`}
                                    onClick={() => handleToggleFeatured(scenario)}
                                    disabled={!canEdit}
                                  >
                                    <Star className="h-3.5 w-3.5" fill={scenario.is_featured ? "currentColor" : "none"} />
                                  </button>
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
                          <div className="flex flex-wrap gap-2">
                            <Button variant="secondary" size="sm" onClick={() => handleLoadScenario(scenario)}>
                              {t("scenarios.load")}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDuplicateScenario(scenario)}
                              disabled={!canEdit || scenarios.length >= SCENARIO_LIMIT}
                              disabledReason={!canEdit ? tCommon("readOnlyTooltip") : undefined}
                            >
                              <Copy className="mr-1 h-3 w-3" /> {t("scenarios.duplicate")}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeleteTarget(scenario)}
                              disabled={!canEdit}
                              disabledReason={!canEdit ? tCommon("readOnlyTooltip") : undefined}
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

// Fase 5/P3 (revised per user feedback): changing frequency now converts the scenario itself —
// horizon and the grid's own values — instead of offering a separate read-only view (redundant
// with the "Mostrar tabla" table already above the chart).
//
// Calendar-based day-length per unit — deliberately "52 weeks = 12 months" (how a business person
// thinks about it), not a strict day-count year, so month<->week horizon conversions land on the
// round numbers users expect (12 months -> 52 weeks, 4 weeks -> 1 month).
const FREQ_DAY_LENGTH: Record<"day" | "week" | "month", number> = {
  day: 1,
  week: 7,
  month: (7 * 52) / 12,
};

function convertHorizon(horizon: number, fromFreq: "day" | "week" | "month", toFreq: "day" | "week" | "month"): number {
  if (fromFreq === toFreq) return horizon;
  const days = horizon * FREQ_DAY_LENGTH[fromFreq];
  return Math.max(1, Math.round(days / FREQ_DAY_LENGTH[toFreq]));
}

// Re-grids a raw-unit series of length `oldN` onto `newN` periods, preserving the total exactly
// via proportional overlap on a normalized [0,1] timeline. The same math handles both directions
// — aggregating (newN < oldN, e.g. week->month: this collapses to an exact sum) and disaggregating
// (newN > oldN, e.g. month->week: this assumes activity is spread evenly within each old period,
// an estimate — adstock/Hill are non-linear, so this is not a model refit at the new grain).
function regridSeries(values: number[], newN: number): number[] {
  const oldN = values.length;
  if (oldN === 0) return new Array(newN).fill(0);
  if (newN === oldN) return values.slice();
  const result = new Array(newN).fill(0);
  for (let i = 0; i < oldN; i += 1) {
    const start = i / oldN;
    const end = (i + 1) / oldN;
    for (let j = 0; j < newN; j += 1) {
      const jStart = j / newN;
      const jEnd = (j + 1) / newN;
      const overlap = Math.min(end, jEnd) - Math.max(start, jStart);
      if (overlap > 0) result[j] += values[i] * overlap * oldN;
    }
  }
  return result;
}

// Rebuilds `adjustments` for every variable against `newPeriods`, converting each variable's raw
// (native-unit) series from the old period grid to the new one via `regridSeries`. Every
// reprojected cell becomes an explicit absolute override (`mode: "value"`) — a multiplier only
// means something relative to a period's own seasonal baseline, and that baseline is tied to the
// OLD frequency's calendar bucketing, not the new one, so preserving multipliers across a
// frequency change would silently change what they mean.
function retimeAdjustments(
  variables: { name: string; baselineMean: number; baselineByPeriod?: Record<string, number> }[],
  oldPeriods: string[],
  adjustments: Record<string, Record<string, PeriodValue>>,
  newPeriods: string[]
): Record<string, Record<string, PeriodValue>> {
  const next: Record<string, Record<string, PeriodValue>> = {};
  newPeriods.forEach((period) => {
    next[period] = {};
  });
  variables.forEach((variable) => {
    const oldRaw = oldPeriods.map((period) => {
      const entry = adjustments[period]?.[variable.name];
      const baseline = variable.baselineByPeriod?.[period] ?? variable.baselineMean;
      if (!entry) return baseline;
      return entry.mode === "value" ? entry.value : baseline * entry.value;
    });
    const newRaw = regridSeries(oldRaw, newPeriods.length);
    newPeriods.forEach((period, idx) => {
      next[period][variable.name] = { mode: "value", value: Number((newRaw[idx] ?? 0).toFixed(2)) };
    });
  });
  return next;
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
