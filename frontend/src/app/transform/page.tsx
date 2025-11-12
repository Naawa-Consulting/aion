"use client";

import React, { useEffect, useMemo, useState } from 'react';

type Dataset = {
  id: string; name: string; n_rows: number; n_cols: number;
  columns: { name: string; dtype: string }[];
};

type Variable = {
  id: string; dataset_id: string; name: string; dtype: string; is_derived: boolean;
  group_id?: string | null; group_name?: string | null; subgroup_id?: string | null; subgroup_name?: string | null;
};

type Group = { id: string; name: string; subgroups: { id: string; name: string; group_id: string }[] };

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function TransformPage() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<string>('');
  const [variables, setVariables] = useState<Variable[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [op, setOp] = useState<'lag'|'decay'|'log'|'add'|'sub'|'mul'|'div'>('lag');
  const [column, setColumn] = useState('');
  const [n, setN] = useState<number>(1);
  const [alpha, setAlpha] = useState<number>(0.5);
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const [newName, setNewName] = useState('');
  const [assignVar, setAssignVar] = useState('');
  const [assignSubgroup, setAssignSubgroup] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [newSubgroupName, setNewSubgroupName] = useState('');
  const [newSubgroupGroupId, setNewSubgroupGroupId] = useState('');
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

  const fetchGroups = async () => {
    const res = await fetch(`${API_URL}/groups`);
    const data = await res.json();
    setGroups(data);
  };

  useEffect(() => { fetchDatasets(); fetchGroups(); }, []);
  useEffect(() => { if (selectedDataset) fetchVariables(selectedDataset); }, [selectedDataset]);

  const doTransform = async () => {
    if (!selectedDataset) return;
    setLoading(true); setError(null);
    try {
      const payload: any = { dataset_id: selectedDataset, op, new_name: newName };
      if (op === 'lag') { payload.column = column; payload.n = n; }
      else if (op === 'decay') { payload.column = column; payload.alpha = alpha; }
      else if (op === 'log') { payload.column = column; }
      else { payload.left = left; payload.right = right; }
      const res = await fetch(`${API_URL}/variables/transform`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(await res.text());
      await fetchVariables(selectedDataset);
      setNewName('');
    } catch (e: any) {
      setError(e?.message || 'Transform failed');
    } finally { setLoading(false); }
  };

  const createGroup = async () => {
    if (!newGroupName) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_URL}/groups`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newGroupName }) });
      if (!res.ok) throw new Error(await res.text());
      setNewGroupName('');
      await fetchGroups();
    } catch (e: any) { setError(e?.message || 'Create group failed'); } finally { setLoading(false); }
  };

  const createSubgroup = async () => {
    if (!newSubgroupName || !newSubgroupGroupId) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_URL}/groups/subgroups`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newSubgroupName, group_id: newSubgroupGroupId }) });
      if (!res.ok) throw new Error(await res.text());
      setNewSubgroupName('');
      await fetchGroups();
    } catch (e: any) { setError(e?.message || 'Create subgroup failed'); } finally { setLoading(false); }
  };

  const assign = async () => {
    if (!selectedDataset || !assignVar || !assignSubgroup) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_URL}/groups/assign`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataset_id: selectedDataset, variable_name: assignVar, subgroup_id: assignSubgroup }) });
      if (!res.ok) throw new Error(await res.text());
      await fetchVariables(selectedDataset);
    } catch (e: any) { setError(e?.message || 'Assign failed'); } finally { setLoading(false); }
  };

  const datasetCols = useMemo(() => variables.map(v => ({ name: v.name, dtype: v.dtype })), [variables]);

  return (
    <main>
      <h2 className="text-xl font-semibold mb-4">Transform & Categorize</h2>
      {error && <p className="text-red-600 mb-3">{error}</p>}

      <div className="mb-4">
        <label className="mr-2">Dataset:</label>
        <select className="border rounded px-2 py-1" value={selectedDataset} onChange={(e) => setSelectedDataset(e.target.value)}>
          {datasets.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <section className="p-4 bg-white rounded border">
          <h3 className="font-medium mb-3">Create Transformation</h3>
          <div className="space-y-2">
            <div>
              <label className="mr-2">Operation</label>
              <select className="border rounded px-2 py-1" value={op} onChange={(e) => setOp(e.target.value as any)}>
                <option value="lag">Lag</option>
                <option value="decay">Decay (EWMA)</option>
                <option value="log">Log</option>
                <option value="add">Add</option>
                <option value="sub">Subtract</option>
                <option value="mul">Multiply</option>
                <option value="div">Divide</option>
              </select>
            </div>

            {(op === 'lag' || op === 'decay' || op === 'log') && (
              <div>
                <label className="mr-2">Column</label>
                <select className="border rounded px-2 py-1" value={column} onChange={(e) => setColumn(e.target.value)}>
                  <option value="">--</option>
                  {datasetCols.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
              </div>
            )}

            {op === 'lag' && (
              <div>
                <label className="mr-2">Periods</label>
                <input type="number" className="border rounded px-2 py-1 w-24" value={n} onChange={(e) => setN(parseInt(e.target.value))} />
              </div>
            )}

            {op === 'decay' && (
              <div>
                <label className="mr-2">Alpha</label>
                <input type="number" step="0.01" className="border rounded px-2 py-1 w-24" value={alpha} onChange={(e) => setAlpha(parseFloat(e.target.value))} />
              </div>
            )}

            {(op === 'add' || op === 'sub' || op === 'mul' || op === 'div') && (
              <div className="flex gap-2 items-center">
                <select className="border rounded px-2 py-1" value={left} onChange={(e) => setLeft(e.target.value)}>
                  <option value="">left</option>
                  {datasetCols.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
                <span>{op}</span>
                <select className="border rounded px-2 py-1" value={right} onChange={(e) => setRight(e.target.value)}>
                  <option value="">right</option>
                  {datasetCols.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
              </div>
            )}

            <div>
              <label className="mr-2">New name</label>
              <input className="border rounded px-2 py-1" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="new_variable" />
            </div>

            <button className="px-3 py-1.5 rounded bg-blue-600 text-white" disabled={loading || !newName} onClick={doTransform}>
              {loading ? 'Creating...' : 'Create'}
            </button>
          </div>
        </section>

        <section className="p-4 bg-white rounded border">
          <h3 className="font-medium mb-3">Groups & Subgroups</h3>
          <div className="space-y-3">
            <div>
              <div className="flex gap-2 items-center">
                <input className="border rounded px-2 py-1" placeholder="New group name" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} />
                <button className="px-3 py-1.5 rounded bg-green-600 text-white" onClick={createGroup} disabled={loading || !newGroupName}>Add Group</button>
              </div>
            </div>
            <div>
              <div className="flex gap-2 items-center">
                <select className="border rounded px-2 py-1" value={newSubgroupGroupId} onChange={(e) => setNewSubgroupGroupId(e.target.value)}>
                  <option value="">Group</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
                <input className="border rounded px-2 py-1" placeholder="New subgroup name" value={newSubgroupName} onChange={(e) => setNewSubgroupName(e.target.value)} />
                <button className="px-3 py-1.5 rounded bg-green-600 text-white" onClick={createSubgroup} disabled={loading || !newSubgroupName || !newSubgroupGroupId}>Add Subgroup</button>
              </div>
            </div>
            <div>
              <div className="flex gap-2 items-center">
                <select className="border rounded px-2 py-1" value={assignVar} onChange={(e) => setAssignVar(e.target.value)}>
                  <option value="">Variable</option>
                  {variables.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
                </select>
                <select className="border rounded px-2 py-1" value={assignSubgroup} onChange={(e) => setAssignSubgroup(e.target.value)}>
                  <option value="">Subgroup</option>
                  {groups.flatMap(g => g.subgroups).map(sg => <option key={sg.id} value={sg.id}>{sg.name}</option>)}
                </select>
                <button className="px-3 py-1.5 rounded bg-blue-600 text-white" onClick={assign} disabled={loading || !assignVar || !assignSubgroup}>Assign</button>
              </div>
            </div>
          </div>
        </section>
      </div>

      <section className="p-4 bg-white rounded border mt-4">
        <h3 className="font-medium mb-3">Variables</h3>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-2 py-1 text-left">Name</th>
                <th className="px-2 py-1 text-left">Dtype</th>
                <th className="px-2 py-1 text-left">Derived</th>
                <th className="px-2 py-1 text-left">Group</th>
                <th className="px-2 py-1 text-left">Subgroup</th>
              </tr>
            </thead>
            <tbody>
              {variables.map(v => (
                <tr key={v.id} className="odd:bg-white even:bg-gray-50">
                  <td className="px-2 py-1">{v.name}</td>
                  <td className="px-2 py-1">{v.dtype}</td>
                  <td className="px-2 py-1">{v.is_derived ? 'Yes' : 'No'}</td>
                  <td className="px-2 py-1">{v.group_name || '-'}</td>
                  <td className="px-2 py-1">{v.subgroup_name || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
