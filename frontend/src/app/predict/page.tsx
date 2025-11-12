"use client";

import React, { useEffect, useMemo, useState } from 'react';

type Dataset = { id: string; name: string; columns: { name: string; dtype: string }[] };
type Model = { id: string; name: string; dataset_id: string; y_var: string; x_vars: string[]; is_hero: boolean };
type VariableRow = {
  name: string;
  baseline_mean: number;
  adjusted_mean: number;
  contribution: number;
  multiplier: number;
  group_name?: string | null;
  subgroup_name?: string | null;
};
type Scenario = {
  id: string;
  name: string;
  model_id: string;
  adjustments: { variable: string; multiplier: number }[];
  results: { total: number; groups: any[]; variables: VariableRow[] };
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function PredictPage() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDataset, setSelectedDataset] = useState('');
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [variables, setVariables] = useState<VariableRow[]>([]);
  const [adjustments, setAdjustments] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<any | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [scenarioName, setScenarioName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedScenario, setSelectedScenario] = useState<string>('');
  const [timeCol, setTimeCol] = useState('');
  const [freq, setFreq] = useState<'day'|'week'|'month'>('month');
  const [by, setBy] = useState<'group'|'subgroup'>('group');
  const [stacked, setStacked] = useState<{ index: string[]; series: { key: string; values: number[] }[] } | null>(null);

  const fetchDatasets = async () => {
    const res = await fetch(`${API_URL}/datasets`);
    const data = await res.json();
    setDatasets(data);
    if (!selectedDataset && data.length) setSelectedDataset(data[0].id);
  };

  const fetchModels = async (datasetId: string) => {
    const res = await fetch(`${API_URL}/models?dataset_id=${datasetId}`);
    const data = await res.json();
    setModels(data);
    const hero = data.find((m: any) => m.is_hero) || data[0];
    if (hero) setSelectedModel(hero.id);
  };

  const fetchScenarios = async (modelId: string) => {
    const res = await fetch(`${API_URL}/predict/${modelId}/scenarios`);
    if (!res.ok) {
      setScenarios([]);
      setSelectedScenario('');
      return;
    }
    const data = await res.json();
    setScenarios(data);
    setSelectedScenario(data.length ? data[0].id : '');
  };

  const loadPreview = async (adjMap: Record<string, number>) => {
    if (!selectedModel) return;
    setLoading(true); setError(null);
    try {
      const payload = {
        adjustments: Object.entries(adjMap).map(([variable, multiplier]) => ({ variable, multiplier })),
      };
      const res = await fetch(`${API_URL}/predict/${selectedModel}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setPreview(data);
      setVariables(data.variables || []);
      setAdjustments((prev) => {
        const next = { ...prev } as Record<string, number>;
        (data.variables || []).forEach((row: any) => {
          if (next[row.name] === undefined) {
            next[row.name] = typeof row.multiplier === 'number' ? row.multiplier : 1;
          }
        });
        return next;
      });
    } catch (e: any) {
      setError(e?.message || 'Simulation failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDatasets(); }, []);
  useEffect(() => { if (selectedDataset) fetchModels(selectedDataset); }, [selectedDataset]);
  useEffect(() => {
    if (selectedModel) {
      // reset adjustments and load baseline
      const base: Record<string, number> = {};
      setAdjustments(base);
      loadPreview(base);
      fetchScenarios(selectedModel);
    }
  }, [selectedModel]);

  const handleMultiplierChange = (variable: string, value: string) => {
    const num = parseFloat(value);
    setAdjustments((prev) => ({ ...prev, [variable]: isNaN(num) ? 1 : num }));
  };

  const recalc = () => {
    loadPreview(adjustments);
  };

  const saveScenario = async () => {
    if (!scenarioName) {
      setError('Scenario name required');
      return;
    }
    setLoading(true); setError(null);
    try {
      const payload = {
        name: scenarioName,
        adjustments: Object.entries(adjustments).map(([variable, multiplier]) => ({ variable, multiplier })),
      };
      const res = await fetch(`${API_URL}/predict/${selectedModel}/scenarios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      setScenarioName('');
      await fetchScenarios(selectedModel);
    } catch (e: any) {
      setError(e?.message || 'Save scenario failed');
    } finally {
      setLoading(false);
    }
  };

  const deleteScenario = async (id: string) => {
    await fetch(`${API_URL}/predict/${selectedModel}/scenarios/${id}`, { method: 'DELETE' });
    await fetchScenarios(selectedModel);
  };

  const loadScenarioAdjustments = (sc: Scenario) => {
    const map: Record<string, number> = {};
    sc.adjustments.forEach((a) => { map[a.variable] = a.multiplier; });
    setAdjustments(map);
    setScenarioName(sc.name);
    loadPreview(map);
  };

  const generateStacked = async () => {
    if (!selectedScenario || !timeCol) return;
    setLoading(true); setError(null);
    try {
      const url = `${API_URL}/predict/${selectedModel}/scenarios/${selectedScenario}/stacked?time_col=${encodeURIComponent(timeCol)}&freq=${freq}&by=${by}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setStacked(data);
    } catch (e: any) {
      setError(e?.message || 'Stacked failed');
    } finally {
      setLoading(false);
    }
  };

  const timeCols = useMemo(() => {
    const ds = datasets.find(d => d.id === selectedDataset);
    return ds ? ds.columns.map(c => c.name) : [];
  }, [datasets, selectedDataset]);

  const chartData = useMemo(() => {
    if (!stacked) return [] as any[];
    return stacked.index.map((label, i) => {
      const row: any = { period: label };
      stacked.series.forEach((s) => { row[s.key] = s.values[i] || 0; });
      return row;
    });
  }, [stacked]);

  return (
    <main>
      <h2 className="text-xl font-semibold mb-4">Predict & Scenario Simulation</h2>
      {error && <p className="text-red-600 mb-3">{error}</p>}

      <div className="flex flex-wrap gap-3 items-center mb-4">
        <div>
          <label className="mr-2">Dataset</label>
          <select className="border rounded px-2 py-1" value={selectedDataset} onChange={(e) => setSelectedDataset(e.target.value)}>
            {datasets.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label className="mr-2">Model</label>
          <select className="border rounded px-2 py-1" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
            {models.map(m => <option key={m.id} value={m.id}>{m.name}{m.is_hero ? ' (Hero)' : ''}</option>)}
          </select>
        </div>
        <button className="px-3 py-1.5 rounded bg-blue-600 text-white" onClick={recalc} disabled={loading}>Recalculate</button>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <section className="lg:col-span-2 p-4 bg-white rounded border">
          <h3 className="font-medium mb-3">Scenario Builder</h3>
          <div className="mb-3 flex gap-2 items-center">
            <input className="border rounded px-2 py-1" placeholder="Scenario name" value={scenarioName} onChange={(e) => setScenarioName(e.target.value)} />
            <button className="px-3 py-1.5 rounded bg-green-600 text-white" onClick={saveScenario} disabled={!scenarioName || loading}>Save Scenario</button>
          </div>
          <div className="overflow-auto max-h-[420px]">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-2 py-1 text-left">Variable</th>
                  <th className="px-2 py-1 text-left">Baseline Mean</th>
                  <th className="px-2 py-1 text-left">Multiplier</th>
                  <th className="px-2 py-1 text-left">Adj Mean</th>
                  <th className="px-2 py-1 text-left">Contribution</th>
                </tr>
              </thead>
              <tbody>
                {variables.map((row) => (
                  <tr key={row.name} className="odd:bg-white even:bg-gray-50">
                    <td className="px-2 py-1">{row.name}</td>
                    <td className="px-2 py-1">{row.baseline_mean.toFixed(2)}</td>
                    <td className="px-2 py-1">
                      <input
                        type="number"
                        step="0.05"
                        className="border rounded px-2 py-1 w-24"
                        value={adjustments[row.name] ?? 1}
                        onChange={(e) => handleMultiplierChange(row.name, e.target.value)}
                      />
                    </td>
                    <td className="px-2 py-1">{row.adjusted_mean?.toFixed(2)}</td>
                    <td className="px-2 py-1">{row.contribution?.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="p-4 bg-white rounded border">
          <h3 className="font-medium mb-3">Preview</h3>
          {preview ? (
            <div className="space-y-3">
              <p className="text-lg font-semibold">Predicted Total: {preview.total?.toFixed(2)}</p>
              <div>
                <h4 className="font-medium mb-1">Group Contributions</h4>
                <ul className="space-y-1 text-sm">
                  {preview.groups?.map((g: any) => (
                    <li key={g.group_id}>{g.group_name || 'Unassigned'}: {g.contribution.toFixed(2)}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <p className="text-gray-500">Adjust multipliers and click Recalculate.</p>
          )}
        </section>
      </div>

      <section className="p-4 bg-white rounded border mt-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium">Saved Scenarios (max 3)</h3>
        </div>
        {scenarios.length === 0 ? (
          <p className="text-gray-500 text-sm">No scenarios saved yet.</p>
        ) : (
          <div className="grid md:grid-cols-3 gap-3">
            {scenarios.map((sc) => (
              <div key={sc.id} className={`border rounded p-3 ${selectedScenario === sc.id ? 'border-blue-600' : 'border-gray-200'}`}>
                <div className="flex justify-between items-center mb-2">
                  <h4 className="font-semibold">{sc.name}</h4>
                  <button className="text-xs text-red-600" onClick={() => deleteScenario(sc.id)}>Delete</button>
                </div>
                <p className="text-sm">Total: {sc.results?.total?.toFixed(2)}</p>
                <button className="text-xs text-blue-600 underline mr-2" onClick={() => loadScenarioAdjustments(sc)}>Load</button>
                <button className="text-xs text-blue-600 underline" onClick={() => setSelectedScenario(sc.id)}>Select</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="p-4 bg-white rounded border mt-4">
        <h3 className="font-medium mb-3">Scenario Breakdown Over Time</h3>
        <div className="flex flex-wrap gap-3 items-center mb-3">
          <select className="border rounded px-2 py-1" value={selectedScenario} onChange={(e) => setSelectedScenario(e.target.value)}>
            <option value="">Scenario</option>
            {scenarios.map(sc => <option key={sc.id} value={sc.id}>{sc.name}</option>)}
          </select>
          <select className="border rounded px-2 py-1" value={timeCol} onChange={(e) => setTimeCol(e.target.value)}>
            <option value="">Time column</option>
            {timeCols.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="border rounded px-2 py-1" value={freq} onChange={(e) => setFreq(e.target.value as any)}>
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
          <select className="border rounded px-2 py-1" value={by} onChange={(e) => setBy(e.target.value as any)}>
            <option value="group">Group</option>
            <option value="subgroup">Subgroup</option>
          </select>
          <button className="px-3 py-1.5 rounded bg-blue-600 text-white" onClick={generateStacked} disabled={!selectedScenario || !timeCol}>Generate</button>
        </div>
        {stacked && (
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-2 py-1 text-left">Period</th>
                  {stacked.series.map((s) => (
                    <th key={s.key} className="px-2 py-1 text-left">{s.key}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {chartData.map((row) => (
                  <tr key={row.period} className="odd:bg-white even:bg-gray-50">
                    <td className="px-2 py-1">{row.period}</td>
                    {stacked.series.map((s) => (
                      <td key={s.key + row.period} className="px-2 py-1">{(row[s.key] ?? 0).toFixed(2)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
