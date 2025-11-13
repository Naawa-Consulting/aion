"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
  Cell,
} from "recharts";
import { toast } from "sonner";

import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Dataset = { id: string; display_name: string; columns: { name: string; dtype: string }[] };
type Variable = { id: string; name: string; dtype: string };
type CorrelationItem = { name: string; corr: number; dtype: string };
type ModelMetrics = {
  r2: number;
  adj_r2: number;
  durbin_watson: number;
  mae: number;
  rmse: number;
  mape?: number | null;
  vif: { name: string; vif: number }[];
};
type Model = {
  id: string;
  name: string;
  dataset_id: string;
  y_var: string;
  x_vars: string[];
  is_hero: boolean;
  role: "hero" | "challenger1" | "challenger2" | "none";
  metrics: ModelMetrics;
};
type ModelSummary = {
  model_id: string;
  intercept: Coefficient;
  coefficients: Coefficient[];
};
type Coefficient = {
  name: string;
  coef: number;
  std_err: number;
  t_value: number;
  p_value: number;
  vif?: number | null;
};
type Predictions = {
  index: string[];
  y_true: number[];
  y_pred: number[];
  residuals: number[];
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function ModelingPage() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<string>("");
  const [variables, setVariables] = useState<Variable[]>([]);
  const [yVar, setYVar] = useState("");
  const [xSelected, setXSelected] = useState<string[]>([]);
  const [modelName, setModelName] = useState("");
  const [corr, setCorr] = useState<CorrelationItem[]>([]);
  const [corrSearch, setCorrSearch] = useState("");
  const [models, setModels] = useState<Model[]>([]);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [summary, setSummary] = useState<ModelSummary | null>(null);
  const [predictions, setPredictions] = useState<Predictions | null>(null);
  const [showResiduals, setShowResiduals] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchDatasets();
  }, []);

  useEffect(() => {
    if (selectedDataset) {
      fetchVariables(selectedDataset);
      fetchModels(selectedDataset);
    }
  }, [selectedDataset]);

  useEffect(() => {
    if (selectedDataset && yVar) {
      fetchCorrelations(selectedDataset, yVar);
    }
  }, [selectedDataset, yVar]);

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

  const fetchDatasets = async () => {
    try {
      const res = await fetch(`${API_URL}/datasets`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setDatasets(data);
      if (!selectedDataset && data.length) {
        setSelectedDataset(data[0].id);
      }
    } catch {
      toast.error("Failed to load datasets");
    }
  };

  const fetchVariables = async (datasetId: string) => {
    try {
      const res = await fetch(`${API_URL}/variables?dataset_id=${datasetId}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const mapped: Variable[] = data.map((v: any) => ({ id: v.id, name: v.name, dtype: v.dtype }));
      setVariables(mapped);
      const numeric = mapped.find((v) => /int|float|double|decimal|number/i.test(v.dtype));
      if (!yVar && numeric) setYVar(numeric.name);
    } catch {
      toast.error("Failed to load variables");
    }
  };

  const fetchModels = async (datasetId: string) => {
    try {
      const res = await fetch(`${API_URL}/models?dataset_id=${datasetId}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setModels(data);
    } catch {
      toast.error("Failed to load models");
    }
  };

  const fetchCorrelations = async (datasetId: string, y: string) => {
    try {
      const res = await fetch(`${API_URL}/models/correlations?dataset_id=${datasetId}&y=${encodeURIComponent(y)}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setCorr(data.items);
    } catch {
      toast.error("Failed to compute correlations");
    }
  };

  const fetchSummary = async (modelId: string) => {
    try {
      const res = await fetch(`${API_URL}/models/${modelId}/summary`);
      if (!res.ok) throw new Error();
      setSummary(await res.json());
    } catch {
      setSummary(null);
    }
  };

  const fetchPredictions = async (modelId: string) => {
    try {
      const res = await fetch(`${API_URL}/models/${modelId}/predictions?granularity=auto`);
      if (!res.ok) throw new Error();
      setPredictions(await res.json());
    } catch {
      setPredictions(null);
    }
  };

  const handleToggleX = (name: string) => {
    setXSelected((prev) => (prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]));
  };

  const handleSubmit = async () => {
    if (!selectedDataset || !yVar || xSelected.length === 0 || !modelName.trim()) {
      toast.error("Provide a name, target, and predictors");
      return;
    }
    setLoading(true);
    try {
      if (editingModelId) {
        const res = await fetch(`${API_URL}/models/${editingModelId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: modelName, x_vars: xSelected }),
        });
        if (!res.ok) throw new Error(await res.text());
        toast.success("Model updated");
      } else {
        const res = await fetch(`${API_URL}/models`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataset_id: selectedDataset, name: modelName, y_var: yVar, x_vars: xSelected }),
        });
        if (!res.ok) throw new Error(await res.text());
        toast.success("Model created");
      }
      await fetchModels(selectedDataset);
      resetForm();
    } catch (err: any) {
      toast.error(err?.message || "Could not save model");
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setModelName("");
    setXSelected([]);
    setEditingModelId(null);
  };

  const startEdit = (model: Model) => {
    setEditingModelId(model.id);
    setModelName(model.name);
    setYVar(model.y_var);
    setXSelected(model.x_vars);
  };

  const deleteModel = async (model: Model) => {
    if (!confirm(`Delete model ${model.name}?`)) return;
    try {
      const res = await fetch(`${API_URL}/models/${model.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Model deleted");
      fetchModels(selectedDataset);
    } catch (err: any) {
      toast.error(err?.message || "Failed to delete");
    }
  };

  const setRole = async (model: Model, role: Model["role"]) => {
    try {
      const res = await fetch(`${API_URL}/models/${model.id}/role`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(`Marked as ${role}`);
      fetchModels(selectedDataset);
    } catch (err: any) {
      toast.error(err?.message || "Failed to set role");
    }
  };

  const correlationData = useMemo(() => {
    const filtered = corr.filter((item) => item.name.toLowerCase().includes(corrSearch.toLowerCase()));
    return filtered.map((item) => ({ ...item, abs: Math.abs(item.corr) }));
  }, [corr, corrSearch]);

  const heroModel = models.find((m) => m.role === "hero");
  const challenger1 = models.find((m) => m.role === "challenger1");
  const challenger2 = models.find((m) => m.role === "challenger2");
  const compareModels = [heroModel, challenger1, challenger2].filter(Boolean) as Model[];

  const comparisonRows = [
    { label: "R²", value: (m: Model) => m.metrics.r2.toFixed(3) },
    { label: "Adj R²", value: (m: Model) => m.metrics.adj_r2.toFixed(3) },
    { label: "VIF max", value: (m: Model) => Math.max(...m.metrics.vif.map((v) => v.vif)).toFixed(2) },
    {
      label: "VIF mean",
      value: (m: Model) =>
        (m.metrics.vif.reduce((sum, item) => sum + item.vif, 0) / Math.max(1, m.metrics.vif.length)).toFixed(2),
    },
    { label: "Durbin–Watson", value: (m: Model) => m.metrics.durbin_watson.toFixed(2) },
    { label: "MAE", value: (m: Model) => m.metrics.mae.toFixed(2) },
    { label: "RMSE", value: (m: Model) => m.metrics.rmse.toFixed(2) },
    { label: "MAPE", value: (m: Model) => (m.metrics.mape ?? 0).toFixed(1) + "%" },
  ];

  const predictionSeries = useMemo(() => {
    if (!predictions) return [];
    return predictions.index.map((label, idx) => ({
      label,
      y_true: predictions.y_true[idx],
      y_pred: predictions.y_pred[idx],
      residual: predictions.residuals[idx],
    }));
  }, [predictions]);

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-[var(--color-muted)]">Module 3</p>
          <h1 className="text-2xl font-semibold tracking-tight">Modeling</h1>
        </div>
        <div className="flex gap-3 items-center">
          <div>
            <label className="text-xs uppercase text-[var(--color-muted)]">Dataset</label>
            <select
              className="ml-2 rounded-full border border-[var(--color-border)] px-4 py-2 bg-transparent"
              value={selectedDataset}
              onChange={(e) => {
                setSelectedDataset(e.target.value);
                resetForm();
              }}
            >
              {datasets.map((ds) => (
                <option key={ds.id} value={ds.id}>
                  {ds.display_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs uppercase text-[var(--color-muted)]">Dependent variable</label>
            <select
              className="ml-2 rounded-full border border-[var(--color-border)] px-4 py-2 bg-transparent"
              value={yVar}
              onChange={(e) => setYVar(e.target.value)}
            >
              <option value="">Select Y</option>
              {variables.map((v) => (
                <option key={v.id} value={v.name}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[360px,1fr]">
        <Card className="space-y-4">
          <CardHeader title="Correlations" subtitle="Choose predictors" />
          <Input placeholder="Search variables" value={corrSearch} onChange={(e) => setCorrSearch(e.target.value)} />
          <div className="h-[420px] overflow-y-auto pr-2">
            <BarChart layout="vertical" width={320} height={Math.max(200, correlationData.length * 26)} data={correlationData}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" hide domain={[0, 1]} />
              <YAxis dataKey="name" type="category" width={100} />
              <Tooltip formatter={(value: number, _, entry) => [`${entry.payload.corr.toFixed(3)}`, "corr"]} />
              <Bar dataKey="abs" fill="var(--color-accent)" radius={[0, 6, 6, 0]}>
                {correlationData.map((entry) => (
                  <Cell key={entry.name} fill={xSelected.includes(entry.name) ? "var(--color-accent)" : "var(--color-border)"} />
                ))}
              </Bar>
            </BarChart>
            <div className="space-y-2 mt-4">
              {correlationData.map((item) => (
                <label key={item.name} className="flex items-center justify-between text-sm">
                  <span>
                    {item.name} <span className="text-xs text-[var(--color-muted)]">({item.corr.toFixed(3)})</span>
                  </span>
                  <input type="checkbox" checked={xSelected.includes(item.name)} onChange={() => handleToggleX(item.name)} />
                </label>
              ))}
            </div>
          </div>
        </Card>

        <Card className="space-y-4">
          <CardHeader title={editingModelId ? "Edit model" : "Create model"} subtitle="Select variables and save" />
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs uppercase text-[var(--color-muted)]">Model name</label>
              <Input value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="Hero Model" />
            </div>
            <div className="space-y-2">
              <label className="text-xs uppercase text-[var(--color-muted)]">Predictors selected</label>
              <p className="text-sm text-[var(--color-muted)]">{xSelected.join(", ") || "None"}</p>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            {editingModelId && (
              <Button variant="ghost" onClick={resetForm}>
                Cancel
              </Button>
            )}
            <Button onClick={handleSubmit} disabled={loading}>
              {loading ? "Saving..." : editingModelId ? "Update model" : "Create model"}
            </Button>
          </div>
        </Card>
      </div>

      <Card className="space-y-4">
        <CardHeader title="Models" subtitle="Manage hero and challengers" />
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--color-bg)]/70">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Role</th>
                <th className="px-3 py-2 text-left">R²</th>
                <th className="px-3 py-2 text-left">Adj R²</th>
                <th className="px-3 py-2 text-left">MAE</th>
                <th className="px-3 py-2 text-left">RMSE</th>
                <th className="px-3 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.id} className="odd:bg-transparent even:bg-[var(--color-border)]/20">
                  <td className="px-3 py-2 font-medium">{m.name}</td>
                  <td className="px-3 py-2">
                    <Badge>{m.role === "none" ? "—" : m.role}</Badge>
                  </td>
                  <td className="px-3 py-2">{m.metrics.r2.toFixed(3)}</td>
                  <td className="px-3 py-2">{m.metrics.adj_r2.toFixed(3)}</td>
                  <td className="px-3 py-2">{m.metrics.mae.toFixed(2)}</td>
                  <td className="px-3 py-2">{m.metrics.rmse.toFixed(2)}</td>
                  <td className="px-3 py-2 space-x-2">
                    <Button variant="ghost" size="sm" onClick={() => startEdit(m)}>
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => deleteModel(m)}>
                      Delete
                    </Button>
                    {m.role !== "hero" && (
                      <Button variant="secondary" size="sm" onClick={() => setRole(m, "hero")}>
                        Hero
                      </Button>
                    )}
                    {m.role !== "challenger1" && (
                      <Button variant="secondary" size="sm" onClick={() => setRole(m, "challenger1")}>
                        Ch. 1
                      </Button>
                    )}
                    {m.role !== "challenger2" && (
                      <Button variant="secondary" size="sm" onClick={() => setRole(m, "challenger2")}>
                        Ch. 2
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="space-y-4">
        <CardHeader title="Comparison" subtitle="Hero vs Challengers" />
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--color-bg)]/70">
              <tr>
                <th className="px-3 py-2 text-left">Metric</th>
                {compareModels.map((m) => (
                  <th key={m.id} className="px-3 py-2 text-left">
                    {m.name} {m.role === "hero" && <Badge>Hero</Badge>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map((row) => (
                <tr key={row.label} className="odd:bg-transparent even:bg-[var(--color-border)]/20">
                  <td className="px-3 py-2 font-medium">{row.label}</td>
                  {compareModels.map((m) => (
                    <td key={m.id} className="px-3 py-2">
                      {row.value(m)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {compareModels.length > 1 && (
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={compareModels.map((m) => ({ name: m.name, r2: m.metrics.r2, mae: m.metrics.mae }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="r2" fill="var(--color-accent)" />
                <Bar dataKey="mae" fill="var(--color-muted)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-4">
          <CardHeader title="Hero Model Summary" subtitle="Coefficients & diagnostics" />
          {summary ? (
            <div className="overflow-auto max-h-[360px] pr-2">
              <table className="min-w-full text-sm">
                <thead className="bg-[var(--color-bg)]/70">
                  <tr>
                    <th className="px-3 py-2 text-left">Variable</th>
                    <th className="px-3 py-2 text-left">Beta</th>
                    <th className="px-3 py-2 text-left">Std Err</th>
                    <th className="px-3 py-2 text-left">t</th>
                    <th className="px-3 py-2 text-left">p</th>
                    <th className="px-3 py-2 text-left">VIF</th>
                  </tr>
                </thead>
                <tbody>
                  {[summary.intercept, ...summary.coefficients].map((item) => (
                    <tr key={item.name} className="odd:bg-transparent even:bg-[var(--color-border)]/20">
                      <td className="px-3 py-2">{item.name}</td>
                      <td className="px-3 py-2">{item.coef.toFixed(4)}</td>
                      <td className="px-3 py-2">{item.std_err.toFixed(4)}</td>
                      <td className="px-3 py-2">{item.t_value.toFixed(2)}</td>
                      <td className="px-3 py-2">{item.p_value.toExponential(2)}</td>
                      <td className="px-3 py-2">{item.vif != null ? item.vif.toFixed(2) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-[var(--color-muted)]">Select a Hero model to view details.</p>
          )}
        </Card>

        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <CardHeader title="Actual vs Model" subtitle="Toggle residuals for diagnostics" />
            <label className="text-xs flex items-center gap-2">
              <input type="checkbox" checked={showResiduals} onChange={(e) => setShowResiduals(e.target.checked)} />
              Residuals
            </label>
          </div>
          {predictionSeries.length ? (
            <div className="h-72">
              <ResponsiveContainer>
                <LineChart data={predictionSeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" hide={predictionSeries.length > 30} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  {showResiduals ? (
                    <Line type="monotone" dataKey="residual" stroke="#ef4444" dot={false} name="Residual" />
                  ) : (
                    <>
                      <Line type="monotone" dataKey="y_true" stroke="#2563eb" dot={false} name="Actual" />
                      <Line type="monotone" dataKey="y_pred" stroke="#22c55e" dot={false} name="Model" />
                    </>
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-[var(--color-muted)]">No prediction data yet.</p>
          )}
        </Card>
      </div>
    </section>
  );
}
