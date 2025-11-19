"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import clsx from "clsx";
import { Pencil, Trash2 } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Line,
} from "recharts";

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
type TransformOp = "lag" | "decay" | "log" | "add" | "sub" | "mul" | "div";
type PreviewPayload = {
  dataset_id: string;
  operation: TransformOp;
  column?: string;
  params: Record<string, string | number | boolean | null>;
  limit: number;
};


type HistoryItem = { id: string; op: string; params: Record<string, any>; created_at: string };

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function TransformPage() {
  const { datasetId, setDatasetId } = useGlobalStore();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [variables, setVariables] = useState<Variable[]>([]);
  const [filteredVariables, setFilteredVariables] = useState<Variable[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<string | null>(null);
  const [op, setOp] = useState<TransformOp>("lag");
  const [column, setColumn] = useState("");
  const [n, setN] = useState(1);
  const [alpha, setAlpha] = useState(0.5);
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [newName, setNewName] = useState("");
  const [search, setSearch] = useState("");
  const [dtypeFilter, setDtypeFilter] = useState("");
const [showDerivedOnly, setShowDerivedOnly] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [previewData, setPreviewData] = useState<{ time: (string | number)[]; original: (number | null)[]; transformed: (number | null)[]; stats?: { mean_original?: number; mean_transformed?: number; correlation?: number } } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyVar, setHistoryVar] = useState<Variable | null>(null);
  const [loading, setLoading] = useState(false);
  const [draggingVar, setDraggingVar] = useState<Variable | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [newSubgroupName, setNewSubgroupName] = useState("");
const [newSubgroupParent, setNewSubgroupParent] = useState("");
const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupDraft, setGroupDraft] = useState("");
  const [groupError, setGroupError] = useState("");
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [editingSubgroupId, setEditingSubgroupId] = useState<string | null>(null);
  const [editingSubgroupGroupId, setEditingSubgroupGroupId] = useState<string | null>(null);
  const [subgroupDraft, setSubgroupDraft] = useState("");
  const [subgroupError, setSubgroupError] = useState("");
  const [renamingSubgroupId, setRenamingSubgroupId] = useState<string | null>(null);
  const [groupToDelete, setGroupToDelete] = useState<Group | null>(null);
  const [groupDeleteLoading, setGroupDeleteLoading] = useState(false);
  const [groupDeleteError, setGroupDeleteError] = useState("");
  const [subgroupToDelete, setSubgroupToDelete] = useState<{ group: Group; subgroup: { id: string; name: string } } | null>(
    null
  );
  const [subgroupDeleteLoading, setSubgroupDeleteLoading] = useState(false);
  const [subgroupDeleteError, setSubgroupDeleteError] = useState("");
  const previewAbortRef = useRef<AbortController | null>(null);
  const previewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeGroups = groups;
  const activeDatasetId = selectedDataset || datasetId || null;
  const groupVariableCount = useMemo(() => {
    if (!groupToDelete) return 0;
    return variables.filter((v) => v.group_id === groupToDelete.id).length;
  }, [groupToDelete, variables]);
  const subgroupVariableCount = useMemo(() => {
    if (!subgroupToDelete) return 0;
    return variables.filter((v) => v.subgroup_id === subgroupToDelete.subgroup.id).length;
  }, [subgroupToDelete, variables]);
  const previewPayload = useMemo<PreviewPayload | null>(() => {
    if (!activeDatasetId) return null;
    const base = {
      dataset_id: activeDatasetId,
      operation: op,
      limit: 200,
      params: {} as Record<string, string | number | boolean | null>,
    };
    if (op === "lag") {
      if (!column) return null;
      const steps = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
      return { ...base, column, params: { periods: steps } };
    }
    if (op === "decay") {
      if (!column) return null;
      return { ...base, column, params: { alpha } };
    }
    if (op === "log") {
      if (!column) return null;
      return { ...base, column, params: {} };
    }
    if (!left || !right) return null;
    return { ...base, column: left, params: { left, right } };
  }, [activeDatasetId, op, column, n, alpha, left, right]);
  const runPreview = useCallback(
    async (payload: PreviewPayload, signal?: AbortSignal) => {
      setPreviewLoading(true);
      setPreviewError("");
      try {
        const res = await fetch(`${API_URL}/variables/transform/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal,
        });
        if (!res.ok) {
          let message = "Unable to load preview";
          try {
            const errData = await res.json();
            message = errData?.detail || errData?.error || message;
          } catch {
            message = await res.text();
          }
          throw new Error(message);
        }
        const data = await res.json();
        setPreviewData(data);
      } catch (error: any) {
        if (error?.name === "AbortError") {
          return;
        }
        setPreviewError(error?.message || "Unable to load preview");
        setPreviewData(null);
      } finally {
        setPreviewLoading(false);
      }
    },
    []
  );
  const retryPreview = useCallback(() => {
    if (!showPreview || !previewPayload) return;
    if (previewDebounceRef.current) {
      clearTimeout(previewDebounceRef.current);
      previewDebounceRef.current = null;
    }
    if (previewAbortRef.current) {
      previewAbortRef.current.abort();
    }
    const controller = new AbortController();
    previewAbortRef.current = controller;
    runPreview(previewPayload, controller.signal);
  }, [previewPayload, runPreview, showPreview]);

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
    if (previewDebounceRef.current) {
      clearTimeout(previewDebounceRef.current);
      previewDebounceRef.current = null;
    }
    if (previewAbortRef.current) {
      previewAbortRef.current.abort();
      previewAbortRef.current = null;
    }

    if (!showPreview) {
      setPreviewLoading(false);
      setPreviewError("");
      return;
    }

    if (!previewPayload) {
      setPreviewData(null);
      setPreviewError("");
      setPreviewLoading(false);
      return;
    }

    const controller = new AbortController();
    previewAbortRef.current = controller;
    previewDebounceRef.current = setTimeout(() => {
      runPreview(previewPayload, controller.signal);
    }, 300);

    return () => {
      if (previewDebounceRef.current) {
        clearTimeout(previewDebounceRef.current);
        previewDebounceRef.current = null;
      }
      controller.abort();
      previewAbortRef.current = null;
    };
  }, [previewPayload, runPreview, showPreview]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (groupToDelete) {
          event.preventDefault();
          setGroupToDelete(null);
        } else if (subgroupToDelete) {
          event.preventDefault();
          setSubgroupToDelete(null);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [groupToDelete, subgroupToDelete]);

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

  const startGroupRename = (group: Group) => {
    setEditingGroupId(group.id);
    setGroupDraft(group.name);
    setGroupError("");
  };

  const cancelGroupRename = () => {
    setEditingGroupId(null);
    setGroupDraft("");
    setGroupError("");
  };

  const submitGroupRename = async () => {
    if (!editingGroupId) return;
    const trimmed = groupDraft.trim();
    if (!trimmed) {
      setGroupError("Name cannot be empty");
      return;
    }
    const original = groups.find((g) => g.id === editingGroupId)?.name;
    if (original && original === trimmed) {
      cancelGroupRename();
      return;
    }
    setRenamingGroupId(editingGroupId);
    try {
      const res = await fetch(`${API_URL}/groups/${editingGroupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        let message = "Failed to rename group";
        try {
          const data = await res.json();
          message = data?.error || data?.detail || message;
        } catch {
          message = await res.text();
        }
        setGroupError(message || "Failed to rename group");
        return;
      }
      setGroups((prev) =>
        prev.map((g) => (g.id === editingGroupId ? { ...g, name: trimmed } : g))
      );
      toast.success(`Group renamed to "${trimmed}"`);
      cancelGroupRename();
    } catch (error: any) {
      setGroupError(error?.message || "Failed to rename group");
    } finally {
      setRenamingGroupId(null);
    }
  };

  const startSubgroupRename = (groupId: string, subgroup: { id: string; name: string }) => {
    setEditingSubgroupId(subgroup.id);
    setEditingSubgroupGroupId(groupId);
    setSubgroupDraft(subgroup.name);
    setSubgroupError("");
  };

  const cancelSubgroupRename = () => {
    setEditingSubgroupId(null);
    setEditingSubgroupGroupId(null);
    setSubgroupDraft("");
    setSubgroupError("");
  };

  const submitSubgroupRename = async () => {
    if (!editingSubgroupId || !editingSubgroupGroupId) return;
    const trimmed = subgroupDraft.trim();
    if (!trimmed) {
      setSubgroupError("Name cannot be empty");
      return;
    }
    const parent = groups.find((g) => g.id === editingSubgroupGroupId);
    const original = parent?.subgroups.find((s) => s.id === editingSubgroupId)?.name;
    if (original && original === trimmed) {
      cancelSubgroupRename();
      return;
    }
    setRenamingSubgroupId(editingSubgroupId);
    try {
      const res = await fetch(`${API_URL}/groups/subgroups/${editingSubgroupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        let message = "Failed to rename subgroup";
        try {
          const data = await res.json();
          message = data?.error || data?.detail || message;
        } catch {
          message = await res.text();
        }
        setSubgroupError(message || "Failed to rename subgroup");
        return;
      }
      setGroups((prev) =>
        prev.map((g) =>
          g.id === editingSubgroupGroupId
            ? {
                ...g,
                subgroups: g.subgroups.map((s) =>
                  s.id === editingSubgroupId ? { ...s, name: trimmed } : s
                ),
              }
            : g
        )
      );
      toast.success(`Subgroup renamed to "${trimmed}"`);
      cancelSubgroupRename();
    } catch (error: any) {
      setSubgroupError(error?.message || "Failed to rename subgroup");
    } finally {
      setRenamingSubgroupId(null);
    }
  };

  const confirmDeleteGroup = async () => {
    if (!groupToDelete) return;
    setGroupDeleteLoading(true);
    setGroupDeleteError("");
    try {
      const res = await fetch(`${API_URL}/groups/${groupToDelete.id}?reassign=uncategorized`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const detail = await safeParseJSON(await res.text());
        throw new Error(detail?.error || detail?.detail || "Failed to delete group");
      }
      const summary = await res.json().catch(() => null);
      setGroups((prev) => prev.filter((g) => g.id !== groupToDelete.id));
      setVariables((prev) =>
        prev.map((variable) =>
          variable.group_id === groupToDelete.id
            ? {
                ...variable,
                group_id: null,
                group_name: null,
                subgroup_id: null,
                subgroup_name: null,
              }
            : variable
        )
      );
      toast.success(
        `Group "${groupToDelete.name}" deleted. ${
          summary?.reassigned_variables ?? groupVariableCount
        } variables moved to Uncategorized.`
      );
      closeGroupDeleteModal();
    } catch (error: any) {
      setGroupDeleteError(error?.message || "Failed to delete group");
    } finally {
      setGroupDeleteLoading(false);
    }
  };

  const closeGroupDeleteModal = () => {
    setGroupToDelete(null);
    setGroupDeleteError("");
  };

  const closeSubgroupDeleteModal = () => {
    setSubgroupToDelete(null);
    setSubgroupDeleteError("");
  };

  const confirmDeleteSubgroup = async () => {
    if (!subgroupToDelete) return;
    setSubgroupDeleteLoading(true);
    setSubgroupDeleteError("");
    try {
      const res = await fetch(`${API_URL}/groups/subgroups/${subgroupToDelete.subgroup.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const detail = await safeParseJSON(await res.text());
        throw new Error(detail?.error || detail?.detail || "Failed to delete subgroup");
      }
      const summary = await res.json().catch(() => null);
      setGroups((prev) =>
        prev.map((group) =>
          group.id === subgroupToDelete.group.id
            ? { ...group, subgroups: group.subgroups.filter((sg) => sg.id !== subgroupToDelete.subgroup.id) }
            : group
        )
      );
      setVariables((prev) =>
        prev.map((variable) =>
          variable.subgroup_id === subgroupToDelete.subgroup.id
            ? { ...variable, subgroup_id: null, subgroup_name: null }
            : variable
        )
      );
      toast.success(
        `Subgroup "${subgroupToDelete.subgroup.name}" deleted. ${
          summary?.cleared_subgroup_assignments ?? subgroupVariableCount
        } variables now have no subgroup.`
      );
      closeSubgroupDeleteModal();
    } catch (error: any) {
      setSubgroupDeleteError(error?.message || "Failed to delete subgroup");
    } finally {
      setSubgroupDeleteLoading(false);
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
            <div className="rounded-2xl border border-[var(--color-border)] p-4 space-y-3">
              <label className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
                <input
                  type="checkbox"
                  checked={showPreview}
                  onChange={() => setShowPreview((prev) => !prev)}
                />
                Show preview
              </label>
              {showPreview ? (
                previewLoading ? (
                  <p className="text-sm text-[var(--color-muted)]">Loading preview…</p>
                ) : previewError ? (
                  <div className="text-sm text-red-500">
                    {previewError}{" "}
                    <button className="underline" onClick={retryPreview}>
                      Retry
                    </button>
                  </div>
                ) : previewData ? (
                  <>
                    <PreviewChart data={previewData} />
                    {previewData.stats && (
                      <div className="text-xs text-[var(--color-muted)] flex flex-wrap gap-4">
                        <span>Mean original: {previewData.stats.mean_original?.toFixed(2)}</span>
                        <span>Mean transformed: {previewData.stats.mean_transformed?.toFixed(2)}</span>
                        <span>Correlation: {previewData.stats.correlation?.toFixed(2)}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-[var(--color-muted)]">Adjust parameters to see preview.</p>
                )
              ) : (
                <p className="text-sm text-[var(--color-muted)]">Preview disabled.</p>
              )}
            </div>
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
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1">
                      {editingGroupId === group.id ? (
                        <div className="flex flex-col gap-1">
                          <input
                            className="rounded-full border border-[var(--color-border)] bg-transparent px-3 py-1 text-sm focus:border-[var(--color-accent)] focus:outline-none"
                            value={groupDraft}
                            onChange={(e) => setGroupDraft(e.target.value.slice(0, 40))}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                submitGroupRename();
                              } else if (event.key === "Escape") {
                                event.preventDefault();
                                cancelGroupRename();
                              }
                            }}
                            onBlur={() => {
                              if (!renamingGroupId) submitGroupRename();
                            }}
                            disabled={renamingGroupId === group.id}
                            autoFocus
                          />
                          {groupError && <p className="text-xs text-red-500">{groupError}</p>}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="flex items-center gap-2 group cursor-pointer text-left"
                            onClick={() => startGroupRename(group)}
                          >
                            <span className="font-medium truncate max-w-[220px]">{group.name}</span>
                            <Pencil
                              size={14}
                              className="text-[var(--color-muted)] opacity-0 group-hover:opacity-100 transition"
                            />
                          </button>
                          <button
                            type="button"
                            className="rounded-full p-1 text-[var(--color-muted)] hover:text-red-500 transition"
                            onClick={() => {
                              setGroupToDelete(group);
                              setGroupDeleteMode("uncategorized");
                              setGroupDeleteError("");
                            }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      )}
                    </div>
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
                        {editingSubgroupId === sub.id ? (
                          <div className="flex flex-col gap-1">
                            <input
                              className="rounded-full border border-[var(--color-border)] bg-transparent px-3 py-1 text-sm focus:border-[var(--color-accent)] focus:outline-none"
                              value={subgroupDraft}
                              onChange={(e) => setSubgroupDraft(e.target.value.slice(0, 40))}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  submitSubgroupRename();
                                } else if (event.key === "Escape") {
                                  event.preventDefault();
                                  cancelSubgroupRename();
                                }
                              }}
                              onBlur={() => {
                                if (!renamingSubgroupId) submitSubgroupRename();
                              }}
                              disabled={renamingSubgroupId === sub.id}
                              autoFocus
                            />
                            {subgroupError && editingSubgroupId === sub.id && (
                              <p className="text-xs text-red-500">{subgroupError}</p>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              className="flex-1 flex items-center gap-2 group text-left"
                              onClick={() => startSubgroupRename(group.id, sub)}
                            >
                              <span className="truncate">{sub.name}</span>
                              <Pencil
                                size={14}
                                className="text-[var(--color-muted)] opacity-0 group-hover:opacity-100 transition"
                              />
                            </button>
                            <button
                              type="button"
                              className="rounded-full p-1 text-[var(--color-muted)] hover:text-red-500 transition"
                              onClick={() => {
                                setSubgroupToDelete({ group, subgroup: sub });
                                setSubgroupDeleteError("");
                              }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}
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

      {groupToDelete && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-4">
          <div className="w-full max-w-md rounded-2xl bg-[var(--color-card)] p-6 shadow-lg space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Delete group &quot;{groupToDelete.name}&quot;?</h3>
              <Button variant="ghost" size="sm" onClick={closeGroupDeleteModal}>
                Close
              </Button>
            </div>
            {groupDeleteError && <p className="text-sm text-red-500">{groupDeleteError}</p>}
            <p className="text-sm text-[var(--color-muted)]">
              This group has {groupVariableCount} variables assigned. Deleting it will move them to &quot;Uncategorized&quot;.
            </p>
            <p className="text-xs text-red-500">This action cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={closeGroupDeleteModal} disabled={groupDeleteLoading}>
                Cancel
              </Button>
              <Button
                variant="secondary"
                className="bg-red-600 text-white hover:bg-red-600/90"
                onClick={confirmDeleteGroup}
                disabled={groupDeleteLoading}
              >
                {groupDeleteLoading ? "Deleting..." : "Delete group"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {subgroupToDelete && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-4">
          <div className="w-full max-w-md rounded-2xl bg-[var(--color-card)] p-6 shadow-lg space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">
                Delete subgroup &quot;{subgroupToDelete.subgroup.name}&quot;?
              </h3>
              <Button variant="ghost" size="sm" onClick={closeSubgroupDeleteModal}>
                Close
              </Button>
            </div>
            {subgroupDeleteError && <p className="text-sm text-red-500">{subgroupDeleteError}</p>}
            <p className="text-sm text-[var(--color-muted)]">
              This subgroup has {subgroupVariableCount} variables assigned. They will remain in &quot;
              {subgroupToDelete.group.name}&quot; but without subgroup.
            </p>
            <p className="text-xs text-red-500">This action cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={closeSubgroupDeleteModal} disabled={subgroupDeleteLoading}>
                Cancel
              </Button>
              <Button
                variant="secondary"
                className="bg-red-600 text-white hover:bg-red-600/90"
                onClick={confirmDeleteSubgroup}
                disabled={subgroupDeleteLoading}
              >
                {subgroupDeleteLoading ? "Deleting..." : "Delete subgroup"}
              </Button>
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

function PreviewChart({
  data,
}: {
  data: { time: (string | number)[]; original: (number | null)[]; transformed: (number | null)[] };
}) {
  const chartData = data.time.map((time, index) => ({
    time,
    original: data.original[index],
    transformed: data.transformed[index],
  }));

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="time" tick={{ fontSize: 10 }} minTickGap={20} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="original" name="Original" stroke="var(--color-muted)" dot={false} />
          <Line type="monotone" dataKey="transformed" name="Transformed" stroke="var(--color-accent)" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function safeParseJSON(payload: string | null) {
  if (!payload) return {};
  try {
    return JSON.parse(payload);
  } catch {
    return {};
  }
}
