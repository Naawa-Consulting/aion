"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

type Dataset = { id: string; name: string; columns: { name: string; dtype: string }[] };
type Model = { id: string; name: string; dataset_id: string; y_var: string; x_vars: string[]; is_hero: boolean };

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function AnalysisPage() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<string>('');
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [summary, setSummary] = useState<any | null>(null);
  const [timeCol, setTimeCol] = useState<string>('');
  const [freq, setFreq] = useState<'day'|'week'|'month'>('month');
  const [by, setBy] = useState<'group'|'subgroup'>('group');
  const [stacked, setStacked] = useState<{ index: string[]; series: { key: string; values: number[] }[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const fetchSummary = async (modelId: string) => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_URL}/analysis/${modelId}/summary?include_intercept=true`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setSummary(data);
    } catch (e: any) { setError(e?.message || 'Load summary failed'); } finally { setLoading(false); }
  };

  const fetchStacked = async () => {
    if (!selectedModel || !timeCol) return;
    setLoading(true); setError(null);
    try {
      const url = `${API_URL}/analysis/${selectedModel}/stacked?time_col=${encodeURIComponent(timeCol)}&freq=${freq}&by=${by}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setStacked(data);
    } catch (e: any) { setError(e?.message || 'Load stacked failed'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchDatasets(); }, []);
  useEffect(() => { if (selectedDataset) fetchModels(selectedDataset); }, [selectedDataset]);
  useEffect(() => { if (selectedModel) fetchSummary(selectedModel); }, [selectedModel]);

  const timeCols = useMemo(() => {
    const ds = datasets.find(d => d.id === selectedDataset);
    return ds ? ds.columns.map(c => c.name) : [];
  }, [datasets, selectedDataset]);

  const chartData = useMemo(() => {
    if (!stacked) return [] as any[];
    const keys = stacked.series.map(s => s.key);
    return stacked.index.map((label, i) => {
      const row: any = { period: label };
      stacked.series.forEach(s => { row[s.key] = s.values[i] || 0; });
      return row;
    });
  }, [stacked]);

  const downloadSummary = async () => {
    if (!selectedModel) return;
    const url = `${API_URL}/analysis/${selectedModel}/export/summary.xlsx`;
    const res = await fetch(url);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'summary.xlsx';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const downloadStacked = async () => {
    if (!selectedModel || !timeCol) return;
    const url = `${API_URL}/analysis/${selectedModel}/export/stacked.xlsx?time_col=${encodeURIComponent(timeCol)}&freq=${freq}&by=${by}`;
    const res = await fetch(url);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'stacked.xlsx';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <main>
      <h2 className="text-xl font-semibold mb-4">Analysis</h2>
      {error && <p className="text-red-600 mb-3">{error}</p>}

      <div className="mb-4 flex flex-wrap gap-3 items-center">
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
        <button className="px-3 py-1.5 rounded bg-blue-600 text-white" onClick={downloadSummary}>Download Summary (Excel)</button>
      </div>

      {summary && (
        <div className="grid md:grid-cols-2 gap-4">
          <section className="p-4 bg-white rounded border">
            <h3 className="font-medium mb-3">Variable Contributions</h3>
            <div className="overflow-auto max-h-80">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-2 py-1 text-left">Variable</th>
                    <th className="px-2 py-1 text-left">Coef</th>
                    <th className="px-2 py-1 text-left">Mean</th>
                    <th className="px-2 py-1 text-left">Contribution</th>
                    <th className="px-2 py-1 text-left">Group</th>
                    <th className="px-2 py-1 text-left">Subgroup</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.variables.map((r: any) => (
                    <tr key={r.name} className="odd:bg-white even:bg-gray-50">
                      <td className="px-2 py-1">{r.name}</td>
                      <td className="px-2 py-1">{r.coef.toFixed(4)}</td>
                      <td className="px-2 py-1">{r.mean.toFixed(2)}</td>
                      <td className="px-2 py-1">{r.contribution.toFixed(2)}</td>
                      <td className="px-2 py-1">{r.group_name || '-'}</td>
                      <td className="px-2 py-1">{r.subgroup_name || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="p-4 bg-white rounded border">
            <h3 className="font-medium mb-3">Group Totals</h3>
            <div className="overflow-auto max-h-80">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-2 py-1 text-left">Group</th>
                    <th className="px-2 py-1 text-left">Contribution</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.groups.map((g: any) => (
                    <tr key={g.group_id} className="odd:bg-white even:bg-gray-50">
                      <td className="px-2 py-1">{g.group_name || '-'}</td>
                      <td className="px-2 py-1">{g.contribution.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      <section className="p-4 bg-white rounded border mt-4">
        <h3 className="font-medium mb-3">Stacked Contributions Over Time</h3>
        <div className="flex flex-wrap gap-3 items-center mb-3">
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
          <button className="px-3 py-1.5 rounded bg-blue-600 text-white" onClick={fetchStacked}>Generate</button>
          <button className="px-3 py-1.5 rounded bg-green-600 text-white" onClick={downloadStacked} disabled={!stacked}>Download Excel</button>
        </div>

        {stacked && (
          <div style={{ width: '100%', height: 360 }}>
            <ResponsiveContainer>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="period" />
                <YAxis />
                <Tooltip />
                <Legend />
                {stacked.series.map((s) => (
                  <Bar key={s.key} dataKey={s.key} stackId="a" fill={`#${(Math.abs(hashCode(s.key)) % 0xFFFFFF).toString(16).padStart(6,'0')}`} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
    </main>
  );
}

function hashCode(str: string): number {
  let hash = 0; for (let i = 0; i < str.length; i++) { hash = ((hash << 5) - hash) + str.charCodeAt(i); hash |= 0; }
  return hash;
}

