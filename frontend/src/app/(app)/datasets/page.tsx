"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { Upload, FolderOpen, Trash2, Pencil, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { ErrorText } from "@/components/ui/error-text";
import { useGlobalStore } from "@/lib/store";
import { formatDate, formatNumber } from "@/lib/format";
import { useKeyboardShortcut } from "@/hooks/useKeyboardShortcut";
import { useCanEdit } from "@/hooks/useCanEdit";
import { apiFetch, ApiError, getAuthHeaders, API_URL } from "@/lib/api";

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
      if (!datasetId && data.length) {
        setDatasetId(data[0].id);
      }
    } catch (err) {
      toast.error((err as Error)?.message || "Failed to load datasets");
    }
  }, [datasetId, setDatasetId]);

  useEffect(() => {
    // activeCompanyId hydrates asynchronously (AuthBootstrap fetches /me/memberships and
    // auto-selects the first company) — fetching before it's set sends no X-Company-Id
    // header and the backend 422s. Wait for it, then re-fetch once it's ready.
    if (!activeCompanyId) return;
    fetchDatasets();
  }, [fetchDatasets, activeCompanyId]);

  const loadPreview = useCallback(async (id: string) => {
    setLoadingPreview(true);
    try {
      const data = await apiFetch<Preview>(`/datasets/${id}/preview?rows=20`);
      setPreview(data);
    } catch (error) {
      console.error(error);
      toast.error("Failed to load preview");
      setPreview(null);
    } finally {
      setLoadingPreview(false);
    }
  }, []);

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
        toast.error(error?.message || "Failed to load version history");
        setVersionHistory({ open: false, dataset: undefined, loading: false, items: [] });
      }
    },
    []
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
        toast.error(error?.message || "Failed to load dataset summary");
        setSummaryState({ open: false, loading: false });
      }
    },
    []
  );

  const handleToggleExcluded = useCallback(async (variable: VariableFlag) => {
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
      toast.error(error?.message || "Failed to update variable");
      setSummaryVariables((prev) =>
        prev.map((v) => (v.id === variable.id ? { ...v, is_excluded: !next } : v))
      );
    } finally {
      setTogglingVariableId(null);
    }
  }, []);

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

  const timePreviewValues = useMemo(() => {
    if (!preview || !timeColumn) return [];
    return preview.rows
      .map((row) => row[timeColumn])
      .filter((value) => value !== undefined && value !== null)
      .slice(0, 3)
      .map((value) => String(value));
  }, [preview, timeColumn]);

  const handleApplySample = useCallback(async () => {
    if (!currentDataset || !canApplySample) return;
    if (sampleMode === "custom" && sampleInvalid) {
      toast.error("Enter a valid sample size before applying.");
      return;
    }
    const target = sampleMode === "all" ? null : Math.round(safeCustomSample);
    const targetLabel =
      target === null ? "all rows" : `${formatNumber(target, 0)} rows`;
    if (
      !window.confirm(
        `Change working dataset to ${targetLabel}? This will affect transformations, modeling, and analysis results.`
      )
    ) {
      return;
    }
    setSampleUpdating(true);
    try {
      const updated = await apiFetch<Dataset>(`/datasets/${currentDataset.id}/sample_size`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sample_size: target }),
      });
      setDatasets((prev) => prev.map((ds) => (ds.id === updated.id ? updated : ds)));
      toast.success(
        `✅ Working dataset updated successfully (${formatNumber(
          updated.sample_size ?? updated.total_rows ?? updated.n_rows,
          0
        )} rows active)`
      );
      await fetchDatasets();
      if (datasetId === updated.id) {
        loadPreview(updated.id);
      }
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || "Failed to update sample size");
    } finally {
      setTimeout(() => setSampleUpdating(false), 300);
    }
  }, [
    currentDataset,
    sampleMode,
    safeCustomSample,
    canApplySample,
    sampleInvalid,
    datasetId,
    fetchDatasets,
    loadPreview,
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
      toast.success("✅ Time variable saved");
      fetchTimeCandidates(updated.id);
    } catch (error: any) {
      console.error(error);
      const detail = error instanceof ApiError ? error.detail : null;
      if (detail?.samples) {
        toast.error(`${detail.error || "Unparseable time values"}: ${detail.samples.map((s: any) => s.value).join(", ")}`);
      } else {
        toast.error(detail?.detail || error?.message || "Failed to save time variable");
      }
    } finally {
      setTimeSaving(false);
    }
  }, [currentDataset, timeColumn, timeCoerce, timeFormat, timeTimezone, fetchTimeCandidates]);

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
      toast.success("Time variable cleared");
      fetchTimeCandidates(updated.id);
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || "Failed to clear time variable");
    } finally {
      setTimeSaving(false);
    }
  }, [currentDataset, fetchTimeCandidates]);

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
        toast.success(column ? "✅ Dependent variable saved" : "Dependent variable cleared");
      } catch (error: any) {
        console.error(error);
        toast.error(error?.message || "Failed to save dependent variable");
        setDependentVariable(previous);
      } finally {
        setDependentVariableSaving(false);
      }
    },
    [currentDataset]
  );

  const handleUpdateUpload = useCallback((fileList: FileList | null) => {
    const file = fileList?.[0];
    setUpdateState((state) => ({ ...state, file }));
  }, []);

  const submitDatasetUpdate = useCallback(async () => {
    if (!updateState.dataset || !updateState.file) {
      toast.error("Select a file to upload.");
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
      toast.success(`✅ Dataset successfully updated (v${data.new_version})`);
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
        const rawMessage =
          typeof detail === "string"
            ? detail
            : typeof detail?.detail === "string"
            ? detail.detail
            : typeof detail?.error === "string"
            ? detail.error
            : "Failed to update dataset";
        setUpdateState((state) => ({
          ...state,
          uploading: false,
          error: rawMessage,
          differences: detail?.differences || null,
        }));
      } else {
        toast.error(error?.message || "Update failed");
        setUpdateState((state) => ({ ...state, uploading: false }));
      }
    }
  }, [updateState, datasetId, fetchDatasets, loadPreview, fetchTimeCandidates]);

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
        toast.error("Solo lectura: tu rol es Visualizador");
        return;
      }
      setUploading(true);
      try {
        await uploadFiles(files, Boolean(opts.force));
        toast.success("Datasets uploaded");
        await fetchDatasets();
      } catch (error: any) {
        if (error?.status === 409) {
          const duplicateName = error.detail?.display_name || "dataset";
          toast.error(`"${duplicateName}" already exists`, {
            action: {
              label: "Upload anyway",
              onClick: () => handleUpload(files, { force: true }),
            },
            description: "Re-use the existing dataset or force upload",
          });
          return;
        }
        toast.error(error?.detail?.message || "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [fetchDatasets, uploadFiles, canEdit]
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

  const handleRename = async () => {
    if (!renameState.dataset) return;
    try {
      await apiFetch(`/datasets/${renameState.dataset.id}/rename`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: renameState.value }),
      });
      toast.success("Dataset renamed");
      setRenameState({ open: false, value: "" });
      fetchDatasets();
    } catch (error) {
      console.error(error);
      toast.error("Rename failed");
    }
  };

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
      toast.success("Dataset deleted");
      setDeleteState({ open: false, cascade: true });
      if (datasetId === deleteState.dataset.id) {
        setDatasetId(null);
        setPreview(null);
      }
      fetchDatasets();
    } catch (error) {
      console.error(error);
      const detail = error instanceof ApiError ? error.detail : null;
      toast.error(detail?.message || (error as Error)?.message || "Delete failed");
    }
  };

  const dtypeSummary = useMemo(() => {
    if (!currentDataset) return [] as { name: string; dtype: string }[];
    return currentDataset.columns.slice(0, 12);
  }, [currentDataset]);

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-[var(--color-muted)]">Module 1</p>
          <h1 className="text-2xl font-semibold tracking-tight">Datasets</h1>
        </div>
        <Button
          onClick={() => document.getElementById("dataset-upload-input")?.click()}
          disabled={!canEdit}
          title={!canEdit ? "Solo lectura: tu rol es Visualizador" : undefined}
        >
          <Upload className="mr-2 h-4 w-4" /> Upload
        </Button>
      </header>

      <div className="grid gap-6 xl:grid-cols-[360px,1fr]">
        <div className="space-y-6">
          <Card className="space-y-4">
            <CardHeader title="Upload" subtitle="Drag & drop CSV or Excel" />
            <div
              {...getRootProps()}
              className={`rounded-2xl border-2 border-dashed p-6 text-center transition ${
                isDragActive ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]" : "border-[var(--color-border)]"
              } ${uploading ? "opacity-60" : ""}`}
            >
              <input {...getInputProps()} id="dataset-upload-input" />
              <p className="font-medium text-lg">Drop files here or click to browse</p>
              <p className="text-sm text-[var(--color-muted)] mt-1">Accepted: CSV, XLSX, XLS, Parquet</p>
              <div className="mt-3 flex justify-center gap-2 text-xs">
                <Badge>CSV</Badge>
                <Badge>Excel</Badge>
                <Badge>Parquet</Badge>
              </div>
              {uploading && (
                <div className="mt-4">
                  <Progress value={uploadProgress} />
                  <p className="text-xs text-[var(--color-muted)] mt-1">Uploading… {uploadProgress}%</p>
                </div>
              )}
            </div>
          </Card>

          <Card className="space-y-4">
            <CardHeader title="Datasets" subtitle="Your recent uploads" />
            <div className="space-y-3 max-h-[480px] overflow-y-auto pr-2">
              {datasets.length === 0 && (
                <p className="text-sm text-[var(--color-muted)]">No datasets yet. Upload to get started.</p>
              )}
              {datasets.map((ds) => {
                const isActive = datasetId === ds.id;
                return (
                  <div
                    key={ds.id}
                    className={`rounded-2xl border p-4 transition cursor-pointer ${
                      isActive ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]" : "border-[var(--color-border)]"
                    }`}
                    onClick={() => setDatasetId(ds.id)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="font-semibold">{ds.display_name}</p>
                        <p className="text-xs text-[var(--color-muted)]">{ds.file_name}</p>
                        <p className="text-xs text-[var(--color-muted)]">Version {ds.version ?? 1}</p>
                      </div>
                      {isActive && <Badge>Active</Badge>}
                    </div>
                    <dl className="grid grid-cols-2 gap-2 text-xs text-[var(--color-muted)]">
                      <div>
                        <dt>Rows</dt>
                        <dd className="text-sm text-[var(--color-foreground)]">{formatNumber(ds.n_rows, 0)}</dd>
                      </div>
                      <div>
                        <dt>Columns</dt>
                        <dd className="text-sm text-[var(--color-foreground)]">{ds.n_cols}</dd>
                      </div>
                      <div>
                        <dt>Created</dt>
                        <dd>{formatDate(ds.created_at)}</dd>
                      </div>
                      <div>
                        <dt>Last used</dt>
                        <dd>{formatDate(ds.last_used_at)}</dd>
                      </div>
                    </dl>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          setDatasetId(ds.id);
                          loadPreview(ds.id);
                        }}
                      >
                        <FolderOpen className="mr-1 h-3 w-3" /> Open
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          setRenameState({ open: true, dataset: ds, value: ds.display_name });
                        }}
                      >
                        <Pencil className="mr-1 h-3 w-3" /> Rename
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
                        <Upload className="mr-1 h-3 w-3" /> Update File
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          setDeleteState({ open: true, dataset: ds, cascade: true });
                        }}
                      >
                        <Trash2 className="mr-1 h-3 w-3" /> Delete
                      </Button>
                      {!isActive && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(event) => {
                            event.stopPropagation();
                            setDatasetId(ds.id);
                            toast.success(`${ds.display_name} is now active`);
                          }}
                        >
                          <Star className="mr-1 h-3 w-3" /> Set Active
                        </Button>
                      )}
                    </div>
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
                className={`absolute inset-0 rounded-2xl bg-[var(--color-bg)]/70 backdrop-blur-sm transition-opacity duration-300 z-10 ${
                  sampleUpdating ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
                }`}
              />
              <CardHeader title={currentDataset.display_name} subtitle={currentDataset.file_name} />
              <div className="grid sm:grid-cols-4 gap-3 text-center">
                <Stat label="Rows" value={formatNumber(totalRows, 0)} />
                <Stat label="Columns" value={currentDataset.n_cols} />
                <Stat label="Created" value={formatDate(currentDataset.created_at)} />
                <Stat label="Last used" value={formatDate(currentDataset.last_used_at)} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-muted)]">
                <p>
                  Version {currentDataset.version ?? 1} · Updated {formatDate(currentDataset.last_used_at)} ·{" "}
                  {formatNumber(totalRows, 0)} rows, {currentDataset.n_cols} columns
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => currentDataset && fetchDatasetSummary(currentDataset)}
                  >
                    View details
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => currentDataset && fetchVersionHistory(currentDataset)}
                    disabled={versionHistory.loading && versionHistory.dataset?.id === currentDataset.id}
                  >
                    Version history
                  </Button>
                </div>
              </div>
              <div className="rounded-2xl border border-[var(--color-border)] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Time variable</p>
                    <p className="text-xs text-[var(--color-muted)]">Used across Transform, Modeling, Analysis, and Predict.</p>
                  </div>
                  {timeCandidatesLoading && <span className="text-xs text-[var(--color-muted)]">Detecting…</span>}
                </div>
                <Select value={timeColumn} onChange={(event) => setTimeColumn(event.target.value)}>
                  <option value="">Select column</option>
                  {timeCandidates.length > 0 && (
                    <optgroup label="Suggested">
                      {timeCandidates.map((candidate) => (
                        <option key={`candidate-${candidate.name}`} value={candidate.name}>
                          {candidate.name} {candidate.parseable ? "" : " (needs coercion)"}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {currentDataset?.columns && (
                    <optgroup label="All columns">
                      {currentDataset.columns.map((col) => (
                        <option key={`col-${col.name}`} value={col.name}>
                          {col.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </Select>
                <div className="space-y-2 rounded-xl border border-dashed border-[var(--color-border)] p-3 text-xs">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={timeCoerce} onChange={(event) => setTimeCoerce(event.target.checked)} />
                    Coerce to datetime
                  </label>
                  <div className="flex flex-wrap gap-3">
                    <label className="flex flex-col gap-1 flex-1 min-w-[160px]">
                      <span>Custom format</span>
                      <input
                        type="text"
                        placeholder="%Y-%m-%d"
                        className="rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm"
                        value={timeFormat}
                        onChange={(event) => setTimeFormat(event.target.value)}
                      />
                    </label>
                    <label className="flex flex-col gap-1 flex-1 min-w-[160px]">
                      <span>Timezone</span>
                      <input
                        type="text"
                        placeholder="UTC"
                        className="rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm"
                        value={timeTimezone}
                        onChange={(event) => setTimeTimezone(event.target.value)}
                      />
                    </label>
                  </div>
                  {timePreviewValues.length > 0 && (
                    <p className="text-[var(--color-muted)]">
                      Sample values: {timePreviewValues.join(", ")}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleSaveTimeVariable}
                    disabled={!canEdit || !currentDataset || timeSaving}
                    title={!canEdit ? "Solo lectura: tu rol es Visualizador" : undefined}
                  >
                    {timeSaving ? "Saving..." : "Save time variable"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearTimeVariable}
                    disabled={!canEdit || !currentDataset?.time_variable || timeSaving}
                    title={!canEdit ? "Solo lectura: tu rol es Visualizador" : undefined}
                  >
                    Clear selection
                  </Button>
                </div>
              </div>
              <div className="rounded-2xl border border-[var(--color-border)] p-4 space-y-3">
                <div>
                  <p className="font-medium">Dependent variable</p>
                  <p className="text-xs text-[var(--color-muted)]">
                    Used in Transform to show correlation against this column while previewing transformations.
                  </p>
                </div>
                <Select
                  value={dependentVariable}
                  onChange={(event) => handleChangeDependentVariable(event.target.value)}
                  disabled={!canEdit || !currentDataset || dependentVariableSaving}
                >
                  <option value="">None selected</option>
                  {currentDataset?.columns.map((col) => (
                    <option key={`dep-${col.name}`} value={col.name}>
                      {col.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="rounded-2xl border border-[var(--color-border)] p-4 space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm font-medium">Working Sample Size</p>
                  <Select
                    wrapperClassName="w-auto"
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
                    <option value="all">All rows</option>
                    <option value="custom">Custom…</option>
                  </Select>
                  {sampleMode === "custom" && (
                    <input
                      type="number"
                      min={sampleMin}
                      max={totalRows}
                      className={`w-24 rounded-xl border px-3 py-2 text-sm transition-all duration-200 ${
                        sampleInvalid ? "border-[var(--color-danger)]" : "border-[var(--color-border)]"
                      } bg-transparent`}
                      value={customSample}
                      onChange={(event) => setCustomSample(Number(event.target.value) || 0)}
                    />
                  )}
                  <Button
                    size="sm"
                    onClick={handleApplySample}
                    disabled={!canEdit || !canApplySample || sampleUpdating}
                    title={!canEdit ? "Solo lectura: tu rol es Visualizador" : undefined}
                  >
                    Apply
                  </Button>
                </div>
                {sampleMode === "custom" && sampleInvalid && (
                  <ErrorText className="text-xs">
                    Enter a value between {formatNumber(sampleMin, 0)} and {formatNumber(totalRows, 0)} rows.
                  </ErrorText>
                )}
                <p className="text-xs text-[var(--color-muted)]">
                  {activeRows === totalRows || !totalRows
                    ? `Currently using all ${formatNumber(totalRows, 0)} rows.`
                    : `Currently using ${formatNumber(activeRows, 0)} of ${formatNumber(totalRows, 0)} rows (${(
                        (activeRows / totalRows) *
                        100
                      ).toFixed(1)}% of dataset).`}
                </p>
              </div>
              <SchemaTabs preview={preview} loading={loadingPreview} datasetName={currentDataset.display_name} />
            </div>
          ) : (
            <div className="min-h-[320px] flex flex-col items-center justify-center text-center text-[var(--color-muted)]">
              <FolderOpen className="h-10 w-10 mb-3" />
              <p>Select a dataset to view details</p>
            </div>
          )}
        </Card>
      </div>

      <Modal
        open={summaryState.open}
        onClose={closeSummary}
        title="Dataset summary"
      >
        {summaryState.loading ? (
          <p className="text-sm text-[var(--color-muted)]">Loading summary…</p>
        ) : summaryState.data ? (
          <div className="space-y-4 max-h-[70vh] overflow-auto">
            <div className="grid md:grid-cols-2 gap-4 text-sm">
              <div className="rounded-xl border border-[var(--color-border)] p-3">
                <p className="text-xs text-[var(--color-muted)]">Dataset</p>
                <p className="font-semibold">{summaryState.data.name}</p>
                <p className="text-xs text-[var(--color-muted)]">Version {summaryState.data.version}</p>
              </div>
              <div className="rounded-xl border border-[var(--color-border)] p-3">
                <p className="text-xs text-[var(--color-muted)]">File type</p>
                <p className="font-semibold">{summaryState.data.file_type?.toUpperCase() || "PARQUET"}</p>
              </div>
              <div className="rounded-xl border border-[var(--color-border)] p-3">
                <p className="text-xs text-[var(--color-muted)]">Created</p>
                <p className="font-semibold">{formatDate(summaryState.data.created)}</p>
              </div>
              <div className="rounded-xl border border-[var(--color-border)] p-3">
                <p className="text-xs text-[var(--color-muted)]">Last used</p>
                <p className="font-semibold">{formatDate(summaryState.data.last_used)}</p>
              </div>
              <div className="rounded-xl border border-[var(--color-border)] p-3">
                <p className="text-xs text-[var(--color-muted)]">Rows</p>
                <p className="font-semibold">
                  {formatNumber(summaryState.data.n_rows, 0)}
                  {summaryState.data.sample_size
                    ? ` (${summaryState.data.sample_size} active)`
                    : ""}
                </p>
              </div>
              <div className="rounded-xl border border-[var(--color-border)] p-3">
                <p className="text-xs text-[var(--color-muted)]">Columns</p>
                <p className="font-semibold">{summaryState.data.n_columns}</p>
              </div>
            </div>
            <div className="rounded-2xl border border-[var(--color-border)] shadow-sm">
              <div className="px-4 py-3 border-b border-[var(--color-border)]">
                <p className="font-medium text-sm">Data quality</p>
              </div>
              <div className="max-h-[45vh] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-[var(--color-bg)] text-xs uppercase tracking-wide text-[var(--color-muted)]">
                    <tr>
                      <th className="px-4 py-2 text-left">Column</th>
                      <th className="px-4 py-2 text-left">Type</th>
                      <th className="px-4 py-2 text-left">% Missing</th>
                      <th className="px-4 py-2 text-left">Unique</th>
                      <th className="px-4 py-2 text-left">Min / Max</th>
                      <th className="px-4 py-2 text-left">Preview</th>
                      <th className="px-4 py-2 text-left">Hide</th>
                    </tr>
                  </thead>
                  <tbody>
                {summaryState.data.columns.map((col) => {
                  const variable = summaryVariables.find((v) => v.name === col.name);
                  return (
                  <tr
                    key={col.name}
                    className="border-t border-[var(--color-border)]/70"
                  >
                        <td className="px-4 py-3 font-medium">{col.name}</td>
                        <td className="px-4 py-3 text-[var(--color-muted)]">{col.dtype}</td>
                        <td className="px-4 py-3 text-[var(--color-muted)]">{col.missing_pct}%</td>
                        <td className="px-4 py-3 text-[var(--color-muted)]">{col.unique}</td>
                        <td className="px-4 py-3 text-[var(--color-muted)]">
                          {col.min !== null && col.min !== undefined ? col.min : "–"} /{" "}
                          {col.max !== null && col.max !== undefined ? col.max : "–"}
                        </td>
                        <td className="px-4 py-3 text-[var(--color-muted)] truncate">
                          {col.samples?.length ? col.samples.join(", ") : "–"}
                        </td>
                        <td className="px-4 py-3">
                          {variable && (
                            <input
                              type="checkbox"
                              checked={variable.is_excluded}
                              disabled={!canEdit || togglingVariableId === variable.id}
                              onChange={() => handleToggleExcluded(variable)}
                              title="Hide this variable from Transform/Modeling selectors"
                            />
                          )}
                        </td>
                      </tr>
                  );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-[var(--color-muted)]">No summary available.</p>
        )}
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" onClick={closeSummary}>
            Close
          </Button>
        </div>
      </Modal>

      <Modal
        open={updateState.open}
        onClose={dismissUpdateModal}
        title={updateState.dataset ? `Replace dataset “${updateState.dataset.display_name}”` : "Replace dataset"}
      >
        <p className="text-sm text-[var(--color-muted)] mb-3">
          Upload a new file to replace the existing one. Make sure the schema (column names and types) is the same.
        </p>
        <input
          type="file"
          accept=".csv,.xlsx,.xls,.parquet"
          onChange={(event) => handleUpdateUpload(event.target.files)}
          className="w-full rounded-lg border border-dashed border-[var(--color-border)] px-3 py-2 text-sm"
        />
        <label className="mt-3 flex flex-col gap-1 text-sm">
          Replace strategy
          <Select
            value={updateState.strategy}
            onChange={(event) =>
              setUpdateState((state) => ({ ...state, strategy: event.target.value as "strict" | "force" }))
            }
          >
            <option value="strict">Strict (schema must match)</option>
            <option value="force">Force (allow added/removed columns)</option>
          </Select>
        </label>
        {updateState.error && (
          <div className="mt-3 rounded-lg border border-[var(--color-danger)]/50 bg-[var(--color-danger-soft)] p-3 text-sm text-[var(--color-danger)]">
            {updateState.error}
          </div>
        )}
        {updateState.differences && (
          <div className="mt-3 rounded-lg border border-[var(--color-border)] p-3 text-sm">
            <p className="font-medium mb-1">Schema differences</p>
            {["added", "removed", "dtype_mismatch"].map((key) => {
              const list = (updateState.differences as any)[key] as string[];
              if (!list?.length) return null;
              const label =
                key === "added" ? "Added" : key === "removed" ? "Removed" : "Type changes";
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
            Cancel
          </Button>
          <Button
            onClick={submitDatasetUpdate}
            disabled={!canEdit || !updateState.file || updateState.uploading}
            title={!canEdit ? "Solo lectura: tu rol es Visualizador" : undefined}
          >
            {updateState.uploading ? "Uploading new version..." : "Upload & Replace"}
          </Button>
        </div>
      </Modal>

      <Modal
        open={versionHistory.open}
        onClose={closeVersionHistory}
        title={versionHistory.dataset ? `${versionHistory.dataset.display_name} · Versions` : "Version history"}
      >
        {versionHistory.loading ? (
          <p className="text-sm text-[var(--color-muted)]">Loading version history…</p>
        ) : versionHistory.items.length ? (
          <ul className="space-y-2 text-sm">
            {versionHistory.items.map((item) => (
              <li key={item.version} className="rounded-lg border border-[var(--color-border)] p-2 flex items-center justify-between">
                <span>Version {item.version}</span>
                <span className="text-[var(--color-muted)]">{formatDate(item.created_at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--color-muted)]">No version history available.</p>
        )}
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" onClick={closeVersionHistory}>
            Close
          </Button>
        </div>
      </Modal>

      <Modal
        open={renameState.open}
        onClose={() => setRenameState({ open: false, value: "" })}
        title="Rename dataset"
      >
        <Input
          value={renameState.value}
          onChange={(event) => setRenameState((state) => ({ ...state, value: event.target.value }))}
          placeholder="Display name"
          autoFocus
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRenameState({ open: false, value: "" })}>Cancel</Button>
          <Button
            onClick={handleRename}
            disabled={!canEdit || !renameState.value.trim()}
            title={!canEdit ? "Solo lectura: tu rol es Visualizador" : undefined}
          >
            Save
          </Button>
        </div>
      </Modal>

      <Modal
        open={deleteState.open}
        onClose={() => setDeleteState({ open: false, cascade: true })}
        title="Delete dataset"
      >
        {deleteState.dataset && (
          <div className="space-y-4 text-sm">
            <p>
              This will delete <strong>{deleteState.dataset.display_name}</strong>
              {" "}and {deleteState.cascade ? "all dependent transforms/models." : "if no dependencies remain."}
            </p>
            <div className="rounded-xl border border-[var(--color-border)] p-3 text-xs">
              <p className="mb-2 font-semibold">Dependencies</p>
              <ul className="space-y-1">
                <li>Variables: {deleteState.dataset.dependencies.variables}</li>
                <li>Models: {deleteState.dataset.dependencies.models}</li>
                <li>Scenarios: {deleteState.dataset.dependencies.scenarios}</li>
              </ul>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={deleteState.cascade}
                onChange={(event) => setDeleteState((state) => ({ ...state, cascade: event.target.checked }))}
              />
              Delete dependent items (recommended)
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleteState({ open: false, cascade: true })}>Cancel</Button>
              <Button
                variant="danger"
                onClick={handleDelete}
                disabled={!canEdit}
                title={!canEdit ? "Solo lectura: tu rol es Visualizador" : undefined}
              >
                Delete
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] p-3">
      <p className="text-xs text-[var(--color-muted)]">{label}</p>
      <p className="text-base font-semibold">{value}</p>
    </div>
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
}: {
  preview: Preview | null;
  loading: boolean;
  datasetName?: string;
}) {
  const [tab, setTab] = useState<"schema" | "preview">("schema");
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
    <div className="rounded-2xl border border-[var(--color-border)] shadow-sm overflow-hidden">
      <div className="flex border-b border-[var(--color-border)] text-sm">
        {["schema", "preview"].map((key) => (
          <button
            key={key}
            className={`flex-1 px-4 py-2 transition ${
              tab === key ? "bg-[var(--color-bg)] font-medium" : "text-[var(--color-muted)]"
            }`}
            onClick={() => setTab(key as any)}
          >
            {key === "schema" ? "Schema Overview" : "Table Preview"}
          </button>
        ))}
      </div>
      {tab === "schema" ? (
        schemaRows.length ? (
          <div className="max-h-[360px] overflow-auto animate-fade">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[var(--color-bg)]">
                <tr className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                  <th className="px-4 py-2 text-left">Column</th>
                  <th className="px-4 py-2 text-left">Type</th>
                  <th className="px-4 py-2 text-left">Preview</th>
                </tr>
              </thead>
              <tbody>
                {schemaRows.map((row) => (
                  <tr
                    key={row.name}
                    className="border-t border-[var(--color-border)]/70 transition hover:bg-[var(--color-border)]/20"
                  >
                    <td className="px-4 py-3 font-medium">{row.name}</td>
                    <td className="px-4 py-3 text-[var(--color-muted)]">{row.type}</td>
                    <td className="px-4 py-3 text-[var(--color-muted)]">
                      {row.samples.length ? row.samples.join(", ") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-6 text-center text-sm text-[var(--color-muted)]">
            {loading ? "Loading schema…" : "No schema available"}
          </div>
        )
      ) : preview && preview.columns.length ? (
        <div className="max-h-[360px] overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--color-bg)]/80">
              <tr>
                {preview.columns.map((col) => (
                  <th key={col} className="px-3 py-2 text-left text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row, idx) => (
                <tr key={idx} className="odd:bg-transparent even:bg-[var(--color-border)]/20">
                  {preview.columns.map((col) => (
                    <td key={`${idx}-${col}`} className="px-3 py-2 whitespace-nowrap">
                      {String(row[col] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-6 text-center text-sm text-[var(--color-muted)]">
          {loading ? "Loading preview…" : "No preview available"}
        </div>
      )}
    </div>
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
