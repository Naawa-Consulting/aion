"use client";

import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import clsx from "clsx";

import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useGlobalStore } from "@/lib/store";
import { useKeyboardShortcut } from "@/hooks/useKeyboardShortcut";

type Dataset = { id: string; display_name: string; columns: { name: string; dtype: string }[] };

type Variable = {
  id: string;
  dataset_id: string;
  name: string;
  dtype: string;
  is_derived: boolean;
  group_id?: string | null;
  group_name?: string | null;
  subgroup_id?: string | null;
  subgroup_name?: string | null;
  created_at?: string | null;
};

type Group = { id: string; name: string; subgroups: { id: string; name: string; group_id: string }[] };

type TransformPreview = { before: number | null; after: number | null };

type HistoryItem = { id: string; op: string; params: Record<string, any>; created_at: string };

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function TransformPage() {
  const { datasetId, setDatasetId } = useGlobalStore();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [variables, setVariables] = useState<Variable[]>([]);
  const [filteredVariables, setFilteredVariables] = useState<Variable[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<string | null>(null);
  const [op, setOp] = useState<"lag" | "decay" | "log" | "add" | "sub" | "mul" | "div">("lag");
  const [column, setColumn] = useState("");
  const [n, setN] = useState(1);
  const [alpha, setAlpha] = useState(0.5);
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [newName, setNewName] = useState("");
  const [search, setSearch] = useState("");
  const [dtypeFilter, setDtypeFilter] = useState("");
  const [showDerivedOnly, setShowDerivedOnly] = useState(false);
  const [lastPreview, setLastPreview] = useState<TransformPreview[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyVar, setHistoryVar] = useState<Variable | null>(null);
  const [loading, setLoading] = useState(false);
  const [draggingVar, setDraggingVar] = useState<Variable | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [newSubgroupName, setNewSubgroupName] = useState("");
  const [newSubgroupParent, setNewSubgroupParent] = useState("");

  const activeDatasetId = selectedDataset || datasetId || null;

  useEffect(() => {
    fetchDatasets();
    fetchGroups();
  }, []);

  useEffect(() => {
    if (activeDatasetId) {
      fetchVariables(activeDatasetId);
      setSelectedDataset(activeDatasetId);
    }
  }, [activeDatasetId]);

  useEffect(() => {
    const next = variables.filter((v) => {
      if (showDerivedOnly && !v.is_derived) return false;
      if (search && !v.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (dtypeFilter && !v.dtype.toLowerCase().includes(dtypeFilter.toLowerCase())) return false;
      return true;
    });
    setFilteredVariables(next);
  }, [variables, search, dtypeFilter, showDerivedOnly]);

  useKeyboardShortcut(
    "z",
    (event) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        handleUndo();
      }
    },
    { ctrl: true }
  );

  const fetchDatasets = async () => {
    try {
      const res = await fetch(`${API_URL}/datasets`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setDatasets(data);
      if (!datasetId && data.length) {
        setDatasets(data);
        setDatasetId(data[0].id);
      }
    } catch {
      toast.error("Failed to load datasets");
    }
  };

  const fetchVariables = async (dataset: string) => {
    try {
      const res = await fetch(`${API_URL}/variables?dataset_id=${dataset}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setVariables(data);
    } catch {
      toast.error("Failed to load variables");
    }
  };

  const fetchGroups = async () => {
    try {
      const res = await fetch(`${API_URL}/groups`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setGroups(data);
    } catch {
      toast.error("Failed to load groups");
    }
  };

  const handleTransform = async () => {
    if (!activeDatasetId) return;
    setLoading(true);
    try {
      const payload: any = { dataset_id: activeDatasetId, op, new_name: newName };
      if (op === "lag") {
        payload.column = column;
        payload.n = n;
      } else if (op === "decay") {
        payload.column = column;
        payload.alpha = alpha;
      } else if (op === "log") {
        payload.column = column;
      } else {
        payload.left = left;
        payload.right = right;
      }
      const res = await fetch(`${API_URL}/variables/transform`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      await fetchVariables(activeDatasetId);
      setLastPreview(data.preview || []);
      setNewName("");
      toast.success("Variable created");
    } catch (err: any) {
      toast.error(err?.message || "Transformation failed");
    } finally {
      setLoading(false);
    }
  };

  const handleCategorize = async (variableId: string, groupId?: string | null, subgroupId?: string | null) => {
    try {
      const res = await fetch(`${API_URL}/variables/${variableId}/categorization`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_id: groupId, subgroup_id: subgroupId }),
      });
      if (!res.ok) throw new Error(await res.text());
      const updated = await res.json();
      setVariables((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
      fetchGroups();
      toast.success("Categorization updated");
    } catch (err: any) {
      toast.error(err?.message || "Failed to categorize");
    }
  };

  const openHistory = async (variable: Variable) => {
    try {
      const res = await fetch(`${API_URL}/variables/${variable.id}/history`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setHistory(data);
      setHistoryVar(variable);
    } catch (err: any) {
      toast.error(err?.message || "Failed to load history");
    }
  };

  const handleUndo = async () => {
    const derived = [...variables].filter((v) => v.is_derived && v.id).sort((a, b) => {
      const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bTime - aTime;
    });
    const latest = derived[0];
    if (!latest) {
      toast.info("No derived variables to undo");
      return;
    }
    try {
      await fetch(`${API_URL}/variables/${latest.id}/undo`, { method: "POST" });
      if (activeDatasetId) fetchVariables(activeDatasetId);
      toast.success(`Removed ${latest.name}`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to undo");
    }
  };

  const dtypeOptions = useMemo(() => {
    const set = new Set(variables.map((v) => v.dtype));
    return Array.from(set);
  }, [variables]);

  const datasetColumns = useMemo(() => {
    const ds = datasets.find((d) => d.id === activeDatasetId);
    return ds ? ds.columns : [];
  }, [datasets, activeDatasetId]);

  const activeGroups = groups;

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-[var(--color-muted)]">Module 2</p>
          <h1 className="text-2xl font-semibold tracking-tight">Transform &amp; Categorize</h1>
        </div>
        <div className="flex items-center gap-3">
          <select
            className="rounded-full border border-[var(--color-border)] px-4 py-2 text-sm bg-transparent"
            value={activeDatasetId ?? ""}
            onChange={(e) => {
              setSelectedDataset(e.target.value);
              setDatasetId(e.target.value);
            }}
          >
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.display_name}
              </option>
            ))}
          </select>
          <Button variant="secondary" size="sm" onClick={handleUndo}>
            Undo last
          </Button>
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[320px,1fr]">
        <Card className="space-y-4">
          <CardHeader title="Variables" subtitle="Search & drag to categorize" />
          <Input placeholder="Search variables" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="flex gap-2 text-sm">
            <select
              className="w-full rounded-full border border-[var(--color-border)] px-3 py-2 bg-transparent"
              value={dtypeFilter}
              onChange={(e) => setDtypeFilter(e.target.value)}
            >
              <option value="">All dtypes</option>
              {dtypeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
              <input type="checkbox" checked={showDerivedOnly} onChange={(e) => setShowDerivedOnly(e.target.checked)} />
              Derived only
            </label>
          </div>
          <div className="max-h-[500px] space-y-2 overflow-y-auto pr-2">
            {filteredVariables.map((variable) => (
              <VariableRow
                key={variable.id}
                variable={variable}
                onDragStart={(event) => {
                  event.dataTransfer?.setData("text/plain", variable.id);
                  setDraggingVar(variable);
                }}
                onDragEnd={() => setDraggingVar(null)}
                onHistory={() => openHistory(variable)}
              />
            ))}
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="space-y-4">
            <CardHeader title="Create transformation" subtitle="Lag, decay, arithmetic & more" />
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">Operation</label>
                <select
                  className="w-full rounded-full border border-[var(--color-border)] px-3 py-2 bg-transparent"
                  value={op}
                  onChange={(e) => setOp(e.target.value as any)}
                >
                  <option value="lag">Lag</option>
                  <option value="decay">Decay</option>
                  <option value="log">Log</option>
                  <option value="add">Add</option>
                  <option value="sub">Subtract</option>
                  <option value="mul">Multiply</option>
                  <option value="div">Divide</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">New name</label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="transformed_variable" />
              </div>
              {(op === "lag" || op === "decay" || op === "log") && (
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">Column</label>
                  <div>
                    <Input
                      list="column-options"
                      value={column}
                      onChange={(e) => setColumn(e.target.value)}
                      placeholder="Type to search column"
                    />
                    <datalist id="column-options">
                      {datasetColumns.map((col) => (
                        <option key={col.name} value={col.name} />
                      ))}
                    </datalist>
                  </div>
                </div>
              )}
              {op === "lag" && (
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">Periods</label>
                  <Input type="number" value={n} onChange={(e) => setN(parseInt(e.target.value) || 1)} />
                </div>
              )}
              {op === "decay" && (
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">Alpha (0-1)</label>
                  <Input type="number" step="0.05" value={alpha} onChange={(e) => setAlpha(parseFloat(e.target.value) || 0.5)} />
                </div>
              )}
              {["add", "sub", "mul", "div"].includes(op) && (
                <>
                  <div className="space-y-2">
                    <label className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">Left</label>
                    <div>
                      <Input
                        list="left-options"
                        value={left}
                        onChange={(e) => setLeft(e.target.value)}
                        placeholder="Type variable"
                      />
                      <datalist id="left-options">
                        {datasetColumns.map((col) => (
                          <option key={col.name} value={col.name} />
                        ))}
                      </datalist>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">Right</label>
                    <div>
                      <Input
                        list="right-options"
                        value={right}
                        onChange={(e) => setRight(e.target.value)}
                        placeholder="Type variable"
                      />
                      <datalist id="right-options">
                        {datasetColumns.map((col) => (
                          <option key={col.name} value={col.name} />
                        ))}
                      </datalist>
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="flex justify-end">
              <Button onClick={handleTransform} disabled={loading || !newName}>
                {loading ? "Creating..." : "Create variable"}
              </Button>
            </div>
            {lastPreview.length > 0 && (
              <div className="rounded-2xl border border-[var(--color-border)] p-4">
                <p className="text-sm font-medium mb-2">Preview</p>
                <Sparkline data={lastPreview} />
              </div>
            )}
          </Card>

          <Card className="space-y-4">
            <CardHeader title="Groups & Subgroups" subtitle="Create targets and drag variables onto them" />
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs uppercase text-[var(--color-muted)]">New group</label>
                <div className="flex gap-2">
                  <Input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="Group name" />
                  <Button
                    size="sm"
                    onClick={async () => {
                      if (!newGroupName.trim()) return;
                      try {
                        const res = await fetch(`${API_URL}/groups`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ name: newGroupName }),
                        });
                        if (!res.ok) throw new Error(await res.text());
                        setNewGroupName("");
                        fetchGroups();
                        toast.success("Group created");
                      } catch (err: any) {
                        toast.error(err?.message || "Failed to create group");
                      }
                    }}
                  >
                    Add
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase text-[var(--color-muted)]">New subgroup</label>
                <div className="flex gap-2">
                  <select
                    className="w-full rounded-full border border-[var(--color-border)] px-3 py-2 bg-transparent"
                    value={newSubgroupParent}
                    onChange={(e) => setNewSubgroupParent(e.target.value)}
                  >
                    <option value="">Select group</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                  <Input value={newSubgroupName} onChange={(e) => setNewSubgroupName(e.target.value)} placeholder="Subgroup" />
                  <Button
                    size="sm"
                    onClick={async () => {
                      if (!newSubgroupParent || !newSubgroupName.trim()) return;
                      try {
                        const res = await fetch(`${API_URL}/groups/subgroups`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ group_id: newSubgroupParent, name: newSubgroupName }),
                        });
                        if (!res.ok) throw new Error(await res.text());
                        setNewSubgroupName("");
                        fetchGroups();
                        toast.success("Subgroup created");
                      } catch (err: any) {
                        toast.error(err?.message || "Failed to create subgroup");
                      }
                    }}
                  >
                    Add
                  </Button>
                </div>
              </div>
            </div>
            <div
              className={clsx(
                "rounded-2xl border border-dashed p-4 text-sm text-[var(--color-muted)]",
                draggingVar ? "border-[var(--color-accent)]" : "border-[var(--color-border)]"
              )}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const variableId = e.dataTransfer.getData("text/plain");
                const targetId = variableId || draggingVar?.id;
                if (targetId) handleCategorize(targetId, null, null);
              }}
            >
              Drop here to clear categorization
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {activeGroups.length === 0 && (
                <p className="text-sm text-[var(--color-muted)]">Create a group to start assigning variables.</p>
              )}
              {activeGroups.map((group) => (
                <div
                  key={group.id}
                  className={clsx(
                    "rounded-2xl border p-4 space-y-3 transition",
                    draggingVar ? "border-dashed border-[var(--color-accent)]" : "border-[var(--color-border)]"
                  )}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const variableId = e.dataTransfer.getData("text/plain");
                    const targetId = variableId || draggingVar?.id;
                    if (targetId) handleCategorize(targetId, group.id, null);
                  }}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">{group.name}</h3>
                    <Badge>{group.subgroups.length} subgroups</Badge>
                  </div>
                  <div className="space-y-2">
                    {group.subgroups.map((sub) => (
                      <div
                        key={sub.id}
                        className="rounded-xl border border-dashed border-[var(--color-border)] px-3 py-2 text-sm"
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const variableId = e.dataTransfer.getData("text/plain");
                          const targetId = variableId || draggingVar?.id;
                          if (targetId) handleCategorize(targetId, group.id, sub.id);
                        }}
                      >
                        {sub.name}
                      </div>
                    ))}
                  </div>
                  <GroupAssignments variables={variables} groupId={group.id} subgroupIds={group.subgroups.map((s) => s.id)} />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {historyVar && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-4">
          <div className="w-full max-w-lg rounded-2xl bg-[var(--color-card)] p-6 shadow-lg space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-[var(--color-muted)]">History</p>
                <h3 className="text-lg font-semibold">{historyVar.name}</h3>
              </div>
              <Button variant="ghost" onClick={() => setHistoryVar(null)}>
                Close
              </Button>
            </div>
            <div className="max-h-[360px] overflow-y-auto space-y-3">
              {history.length === 0 && <p className="text-sm text-[var(--color-muted)]">No history yet.</p>}
              {history.map((item) => (
                <div key={item.id} className="rounded-xl border border-[var(--color-border)] p-3 text-sm space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium uppercase text-xs text-[var(--color-muted)]">{item.op}</span>
                    <span className="text-xs text-[var(--color-muted)]">
                      {new Date(item.created_at).toLocaleString()}
                    </span>
                  </div>
                  <pre className="text-xs text-[var(--color-muted)]">{JSON.stringify(item.params, null, 2)}</pre>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function VariableRow({
  variable,
  onDragStart,
  onDragEnd,
  onHistory,
}: {
  variable: Variable;
  onDragStart: (event: React.DragEvent) => void;
  onDragEnd: () => void;
  onHistory: () => void;
}) {
  return (
    <div
      className="rounded-2xl border border-[var(--color-border)] p-3 text-sm bg-white/60 dark:bg-white/5 cursor-grab active:cursor-grabbing"
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium">{variable.name}</p>
          <p className="text-xs text-[var(--color-muted)]">{variable.dtype}</p>
        </div>
        <div className="flex gap-1">
          {variable.is_derived && <Badge variant="neutral">fx</Badge>}
          {(variable.group_name || variable.subgroup_name) && (
            <Badge variant="success">{variable.subgroup_name || variable.group_name}</Badge>
          )}
          {variable.is_derived && (
            <button className="text-xs text-[var(--color-accent)] underline" onClick={onHistory}>
              history
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function GroupAssignments({
  variables,
  groupId,
  subgroupIds,
}: {
  variables: Variable[];
  groupId: string;
  subgroupIds: string[];
}) {
  const members = variables.filter((v) => v.group_id === groupId || subgroupIds.includes(v.subgroup_id || ""));
  if (!members.length) return null;
  return (
    <div className="text-xs text-[var(--color-muted)]">
      Assigned:{" "}
      {members.map((m, idx) => (
        <span key={m.id}>{idx > 0 && ", "}{m.name}</span>
      ))}
    </div>
  );
}

function Sparkline({ data }: { data: TransformPreview[] }) {
  const width = 260;
  const height = 80;
  const beforePoints = data.map((d) => d.before).filter((d) => typeof d === "number") as number[];
  const afterPoints = data.map((d) => d.after).filter((d) => typeof d === "number") as number[];
  const combined = [...beforePoints, ...afterPoints];
  const min = combined.length ? Math.min(...combined) : 0;
  const max = combined.length ? Math.max(...combined) : 1;

  const scaleY = (value: number) => {
    if (max === min) return height / 2;
    return height - ((value - min) / (max - min)) * height;
  };
  const scaleX = (index: number) => {
    if (data.length <= 1) return 0;
    return (index / (data.length - 1)) * width;
  };

  const path = (series: (number | null)[]) =>
    series
      .map((value, idx) => {
        if (value === null || value === undefined) return null;
        const command = idx === 0 ? "M" : "L";
        return `${command}${scaleX(idx)},${scaleY(value)}`;
      })
      .filter(Boolean)
      .join(" ");

  const beforePath = path(data.map((d) => d.before));
  const afterPath = path(data.map((d) => d.after));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img">
      {beforePath && <path d={beforePath} stroke="var(--color-muted)" strokeWidth="1.5" fill="none" />}
      {afterPath && <path d={afterPath} stroke="var(--color-accent)" strokeWidth="2" fill="none" />}
    </svg>
  );
}
