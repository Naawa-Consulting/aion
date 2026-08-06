"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Pencil, Trash2, Plus, X } from "lucide-react";

import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { apiFetch, ApiError } from "@/lib/api";

type SourceMode = "dataset_column" | "rate_metric" | "manual";

type ManualEntry = { amount: number; start_date: string; end_date: string };

type ChannelConfig = {
  cost_column?: string | null;
  rate_value?: number | null;
  metric_column?: string | null;
  entries?: ManualEntry[] | null;
};

type InvestmentChannel = {
  id: string;
  dataset_id: string;
  name: string;
  source_mode: SourceMode;
  config: ChannelConfig;
  proxy_variable?: string | null;
  created_at: string;
};

const SOURCE_MODE_LABEL: Record<SourceMode, string> = {
  dataset_column: "Columna del dataset",
  rate_metric: "Tasa × métrica",
  manual: "Manual",
};

const NO_PROXY = "__none__";

function emptyForm() {
  return {
    name: "",
    source_mode: "dataset_column" as SourceMode,
    cost_column: "",
    rate_value: "",
    metric_column: "",
    entries: [{ amount: "", start_date: "", end_date: "" }] as { amount: string; start_date: string; end_date: string }[],
    proxy_variable: NO_PROXY,
  };
}

export function InvestmentChannels({
  datasetId,
  variableNames,
  datasetColumns,
  canEdit,
}: {
  datasetId: string | null;
  variableNames: string[];
  datasetColumns: { name: string; dtype: string }[];
  canEdit: boolean;
}) {
  const [channels, setChannels] = useState<InvestmentChannel[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<InvestmentChannel | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchChannels = useCallback(async () => {
    if (!datasetId) {
      setChannels([]);
      return;
    }
    setLoading(true);
    try {
      const data = await apiFetch<InvestmentChannel[]>(`/economics/channels?dataset_id=${datasetId}`);
      setChannels(data);
    } catch {
      toast.error("Failed to load investment channels");
    } finally {
      setLoading(false);
    }
  }, [datasetId]);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setFormError("");
    setModalOpen(true);
  };

  const openEdit = (channel: InvestmentChannel) => {
    setEditingId(channel.id);
    setForm({
      name: channel.name,
      source_mode: channel.source_mode,
      cost_column: channel.config.cost_column || "",
      rate_value: channel.config.rate_value != null ? String(channel.config.rate_value) : "",
      metric_column: channel.config.metric_column || "",
      entries:
        channel.config.entries && channel.config.entries.length
          ? channel.config.entries.map((e) => ({ amount: String(e.amount), start_date: e.start_date, end_date: e.end_date }))
          : [{ amount: "", start_date: "", end_date: "" }],
      proxy_variable: channel.proxy_variable || NO_PROXY,
    });
    setFormError("");
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setFormError("");
  };

  const addEntryRow = () => {
    setForm((prev) => ({ ...prev, entries: [...prev.entries, { amount: "", start_date: "", end_date: "" }] }));
  };

  const removeEntryRow = (index: number) => {
    setForm((prev) => ({ ...prev, entries: prev.entries.filter((_, i) => i !== index) }));
  };

  const updateEntry = (index: number, field: "amount" | "start_date" | "end_date", value: string) => {
    setForm((prev) => ({
      ...prev,
      entries: prev.entries.map((entry, i) => (i === index ? { ...entry, [field]: value } : entry)),
    }));
  };

  const buildConfig = (): ChannelConfig | null => {
    if (form.source_mode === "dataset_column") {
      if (!form.cost_column) return null;
      return { cost_column: form.cost_column };
    }
    if (form.source_mode === "rate_metric") {
      const rate = parseFloat(form.rate_value);
      if (!form.metric_column || !Number.isFinite(rate)) return null;
      return { rate_value: rate, metric_column: form.metric_column };
    }
    const entries = form.entries
      .filter((e) => e.amount && e.start_date && e.end_date)
      .map((e) => ({ amount: parseFloat(e.amount), start_date: e.start_date, end_date: e.end_date }));
    if (!entries.length) return null;
    return { entries };
  };

  const handleSubmit = async () => {
    const name = form.name.trim();
    if (!name) {
      setFormError("Name cannot be empty");
      return;
    }
    const config = buildConfig();
    if (!config) {
      setFormError("Complete the required fields for the selected source mode");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const proxy_variable = form.proxy_variable === NO_PROXY ? null : form.proxy_variable;
      if (editingId) {
        await apiFetch(`/economics/channels/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            source_mode: form.source_mode,
            config,
            proxy_variable,
            unset_proxy_variable: proxy_variable === null,
          }),
        });
        toast.success(`Channel "${name}" updated`);
      } else {
        await apiFetch("/economics/channels", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataset_id: datasetId, name, source_mode: form.source_mode, config, proxy_variable }),
        });
        toast.success(`Channel "${name}" created`);
      }
      closeModal();
      fetchChannels();
    } catch (error: any) {
      const detail = error instanceof ApiError ? error.detail : null;
      setFormError(detail?.detail || detail?.error || error?.message || "Failed to save channel");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await apiFetch(`/economics/channels/${deleteTarget.id}`, { method: "DELETE" });
      toast.success(`Channel "${deleteTarget.name}" deleted`);
      setDeleteTarget(null);
      fetchChannels();
    } catch (error: any) {
      toast.error((error as Error)?.message || "Failed to delete channel");
    } finally {
      setDeleteLoading(false);
    }
  };

  const columnOptions = useMemo(() => datasetColumns.map((c) => c.name), [datasetColumns]);

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between">
        <CardHeader title="Canales de inversión" subtitle="Costo real por canal, desacoplado de las variables del modelo" />
        <Button
          size="sm"
          onClick={openCreate}
          disabled={!canEdit || !datasetId}
          title={!canEdit ? "Solo lectura: tu rol es Visualizador" : undefined}
        >
          <Plus size={14} className="mr-1 inline" /> Agregar canal
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--color-muted)]">Loading…</p>
      ) : channels.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">
          Sin canales configurados para este dataset. Un canal representa el gasto real ($) de un medio,
          independiente de si su variable entró al modelo.
        </p>
      ) : (
        <div className="space-y-2">
          {channels.map((channel) => (
            <div
              key={channel.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--color-border)] px-4 py-3 text-sm"
            >
              <div className="flex flex-1 flex-wrap items-center gap-2">
                <span className="font-medium">{channel.name}</span>
                <Badge>{SOURCE_MODE_LABEL[channel.source_mode]}</Badge>
                {channel.proxy_variable ? (
                  <Badge variant="success">proxy: {channel.proxy_variable}</Badge>
                ) : (
                  <Badge variant="warning">no modelado</Badge>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="rounded-full p-1.5 text-[var(--color-muted)] hover:text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => openEdit(channel)}
                  disabled={!canEdit}
                  title={!canEdit ? "Solo lectura: tu rol es Visualizador" : "Edit"}
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  className="rounded-full p-1.5 text-[var(--color-muted)] hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => setDeleteTarget(channel)}
                  disabled={!canEdit}
                  title={!canEdit ? "Solo lectura: tu rol es Visualizador" : "Delete"}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={closeModal} title={editingId ? "Editar canal" : "Nuevo canal de inversión"}>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">Nombre</label>
            <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="YouTube" />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">Fuente de inversión</label>
            <select
              className="w-full rounded-full border border-[var(--color-border)] px-3 py-2 bg-transparent text-sm"
              value={form.source_mode}
              onChange={(e) => setForm((p) => ({ ...p, source_mode: e.target.value as SourceMode }))}
            >
              <option value="dataset_column">Columna del dataset</option>
              <option value="rate_metric">Tasa × métrica</option>
              <option value="manual">Manual</option>
            </select>
          </div>

          {form.source_mode === "dataset_column" && (
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">Columna de costo ($)</label>
              <div>
                <Input
                  list="channel-cost-columns"
                  value={form.cost_column}
                  onChange={(e) => setForm((p) => ({ ...p, cost_column: e.target.value }))}
                  placeholder="spend_youtube"
                />
                <datalist id="channel-cost-columns">
                  {columnOptions.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>
            </div>
          )}

          {form.source_mode === "rate_metric" && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">Tasa (ej. CPV)</label>
                <Input
                  type="number"
                  step="0.0001"
                  value={form.rate_value}
                  onChange={(e) => setForm((p) => ({ ...p, rate_value: e.target.value }))}
                  placeholder="0.05"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">Columna de métrica</label>
                <div>
                  <Input
                    list="channel-metric-columns"
                    value={form.metric_column}
                    onChange={(e) => setForm((p) => ({ ...p, metric_column: e.target.value }))}
                    placeholder="youtube_views"
                  />
                  <datalist id="channel-metric-columns">
                    {columnOptions.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </div>
              </div>
            </div>
          )}

          {form.source_mode === "manual" && (
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">Periodos de inversión</label>
              <div className="space-y-2">
                {form.entries.map((entry, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="Monto"
                      value={entry.amount}
                      onChange={(e) => updateEntry(index, "amount", e.target.value)}
                      className="w-28"
                    />
                    <Input
                      type="date"
                      value={entry.start_date}
                      onChange={(e) => updateEntry(index, "start_date", e.target.value)}
                    />
                    <Input
                      type="date"
                      value={entry.end_date}
                      onChange={(e) => updateEntry(index, "end_date", e.target.value)}
                    />
                    <button
                      type="button"
                      className="rounded-full p-1.5 text-[var(--color-muted)] hover:text-red-500"
                      onClick={() => removeEntryRow(index)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <Button variant="ghost" size="sm" onClick={addEntryRow}>
                <Plus size={14} className="mr-1 inline" /> Agregar periodo
              </Button>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
              Variable proxy (modelo)
            </label>
            <select
              className="w-full rounded-full border border-[var(--color-border)] px-3 py-2 bg-transparent text-sm"
              value={form.proxy_variable}
              onChange={(e) => setForm((p) => ({ ...p, proxy_variable: e.target.value }))}
            >
              <option value={NO_PROXY}>— sin variable de modelo (no modelado) —</option>
              {variableNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <p className="text-xs text-[var(--color-muted)]">
              Qué variable del modelo representa este canal. Si no se selecciona, la inversión sigue contando en
              el total pero no se le atribuye contribución/ROI.
            </p>
          </div>

          {formError && <p className="text-sm text-red-500">{formError}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={closeModal} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? "Saving…" : editingId ? "Save changes" : "Create channel"}
            </Button>
          </div>
        </div>
      </Modal>

      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-4">
          <div className="w-full max-w-md rounded-2xl bg-[var(--color-card)] p-6 shadow-lg space-y-4">
            <h3 className="text-lg font-semibold">Delete channel &quot;{deleteTarget.name}&quot;?</h3>
            <p className="text-xs text-red-500">This action cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleteLoading}>
                Cancel
              </Button>
              <Button
                variant="secondary"
                className="bg-red-600 text-white hover:bg-red-600/90"
                onClick={confirmDelete}
                disabled={deleteLoading}
              >
                {deleteLoading ? "Deleting..." : "Delete channel"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
