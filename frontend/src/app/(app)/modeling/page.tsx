"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { Info, MoreVertical, Pencil } from "lucide-react";

import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Select } from "@/components/ui/select";
import { Eyebrow } from "@/components/ui/eyebrow";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip as InfoPopover } from "@/components/ui/tooltip";
import { StatCard } from "@/components/ui/stat-card";
import { Disclosure } from "@/components/ui/disclosure";
import { Tabs } from "@/components/ui/tabs";
import { Table, TableHeader, TableRow, Th, TableCell } from "@/components/ui/table";
import { Modal } from "@/components/ui/modal";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";
import { RowActions } from "@/components/ui/row-actions";
import { IconButton } from "@/components/ui/icon-button";
import { SelectedPredictorsQuickView } from "@/components/modeling/SelectedPredictorsQuickView";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { apiFetch, ApiError } from "@/lib/api";
import { translateApiError } from "@/lib/error-messages";
import { useCanEdit, useActiveRole } from "@/hooks/useCanEdit";
import { useGlobalStore } from "@/lib/store";
import { chartColor } from "@/lib/chart-colors";
import { formatChartNumber } from "@/lib/chart-format";
import { EMPTY_VALUE } from "@/lib/format";
import { downloadBlob } from "@/lib/download";

type Dataset = { id: string; display_name: string; columns: { name: string; dtype: string }[] };
type Variable = { id: string; name: string; dtype: string };
type CorrelationItem = {
  name: string;
  corr_y: number | null;
  corr_res: number | null;
  dtype: string;
  derived: boolean;
  group_name: string | null;
  subgroup_name: string | null;
};
type ModelMetrics = {
  r2: number;
  adj_r2: number;
  durbin_watson: number;
  mae: number;
  rmse: number;
  mape?: number | null;
  vif: { name: string; vif: number }[];
};
type ModelRole = "hero" | "challenger1" | "challenger2" | "none";
type Model = {
  id: string;
  name: string;
  dataset_id: string;
  y_var: string;
  x_vars: string[];
  is_hero: boolean;
  apply_media_transforms: boolean;
  role: ModelRole;
  metrics: ModelMetrics;
};
type ModelSummary = {
  model_id: string;
  intercept: Coefficient;
  coefficients: Coefficient[];
};
type Coefficient = {
  name: string;
  display_name?: string | null;
  coef: number;
  std_err: number;
  t_value: number;
  p_value: number;
  vif?: number | null;
  beta_std?: number | null;
  is_media?: boolean;
  decay?: number | null;
  half_life?: number | null;
  hill_k?: number | null;
  hill_s?: number | null;
  lag?: number | null;
  raw_mean?: number | null;
};
type Predictions = {
  index: string[];
  y_true: number[];
  y_pred: number[];
  residuals: number[];
};

type GroupFilter = "all" | string;
type SubgroupFilter = "all" | string;
type Quality = "good" | "review" | null;

const ROLE_LABEL: Record<string, string> = { hero: "Hero", challenger1: "Ch. 1", challenger2: "Ch. 2" };
const NEW_MODEL_VALUE = "__new__";

const formatPValueNumber = (value: number) => {
  if (value == null || Number.isNaN(value)) return EMPTY_VALUE;
  return value < 0.0001 ? "<0.0001" : value.toFixed(4);
};

const pValueStars = (value: number) => {
  if (value == null || Number.isNaN(value)) return "";
  return value < 0.001 ? "***" : value < 0.01 ? "**" : value < 0.05 ? "*" : "";
};

const formatCorr = (value: number | null | undefined) => {
  if (value == null || Number.isNaN(value)) return EMPTY_VALUE;
  return value.toFixed(3);
};

const formatTimeLabel = (value: string | number, includeYear = true) => {
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    if (includeYear) {
      options.year = "numeric";
    }
    return parsed.toLocaleDateString(undefined, options);
  }
  return String(value);
};

const quality = (value: number | null, threshold: number, higherIsBetter: boolean): Quality => {
  if (value == null || Number.isNaN(value)) return null;
  if (higherIsBetter) return value >= threshold ? "good" : "review";
  return value <= threshold ? "good" : "review";
};

const durbinWatsonQuality = (value: number | null | undefined): Quality => {
  if (value == null || Number.isNaN(value)) return null;
  return value >= 1.5 && value <= 2.5 ? "good" : "review";
};

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

function InfoTooltip({
  label,
  content,
  side,
  align,
}: {
  label: string;
  content: string;
  side?: "top" | "bottom";
  align?: "center" | "end";
}) {
  return (
    <InfoPopover
      side={side}
      align={align}
      content={<span style={{ whiteSpace: "normal", display: "block", width: "max-content", maxWidth: 220 }}>{content}</span>}
    >
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

export default function ModelingPage() {
  const t = useTranslations("modeling");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const canEdit = useCanEdit();
  const { activeCompanyId, datasetId: storedDatasetId, setDatasetId: setStoredDatasetId, startLongOperation, endLongOperation } =
    useGlobalStore();
  const { resolvedTheme } = useTheme();
  const isDarkTheme = resolvedTheme === "dark";
  const mutedColor = isDarkTheme ? "#81858e" : "#6d7178";
  const lineColor = isDarkTheme ? "#262a2f" : "#e5e6ea";
  const surfaceColor = isDarkTheme ? "#16181b" : "#ffffff";

  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<string>("");
  const [variables, setVariables] = useState<Variable[]>([]);
  const [yVar, setYVar] = useState("");
  const [xSelected, setXSelected] = useState<string[]>([]);
  const [modelName, setModelName] = useState("");
  const [applyMediaTransforms, setApplyMediaTransforms] = useState(true);
  const [corr, setCorr] = useState<CorrelationItem[]>([]);
  const [corrLoading, setCorrLoading] = useState(false);
  const [corrSearch, setCorrSearch] = useState("");
  const [models, setModels] = useState<Model[]>([]);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [summary, setSummary] = useState<ModelSummary | null>(null);
  const [predictions, setPredictions] = useState<Predictions | null>(null);
  const [showResiduals, setShowResiduals] = useState(false);
  // A03-R5: aislar una serie con clic en la leyenda — recharts no lo hace solo; `hide` en
  // `Bar`/`Line` sí lo soporta, solo falta el estado y el `onClick` de `Legend` que lo alternen.
  const [hiddenComparisonKeys, setHiddenComparisonKeys] = useState<string[]>([]);
  const toggleComparisonKey = (key: string) =>
    setHiddenComparisonKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  const [hiddenDiagnosticsKeys, setHiddenDiagnosticsKeys] = useState<string[]>([]);
  const toggleDiagnosticsKey = (key: string) =>
    setHiddenDiagnosticsKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  const [editSummary, setEditSummary] = useState<ModelSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [showQuickView, setShowQuickView] = useState(false);
  const [groupFilter, setGroupFilter] = useState<GroupFilter>("all");
  const [subgroupFilter, setSubgroupFilter] = useState<SubgroupFilter>("all");
  const [duplicateLoadingId, setDuplicateLoadingId] = useState<string | null>(null);
  const [bestLoadingId, setBestLoadingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Model | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  // null = still loading/unknown, so the warning only ever appears once we actually know a
  // model has scenarios — never omitted just because the count hasn't arrived yet.
  const [deleteScenarioCount, setDeleteScenarioCount] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  // A08-R6: abierto por defecto para `modelador`/`admin_compania`, cerrado para `visualizador` —
  // sincronizado una sola vez cuando `useActiveRole()` deja de ser `null` (mismo criterio que
  // Analysis), en vez de fijarlo como valor inicial de `useState` (el rol real puede resolver
  // después del primer render).
  const activeRole = useActiveRole();
  const detailOpenSyncedRef = useRef(false);
  useEffect(() => {
    if (detailOpenSyncedRef.current || activeRole === null) return;
    detailOpenSyncedRef.current = true;
    setDetailOpen(activeRole === "modelador" || activeRole === "admin_compania");
  }, [activeRole]);
  const [activeTab, setActiveTab] = useState("models");
  const autoOpenedRef = useRef(false);

  const openBuilder = () => {
    setDetailOpen(true);
    setActiveTab("builder");
  };

  useEffect(() => {
    setGroupFilter("all");
    setSubgroupFilter("all");
  }, [selectedDataset]);

  useEffect(() => {
    if (selectedDataset && yVar) {
      fetchCorrelations(selectedDataset, yVar, editingModelId);
    }
  }, [selectedDataset, yVar, editingModelId]);

  useEffect(() => {
    const hero = models.find((m) => m.role === "hero");
    if (hero) {
      fetchSummary(hero.id);
      fetchPredictions(hero.id);
    } else {
      setSummary(null);
      setPredictions(null);
    }
  }, [models]);

  // Fit metrics + coefficients for whichever model the builder is currently editing — lets a
  // modelador see "does this model need more/fewer variables" without leaving the tab. Separate
  // from `summary` (always the Hero) since the edited model may not be the Hero.
  useEffect(() => {
    if (!editingModelId) {
      setEditSummary(null);
      return;
    }
    let active = true;
    apiFetch<ModelSummary>(`/models/${editingModelId}/summary`)
      .then((data) => {
        if (active) setEditSummary(data);
      })
      .catch(() => {
        if (active) setEditSummary(null);
      });
    return () => {
      active = false;
    };
  }, [editingModelId]);

  const fetchDatasets = useCallback(async () => {
    try {
      const data = await apiFetch<Dataset[]>("/datasets");
      setDatasets(data);
      if (data.length) {
        // Prefer the dataset selected elsewhere in the app (A10-R1) — only fall back to the
        // first dataset if there's no valid stored selection, mirroring datasets/page.tsx.
        const preferred = storedDatasetId && data.some((d) => d.id === storedDatasetId) ? storedDatasetId : data[0].id;
        setSelectedDataset((prev) => (prev ? prev : preferred));
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? translateApiError(err, tErrors) : t("toasts.loadDatasetsFailed"));
    } finally {
      setInitializing(false);
    }
  }, [t, tErrors, storedDatasetId]);

  useEffect(() => {
    // activeCompanyId hydrates asynchronously (AuthBootstrap fetches /me/memberships and
    // auto-selects the first company) — fetching before it's set sends no X-Company-Id
    // header and the backend 422s. Wait for it, then re-fetch once it's ready.
    if (!activeCompanyId) return;
    fetchDatasets();
  }, [fetchDatasets, activeCompanyId]);

  const fetchVariables = useCallback(async (datasetId: string) => {
    try {
      const data = await apiFetch<any[]>(`/variables?dataset_id=${datasetId}`);
      const mapped: Variable[] = data.map((v: any) => ({ id: v.id, name: v.name, dtype: v.dtype }));
      setVariables(mapped);
      const numeric = mapped.find((v) => /int|float|double|decimal|number/i.test(v.dtype));
      if (numeric) {
        setYVar((prev) => (prev ? prev : numeric.name));
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? translateApiError(err, tErrors) : t("toasts.loadVariablesFailed"));
    }
  }, [t, tErrors]);

  const fetchModels = useCallback(async (datasetId: string) => {
    setModelsLoading(true);
    try {
      const data = await apiFetch<Model[]>(`/models?dataset_id=${datasetId}`);
      setModels(data);
      if (!autoOpenedRef.current) {
        autoOpenedRef.current = true;
        if (data.length === 0) {
          setDetailOpen(true);
          setActiveTab("builder");
        }
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? translateApiError(err, tErrors) : t("toasts.loadModelsFailed"));
    } finally {
      setModelsLoading(false);
    }
  }, [t, tErrors]);

  useEffect(() => {
    if (selectedDataset) {
      fetchVariables(selectedDataset);
      fetchModels(selectedDataset);
    }
  }, [selectedDataset, fetchVariables, fetchModels]);

  const fetchCorrelations = async (datasetId: string, y: string, modelId?: string | null) => {
    setCorrLoading(true);
    try {
      const params = new URLSearchParams({ dataset_id: datasetId, y: y });
      if (modelId) {
        params.append("model_id", modelId);
      }
      const data = await apiFetch<{ items: CorrelationItem[] }>(`/models/correlations?${params.toString()}`);
      setCorr(data.items);
    } catch (err) {
      toast.error(err instanceof ApiError ? translateApiError(err, tErrors) : t("toasts.correlationsFailed"));
    } finally {
      setCorrLoading(false);
    }
  };

  const fetchSummary = async (modelId: string) => {
    try {
      const data = await apiFetch<ModelSummary>(`/models/${modelId}/summary`);
      setSummary(data);
    } catch {
      setSummary(null);
    }
  };

  const fetchPredictions = async (modelId: string) => {
    try {
      const data = await apiFetch<Predictions>(`/models/${modelId}/predictions?granularity=auto`);
      setPredictions(data);
    } catch {
      setPredictions(null);
    }
  };

  const downloadModelSummary = async (modelId: string) => {
    try {
      const blob = await apiFetch<Blob>(`/models/${modelId}/export/summary.xlsx`, { responseType: "blob" });
      downloadBlob(blob, "model-summary.xlsx");
    } catch (err) {
      toast.error(err instanceof ApiError ? translateApiError(err, tErrors) : t("toasts.exportFailed"));
    }
  };

  const handleToggleX = (name: string) => {
    setXSelected((prev) => (prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]));
  };

  const handleToggleSelectAll = () => {
    if (!visibleCorrelations.length) return;
    setXSelected((prev) => {
      if (allVisibleSelected) {
        return prev.filter((name) => !visibleCorrelations.some((item) => item.name === name));
      }
      const merged = new Set(prev);
      visibleCorrelations.forEach((item) => merged.add(item.name));
      return Array.from(merged);
    });
  };

  const selectedDetails = useMemo(
    () =>
      xSelected.map((name) => {
        const meta = corr.find((item) => item.name === name);
        return { name, corr_y: meta?.corr_y ?? null, corr_res: meta?.corr_res ?? null };
      }),
    [xSelected, corr]
  );

  const handleSubmit = async () => {
    if (!selectedDataset || !yVar || xSelected.length === 0 || !modelName.trim()) {
      toast.error(t("toasts.missingFields"));
      return;
    }
    setLoading(true);
    startLongOperation(t("overlay.fitting"));
    try {
      if (editingModelId) {
        await apiFetch(`/models/${editingModelId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: modelName,
            x_vars: xSelected,
            apply_media_transforms: applyMediaTransforms,
          }),
        });
        toast.success(t("toasts.modelUpdated"));
      } else {
        await apiFetch("/models", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dataset_id: selectedDataset,
            name: modelName,
            y_var: yVar,
            x_vars: xSelected,
            apply_media_transforms: applyMediaTransforms,
          }),
        });
        toast.success(t("toasts.modelCreated"));
      }
      await fetchModels(selectedDataset);
      resetForm();
    } catch (err) {
      toast.error(translateApiError(err, tErrors));
    } finally {
      setLoading(false);
      endLongOperation();
    }
  };

  const resetForm = () => {
    setModelName("");
    setXSelected([]);
    setEditingModelId(null);
    setApplyMediaTransforms(true);
  };

  const startEdit = (model: Model) => {
    setEditingModelId(model.id);
    setModelName(model.name);
    setYVar(model.y_var);
    setXSelected(model.x_vars);
    setApplyMediaTransforms(model.apply_media_transforms);
    setActiveTab("builder");
  };

  const openDeleteModal = (model: Model) => {
    setDeleteTarget(model);
    setDeleteScenarioCount(null);
    apiFetch<{ scenarios: number }>(`/models/${model.id}/dependencies`)
      .then((data) => setDeleteScenarioCount(data.scenarios))
      .catch(() => setDeleteScenarioCount(0));
  };

  const confirmDeleteModel = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await apiFetch(`/models/${deleteTarget.id}`, { method: "DELETE" });
      toast.success(t("toasts.modelDeleted"));
      setDeleteTarget(null);
      await fetchModels(selectedDataset);
    } catch (err) {
      toast.error(translateApiError(err, tErrors));
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleDuplicateModel = async (model: Model) => {
    if (!selectedDataset) return;
    setDuplicateLoadingId(model.id);
    try {
      await apiFetch(`/models/${model.id}/duplicate`, { method: "POST" });
      toast.success(t("toasts.modelDuplicated"));
      await fetchModels(selectedDataset);
    } catch (err) {
      toast.error(translateApiError(err, tErrors));
    } finally {
      setDuplicateLoadingId(null);
    }
  };

  const handleBestModel = async (model: Model) => {
    if (!selectedDataset) return;
    setBestLoadingId(model.id);
    startLongOperation(t("overlay.searchingBest"));
    try {
      await apiFetch(`/models/${model.id}/best_stepwise`, { method: "POST" });
      toast.success(t("toasts.bestModelCreated"));
      await fetchModels(selectedDataset);
    } catch (err) {
      toast.error(translateApiError(err, tErrors));
    } finally {
      setBestLoadingId(null);
      endLongOperation();
    }
  };

  const setRole = async (model: Model, role: Model["role"]) => {
    try {
      await apiFetch(`/models/${model.id}/role`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      toast.success(t("toasts.roleUpdated"));
      fetchModels(selectedDataset);
    } catch (err) {
      toast.error(translateApiError(err, tErrors));
    }
  };

  const groupOptions = useMemo(() => {
    const names = Array.from(new Set(corr.map((item) => item.group_name).filter((g): g is string => Boolean(g))));
    return names.sort((a, b) => a.localeCompare(b));
  }, [corr]);

  const subgroupOptions = useMemo(() => {
    if (groupFilter === "all") return [];
    const names = Array.from(
      new Set(
        corr
          .filter((item) => item.group_name === groupFilter && item.subgroup_name)
          .map((item) => item.subgroup_name as string)
      )
    );
    return names.sort((a, b) => a.localeCompare(b));
  }, [corr, groupFilter]);

  const visibleCorrelations = useMemo(() => {
    const lowered = corrSearch.toLowerCase();
    return corr
      .filter((item) => item.name.toLowerCase().includes(lowered))
      .filter((item) => {
        if (groupFilter === "all") return true;
        if (item.group_name !== groupFilter) return false;
        if (subgroupFilter === "all") return true;
        return item.subgroup_name === subgroupFilter;
      })
      .sort((a, b) => {
        const aVal = Math.abs(a.corr_y ?? 0);
        const bVal = Math.abs(b.corr_y ?? 0);
        return bVal - aVal;
      });
  }, [corr, corrSearch, groupFilter, subgroupFilter]);

  const allVisibleSelected = useMemo(() => {
    if (!visibleCorrelations.length) return false;
    return visibleCorrelations.every((item) => xSelected.includes(item.name));
  }, [visibleCorrelations, xSelected]);

  const selectAllRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (selectAllRef.current) {
      const someVisibleSelected = visibleCorrelations.some((item) => xSelected.includes(item.name));
      selectAllRef.current.indeterminate = someVisibleSelected && !allVisibleSelected;
    }
  }, [visibleCorrelations, xSelected, allVisibleSelected]);

  const heroModel = models.find((m) => m.role === "hero");
  const editingModel = editingModelId ? models.find((m) => m.id === editingModelId) : undefined;
  const challenger1 = models.find((m) => m.role === "challenger1");
  const challenger2 = models.find((m) => m.role === "challenger2");
  const compareModels = [heroModel, challenger1, challenger2].filter(Boolean) as Model[];
  const heroComparisonIndex = compareModels.findIndex((m) => m.role === "hero");

  const formatMetricValue = (value: number | null) => {
    if (value == null || Number.isNaN(value)) return EMPTY_VALUE;
    if (Math.abs(value) >= 1000) return value.toFixed(0);
    if (Math.abs(value) >= 100) return value.toFixed(1);
    if (Math.abs(value) >= 1) return value.toFixed(2);
    return value.toFixed(3);
  };

  type MetricConfig = {
    key: string;
    label: string;
    type: "higher" | "lower" | "target";
    target?: number;
    getValue: (model: Model) => number | null;
    format?: (value: number | null) => string;
  };

  const metricConfigs: MetricConfig[] = [
    { key: "r2", label: t("comparison.metrics.r2"), type: "higher", getValue: (m) => m.metrics.r2 },
    { key: "adj_r2", label: t("comparison.metrics.adjR2"), type: "higher", getValue: (m) => m.metrics.adj_r2 },
    {
      key: "vif_max",
      label: t("comparison.metrics.vifMax"),
      type: "lower",
      getValue: (m) => (m.metrics.vif.length ? Math.max(...m.metrics.vif.map((v) => v.vif)) : null),
    },
    {
      key: "vif_mean",
      label: t("comparison.metrics.vifMean"),
      type: "lower",
      getValue: (m) =>
        m.metrics.vif.length
          ? m.metrics.vif.reduce((sum, item) => sum + item.vif, 0) / m.metrics.vif.length
          : null,
    },
    {
      key: "durbin_watson",
      label: t("comparison.metrics.durbinWatson"),
      type: "target",
      target: 2,
      getValue: (m) => m.metrics.durbin_watson,
    },
    { key: "mae", label: t("comparison.metrics.mae"), type: "lower", getValue: (m) => m.metrics.mae },
    { key: "rmse", label: t("comparison.metrics.rmse"), type: "lower", getValue: (m) => m.metrics.rmse },
    {
      key: "mape",
      label: t("comparison.metrics.mape"),
      type: "lower",
      getValue: (m) => (m.metrics.mape != null ? m.metrics.mape : null),
      format: (value) => (value == null || Number.isNaN(value) ? EMPTY_VALUE : `${value.toFixed(1)}%`),
    },
  ];

  const getBestIndex = (
    values: (number | null)[],
    type: MetricConfig["type"],
    target?: number
  ): number | null => {
    const valid = values
      .map((value, idx) => ({ value, idx }))
      .filter((entry) => entry.value != null && !Number.isNaN(entry.value));
    if (!valid.length) return null;
    if (type === "higher") {
      return valid.reduce((best, curr) => ((curr.value as number) > (best.value as number) ? curr : best)).idx;
    }
    if (type === "target" && typeof target === "number") {
      return valid.reduce(
        (best, curr) =>
          Math.abs((curr.value as number) - target) < Math.abs((best.value as number) - target) ? curr : best
      ).idx;
    }
    return valid.reduce((best, curr) => ((curr.value as number) < (best.value as number) ? curr : best)).idx;
  };

  const metricRows = metricConfigs.map((config) => {
    const values = compareModels.map((model) => config.getValue(model));
    const bestIndex = getBestIndex(values, config.type, config.target);
    return { ...config, values, bestIndex };
  });

  const comparisonChartData = useMemo(
    () =>
      compareModels.map((m) => ({
        model: m.name,
        mae: m.metrics.mae,
        rmse: m.metrics.rmse,
        r2: m.metrics.r2,
      })),
    [compareModels]
  );

  const predictionSeries = useMemo(() => {
    if (!predictions) return [];
    return predictions.index.map((label, idx) => ({
      label,
      y_true: predictions.y_true[idx],
      y_pred: predictions.y_pred[idx],
      residual: predictions.residuals[idx],
    }));
  }, [predictions]);

  const tornadoData = useMemo(() => {
    if (!summary) return [];
    return summary.coefficients
      .filter((c): c is Coefficient & { beta_std: number } => c.beta_std != null && Number.isFinite(c.beta_std))
      .map((c) => ({ name: c.display_name ?? c.name, value: c.beta_std }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  }, [summary]);

  const tornadoHeight = Math.min(420, Math.max(160, tornadoData.length * 34 + 24));

  const yVarOrFallback = yVar || "Y";
  const showEmptyDatasets = !initializing && datasets.length === 0;

  // Shared between the page-level Resumen (always the Hero) and the Builder tab (whichever
  // model is being edited) — same fit-quality read regardless of which model it's showing.
  const renderQualityStats = (model: Model) => {
    const modelVifMax = model.metrics.vif.length ? Math.max(...model.metrics.vif.map((v) => v.vif)) : null;
    const modelR2Quality = quality(model.metrics.r2, 0.7, true);
    const modelVifQuality = quality(modelVifMax, 5, false);
    const modelDwQuality = durbinWatsonQuality(model.metrics.durbin_watson);
    const modelYVar = model.y_var || yVarOrFallback;
    return (
      <>
        <StatCard
          label={t("kpis.r2")}
          value={model.metrics.r2.toFixed(3)}
          icon={<InfoTooltip label={t("kpis.r2")} content={t("kpis.r2Tooltip", { yVar: modelYVar })} />}
          trend={
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              {modelR2Quality && (
                <Badge variant={modelR2Quality === "good" ? "success" : "warning"}>{t(`kpis.quality.${modelR2Quality}`)}</Badge>
              )}
              <span className="text-xs tabular-nums text-muted">{t("kpis.adjSuffix", { value: model.metrics.adj_r2.toFixed(3) })}</span>
            </span>
          }
        />
        <StatCard label={t("kpis.mae")} value={formatMetricValue(model.metrics.mae)} />
        <StatCard label={t("kpis.rmse")} value={formatMetricValue(model.metrics.rmse)} />
        <StatCard
          label={t("kpis.vifMax")}
          value={modelVifMax != null ? modelVifMax.toFixed(2) : EMPTY_VALUE}
          icon={<InfoTooltip label={t("kpis.vifMax")} content={t("kpis.vifTooltip")} />}
          trend={modelVifQuality ? <Badge variant={modelVifQuality === "good" ? "success" : "warning"}>{t(`kpis.quality.${modelVifQuality}`)}</Badge> : undefined}
        />
        <StatCard
          label={t("kpis.durbinWatson")}
          value={model.metrics.durbin_watson != null ? model.metrics.durbin_watson.toFixed(3) : EMPTY_VALUE}
          icon={<InfoTooltip label={t("kpis.durbinWatson")} content={t("kpis.durbinWatsonTooltip")} />}
          trend={modelDwQuality ? <Badge variant={modelDwQuality === "good" ? "success" : "warning"}>{t(`kpis.quality.${modelDwQuality}`)}</Badge> : undefined}
        />
      </>
    );
  };

  // Shared between the standalone Coefficients tab (Hero) and the Builder tab's inline quality
  // section (whichever model is being edited) — always the full detail, no toggle (point 5:
  // hiding stats behind a click made the table less useful than just showing it).
  const renderCoefficientsTable = (modelSummary: ModelSummary) => (
    <div className="space-y-2">
      <Table wrapperClassName="max-h-[480px] overflow-auto">
        <TableHeader className="sticky top-0 z-10">
          <TableRow>
            <Th>{t("coefficients.colVariable")}</Th>
            <Th className="text-right">{t("coefficients.colCoef")}</Th>
            <Th className="text-right">{t("coefficients.colStdBeta")}</Th>
            <Th className="text-right">{t("coefficients.colStdErr")}</Th>
            <Th className="text-right">{t("coefficients.colT")}</Th>
            <Th className="text-right">{t("coefficients.colP")}</Th>
            <Th className="text-center">{t("coefficients.colSig")}</Th>
            <Th className="text-right">{t("coefficients.colVif")}</Th>
          </TableRow>
        </TableHeader>
        <tbody>
          {[modelSummary.intercept, ...modelSummary.coefficients].map((item) => (
            <TableRow key={item.name} className="hover:bg-surface-2">
              <TableCell>
                <div className="flex items-center gap-2">
                  <span>{item.name}</span>
                  {item.is_media && <Badge variant="accent">{t("coefficients.mediaBadge")}</Badge>}
                </div>
                {item.is_media && (
                  <div className="text-2xs text-muted">
                    decay {item.decay?.toFixed(2)}
                    {item.half_life != null ? ` (half-life ${item.half_life.toFixed(1)})` : ""} · K{" "}
                    {item.hill_k?.toFixed(2)} · S {item.hill_s?.toFixed(1)}
                    {item.lag ? ` · lag ${item.lag}` : ""}
                  </div>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">{item.coef.toFixed(4)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {item.beta_std != null ? item.beta_std.toFixed(3) : EMPTY_VALUE}
              </TableCell>
              <TableCell className="text-right tabular-nums">{item.std_err.toFixed(4)}</TableCell>
              <TableCell className="text-right tabular-nums">{item.t_value.toFixed(2)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatPValueNumber(item.p_value)}</TableCell>
              <TableCell className="text-center tabular-nums text-muted">{pValueStars(item.p_value)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {item.vif != null ? item.vif.toFixed(2) : EMPTY_VALUE}
              </TableCell>
            </TableRow>
          ))}
        </tbody>
      </Table>
      <p className="text-2xs text-muted">{t("coefficients.significanceLegend")}</p>
    </div>
  );

  const tabItems = [
    {
      id: "builder",
      label: t("tabs.builder"),
      content: (
        <div className="grid gap-6 lg:grid-cols-[360px,1fr]">
          <Card className="space-y-4">
            <CardHeader title={t("builder.predictorsTitle")} subtitle={t("builder.predictorsSubtitle")} />
            <div className="flex flex-wrap gap-2 text-xs">
              <ToggleChip
                active={groupFilter === "all"}
                onClick={() => {
                  setGroupFilter("all");
                  setSubgroupFilter("all");
                }}
              >
                {t("builder.filterAll")}
              </ToggleChip>
              {groupOptions.map((group) => (
                <ToggleChip
                  key={group}
                  active={groupFilter === group}
                  onClick={() => {
                    setGroupFilter(group);
                    setSubgroupFilter("all");
                  }}
                >
                  {group}
                </ToggleChip>
              ))}
            </div>
            {groupFilter !== "all" && subgroupOptions.length > 0 && (
              <div className="flex flex-wrap gap-2 text-2xs text-muted">
                <ToggleChip active={subgroupFilter === "all"} onClick={() => setSubgroupFilter("all")}>
                  {t("builder.subgroupAll")}
                </ToggleChip>
                {subgroupOptions.map((subgroup) => (
                  <ToggleChip key={subgroup} active={subgroupFilter === subgroup} onClick={() => setSubgroupFilter(subgroup)}>
                    {subgroup}
                  </ToggleChip>
                ))}
              </div>
            )}
            <Input
              placeholder={t("builder.searchPlaceholder")}
              aria-label={t("builder.searchPlaceholder")}
              value={corrSearch}
              onChange={(e) => setCorrSearch(e.target.value)}
            />
            <div className="flex items-center justify-between px-1 text-xs text-muted">
              <label className="flex items-center gap-2">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  className="h-4 w-4 accent-accent"
                  checked={allVisibleSelected}
                  onChange={handleToggleSelectAll}
                  disabled={!visibleCorrelations.length}
                />
                <span>{t("builder.selectAllFiltered")}</span>
              </label>
              <button
                type="button"
                className="rounded-full border border-border-control px-2.5 py-1 text-2xs text-muted hover:bg-surface-2"
                onClick={() => setShowQuickView(true)}
              >
                {t("builder.selectedCount", { count: xSelected.length })}
              </button>
            </div>
            <div className="h-[420px] overflow-y-auto pr-2">
              <div className="space-y-2">
                {corrLoading && !corr.length
                  ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)
                  : null}
                {(!corrLoading || corr.length > 0) && visibleCorrelations.map((item) => (
                  <label key={item.name} className="flex items-center justify-between gap-4 text-sm">
                    <div className="min-w-0">
                      <p className="truncate text-ink">{item.name}</p>
                      <p className="text-xs text-muted">
                        {t("builder.yLabel")}: {formatCorr(item.corr_y)}
                        {editingModelId ? (
                          <>
                            {" "}· {t("builder.residualLabel")}: {formatCorr(item.corr_res)}
                          </>
                        ) : null}
                      </p>
                    </div>
                    <input type="checkbox" checked={xSelected.includes(item.name)} onChange={() => handleToggleX(item.name)} />
                  </label>
                ))}
                {!corrLoading && !visibleCorrelations.length && <p className="text-sm text-muted">{t("builder.noMatches")}</p>}
              </div>
            </div>
          </Card>

          <div className="space-y-6">
          <Card className="space-y-4">
            <CardHeader
              title={editingModelId ? t("builder.formTitleEdit") : t("builder.formTitleCreate")}
              subtitle={t("builder.formSubtitle")}
            />
            <FilterField label={t("builder.modelSelectorLabel")} className="max-w-xs">
              <Select
                value={editingModelId ?? NEW_MODEL_VALUE}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === NEW_MODEL_VALUE) {
                    resetForm();
                    return;
                  }
                  const model = models.find((m) => m.id === val);
                  if (model) startEdit(model);
                }}
              >
                <option value={NEW_MODEL_VALUE}>{t("builder.newModelOption")}</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </FilterField>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Eyebrow htmlFor="modeling-model-name">{t("builder.modelNameLabel")}</Eyebrow>
                <Input
                  id="modeling-model-name"
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  placeholder={t("builder.modelNamePlaceholder")}
                />
              </div>
              <div className="space-y-2">
                <Eyebrow>{t("builder.predictorsSelectedLabel")}</Eyebrow>
                <p className="text-sm text-muted">
                  {xSelected.length ? t("builder.selectedCount", { count: xSelected.length }) : t("builder.predictorsNone")}
                </p>
              </div>
            </div>
            <SelectedPredictorsQuickView
              predictors={xSelected}
              onRemove={(name) => setXSelected((prev) => prev.filter((p) => p !== name))}
              onClear={() => setXSelected([])}
              title={t("quickView.title")}
              countLabel={(count) => t("quickView.count", { count })}
              clearLabel={t("quickView.clear")}
              removeLabel={(name) => t("quickView.remove", { name })}
              emptyLabel={t("quickView.empty")}
            />
            <label className="flex items-center gap-2 text-sm text-ink" title={t("builder.mediaTransformTooltip")}>
              <input
                type="checkbox"
                checked={applyMediaTransforms}
                onChange={(e) => setApplyMediaTransforms(e.target.checked)}
              />
              {t("builder.mediaTransformLabel")}
            </label>
            <div className="flex gap-2 justify-end">
              {editingModelId && (
                <Button variant="ghost" onClick={resetForm}>
                  {t("builder.cancel")}
                </Button>
              )}
              <Button
                onClick={handleSubmit}
                disabled={!canEdit}
                loading={loading}
                disabledReason={!canEdit ? tCommon("readOnlyTooltip") : undefined}
              >
                {loading ? t("builder.saving") : editingModelId ? t("builder.submitUpdate") : t("builder.submitCreate")}
              </Button>
            </div>
          </Card>

          <Card className="space-y-4">
            <CardHeader title={t("builder.qualityTitle")} subtitle={t("builder.qualitySubtitle")} />
            {editingModel ? (
              <>
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">{renderQualityStats(editingModel)}</div>
                {editSummary ? renderCoefficientsTable(editSummary) : <Skeleton className="h-48" />}
              </>
            ) : (
              <p className="text-sm text-muted">{t("builder.qualityEmptyHint")}</p>
            )}
          </Card>
          </div>
        </div>
      ),
    },
    {
      id: "models",
      label: t("tabs.models"),
      content: (
        <Card className="space-y-4">
          <CardHeader title={t("models.title")} subtitle={t("models.subtitle")} />
          {models.length ? (
            <Table wrapperClassName="max-h-[480px] overflow-auto">
              <TableHeader className="sticky top-0 z-10">
                <TableRow>
                  <Th>{t("models.colName")}</Th>
                  <Th>
                    <span className="inline-flex items-center gap-1">
                      {t("models.colRole")}
                      <InfoTooltip label={t("models.colRole")} content={t("models.roleTooltip")} side="bottom" />
                    </span>
                  </Th>
                  <Th className="text-right">{t("models.colR2")}</Th>
                  <Th className="text-right">{t("models.colAdjR2")}</Th>
                  <Th className="text-right">{t("models.colMae")}</Th>
                  <Th className="text-right">{t("models.colRmse")}</Th>
                  <Th>{t("models.colActions")}</Th>
                </TableRow>
              </TableHeader>
              <tbody>
                {models.map((m) => (
                  <TableRow key={m.id} className="hover:bg-surface-2">
                    <TableCell>
                      <span className="font-medium">{m.name}</span>
                      {!m.apply_media_transforms && (
                        <span className="ml-2 text-3xs uppercase text-muted" title={t("models.noTransformTooltip")}>
                          {t("models.noTransformBadge")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={m.role === "hero" ? "accent" : "neutral"}>
                        {m.role === "none" ? t("models.roleNone") : ROLE_LABEL[m.role] || m.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{m.metrics.r2.toFixed(3)}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.metrics.adj_r2.toFixed(3)}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.metrics.mae.toFixed(2)}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.metrics.rmse.toFixed(2)}</TableCell>
                    <TableCell>
                      <RowActions>
                        <IconButton size="sm" aria-label={t("models.actionEdit")} onClick={() => startEdit(m)}>
                          <Pencil className="h-4 w-4" />
                        </IconButton>
                        <Dropdown
                          align="right"
                          triggerAriaLabel={t("models.actionMore")}
                          trigger={
                            <span className="inline-flex h-control-sm w-control-sm items-center justify-center rounded-full border border-border-control transition duration-150 hover:bg-accent-bg">
                              <MoreVertical className="h-4 w-4" />
                            </span>
                          }
                        >
                          {m.role !== "hero" && (
                            <DropdownItem
                              onClick={() => setRole(m, "hero")}
                              disabled={!canEdit}
                              disabledReason={!canEdit ? tCommon("readOnlyTooltip") : undefined}
                            >
                              {t("models.setHero")}
                            </DropdownItem>
                          )}
                          {m.role !== "challenger1" && (
                            <DropdownItem
                              onClick={() => setRole(m, "challenger1")}
                              disabled={!canEdit}
                              disabledReason={!canEdit ? tCommon("readOnlyTooltip") : undefined}
                            >
                              {t("models.setChallenger1")}
                            </DropdownItem>
                          )}
                          {m.role !== "challenger2" && (
                            <DropdownItem
                              onClick={() => setRole(m, "challenger2")}
                              disabled={!canEdit}
                              disabledReason={!canEdit ? tCommon("readOnlyTooltip") : undefined}
                            >
                              {t("models.setChallenger2")}
                            </DropdownItem>
                          )}
                          <DropdownItem
                            onClick={() => handleDuplicateModel(m)}
                            disabled={!canEdit || duplicateLoadingId === m.id}
                            disabledReason={!canEdit ? tCommon("readOnlyTooltip") : undefined}
                          >
                            {duplicateLoadingId === m.id ? t("models.actionDuplicating") : t("models.actionDuplicate")}
                          </DropdownItem>
                          <DropdownItem
                            onClick={() => handleBestModel(m)}
                            disabled={!canEdit || bestLoadingId === m.id}
                            disabledReason={!canEdit ? tCommon("readOnlyTooltip") : undefined}
                          >
                            {bestLoadingId === m.id ? t("models.actionBestRunning") : t("models.actionBest")}
                          </DropdownItem>
                          <DropdownItem
                            onClick={() => openDeleteModal(m)}
                            disabled={!canEdit}
                            disabledReason={!canEdit ? tCommon("readOnlyTooltip") : undefined}
                            className="text-bad"
                          >
                            {t("models.actionDelete")}
                          </DropdownItem>
                        </Dropdown>
                      </RowActions>
                    </TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState
              title={t("models.empty.title")}
              description={t("models.empty.description")}
              action={<Button onClick={openBuilder}>{t("models.empty.cta")}</Button>}
            />
          )}
        </Card>
      ),
    },
    {
      id: "comparison",
      label: t("tabs.comparison"),
      content: (
        <Card className="space-y-4">
          <CardHeader title={t("comparison.title")} subtitle={t("comparison.subtitle")} />
          {compareModels.length ? (
            <>
              <Table wrapperClassName="overflow-auto">
                <TableHeader>
                  <TableRow>
                    <Th>{t("comparison.metricLabel")}</Th>
                    {compareModels.map((m, idx) => (
                      <Th key={m.id} className={`text-center${idx === heroComparisonIndex ? " bg-surface-2" : ""}`}>
                        <div className="flex flex-col items-center gap-1 py-1 text-2xs font-medium normal-case tracking-normal text-ink">
                          <span className="text-sm">{m.name}</span>
                          {m.role === "hero" && <Badge variant="accent">Hero</Badge>}
                        </div>
                      </Th>
                    ))}
                  </TableRow>
                </TableHeader>
                <tbody>
                  {metricRows.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell className="text-xs font-medium text-muted">{row.label}</TableCell>
                      {row.values.map((value, idx) => {
                        const isBest = row.bestIndex != null && idx === row.bestIndex;
                        const isHero = idx === heroComparisonIndex;
                        const displayValue = row.format ? row.format(value) : formatMetricValue(value);
                        return (
                          <TableCell
                            key={`${row.key}-${idx}`}
                            className={`text-center tabular-nums${isHero ? " bg-surface-2" : ""}${
                              isBest ? " rounded-md bg-good-bg font-semibold text-good" : ""
                            }`}
                          >
                            <span className="inline-flex items-center gap-1">
                              <span>{displayValue}</span>
                              {isBest && <Badge variant="success">{t("comparison.best")}</Badge>}
                            </span>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </tbody>
              </Table>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="mb-2 text-2xs font-medium uppercase tracking-wide text-muted">{t("comparison.errorChartTitle")}</p>
                  <div className="h-chart-sm">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        accessibilityLayer
                        data={comparisonChartData}
                        margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke={lineColor} />
                        <XAxis dataKey="model" tick={{ fill: mutedColor, fontSize: 11 }} axisLine={{ stroke: lineColor }} />
                        <YAxis
                          tick={{ fill: mutedColor, fontSize: 11 }}
                          axisLine={{ stroke: lineColor }}
                          tickFormatter={(value) => formatChartNumber(Number(value), 2)}
                        />
                        <Tooltip
                          formatter={(value: number) => formatChartNumber(value, 3)}
                          contentStyle={{ background: surfaceColor, borderColor: lineColor, fontSize: 12 }}
                        />
                        <Legend
                          wrapperStyle={{ fontSize: 12, color: mutedColor, cursor: "pointer" }}
                          formatter={(value: string, entry: any) => (
                            <span style={{ opacity: hiddenComparisonKeys.includes(entry.dataKey) ? 0.4 : 1 }}>{value}</span>
                          )}
                          onClick={(entry: any) => toggleComparisonKey(entry.dataKey)}
                        />
                        <Bar
                          dataKey="mae"
                          name={t("comparison.metrics.mae")}
                          radius={[6, 6, 0, 0]}
                          fill={chartColor(1, isDarkTheme)}
                          hide={hiddenComparisonKeys.includes("mae")}
                        />
                        <Bar
                          dataKey="rmse"
                          name={t("comparison.metrics.rmse")}
                          radius={[6, 6, 0, 0]}
                          fill={chartColor(2, isDarkTheme)}
                          hide={hiddenComparisonKeys.includes("rmse")}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-2xs font-medium uppercase tracking-wide text-muted">{t("comparison.r2ChartTitle")}</p>
                  <div className="h-chart-sm">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        accessibilityLayer
                        data={comparisonChartData}
                        margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke={lineColor} />
                        <XAxis dataKey="model" tick={{ fill: mutedColor, fontSize: 11 }} axisLine={{ stroke: lineColor }} />
                        <YAxis
                          domain={[0, 1]}
                          tick={{ fill: mutedColor, fontSize: 11 }}
                          axisLine={{ stroke: lineColor }}
                          tickFormatter={(value) => formatChartNumber(Number(value), 2)}
                        />
                        <ReferenceLine
                          y={0.7}
                          stroke={chartColor(7, isDarkTheme)}
                          strokeDasharray="4 4"
                          label={{ value: t("kpis.quality.good"), fontSize: 10, position: "insideTopRight", fill: mutedColor }}
                        />
                        <Tooltip
                          formatter={(value: number) => formatChartNumber(value, 3)}
                          contentStyle={{ background: surfaceColor, borderColor: lineColor, fontSize: 12 }}
                        />
                        <Bar dataKey="r2" name="R²" radius={[6, 6, 0, 0]} fill={chartColor(0, isDarkTheme)} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <EmptyState title={t("comparison.empty")} />
          )}
        </Card>
      ),
    },
    {
      id: "diagnostics",
      label: t("tabs.diagnostics"),
      content: (
        <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardHeader title={t("diagnostics.title")} subtitle={t("diagnostics.subtitle")} />
            <div className="flex gap-1">
              <ToggleChip active={!showResiduals} onClick={() => setShowResiduals(false)}>
                {t("diagnostics.viewActual")}
              </ToggleChip>
              <ToggleChip active={showResiduals} onClick={() => setShowResiduals(true)}>
                {t("diagnostics.viewResiduals")}
              </ToggleChip>
            </div>
          </div>
          {predictionSeries.length ? (
            <div className="h-chart-lg">
              <ResponsiveContainer width="100%" height="100%">
                {showResiduals ? (
                  <BarChart accessibilityLayer data={predictionSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke={lineColor} />
                    <XAxis
                      dataKey="label"
                      tickFormatter={(value) => formatTimeLabel(String(value), true)}
                      minTickGap={12}
                      height={40}
                      tick={{ fill: mutedColor, fontSize: 11 }}
                      axisLine={{ stroke: lineColor }}
                    />
                    <YAxis
                      tickFormatter={(value) => formatChartNumber(Number(value))}
                      tick={{ fill: mutedColor, fontSize: 11 }}
                      axisLine={{ stroke: lineColor }}
                    />
                    <ReferenceLine y={0} stroke={lineColor} />
                    <Tooltip
                      labelFormatter={(value) => formatTimeLabel(String(value), true)}
                      formatter={(value: number) => [value.toFixed(4), t("diagnostics.seriesResidual")]}
                      contentStyle={{ background: surfaceColor, borderColor: lineColor, fontSize: 12 }}
                    />
                    <Bar dataKey="residual" name={t("diagnostics.seriesResidual")}>
                      {predictionSeries.map((entry, idx) => (
                        <Cell key={idx} fill={entry.residual >= 0 ? chartColor(0, isDarkTheme) : chartColor(1, isDarkTheme)} />
                      ))}
                    </Bar>
                  </BarChart>
                ) : (
                  <LineChart accessibilityLayer data={predictionSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke={lineColor} />
                    <XAxis
                      dataKey="label"
                      tickFormatter={(value) => formatTimeLabel(String(value), true)}
                      minTickGap={12}
                      height={40}
                      tick={{ fill: mutedColor, fontSize: 11 }}
                      axisLine={{ stroke: lineColor }}
                    />
                    <YAxis
                      tickFormatter={(value) => formatChartNumber(Number(value))}
                      tick={{ fill: mutedColor, fontSize: 11 }}
                      axisLine={{ stroke: lineColor }}
                    />
                    <Tooltip
                      labelFormatter={(value) => formatTimeLabel(String(value), true)}
                      formatter={(value: number, name) => [value.toFixed(4), name]}
                      contentStyle={{ background: surfaceColor, borderColor: lineColor, fontSize: 12 }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: 12, color: mutedColor, cursor: "pointer" }}
                      formatter={(value: string, entry: any) => (
                        <span style={{ opacity: hiddenDiagnosticsKeys.includes(entry.dataKey) ? 0.4 : 1 }}>{value}</span>
                      )}
                      onClick={(entry: any) => toggleDiagnosticsKey(entry.dataKey)}
                    />
                    <Line
                      type="monotone"
                      dataKey="y_true"
                      stroke={chartColor(0, isDarkTheme)}
                      dot={false}
                      name={t("diagnostics.seriesActual")}
                      hide={hiddenDiagnosticsKeys.includes("y_true")}
                    />
                    <Line
                      type="monotone"
                      dataKey="y_pred"
                      stroke={chartColor(2, isDarkTheme)}
                      dot={false}
                      name={t("diagnostics.seriesModel")}
                      hide={hiddenDiagnosticsKeys.includes("y_pred")}
                    />
                  </LineChart>
                )}
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title={t("diagnostics.empty")} />
          )}
        </Card>
      ),
    },
    {
      id: "coefficients",
      label: t("tabs.coefficients"),
      content: (
        <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardHeader title={t("coefficients.title")} subtitle={t("coefficients.subtitle")} />
            <Button
              variant="ghost"
              onClick={() => heroModel && downloadModelSummary(heroModel.id)}
              disabled={!summary || !heroModel}
            >
              {t("coefficients.export")}
            </Button>
          </div>
          {summary ? renderCoefficientsTable(summary) : <EmptyState title={t("coefficients.empty")} />}
        </Card>
      ),
    },
  ];

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
                  resetForm();
                }}
              >
                {datasets.map((ds) => (
                  <option key={ds.id} value={ds.id}>
                    {ds.display_name}
                  </option>
                ))}
              </Select>
            </FilterField>
            <FilterField label={t("filters.dependentVariable")} className="w-[260px]">
              <Select value={yVar} onChange={(e) => setYVar(e.target.value)}>
                <option value="">{t("filters.dependentVariablePlaceholder")}</option>
                {variables.map((v) => (
                  <option key={v.id} value={v.name}>
                    {v.name}
                  </option>
                ))}
              </Select>
            </FilterField>
          </FilterBar>

          {/* Resumen: siempre visible — la vitrina del hero model. */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5" aria-busy={modelsLoading} aria-live="polite">
            {modelsLoading ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[104px]" />)
            ) : heroModel ? (
              renderQualityStats(heroModel)
            ) : (
              <div className="sm:col-span-2 lg:col-span-4">
                <Card>
                  <EmptyState
                    title={t("kpis.noHero.title")}
                    description={t("kpis.noHero.description")}
                    action={<Button onClick={openBuilder}>{t("kpis.noHero.cta")}</Button>}
                  />
                </Card>
              </div>
            )}
          </div>

          {heroModel && (
            <Card className="space-y-3">
              <CardHeader as="h2" title={t("tornado.title")} subtitle={t("tornado.subtitle", { yVar: yVarOrFallback })} />
              {tornadoData.length ? (
                <>
                  <div style={{ height: tornadoHeight }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        accessibilityLayer
                        data={tornadoData}
                        layout="vertical"
                        margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke={lineColor} horizontal={false} />
                        <XAxis
                          type="number"
                          tick={{ fill: mutedColor, fontSize: 11 }}
                          axisLine={{ stroke: lineColor }}
                          tickFormatter={(value) => formatChartNumber(Number(value), 2)}
                        />
                        <YAxis
                          type="category"
                          dataKey="name"
                          width={140}
                          tick={{ fill: mutedColor, fontSize: 11 }}
                          axisLine={{ stroke: lineColor }}
                          tickFormatter={(value: string) => (value.length > 18 ? `${value.slice(0, 17)}…` : value)}
                        />
                        <ReferenceLine x={0} stroke={lineColor} />
                        <Tooltip
                          formatter={(value: number) => formatChartNumber(value, 3)}
                          labelFormatter={(value) => String(value)}
                          contentStyle={{ background: surfaceColor, borderColor: lineColor, fontSize: 12 }}
                        />
                        <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive animationDuration={400}>
                          {tornadoData.map((entry, idx) => (
                            <Cell key={idx} fill={entry.value >= 0 ? chartColor(0, isDarkTheme) : chartColor(1, isDarkTheme)} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex items-center gap-4 text-2xs text-muted">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: chartColor(0, isDarkTheme) }} aria-hidden />
                      {t("tornado.positive")}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: chartColor(1, isDarkTheme) }} aria-hidden />
                      {t("tornado.negative")}
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted">{t("tornado.empty")}</p>
              )}
            </Card>
          )}

          {/* Detalle: constructor, lista de modelos, comparación y diagnóstico — oculto hasta que se pide. */}
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

      <Modal open={showQuickView} onClose={() => setShowQuickView(false)} title={t("quickView.title")}>
        <p className="mb-3 text-xs text-muted">{t("quickView.count", { count: xSelected.length })}</p>
        <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
          {selectedDetails.length ? (
            selectedDetails.map((item) => (
              <div key={item.name} className="flex items-center justify-between rounded-xl border border-line px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{item.name}</p>
                  <p className="text-xs text-muted">
                    {t("builder.yLabel")}: {formatCorr(item.corr_y)}
                    {editingModelId ? (
                      <>
                        {" "}· {t("builder.residualLabel")}: {formatCorr(item.corr_res)}
                      </>
                    ) : null}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={t("quickView.remove", { name: item.name })}
                  className="rounded-full border border-border-control px-2 py-0.5 text-xs text-muted hover:bg-surface-2"
                  onClick={() => handleToggleX(item.name)}
                >
                  ×
                </button>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted">{t("quickView.empty")}</p>
          )}
        </div>
      </Modal>

      <Modal open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title={t("models.confirmDelete.title")}>
        <p className="text-sm text-ink">{t("models.confirmDelete.body", { name: deleteTarget?.name || "" })}</p>
        {deleteScenarioCount != null && deleteScenarioCount > 0 && (
          <div className="mt-3 rounded-lg border border-bad/50 bg-bad-bg p-3 text-sm text-bad">
            {t("models.confirmDelete.scenarioWarning", { count: deleteScenarioCount })}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleteLoading}>
            {tCommon("cancel")}
          </Button>
          <Button variant="danger" onClick={confirmDeleteModel} disabled={deleteLoading}>
            {t("models.confirmDelete.confirm")}
          </Button>
        </div>
      </Modal>
    </section>
  );
}
