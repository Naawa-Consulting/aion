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
import { useGlobalStore } from "@/lib/store";
import { formatDate, formatNumber } from "@/lib/format";
import { useKeyboardShortcut } from "@/hooks/useKeyboardShortcut";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type Dataset = {
  id: string;
  display_name: string;
  file_name: string;
  n_rows: number;
  n_cols: number;
  created_at: string;
  last_used_at: string;
  columns: { name: string; dtype: string }[];
  dependencies: { variables: number; models: number; scenarios: number };
};

type Preview = {
  columns: string[];
  rows: Record<string, unknown>[];
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
  const { datasetId, setDatasetId } = useGlobalStore();

  const fetchDatasets = useCallback(async () => {
    const res = await fetch(`${API_URL}/datasets`);
    if (!res.ok) {
      toast.error("Failed to load datasets");
      return;
    }
    const data = await res.json();
    setDatasets(data);
    if (!datasetId && data.length) {
      setDatasetId(data[0].id);
    }
  }, [datasetId, setDatasetId]);

  useEffect(() => {
    fetchDatasets();
  }, [fetchDatasets]);

  const loadPreview = useCallback(async (id: string) => {
    setLoadingPreview(true);
    try {
      const res = await fetch(`${API_URL}/datasets/${id}/preview?rows=20`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setPreview(data);
    } catch (error) {
      console.error(error);
      toast.error("Failed to load preview");
      setPreview(null);
    } finally {
      setLoadingPreview(false);
    }
  }, []);

  useEffect(() => {
    if (datasetId) {
      loadPreview(datasetId);
    }
  }, [datasetId, loadPreview]);

  const currentDataset = useMemo(
    () => datasets.find((ds) => ds.id === datasetId) || null,
    [datasets, datasetId]
  );

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
        xhr.open("POST", `${API_URL}/datasets/upload?force=${force}`);
        xhr.send(form);
      }),
    []
  );

  const handleUpload = useCallback(
    async (files: File[], opts: { force?: boolean } = {}) => {
      if (!files.length) return;
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
    [fetchDatasets, uploadFiles]
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
    accept: {
      "text/csv": [".csv"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.ms-excel": [".xls"],
    },
  });

  const handleRename = async () => {
    if (!renameState.dataset) return;
    try {
      const res = await fetch(`${API_URL}/datasets/${renameState.dataset.id}/rename`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: renameState.value }),
      });
      if (!res.ok) throw new Error(await res.text());
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
      const res = await fetch(
        `${API_URL}/datasets/${deleteState.dataset.id}?cascade=${deleteState.cascade}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const detail = await res.json().catch(() => ({ message: "Delete failed" }));
        toast.error(detail?.message || "Delete failed");
        return;
      }
      toast.success("Dataset deleted");
      setDeleteState({ open: false, cascade: true });
      if (datasetId === deleteState.dataset.id) {
        setDatasetId(null);
        setPreview(null);
      }
      fetchDatasets();
    } catch (error) {
      console.error(error);
      toast.error("Delete failed");
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
        <Button onClick={() => document.getElementById("dataset-upload-input")?.click()}>
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
              <p className="text-sm text-[var(--color-muted)] mt-1">Accepted: CSV, XLSX, XLS</p>
              <div className="mt-3 flex justify-center gap-2 text-xs">
                <Badge>CSV</Badge>
                <Badge>Excel</Badge>
                <Badge>Parquet Store</Badge>
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

        <Card className="space-y-4">
          {currentDataset ? (
            <>
              <CardHeader title={currentDataset.display_name} subtitle={currentDataset.file_name} />
              <div className="grid sm:grid-cols-4 gap-3 text-center">
                <Stat label="Rows" value={formatNumber(currentDataset.n_rows, 0)} />
                <Stat label="Columns" value={currentDataset.n_cols} />
                <Stat label="Created" value={formatDate(currentDataset.created_at)} />
                <Stat label="Last used" value={formatDate(currentDataset.last_used_at)} />
              </div>
              <div className="flex flex-wrap gap-2">
                {dtypeSummary.map((col) => (
                  <Badge key={col.name}>{col.name} · {col.dtype}</Badge>
                ))}
              </div>
              <div className="rounded-2xl border border-[var(--color-border)]">
                <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
                  <p className="font-medium">Schema preview</p>
                  {loadingPreview && <span className="text-xs text-[var(--color-muted)]">Loading…</span>}
                </div>
                {preview && preview.columns.length > 0 ? (
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
                    No preview available
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="min-h-[320px] flex flex-col items-center justify-center text-center text-[var(--color-muted)]">
              <FolderOpen className="h-10 w-10 mb-3" />
              <p>Select a dataset to view details</p>
            </div>
          )}
        </Card>
      </div>

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
          <Button onClick={handleRename} disabled={!renameState.value.trim()}>
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
              <Button variant="danger" onClick={handleDelete}>Delete</Button>
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
