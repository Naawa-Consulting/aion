"use client";

import React, { useMemo, useState } from 'react';

type Dataset = {
  id: string;
  name: string;
  n_rows: number;
  n_cols: number;
  columns: { name: string; dtype: string }[];
};

type Preview = {
  columns: string[];
  rows: Record<string, any>[];
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function UploadPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selected, setSelected] = useState<Dataset | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [renames, setRenames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSelectFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fl = e.target.files ? Array.from(e.target.files) : [];
    setFiles(fl);
  };

  const upload = async () => {
    setError(null);
    setLoading(true);
    try {
      const form = new FormData();
      files.forEach((f) => form.append('files', f));
      const res = await fetch(`${API_URL}/datasets/upload`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setDatasets(data.datasets);
      if (data.datasets.length > 0) {
        setSelected(data.datasets[0]);
        await loadPreview(data.datasets[0].id);
      }
    } catch (e: any) {
      setError(e?.message || 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  const loadPreview = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/datasets/${id}/preview?rows=20`);
      if (!res.ok) throw new Error(await res.text());
      const data: Preview = await res.json();
      setPreview(data);
      setRenames({});
    } catch (e: any) {
      setError(e?.message || 'Preview failed');
    } finally {
      setLoading(false);
    }
  };

  const applyRenames = async () => {
    if (!selected) return;
    const payload = {
      renames: Object.entries(renames).map(([from_name, to_name]) => ({ from_name, to_name })),
    };
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/datasets/${selected.id}/columns`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      const updated: Dataset = await res.json();
      setSelected(updated);
      setDatasets((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      await loadPreview(updated.id);
    } catch (e: any) {
      setError(e?.message || 'Rename failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main>
      <h2 className="text-xl font-semibold mb-4">Upload Datasets</h2>
      <div className="space-y-4">
        <div className="p-4 bg-white rounded border">
          <input type="file" accept=".csv,.xlsx,.xls" multiple onChange={onSelectFiles} />
          <button
            disabled={files.length === 0 || loading}
            onClick={upload}
            className="ml-3 px-3 py-1.5 rounded bg-blue-600 text-white disabled:opacity-50"
          >
            {loading ? 'Uploading...' : 'Upload'}
          </button>
          {error && <p className="text-red-600 mt-2">{error}</p>}
        </div>

        {datasets.length > 0 && (
          <div className="p-4 bg-white rounded border">
            <h3 className="font-medium mb-2">Datasets</h3>
            <ul className="space-y-1">
              {datasets.map((d) => (
                <li key={d.id}>
                  <button className={`underline ${selected?.id === d.id ? 'text-blue-700' : 'text-blue-600'}`} onClick={() => { setSelected(d); loadPreview(d.id); }}>
                    {d.name} ({d.n_rows}x{d.n_cols})
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {selected && preview && (
          <div className="p-4 bg-white rounded border">
            <h3 className="font-medium mb-3">Preview: {selected.name}</h3>
            <div className="overflow-auto border rounded">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    {preview.columns.map((c) => (
                      <th key={c} className="px-2 py-1 text-left font-medium">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, i) => (
                    <tr key={i} className="odd:bg-white even:bg-gray-50">
                      {preview.columns.map((c) => (
                        <td key={c} className="px-2 py-1 whitespace-nowrap">{String(row[c])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4">
              <h4 className="font-medium mb-2">Rename Columns</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {selected.columns.map((col) => (
                  <div key={col.name} className="flex items-center gap-2">
                    <span className="w-48 text-gray-700">{col.name}</span>
                    <input
                      className="border rounded px-2 py-1 flex-1"
                      placeholder="new_name"
                      value={renames[col.name] ?? ''}
                      onChange={(e) => setRenames((r) => ({ ...r, [col.name]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
              <button
                className="mt-3 px-3 py-1.5 rounded bg-green-600 text-white"
                disabled={Object.keys(renames).length === 0 || loading}
                onClick={applyRenames}
              >
                {loading ? 'Saving...' : 'Save Renames'}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

