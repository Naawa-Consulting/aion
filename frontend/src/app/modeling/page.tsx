"use client";

import React, { useEffect, useMemo, useState } from 'react';

type Dataset = { id: string; name: string; columns: { name: string; dtype: string }[] };
type Variable = { id: string; name: string; dtype: string; is_derived: boolean };
type CorrItem = { name: string; corr: number; dtype: string };
type CorrResp = { y: string; items: CorrItem[] };
type ModelMetrics = { r2: number; adj_r2: number; durbin_watson: number; mape?: number | null; mae: number; rmse: number; vif: { name: string; vif: number }[] };
type Model = { id: string; name: string; dataset_id: string; y_var: string; x_vars: string[]; is_hero: boolean; metrics: ModelMetrics };

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function ModelingPage() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<string>('');
  const [variables, setVariables] = useState<Variable[]>([]);
  const [yVar, setYVar] = useState('');
  const [xSelected, setXSelected] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [corr, setCorr] = useState<CorrItem[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDatasets = async () => {
    const res = await fetch(`${API_URL}/datasets`);
    const data = await res.json();
    setDatasets(data);
    if (!selectedDataset && data.length) setSelectedDataset(data[0].id);
  };

  const fetchVariables = async (datasetId: string) => {
    const res = await fetch(`${API_URL}/variables?dataset_id=${datasetId}`);
    const data = await res.json();
    setVariables(data);
  };

  const fetchModels = async (datasetId: string) => {
    const res = await fetch(`${API_URL}/models?dataset_id=${datasetId}`);
    const data = await res.json();
    setModels(data);
  };

  const fetchCorr = async () => {
    if (!selectedDataset || !yVar) return;
    const res = await fetch(`${API_URL}/models/correlations?dataset_id=${selectedDataset}&y=${encodeURIComponent(yVar)}`);
    if (!res.ok) return setCorr([]);
    const data: CorrResp = await res.json();
    setCorr(data.items);
  };

  useEffect(() => { fetchDatasets(); }, []);
  useEffect(() => { if (selectedDataset) { fetchVariables(selectedDataset); fetchModels(selectedDataset); } }, [selectedDataset]);
  useEffect(() => { fetchCorr(); }, [yVar, selectedDataset]);

  const numericVars = useMemo(() => variables.filter(v => /int|float|double|decimal|number/i.test(v.dtype)), [variables]);
  const xCandidates = useMemo(() => numericVars.filter(v => v.name !== yVar).map(v => v.name), [numericVars, yVar]);

  const toggleX = (name: string) => {
    setXSelected(prev => prev.includes(name) ? prev.filter(x => x !== name) : [...prev, name]);
  };

  const createModel = async () => {
    if (!selectedDataset || !yVar || xSelected.length === 0 || !name) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_URL}/models`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataset_id: selectedDataset, name, y_var: yVar, x_vars: xSelected }) });
      if (!res.ok) throw new Error(await res.text());
      await fetchModels(selectedDataset);
      setName('');
    } catch (e: any) { setError(e?.message || 'Create model failed'); } finally { setLoading(false); }
  };

  const markHero = async (id: string) => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_URL}/models/${id}/hero`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      await fetchModels(selectedDataset);
    } catch (e: any) { setError(e?.message || 'Mark hero failed'); } finally { setLoading(false); }
  };

  const topModels = useMemo(() => {
    const sorted = [...models].sort((a, b) => (b.is_hero ? 1 : 0) - (a.is_hero ? 1 : 0) || b.metrics.r2 - a.metrics.r2);
    return sorted.slice(0, 3);
  }, [models]);

  return (
    <main>
      <h2 className="text-xl font-semibold mb-4">Modeling</h2>
      {error && <p className="text-red-600 mb-3">{error}</p>}

      <div className="mb-4 flex flex-wrap gap-3 items-center">
        <div>
          <label className="mr-2">Dataset</label>
          <select className="border rounded px-2 py-1" value={selectedDataset} onChange={(e) => setSelectedDataset(e.target.value)}>
            {datasets.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label className="mr-2">Dependent (Y)</label>
          <select className="border rounded px-2 py-1" value={yVar} onChange={(e) => setYVar(e.target.value)}>
            <option value="">--</option>
            {numericVars.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
          </select>
        </div>
        <div>
          <input className="border rounded px-2 py-1" placeholder="Model name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <button className="px-3 py-1.5 rounded bg-blue-600 text-white" disabled={loading || !name || !yVar || xSelected.length === 0} onClick={createModel}>
          {loading ? 'Creating...' : 'Create Model'}
        </button>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <section className="p-4 bg-white rounded border">
          <h3 className="font-medium mb-3">Correlations to {yVar || 'Y'}</h3>
          <div className="max-h-72 overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-2 py-1 text-left">Variable</th>
                  <th className="px-2 py-1 text-left">Corr</th>
                  <th className="px-2 py-1 text-left">Select</th>
                </tr>
              </thead>
              <tbody>
                {corr.map(item => (
                  <tr key={item.name} className="odd:bg-white even:bg-gray-50">
                    <td className="px-2 py-1">{item.name}</td>
                    <td className="px-2 py-1">{item.corr.toFixed(3)}</td>
                    <td className="px-2 py-1">
                      <input type="checkbox" checked={xSelected.includes(item.name)} onChange={() => toggleX(item.name)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="p-4 bg-white rounded border">
          <h3 className="font-medium mb-3">Models</h3>
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-2 py-1 text-left">Name</th>
                  <th className="px-2 py-1 text-left">Hero</th>
                  <th className="px-2 py-1 text-left">R²</th>
                  <th className="px-2 py-1 text-left">Adj R²</th>
                  <th className="px-2 py-1 text-left">DW</th>
                  <th className="px-2 py-1 text-left">MAE</th>
                  <th className="px-2 py-1 text-left">RMSE</th>
                  <th className="px-2 py-1 text-left">MAPE</th>
                  <th className="px-2 py-1 text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {models.map(m => (
                  <tr key={m.id} className="odd:bg-white even:bg-gray-50">
                    <td className="px-2 py-1">{m.name}</td>
                    <td className="px-2 py-1">{m.is_hero ? 'Yes' : '-'}</td>
                    <td className="px-2 py-1">{m.metrics.r2.toFixed(3)}</td>
                    <td className="px-2 py-1">{m.metrics.adj_r2.toFixed(3)}</td>
                    <td className="px-2 py-1">{m.metrics.durbin_watson.toFixed(2)}</td>
                    <td className="px-2 py-1">{m.metrics.mae.toFixed(2)}</td>
                    <td className="px-2 py-1">{m.metrics.rmse.toFixed(2)}</td>
                    <td className="px-2 py-1">{m.metrics.mape != null ? m.metrics.mape.toFixed(1) + '%' : '-'}</td>
                    <td className="px-2 py-1">
                      {!m.is_hero && <button className="px-2 py-1 rounded bg-blue-600 text-white" onClick={() => markHero(m.id)}>Make Hero</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="p-4 bg-white rounded border mt-4">
        <h3 className="font-medium mb-3">Compare (Hero + Challengers)</h3>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-2 py-1 text-left">Metric</th>
                {topModels.map(m => <th key={m.id} className="px-2 py-1 text-left">{m.name}{m.is_hero ? ' (Hero)' : ''}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="px-2 py-1">R²</td>
                {topModels.map(m => <td key={m.id + 'r2'} className="px-2 py-1">{m.metrics.r2.toFixed(3)}</td>)}
              </tr>
              <tr>
                <td className="px-2 py-1">Adj R²</td>
                {topModels.map(m => <td key={m.id + 'adj'} className="px-2 py-1">{m.metrics.adj_r2.toFixed(3)}</td>)}
              </tr>
              <tr>
                <td className="px-2 py-1">Durbin–Watson</td>
                {topModels.map(m => <td key={m.id + 'dw'} className="px-2 py-1">{m.metrics.durbin_watson.toFixed(2)}</td>)}
              </tr>
              <tr>
                <td className="px-2 py-1">MAE</td>
                {topModels.map(m => <td key={m.id + 'mae'} className="px-2 py-1">{m.metrics.mae.toFixed(2)}</td>)}
              </tr>
              <tr>
                <td className="px-2 py-1">RMSE</td>
                {topModels.map(m => <td key={m.id + 'rmse'} className="px-2 py-1">{m.metrics.rmse.toFixed(2)}</td>)}
              </tr>
              <tr>
                <td className="px-2 py-1">MAPE</td>
                {topModels.map(m => <td key={m.id + 'mape'} className="px-2 py-1">{m.metrics.mape != null ? m.metrics.mape.toFixed(1) + '%' : '-'}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

