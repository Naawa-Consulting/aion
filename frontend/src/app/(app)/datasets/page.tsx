"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Upload, FolderOpen, Trash2, Pencil, Star, Database } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { ErrorText } from "@/components/ui/error-text";
import { Eyebrow } from "@/components/ui/eyebrow";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Disclosure } from "@/components/ui/disclosure";
import { Tabs } from "@/components/ui/tabs";
import { Table, TableHeader, TableRow, Th, TableCell } from "@/components/ui/table";
import { RowActions } from "@/components/ui/row-actions";
import { useGlobalStore } from "@/lib/store";
import { formatDate, formatNumber } from "@/lib/format";
import { useKeyboardShortcut } from "@/hooks/useKeyboardShortcut";
import { useCanEdit } from "@/hooks/useCanEdit";
import { apiFetch, ApiError, getAuthHeaders, API_URL } from "@/lib/api";
import { translateApiError } from "@/lib/error-messages";

type Dataset = {
  id: string;
  display_name: string;
  file_name: string;
  n_rows: number;
  total_rows?: number;
  n_cols: number;
  sample_size?: number | null;
  time_variable?: string | null;
  time_format?: string | null;
  time_timezone?: string | null;
  dependent_variable?: string | null;
  version?: number;
  previous_version_id?: string | null;
  created_at: string;
  last_used_at: string;
  columns: { name: string; dtype: string }[];
  dependencies: { variables: number; models: number; scenarios: number };
};

type TimeCandidate = { name: string; dtype: string; parseable: boolean };
type TimeCandidateResponse = {
  candidates: TimeCandidate[];
  current?: { name?: string | null; time_format?: string | null; time_timezone?: string | null } | null;
};

type Preview = {
  columns: string[];
  rows: Record<string, unknown>[];
};

type Differences = { added: string[]; removed: string[]; dtype_mismatch: string[] };

type VersionInfo = { version: number; created_at: string };

type VariableFlag = { id: string; name: string; is_excluded: boolean };

type DatasetSummary = {
  name: string;
  version: number;
  created: string;
  last_used: string;
  file_type: string;
  n_rows: number;
  sample_size?: number | null;
  n_columns: number;
  columns: {
    name: string;
    dtype: string;
    missing_pct: number;
    unique: number;
    min?: number | null;
    max?: number | null;
    samples: string[];
  }[];
};

export default function DatasetsPage() {
  const t = useTranslations("datasets");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const readOnlyTitle = tCommon("readOnlyTooltip");
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [renameState, setRenameState] = useState<{ open: boolean; dataset?: Dataset; value: string }>(
    { open: false, value: "" }
  );
  const [deleteState, setDeleteState] = useState<{ open: boolean; dataset?: Dataset; cascade: boolean }>(
    { open: false, cascade: true }
  );
  const { datasetId, setDatasetId, activeCompanyId } = useGlobalStore();
  const canEdit = useCanEdit();
  const [sampleMode, setSampleMode] = useState<"all" | "custom">("all");
  const [customSample, setCustomSample] = useState<number>(0);
  const [sampleUpdating, setSampleUpdating] = useState(false);
  const [sampleConfirmOpen, setSampleConfirmOpen] = useState(false);
  const [timeCandidates, setTimeCandidates] = useState<TimeCandidate[]>([]);
  const [timeCandidatesLoading, setTimeCandidatesLoading] = useState(false);
  const [timeColumn, setTimeColumn] = useState("");
  const [timeCoerce, setTimeCoerce] = useState(false);
  const [timeFormat, setTimeFormat] = useState("");
  const [timeTimezone, setTimeTimezone] = useState("");
  const [timeSaving, setTimeSaving] = useState(false);
  const [updateState, setUpdateState] = useState<{
    open: boolean;
    dataset?: Dataset;
    strategy: "strict" | "force";
    file?: File | null;
    uploading: boolean;
    error?: string | null;
    differences?: Differences | null;
  }>({
    open: false,
    strategy: "strict",
    uploading: false,
  });
  const [versionHistory, setVersionHistory] = useState<{
    open: boolean;
    dataset?: Dataset;
    loading: boolean;
    items: VersionInfo[];
  }>({ open: false, loading: false, items: [] });
  const [summaryState, setSummaryState] = useState<{
    open: boolean;
    loading: boolean;
    data?: DatasetSummary;
  }>({ open: false, loading: false });
  const [summaryVariables, setSummaryVariables] = useState<VariableFlag[]>([]);
  const [togglingVariableId, setTogglingVariableId] = useState<string | null>(null);
  const [dependentVariable, setDependentVariable] = useState("");
  const [dependentVariableSaving, setDependentVariableSaving] = useState(false);

  const dismissUpdateModal = useCallback(() => {
    setUpdateState({ open: false, strategy: "strict", uploading: false });
  }, []);

  const closeVersionHistory = useCallback(() => {
    setVersionHistory({ open: false, loading: false, items: [] });
  }, []);

  const closeSummary = useCallback(() => {
    setSummaryState({ open: false, loading: false, data: undefined });
    setSummaryVariables([]);
  }, []);

  const fetchDatasets = useCallback(async () => {
    try {
      const data = await apiFetch<Dataset[]>("/datasets");
      setDatasets(data);
      // Only reassign when the current selection (persisted from a previous session, or a
      // stale id whose dataset was deleted) isn't in the fresh list — never override an
      // active, still-valid selection with "most recently created" on every fetch.
      if (data.length && !data.some((ds) => ds.id === datasetId)) {
        setDatasetId(data[0].id);
      }
    } catch (err) {
      toast.error((err as Error)?.message || t("toasts.loadFailed"));
    }
  }, [datasetId, setDatasetId, t]);

  useEffect(() => {
    // activeCompanyId hydrates asynchronously (AuthBootstrap fetches /me/memberships and
    // auto-selects the first company) — fetching before it's set sends no X-Company-Id
    // header and the backend 422s. Wait for it, then re-fetch once it's ready.
    if (!activeCompanyId) return;
    fetchDatasets();
  }, [fetchDatasets, activeCompanyId]);

  const loadPreview = useCallback(
    async (id: string) => {
      setLoadingPreview(true);
      try {
        const data = await apiFetch<Preview>(`/datasets/${id}/preview?rows=20`);
        setPreview(data);
      } catch (error) {
        console.error(error);
        toast.error(t("toasts.previewFailed"));
        setPreview(null);
      } finally {
        setLoadingPreview(false);
      }
    },
    [t]
  );

  const fetchTimeCandidates = useCallback(
    async (id: string) => {
      setTimeCandidatesLoading(true);
      try {
        const data = await apiFetch<TimeCandidateResponse>(`/datasets/${id}/time_candidates`);
        setTimeCandidates(data.candidates || []);
        if (data.current?.name) {
          setTimeColumn(data.current.name);
          setTimeFormat(data.current.time_format ?? "");
          setTimeTimezone(data.current.time_timezone ?? "");
          setTimeCoerce(false);
        }
      } catch (error) {
        console.error(error);
        setTimeCandidates([]);
      } finally {
        setTimeCandidatesLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (datasetId) {
      loadPreview(datasetId);
      fetchTimeCandidates(datasetId);
    }
  }, [datasetId, loadPreview, fetchTimeCandidates]);

  const fetchVersionHistory = useCallback(
    async (dataset: Dataset) => {
      setVersionHistory({ open: true, dataset, loading: true, items: [] });
      try {
        const data = await apiFetch<{ versions?: VersionInfo[] }>(`/datasets/${dataset.id}/versions`);
        setVersionHistory({ open: true, dataset, loading: false, items: data.versions || [] });
      } catch (error: any) {
        console.error(error);
        toast.error(error?.message || t("toasts.versionsFailed"));
        setVersionHistory({ open: false, dataset: undefined, loading: false, items: [] });
      }
    },
    [t]
  );

  const fetchDatasetSummary = useCallback(
    async (dataset: Dataset) => {
      setSummaryState({ open: true, loading: true });
      try {
        const [data, variables] = await Promise.all([
          apiFetch<DatasetSummary>(`/datasets/${dataset.id}/summary`),
          apiFetch<VariableFlag[]>(`/variables?dataset_id=${dataset.id}&include_excluded=true`),
        ]);
        setSummaryState({ open: true, loading: false, data });
        setSummaryVariables(variables);
      } catch (error: any) {
        console.error(error);
        toast.error(error?.message || t("toasts.summaryFailed"));
        setSummaryState({ open: false, loading: false });
      }
    },
    [t]
  );

  const handleToggleExcluded = useCallback(
    async (variable: VariableFlag) => {
      const next = !variable.is_excluded;
      setTogglingVariableId(variable.id);
      setSummaryVariables((prev) =>
        prev.map((v) => (v.id === variable.id ? { ...v, is_excluded: next } : v))
      );
      try {
        await apiFetch(`/variables/${variable.id}/categorization`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_excluded: next }),
        });
      } catch (error: any) {
        console.error(error);
        toast.error(error?.message || t("toasts.variableUpdateFailed"));
        setSummaryVariables((prev) =>
          prev.map((v) => (v.id === variable.id ? { ...v, is_excluded: !next } : v))
        );
      } finally {
        setTogglingVariableId(null);
      }
    },
    [t]
  );

  const currentDataset = useMemo(
    () => datasets.find((ds) => ds.id === datasetId) || null,
    [datasets, datasetId]
  );

  useEffect(() => {
    if (!currentDataset) return;
    const total = currentDataset.total_rows ?? currentDataset.n_rows ?? 0;
    const nextMode = currentDataset.sample_size ? "custom" : "all";
    setSampleMode(nextMode);
    const fallback = currentDataset.sample_size ?? (total || 10);
    setCustomSample(fallback);
    setTimeColumn(currentDataset.time_variable ?? "");
    setTimeFormat(currentDataset.time_format ?? "");
    setTimeTimezone(currentDataset.time_timezone ?? "");
    setTimeCoerce(!currentDataset.time_variable);
    setDependentVariable(currentDataset.dependent_variable ?? "");
  }, [currentDataset]);

  const totalRows = currentDataset?.total_rows ?? currentDataset?.n_rows ?? 0;
  const activeRows = currentDataset ? currentDataset.sample_size ?? totalRows : 0;
  const sampleMin = currentDataset ? (totalRows >= 10 ? 10 : totalRows || 10) : 10;
  const safeCustomSample = Number.isFinite(customSample) ? customSample : 0;
  const pendingSample = sampleMode === "all" ? null : safeCustomSample;
  const currentSample = currentDataset?.sample_size ?? null;
  const sampleInvalid =
    sampleMode === "custom" &&
    !!currentDataset &&
    (
      totalRows
        ? safeCustomSample < sampleMin || safeCustomSample > totalRows
        : safeCustomSample > 0
    );
  const canApplySample = Boolean(
    currentDataset && !sampleInvalid && (currentSample ?? null) !== (pendingSample ?? null)
  );
  const pendingSampleLabel =
    pendingSample === null ? t("sample.allRowsLabel") : t("sample.rowsLabel", { count: formatNumber(pendingSample, 0) });

  const timePreviewValues = useMemo(() => {
    if (!preview || !timeColumn) return [];
    return preview.rows
      .map((row) => row[timeColumn])
      .filter((value) => value !== undefined && value !== null)
      .slice(0, 3)
      .map((value) => String(value));
  }, [preview, timeColumn]);

  const requestApplySample = useCallback(() => {
    if (!currentDataset || !canApplySample) return;
    if (sampleMode === "custom" && sampleInvalid) {
      toast.error(t("sample.invalidRangeToast"));
      return;
    }
    setSampleConfirmOpen(true);
  }, [currentDataset, canApplySample, sampleMode, sampleInvalid, t]);

  const handleApplySample = useCallback(async () => {
    if (!currentDataset || !canApplySample) return;
    const target = sampleMode === "all" ? null : Math.round(safeCustomSample);
    setSampleConfirmOpen(false);
    setSampleUpdating(true);
    try {
      const updated = await apiFetch<Dataset>(`/datasets/${currentDataset.id}/sample_size`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sample_size: target }),
      });
      setDatasets((prev) => prev.map((ds) => (ds.id === updated.id ? updated : ds)));
      toast.success(
        t("toasts.sampleApplied", {
          rows: formatNumber(updated.sample_size ?? updated.total_rows ?? updated.n_rows, 0),
        })
      );
      await fetchDatasets();
      if (datasetId === updated.id) {
        loadPreview(updated.id);
      }
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || t("toasts.sampleFailed"));
    } finally {
      setTimeout(() => setSampleUpdating(false), 300);
    }
  }, [
    currentDataset,
    sampleMode,
    safeCustomSample,
    canApplySample,
    datasetId,
    fetchDatasets,
    loadPreview,
    t,
  ]);

  const handleSaveTimeVariable = useCallback(async () => {
    if (!currentDataset) return;
    setTimeSaving(true);
    try {
      const updated = await apiFetch<Dataset>(`/datasets/${currentDataset.id}/time_variable`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          column: timeColumn || null,
          coerce: timeCoerce,
          time_format: timeFormat || null,
          timezone: timeTimezone || null,
        }),
      });
      setDatasets((prev) => prev.map((ds) => (ds.id === updated.id ? updated : ds)));
      toast.success(t("toasts.timeSaved"));
      fetchTimeCandidates(updated.id);
    } catch (error: any) {
      console.error(error);
      const detail = error instanceof ApiError ? error.detail : null;
      if (detail?.samples) {
        toast.error(`${translateApiError(error, tErrors)}: ${detail.samples.map((s: any) => s.value).join(", ")}`);
      } else {
        toast.error(translateApiError(error, tErrors) || t("toasts.timeSaveFailed"));
      }
    } finally {
      setTimeSaving(false);
    }
  }, [currentDataset, timeColumn, timeCoerce, timeFormat, timeTimezone, fetchTimeCandidates, t, tErrors]);

  const handleClearTimeVariable = useCallback(async () => {
    if (!currentDataset) return;
    setTimeSaving(true);
    try {
      const updated = await apiFetch<Dataset>(`/datasets/${currentDataset.id}/time_variable`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ column: null }),
      });
      setDatasets((prev) => prev.map((ds) => (ds.id === updated.id ? updated : ds)));
      setTimeColumn("");
      setTimeFormat("");
      setTimeTimezone("");
      setTimeCoerce(false);
      toast.success(t("toasts.timeCleared"));
      fetchTimeCandidates(updated.id);
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || t("toasts.timeClearFailed"));
    } finally {
      setTimeSaving(false);
    }
  }, [currentDataset, fetchTimeCandidates, t]);

  const handleChangeDependentVariable = useCallback(
    async (column: string) => {
      if (!currentDataset) return;
      const previous = currentDataset.dependent_variable ?? "";
      setDependentVariable(column);
      setDependentVariableSaving(true);
      try {
        const updated = await apiFetch<Dataset>(`/datasets/${currentDataset.id}/dependent_variable`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ column: column || null }),
        });
        setDatasets((prev) => prev.map((ds) => (ds.id === updated.id ? updated : ds)));
        toast.success(column ? t("toasts.dependentSaved") : t("toasts.dependentCleared"));
      } catch (error: any) {
        console.error(error);
        toast.error(error?.message || t("toasts.dependentFailed"));
        setDependentVariable(previous);
      } finally {
        setDependentVariableSaving(false);
      }
    },
    [currentDataset, t]
  );

  const handleUpdateUpload = useCallback((fileList: FileList | null) => {
    const file = fileList?.[0];
    setUpdateState((state) => ({ ...state, file }));
  }, []);

  const submitDatasetUpdate = useCallback(async () => {
    if (!updateState.dataset || !updateState.file) {
      toast.error(t("toasts.selectFile"));
      return;
    }
    setUpdateState((state) => ({ ...state, uploading: true, error: null, differences: null }));
    try {
      const formData = new FormData();
      formData.append("file", updateState.file);
      formData.append("replace_strategy", updateState.strategy);
      const data = await apiFetch<{ new_version: number }>(`/datasets/${updateState.dataset.id}/update`, {
        method: "POST",
        body: formData,
      });
      toast.success(t("toasts.datasetUpdated", { version: data.new_version }));
      setUpdateState({ open: false, strategy: "strict", uploading: false });
      await fetchDatasets();
      if (datasetId === updateState.dataset.id) {
        loadPreview(updateState.dataset.id);
        fetchTimeCandidates(updateState.dataset.id);
      }
    } catch (error: any) {
      console.error(error);
      const detail = error instanceof ApiError ? error.detail : null;
      if (detail) {
        setUpdateState((state) => ({
          ...state,
          uploading: false,
          error: translateApiError(error, tErrors) || t("toasts.updateFailed"),
          differences: detail?.differences || null,
        }));
      } else {
        toast.error(error?.message || t("toasts.updateFailed"));
        setUpdateState((state) => ({ ...state, uploading: false }));
      }
    }
  }, [updateState, datasetId, fetchDatasets, loadPreview, fetchTimeCandidates, t, tErrors]);

  const uploadFiles = useCallback(
    (files: File[], force = false) =>
      new Promise<void>((resolve, reject) => {
        const form = new FormData();
        files.forEach((file) => form.append("files", file));
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            setUploadProgress(Math.round((event.loaded / event.total) * 100));
          }
        };
        xhr.onload = () => {
          setUploadProgress(0);
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject({ status: xhr.status, detail: safeParseJSON(xhr.responseText) });
          }
        };
        xhr.onerror = () => {
          setUploadProgress(0);
          reject({ status: xhr.status || 500, detail: { message: "Upload failed" } });
        };
        (async () => {
          xhr.open("POST", `${API_URL}/datasets/upload?force=${force}`);
          const headers = await getAuthHeaders();
          Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
          xhr.send(form);
        })();
      }),
    []
  );

  const handleUpload = useCallback(
    async (files: File[], opts: { force?: boolean } = {}) => {
      if (!files.length) return;
      if (!canEdit) {
        toast.error(readOnlyTitle);
        return;
      }
      setUploading(true);
      try {
        await uploadFiles(files, Boolean(opts.force));
        toast.success(t("toasts.uploaded"));
        await fetchDatasets();
      } catch (error: any) {
        if (error?.status === 409) {
          const duplicateName = error.detail?.display_name || t("uploadCard.dropTitle");
          toast.error(t("toasts.duplicateExists", { name: duplicateName }), {
            action: {
              label: t("toasts.uploadAnyway"),
              onClick: () => handleUpload(files, { force: true }),
            },
            description: t("toasts.duplicateDescription"),
          });
          return;
        }
        toast.error(error?.detail?.message || t("toasts.uploadFailed"));
      } finally {
        setUploading(false);
      }
    },
    [fetchDatasets, uploadFiles, canEdit, readOnlyTitle, t]
  );

  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted.length) {
        handleUpload(accepted);
      }
    },
    [handleUpload]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true,
    disabled: !canEdit,
    accept: {
      "text/csv": [".csv"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.ms-excel": [".xls"],
      "application/octet-stream": [".parquet"],
    },
  });

  const handleRename = useCallback(async () => {
    if (!renameState.dataset) return;
    try {
      await apiFetch(`/datasets/${renameState.dataset.id}/rename`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: renameState.value }),
      });
      toast.success(t("toasts.renamed"));
      setRenameState({ open: false, value: "" });
      fetchDatasets();
    } catch (error) {
      console.error(error);
      toast.error(t("toasts.renameFailed"));
    }
  }, [renameState, fetchDatasets, t]);

  useKeyboardShortcut(
    "s",
    (event) => {
      if (renameState.open) {
        event.preventDefault();
        handleRename();
      }
    },
    { ctrl: true }
  );

  const handleDelete = async () => {
    if (!deleteState.dataset) return;
    try {
      await apiFetch(`/datasets/${deleteState.dataset.id}?cascade=${deleteState.cascade}`, {
        method: "DELETE",
      });
      toast.success(t("toasts.deleted"));
      setDeleteState({ open: false, cascade: true });
      if (datasetId === deleteState.dataset.id) {
        setDatasetId(null);
        setPreview(null);
      }
      fetchDatasets();
    } catch (error) {
      console.error(error);
      toast.error(translateApiError(error, tErrors) || t("toasts.deleteFailed"));
    }
  };

  return (
    <section>
      <PageHeader
        title={t("title")}
        subtitle={t("eyebrow")}
        actions={
          <Button
            onClick={() => document.getElementById("dataset-upload-input")?.click()}
            disabled={!canEdit}
            title={!canEdit ? readOnlyTitle : undefined}
          >
            <Upload className="mr-2 h-4 w-4" /> {t("upload")}
          </Button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[360px,1fr]">
        <div className="space-y-6">
          <Card className="space-y-4">
            <CardHeader as="h2" title={t("uploadCard.title")} subtitle={t("uploadCard.subtitle")} />
            <div
              {...getRootProps()}
              className={`rounded-xl border-2 border-dashed p-6 text-center transition ${
                isDragActive ? "border-accent bg-accent-bg" : "border-line-2"
              } ${uploading ? "opacity-60" : ""}`}
            >
              <input {...getInputProps()} id="dataset-upload-input" />
              <p className="font-medium text-md">{t("uploadCard.dropTitle")}</p>
              <p className="text-sm text-muted mt-1">{t("uploadCard.dropSubtitle")}</p>
              <div className="mt-3 flex justify-center gap-2 text-xs">
                <Badge>CSV</Badge>
                <Badge>Excel</Badge>
                <Badge>Parquet</Badge>
              </div>
              {uploading && (
                <div className="mt-4">
                  <Progress value={uploadProgress} />
                  <p className="text-xs text-muted mt-1">{t("uploadCard.uploading", { percent: uploadProgress })}</p>
                </div>
              )}
            </div>
          </Card>

          <Card className="space-y-4">
            <CardHeader as="h2" title={t("listCard.title")} subtitle={t("listCard.subtitle")} />
            <div className="space-y-3 max-h-[480px] overflow-y-auto pr-2">
              {datasets.length === 0 && (
                <EmptyState icon={Database} title={t("listCard.emptyTitle")} description={t("listCard.emptyDescription")} />
              )}
              {datasets.map((ds) => {
                const isActive = datasetId === ds.id;
                return (
                  <div
                    key={ds.id}
                    className={`rounded-xl border p-4 transition cursor-pointer ${
                      isActive ? "border-accent bg-accent-bg" : "border-line"
                    }`}
                    onClick={() => setDatasetId(ds.id)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="font-semibold text-ink">{ds.display_name}</p>
                        <p className="text-xs text-muted">{ds.file_name}</p>
                        <p className="text-xs text-muted">{t("listCard.version", { version: ds.version ?? 1 })}</p>
                      </div>
                      {isActive && <Badge variant="accent">{t("listCard.active")}</Badge>}
                    </div>
                    <dl className="grid grid-cols-2 gap-2 text-xs text-muted">
                      <div>
                        <dt>{t("stats.rows")}</dt>
                        <dd className="text-sm text-ink tabular-nums">{formatNumber(ds.n_rows, 0)}</dd>
                      </div>
                      <div>
                        <dt>{t("stats.columns")}</dt>
                        <dd className="text-sm text-ink tabular-nums">{ds.n_cols}</dd>
                      </div>
                      <div>
                        <dt>{t("stats.created")}</dt>
                        <dd>{formatDate(ds.created_at)}</dd>
                      </div>
                      <div>
                        <dt>{t("stats.lastUsed")}</dt>
                        <dd>{formatDate(ds.last_used_at)}</dd>
                      </div>
                    </dl>
                    <RowActions className="mt-3 flex-wrap gap-x-4 gap-y-2 text-xs">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          setDatasetId(ds.id);
                          loadPreview(ds.id);
                        }}
                      >
                        <FolderOpen className="mr-1 h-3 w-3" /> {t("actions.open")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          setRenameState({ open: true, dataset: ds, value: ds.display_name });
                        }}
                      >
                        <Pencil className="mr-1 h-3 w-3" /> {t("actions.rename")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          setUpdateState({
                            open: true,
                            dataset: ds,
                            strategy: "strict",
                            file: null,
                            uploading: false,
                            error: null,
                            differences: null,
                          });
                        }}
                      >
                        <Upload className="mr-1 h-3 w-3" /> {t("actions.updateFile")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="!text-bad hover:!bg-bad-bg"
                        onClick={(event) => {
                          event.stopPropagation();
                          setDeleteState({ open: true, dataset: ds, cascade: true });
                        }}
                      >
                        <Trash2 className="mr-1 h-3 w-3" /> {t("actions.delete")}
                      </Button>
                      {!isActive && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(event) => {
                            event.stopPropagation();
                            setDatasetId(ds.id);
                            toast.success(t("toasts.setActive", { name: ds.display_name }));
                          }}
                        >
                          <Star className="mr-1 h-3 w-3" /> {t("actions.setActive")}
                        </Button>
                      )}
                    </RowActions>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        <Card className="space-y-4 min-w-0">
          {currentDataset ? (
            <div className="relative space-y-4">
              <div
                className={`absolute inset-0 rounded-xl bg-plane/70 backdrop-blur-sm transition-opacity duration-300 z-10 ${
                  sampleUpdating ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
                }`}
              />
              <CardHeader as="h2" title={currentDataset.display_name} subtitle={currentDataset.file_name} />
              <div className="grid sm:grid-cols-4 gap-3">
                <StatCard size="lg" label={t("stats.rows")} value={formatNumber(totalRows, 0)} />
                <StatCard size="lg" label={t("stats.columns")} value={String(currentDataset.n_cols)} />
                <StatCard size="lg" label={t("stats.created")} value={formatDate(currentDataset.created_at)} />
                <StatCard size="lg" label={t("stats.lastUsed")} value={formatDate(currentDataset.last_used_at)} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                <p>
                  {t("detail.versionSummary", {
                    version: currentDataset.version ?? 1,
                    updated: formatDate(currentDataset.last_used_at),
                    rows: formatNumber(totalRows, 0),
                    columns: currentDataset.n_cols,
                  })}
                </p>
                <RowActions>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => currentDataset && fetchDatasetSummary(currentDataset)}
                  >
                    {t("detail.viewDetails")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => currentDataset && fetchVersionHistory(currentDataset)}
                    disabled={versionHistory.loading && versionHistory.dataset?.id === currentDataset.id}
                  >
                    {t("detail.versionHistory")}
                  </Button>
                </RowActions>
              </div>

              <Disclosure
                as="h3"
                title={t("timeVariable.title")}
                subtitle={
                  currentDataset.time_variable
                    ? t("timeVariable.currentValue", { column: currentDataset.time_variable })
                    : t("timeVariable.description")
                }
                defaultOpen={!currentDataset.time_variable}
                className="rounded-xl border border-line p-4"
              >
                <div className="space-y-3 pt-2">
                  {timeCandidatesLoading && <p className="text-xs text-muted">{t("timeVariable.detecting")}</p>}
                  <Select
                    aria-label={t("timeVariable.title")}
                    value={timeColumn}
                    onChange={(event) => setTimeColumn(event.target.value)}
                  >
                    <option value="">{t("timeVariable.selectPlaceholder")}</option>
                    {timeCandidates.length > 0 && (
                      <optgroup label={t("timeVariable.suggestedGroup")}>
                        {timeCandidates.map((candidate) => (
                          <option key={`candidate-${candidate.name}`} value={candidate.name}>
                            {candidate.name} {candidate.parseable ? "" : ` (${t("timeVariable.needsCoercion")})`}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {currentDataset?.columns && (
                      <optgroup label={t("timeVariable.allColumnsGroup")}>
                        {currentDataset.columns.map((col) => (
                          <option key={`col-${col.name}`} value={col.name}>
                            {col.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </Select>
                  <div className="space-y-2 rounded-lg border border-dashed border-line-2 p-3 text-xs">
                    <label className="flex items-center gap-2 text-sm text-ink">
                      <input type="checkbox" checked={timeCoerce} onChange={(event) => setTimeCoerce(event.target.checked)} />
                      {t("timeVariable.coerceLabel")}
                    </label>
                    <div className="flex flex-wrap gap-3">
                      <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
                        <Eyebrow htmlFor="time-format">{t("timeVariable.customFormatLabel")}</Eyebrow>
                        <Input
                          id="time-format"
                          type="text"
                          placeholder="%Y-%m-%d"
                          value={timeFormat}
                          onChange={(event) => setTimeFormat(event.target.value)}
                        />
                      </div>
                      <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
                        <Eyebrow htmlFor="time-timezone">{t("timeVariable.timezoneLabel")}</Eyebrow>
                        <Input
                          id="time-timezone"
                          type="text"
                          placeholder="UTC"
                          value={timeTimezone}
                          onChange={(event) => setTimeTimezone(event.target.value)}
                        />
                      </div>
                    </div>
                    {timePreviewValues.length > 0 && (
                      <p className="text-muted">{t("timeVariable.sampleValues", { values: timePreviewValues.join(", ") })}</p>
                    )}
                  </div>
                  <RowActions>
                    <Button
                      size="sm"
                      onClick={handleSaveTimeVariable}
                      disabled={!canEdit || !currentDataset || timeSaving}
                      title={!canEdit ? readOnlyTitle : undefined}
                    >
                      {timeSaving ? t("timeVariable.saving") : t("timeVariable.save")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleClearTimeVariable}
                      disabled={!canEdit || !currentDataset?.time_variable || timeSaving}
                      title={!canEdit ? readOnlyTitle : undefined}
                    >
                      {t("timeVariable.clear")}
                    </Button>
                  </RowActions>
                </div>
              </Disclosure>

              <Disclosure
                as="h3"
                title={t("dependentVariable.title")}
                subtitle={
                  currentDataset.dependent_variable
                    ? t("timeVariable.currentValue", { column: currentDataset.dependent_variable })
                    : t("dependentVariable.description")
                }
                defaultOpen={!currentDataset.dependent_variable}
                className="rounded-xl border border-line p-4"
              >
                <div className="space-y-3 pt-2">
                  <Select
                    aria-label={t("dependentVariable.title")}
                    value={dependentVariable}
                    onChange={(event) => handleChangeDependentVariable(event.target.value)}
                    disabled={!canEdit || !currentDataset || dependentVariableSaving}
                  >
                    <option value="">{t("dependentVariable.none")}</option>
                    {currentDataset?.columns.map((col) => (
                      <option key={`dep-${col.name}`} value={col.name}>
                        {col.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </Disclosure>

              <Disclosure
                as="h3"
                title={t("sample.title")}
                subtitle={
                  activeRows === totalRows || !totalRows
                    ? t("sample.currentAll", { total: formatNumber(totalRows, 0) })
                    : t("sample.currentPartial", {
                        active: formatNumber(activeRows, 0),
                        total: formatNumber(totalRows, 0),
                        percent: ((activeRows / totalRows) * 100).toFixed(1),
                      })
                }
                defaultOpen={sampleMode === "custom"}
                className="rounded-xl border border-line p-4"
              >
                <div className="space-y-2 pt-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <Select
                      wrapperClassName="w-auto"
                      aria-label={t("sample.title")}
                      value={sampleMode}
                      onChange={(event) => {
                        const nextMode = event.target.value as "all" | "custom";
                        setSampleMode(nextMode);
                        if (nextMode === "custom" && sampleMode !== "custom") {
                          const fallbackValue =
                            currentDataset.sample_size ?? (safeCustomSample || sampleMin || 10);
                          setCustomSample(fallbackValue || sampleMin || 10);
                        }
                      }}
                    >
                      <option value="all">{t("sample.allRows")}</option>
                      <option value="custom">{t("sample.custom")}</option>
                    </Select>
                    {sampleMode === "custom" && (
                      <Input
                        aria-label={t("sample.custom")}
                        type="number"
                        min={sampleMin}
                        max={totalRows}
                        className={`w-24 ${sampleInvalid ? "!border-bad" : ""}`}
                        value={customSample}
                        onChange={(event) => setCustomSample(Number(event.target.value) || 0)}
                      />
                    )}
                    <Button
                      size="sm"
                      onClick={requestApplySample}
                      disabled={!canEdit || !canApplySample || sampleUpdating}
                      title={!canEdit ? readOnlyTitle : undefined}
                    >
                      {t("sample.apply")}
                    </Button>
                  </div>
                  {sampleMode === "custom" && sampleInvalid && (
                    <ErrorText className="text-xs">
                      {t("sample.invalidRange", { min: formatNumber(sampleMin, 0), max: formatNumber(totalRows, 0) })}
                    </ErrorText>
                  )}
                </div>
              </Disclosure>

              <SchemaTabs preview={preview} loading={loadingPreview} t={t} />
            </div>
          ) : (
            <EmptyState
              icon={FolderOpen}
              title={t("detail.emptySelectionTitle")}
              className="min-h-[320px]"
            />
          )}
        </Card>
      </div>

      <Modal open={summaryState.open} onClose={closeSummary} title={t("summaryModal.title")}>
        {summaryState.loading ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : summaryState.data ? (
          <div className="space-y-4 max-h-[70vh] overflow-auto">
            <div className="grid md:grid-cols-2 gap-4 text-sm">
              <div className="rounded-lg border border-line p-3">
                <p className="text-xs text-muted">{t("summaryModal.dataset")}</p>
                <p className="font-semibold text-ink">{summaryState.data.name}</p>
                <p className="text-xs text-muted">{t("versionModal.version", { version: summaryState.data.version })}</p>
              </div>
              <div className="rounded-lg border border-line p-3">
                <p className="text-xs text-muted">{t("summaryModal.fileType")}</p>
                <p className="font-semibold text-ink">{summaryState.data.file_type?.toUpperCase() || "PARQUET"}</p>
              </div>
              <div className="rounded-lg border border-line p-3">
                <p className="text-xs text-muted">{t("stats.created")}</p>
                <p className="font-semibold text-ink">{formatDate(summaryState.data.created)}</p>
              </div>
              <div className="rounded-lg border border-line p-3">
                <p className="text-xs text-muted">{t("stats.lastUsed")}</p>
                <p className="font-semibold text-ink">{formatDate(summaryState.data.last_used)}</p>
              </div>
              <div className="rounded-lg border border-line p-3">
                <p className="text-xs text-muted">{t("stats.rows")}</p>
                <p className="font-semibold text-ink tabular-nums">
                  {formatNumber(summaryState.data.n_rows, 0)}
                  {summaryState.data.sample_size
                    ? ` (${t("summaryModal.active", { count: summaryState.data.sample_size })})`
                    : ""}
                </p>
              </div>
              <div className="rounded-lg border border-line p-3">
                <p className="text-xs text-muted">{t("stats.columns")}</p>
                <p className="font-semibold text-ink tabular-nums">{summaryState.data.n_columns}</p>
              </div>
            </div>
            <div className="rounded-xl border border-line">
              <div className="px-4 py-3 border-b border-line">
                <p className="font-medium text-sm text-ink">{t("summaryModal.dataQuality")}</p>
              </div>
              <div className="max-h-[45vh] overflow-auto">
                <Table wrapperClassName="rounded-none border-0">
                  <TableHeader className="sticky top-0">
                    <TableRow>
                      <Th>{t("schema.column")}</Th>
                      <Th>{t("schema.type")}</Th>
                      <Th>{t("summaryModal.missingPct")}</Th>
                      <Th>{t("summaryModal.unique")}</Th>
                      <Th>{t("summaryModal.minMax")}</Th>
                      <Th>{t("schema.preview")}</Th>
                      <Th>{t("summaryModal.hide")}</Th>
                    </TableRow>
                  </TableHeader>
                  <tbody>
                    {summaryState.data.columns.map((col) => {
                      const variable = summaryVariables.find((v) => v.name === col.name);
                      return (
                        <TableRow key={col.name}>
                          <TableCell className="font-medium">{col.name}</TableCell>
                          <TableCell className="text-muted">{col.dtype}</TableCell>
                          <TableCell className="text-muted">{col.missing_pct}%</TableCell>
                          <TableCell className="text-muted">{col.unique}</TableCell>
                          <TableCell className="text-muted">
                            {col.min !== null && col.min !== undefined ? col.min : "–"} /{" "}
                            {col.max !== null && col.max !== undefined ? col.max : "–"}
                          </TableCell>
                          <TableCell className="text-muted truncate max-w-[220px]">
                            {col.samples?.length ? col.samples.join(", ") : "–"}
                          </TableCell>
                          <TableCell>
                            {variable && (
                              <input
                                type="checkbox"
                                checked={variable.is_excluded}
                                disabled={!canEdit || togglingVariableId === variable.id}
                                onChange={() => handleToggleExcluded(variable)}
                                aria-label={t("summaryModal.hideAria", { name: col.name })}
                                title={t("summaryModal.hideTooltip")}
                              />
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">{t("summaryModal.none")}</p>
        )}
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" onClick={closeSummary}>
            {tCommon("close")}
          </Button>
        </div>
      </Modal>

      <Modal
        open={updateState.open}
        onClose={dismissUpdateModal}
        title={updateState.dataset ? t("updateModal.titleNamed", { name: updateState.dataset.display_name }) : t("updateModal.title")}
      >
        <p className="text-sm text-muted mb-3">{t("updateModal.description")}</p>
        <Eyebrow htmlFor="dataset-update-file">{t("updateModal.fileLabel")}</Eyebrow>
        <input
          id="dataset-update-file"
          type="file"
          accept=".csv,.xlsx,.xls,.parquet"
          onChange={(event) => handleUpdateUpload(event.target.files)}
          className="mt-1 w-full rounded-lg border border-dashed border-line-2 px-3 py-2 text-sm"
        />
        <div className="mt-3">
          <Eyebrow htmlFor="dataset-update-strategy">{t("updateModal.replaceStrategy")}</Eyebrow>
          <Select
            id="dataset-update-strategy"
            className="mt-1"
            value={updateState.strategy}
            onChange={(event) =>
              setUpdateState((state) => ({ ...state, strategy: event.target.value as "strict" | "force" }))
            }
          >
            <option value="strict">{t("updateModal.strict")}</option>
            <option value="force">{t("updateModal.force")}</option>
          </Select>
        </div>
        {updateState.error && (
          <div className="mt-3 rounded-lg border border-bad/50 bg-bad-bg p-3 text-sm text-bad">
            {updateState.error}
          </div>
        )}
        {updateState.differences && (
          <div className="mt-3 rounded-lg border border-line p-3 text-sm">
            <p className="font-medium mb-1 text-ink">{t("updateModal.differencesTitle")}</p>
            {["added", "removed", "dtype_mismatch"].map((key) => {
              const list = (updateState.differences as any)[key] as string[];
              if (!list?.length) return null;
              const label =
                key === "added"
                  ? t("updateModal.differences.added")
                  : key === "removed"
                  ? t("updateModal.differences.removed")
                  : t("updateModal.differences.typeChanges");
              return (
                <p key={key}>
                  <span className="font-semibold">{label}:</span> {list.join(", ")}
                </p>
              );
            })}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={dismissUpdateModal}>
            {tCommon("cancel")}
          </Button>
          <Button
            onClick={submitDatasetUpdate}
            disabled={!canEdit || !updateState.file || updateState.uploading}
            title={!canEdit ? readOnlyTitle : undefined}
          >
            {updateState.uploading ? t("updateModal.uploading") : t("updateModal.uploadReplace")}
          </Button>
        </div>
      </Modal>

      <Modal
        open={versionHistory.open}
        onClose={closeVersionHistory}
        title={
          versionHistory.dataset
            ? t("versionModal.titleNamed", { name: versionHistory.dataset.display_name })
            : t("versionModal.title")
        }
      >
        {versionHistory.loading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : versionHistory.items.length ? (
          <ul className="space-y-2 text-sm">
            {versionHistory.items.map((item) => (
              <li key={item.version} className="rounded-lg border border-line p-2 flex items-center justify-between">
                <span className="text-ink">{t("versionModal.version", { version: item.version })}</span>
                <span className="text-muted">{formatDate(item.created_at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">{t("versionModal.none")}</p>
        )}
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" onClick={closeVersionHistory}>
            {tCommon("close")}
          </Button>
        </div>
      </Modal>

      <Modal
        open={renameState.open}
        onClose={() => setRenameState({ open: false, value: "" })}
        title={t("renameModal.title")}
      >
        <Eyebrow htmlFor="dataset-rename-input">{t("renameModal.label")}</Eyebrow>
        <Input
          id="dataset-rename-input"
          className="mt-1"
          value={renameState.value}
          onChange={(event) => setRenameState((state) => ({ ...state, value: event.target.value }))}
          autoFocus
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRenameState({ open: false, value: "" })}>
            {tCommon("cancel")}
          </Button>
          <Button
            onClick={handleRename}
            disabled={!canEdit || !renameState.value.trim()}
            title={!canEdit ? readOnlyTitle : undefined}
          >
            {tCommon("save")}
          </Button>
        </div>
      </Modal>

      <Modal
        open={deleteState.open}
        onClose={() => setDeleteState({ open: false, cascade: true })}
        title={t("deleteModal.title")}
      >
        {deleteState.dataset && (
          <div className="space-y-4 text-sm">
            <p className="text-ink">
              {t(deleteState.cascade ? "deleteModal.bodyCascade" : "deleteModal.bodyNoCascade", {
                name: deleteState.dataset.display_name,
              })}
            </p>
            <div className="rounded-lg border border-line p-3 text-xs">
              <p className="mb-2 font-semibold text-ink">{t("deleteModal.dependencies")}</p>
              <ul className="space-y-1 text-muted">
                <li>{t("deleteModal.variables", { count: deleteState.dataset.dependencies.variables })}</li>
                <li>{t("deleteModal.models", { count: deleteState.dataset.dependencies.models })}</li>
                <li>{t("deleteModal.scenarios", { count: deleteState.dataset.dependencies.scenarios })}</li>
              </ul>
            </div>
            <label className="flex items-center gap-2 text-xs text-ink">
              <input
                type="checkbox"
                checked={deleteState.cascade}
                onChange={(event) => setDeleteState((state) => ({ ...state, cascade: event.target.checked }))}
              />
              {t("deleteModal.cascadeLabel")}
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleteState({ open: false, cascade: true })}>
                {tCommon("cancel")}
              </Button>
              <Button
                variant="danger"
                onClick={handleDelete}
                disabled={!canEdit}
                title={!canEdit ? readOnlyTitle : undefined}
              >
                {tCommon("delete")}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={sampleConfirmOpen} onClose={() => setSampleConfirmOpen(false)} title={t("sample.confirmTitle")}>
        <p className="text-sm text-ink">{t("sample.confirmBody", { target: pendingSampleLabel })}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setSampleConfirmOpen(false)}>
            {tCommon("cancel")}
          </Button>
          <Button onClick={handleApplySample} disabled={sampleUpdating}>
            {tCommon("confirm")}
          </Button>
        </div>
      </Modal>
    </section>
  );
}

function safeParseJSON(payload: string | null) {
  if (!payload) return {};
  try {
    return JSON.parse(payload);
  } catch (error) {
    return {};
  }
}

function SchemaTabs({
  preview,
  loading,
  t,
}: {
  preview: Preview | null;
  loading: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const [tab, setTab] = useState("schema");
  const schemaRows =
    preview?.columns?.map((column) => {
      const samples = (preview.rows || [])
        .map((row) => row[column])
        .filter((value) => value !== null && value !== undefined)
        .slice(0, 3)
        .map((value) => String(value));
      return { name: column, type: inferType(samples, preview, column), samples };
    }) || [];

  return (
    <Tabs
      active={tab}
      onChange={setTab}
      items={[
        {
          id: "schema",
          label: t("schema.schemaTab"),
          content: schemaRows.length ? (
            <Table wrapperClassName="max-h-[360px] overflow-auto">
              <TableHeader className="sticky top-0">
                <TableRow>
                  <Th>{t("schema.column")}</Th>
                  <Th>{t("schema.type")}</Th>
                  <Th>{t("schema.preview")}</Th>
                </TableRow>
              </TableHeader>
              <tbody>
                {schemaRows.map((row) => (
                  <TableRow key={row.name}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-muted">{row.type}</TableCell>
                    <TableCell className="text-muted">{row.samples.length ? row.samples.join(", ") : "—"}</TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          ) : loading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </div>
          ) : (
            <div className="p-6 text-center text-sm text-muted">{t("schema.noSchema")}</div>
          ),
        },
        {
          id: "preview",
          label: t("schema.previewTab"),
          content:
            preview && preview.columns.length ? (
              <Table wrapperClassName="max-h-[360px] overflow-auto">
                <TableHeader className="sticky top-0">
                  <TableRow>
                    {preview.columns.map((col) => (
                      <Th key={col}>{col}</Th>
                    ))}
                  </TableRow>
                </TableHeader>
                <tbody>
                  {preview.rows.map((row, idx) => (
                    <TableRow key={idx} className="odd:bg-transparent even:bg-surface-2">
                      {preview.columns.map((col) => (
                        <TableCell key={`${idx}-${col}`} className="whitespace-nowrap">
                          {String(row[col] ?? "")}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </tbody>
              </Table>
            ) : loading ? (
              <div className="space-y-2 p-4">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
              </div>
            ) : (
              <div className="p-6 text-center text-sm text-muted">{t("schema.noPreview")}</div>
            ),
        },
      ]}
    />
  );
}

function inferType(samples: string[], preview: Preview | null, column: string) {
  if (preview?.columns) {
    const colIndex = preview.columns.indexOf(column);
    if (colIndex >= 0 && preview.rows.length) {
      const value = preview.rows[0][column];
      if (value !== null && value !== undefined) {
        const type = typeof value;
        if (type === "number") return "number";
        if (value instanceof Date) return "datetime";
      }
    }
  }
  const sample = samples[0];
  if (!sample) return "—";
  if (!Number.isNaN(Date.parse(sample))) return "datetime";
  if (!Number.isNaN(Number(sample))) return "number";
  return "string";
}
