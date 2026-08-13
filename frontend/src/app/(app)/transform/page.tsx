"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import clsx from "clsx";
import { Pencil, Trash2, GripVertical } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  Legend,
  Line,
} from "recharts";

import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ErrorText } from "@/components/ui/error-text";
import { Select } from "@/components/ui/select";
import { Eyebrow } from "@/components/ui/eyebrow";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Modal } from "@/components/ui/modal";
import { RowActions } from "@/components/ui/row-actions";
import { IconButton } from "@/components/ui/icon-button";
import { useGlobalStore } from "@/lib/store";
import { useKeyboardShortcut } from "@/hooks/useKeyboardShortcut";
import { apiFetch } from "@/lib/api";
import { translateApiError } from "@/lib/error-messages";
import { useCanEdit } from "@/hooks/useCanEdit";
import { chartColor } from "@/lib/chart-colors";
import { InvestmentChannels } from "@/components/transform/investment-channels";
import { ConversionSettingsCard } from "@/components/transform/conversion-settings";

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

type Group = {
  id: string;
  name: string;
  apply_media_transform: boolean;
  is_baseline: boolean;
  subgroups: { id: string; name: string; group_id: string; apply_media_transform: boolean }[];
};
type TransformOp = "lag" | "decay" | "log" | "add" | "sub" | "mul" | "div" | "hill" | "adstock";
type PreviewPayload = {
  dataset_id: string;
  operation: TransformOp;
  column?: string;
  params: Record<string, string | number | boolean | null>;
  limit: number;
};

type HistoryItem = { id: string; op: string; params: Record<string, any>; created_at: string };

export default function TransformPage() {
  const t = useTranslations("transform");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const readOnlyTitle = tCommon("readOnlyTooltip");
  const { datasetId, setDatasetId, activeCompanyId } = useGlobalStore();
  const canEdit = useCanEdit();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [variables, setVariables] = useState<Variable[]>([]);
  const [variablesLoading, setVariablesLoading] = useState(false);
  const [filteredVariables, setFilteredVariables] = useState<Variable[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [selectedDataset, setSelectedDataset] = useState<string | null>(null);
  const [op, setOp] = useState<TransformOp>("lag");
  const [column, setColumn] = useState("");
  const [n, setN] = useState(1);
  const [alpha, setAlpha] = useState(0.5);
  const [hillK, setHillK] = useState(1);
  const [hillS, setHillS] = useState(1);
  const [adstockDecay, setAdstockDecay] = useState(0.5);
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [newName, setNewName] = useState("");
  const [search, setSearch] = useState("");
  const [dtypeFilter, setDtypeFilter] = useState("");
  const [showDerivedOnly, setShowDerivedOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkGroupId, setBulkGroupId] = useState("");
  const [bulkSubgroupId, setBulkSubgroupId] = useState("");
  const [bulkApplying, setBulkApplying] = useState(false);
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
    if (op === "hill") {
      if (!column) return null;
      return { ...base, column, params: { k: hillK, s: hillS } as Record<string, string | number | boolean | null> };
    }
    if (op === "adstock") {
      if (!column) return null;
      return { ...base, column, params: { decay: adstockDecay } as Record<string, string | number | boolean | null> };
    }
    if (!left || !right) return null;
    return { ...base, column: left, params: { left, right } };
  }, [activeDatasetId, op, column, n, alpha, hillK, hillS, adstockDecay, left, right]);
  const runPreview = useCallback(
    async (payload: PreviewPayload, signal?: AbortSignal) => {
      setPreviewLoading(true);
      setPreviewError("");
      try {
        const data = await apiFetch<typeof previewData>("/variables/transform/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal,
        });
        setPreviewData(data);
      } catch (error: any) {
        if (error?.name === "AbortError") {
          return;
        }
        setPreviewError((error as Error)?.message || t("builder.previewError"));
        setPreviewData(null);
      } finally {
        setPreviewLoading(false);
      }
    },
    [t]
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

  const fetchDatasets = useCallback(async () => {
    try {
      const data = await apiFetch<Dataset[]>("/datasets");
      setDatasets(data);
      if (!datasetId && data.length) {
        setDatasetId(data[0].id);
      }
    } catch {
      toast.error(t("toasts.loadDatasetsFailed"));
    }
  }, [datasetId, setDatasetId, t]);

  const fetchVariables = async (dataset: string) => {
    setVariablesLoading(true);
    try {
      const data = await apiFetch<Variable[]>(`/variables?dataset_id=${dataset}`);
      setVariables(data);
    } catch {
      toast.error(t("toasts.loadVariablesFailed"));
    } finally {
      setVariablesLoading(false);
    }
  };

  const fetchGroups = useCallback(async () => {
    setGroupsLoading(true);
    try {
      const data = await apiFetch<Group[]>("/groups");
      setGroups(data);
    } catch {
      toast.error(t("toasts.loadGroupsFailed"));
    } finally {
      setGroupsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    // activeCompanyId hydrates asynchronously (AuthBootstrap fetches /me/memberships and
    // auto-selects the first company) — fetching before it's set sends no X-Company-Id
    // header and the backend 422s ("Failed to load datasets"/"Failed to load groups").
    if (!activeCompanyId) return;
    fetchDatasets();
    fetchGroups();
  }, [fetchDatasets, fetchGroups, activeCompanyId]);

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
      setGroupError(t("groups.nameRequired"));
      return;
    }
    const original = groups.find((g) => g.id === editingGroupId)?.name;
    if (original && original === trimmed) {
      cancelGroupRename();
      return;
    }
    setRenamingGroupId(editingGroupId);
    try {
      await apiFetch(`/groups/${editingGroupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      setGroups((prev) =>
        prev.map((g) => (g.id === editingGroupId ? { ...g, name: trimmed } : g))
      );
      toast.success(t("toasts.groupRenamed", { name: trimmed }));
      cancelGroupRename();
    } catch (error: any) {
      setGroupError(translateApiError(error, tErrors) || t("toasts.groupRenameFailed"));
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
      setSubgroupError(t("groups.nameRequired"));
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
      await apiFetch(`/groups/subgroups/${editingSubgroupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
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
      toast.success(t("toasts.subgroupRenamed", { name: trimmed }));
      cancelSubgroupRename();
    } catch (error: any) {
      setSubgroupError(translateApiError(error, tErrors) || t("toasts.subgroupRenameFailed"));
    } finally {
      setRenamingSubgroupId(null);
    }
  };

  const toggleGroupMediaTransform = async (group: Group) => {
    const next = !group.apply_media_transform;
    setGroups((prev) => prev.map((g) => (g.id === group.id ? { ...g, apply_media_transform: next } : g)));
    try {
      await apiFetch(`/groups/${group.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply_media_transform: next }),
      });
      toast.success(next ? t("toasts.mediaOn", { name: group.name }) : t("toasts.mediaOff", { name: group.name }));
    } catch (error: any) {
      setGroups((prev) => prev.map((g) => (g.id === group.id ? { ...g, apply_media_transform: !next } : g)));
      toast.error((error as Error)?.message || t("toasts.groupUpdateFailed"));
    }
  };

  const toggleGroupBaseline = async (group: Group) => {
    const next = !group.is_baseline;
    // is_baseline is unique per company — the backend clears it on every other group when one is
    // set, so mirror that locally too (not just flip this one group) to avoid a stale UI showing
    // two "baseline" groups until the next fetchGroups().
    const previous = groups;
    setGroups((prev) => prev.map((g) => ({ ...g, is_baseline: g.id === group.id ? next : next ? false : g.is_baseline })));
    try {
      await apiFetch(`/groups/${group.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_baseline: next }),
      });
      toast.success(next ? t("toasts.baselineOn", { name: group.name }) : t("toasts.baselineOff", { name: group.name }));
    } catch (error: any) {
      setGroups(previous);
      toast.error((error as Error)?.message || t("toasts.groupUpdateFailed"));
    }
  };

  const toggleSubgroupMediaTransform = async (group: Group, subgroup: { id: string; name: string; apply_media_transform: boolean }) => {
    const next = !subgroup.apply_media_transform;
    setGroups((prev) =>
      prev.map((g) =>
        g.id === group.id
          ? { ...g, subgroups: g.subgroups.map((s) => (s.id === subgroup.id ? { ...s, apply_media_transform: next } : s)) }
          : g
      )
    );
    try {
      await apiFetch(`/groups/subgroups/${subgroup.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply_media_transform: next }),
      });
      toast.success(next ? t("toasts.mediaOn", { name: subgroup.name }) : t("toasts.mediaOff", { name: subgroup.name }));
    } catch (error: any) {
      setGroups((prev) =>
        prev.map((g) =>
          g.id === group.id
            ? { ...g, subgroups: g.subgroups.map((s) => (s.id === subgroup.id ? { ...s, apply_media_transform: !next } : s)) }
            : g
        )
      );
      toast.error((error as Error)?.message || t("toasts.subgroupUpdateFailed"));
    }
  };

  const confirmDeleteGroup = async () => {
    if (!groupToDelete) return;
    setGroupDeleteLoading(true);
    setGroupDeleteError("");
    try {
      const summary = await apiFetch<any>(`/groups/${groupToDelete.id}?reassign=uncategorized`, {
        method: "DELETE",
      });
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
        t("toasts.groupDeleted", {
          name: groupToDelete.name,
          count: summary?.reassigned_variables ?? groupVariableCount,
        })
      );
      closeGroupDeleteModal();
    } catch (error: any) {
      setGroupDeleteError(translateApiError(error, tErrors) || t("toasts.groupDeleteFailed"));
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
      const summary = await apiFetch<any>(`/groups/subgroups/${subgroupToDelete.subgroup.id}`, {
        method: "DELETE",
      });
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
        t("toasts.subgroupDeleted", {
          name: subgroupToDelete.subgroup.name,
          count: summary?.cleared_subgroup_assignments ?? subgroupVariableCount,
        })
      );
      closeSubgroupDeleteModal();
    } catch (error: any) {
      setSubgroupDeleteError(translateApiError(error, tErrors) || t("toasts.subgroupDeleteFailed"));
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
      } else if (op === "hill") {
        payload.column = column;
        payload.k = hillK;
        payload.s = hillS;
      } else if (op === "adstock") {
        payload.column = column;
        payload.decay = adstockDecay;
      } else {
        payload.left = left;
        payload.right = right;
      }
      await apiFetch<Variable>("/variables/transform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await fetchVariables(activeDatasetId);
      setNewName("");
      toast.success(t("toasts.variableCreated"));
    } catch (err: any) {
      toast.error((err as Error)?.message || t("toasts.transformFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleCategorize = async (variableId: string, groupId?: string | null, subgroupId?: string | null) => {
    try {
      const updated = await apiFetch<Variable>(`/variables/${variableId}/categorization`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_id: groupId, subgroup_id: subgroupId }),
      });
      setVariables((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
      fetchGroups();
      toast.success(t("toasts.categorized"));
    } catch (err: any) {
      toast.error((err as Error)?.message || t("toasts.categorizeFailed"));
    }
  };

  const toggleSelected = (variableId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(variableId)) next.delete(variableId);
      else next.add(variableId);
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    setSelectedIds((prev) => {
      const allSelected = filteredVariables.length > 0 && filteredVariables.every((v) => prev.has(v.id));
      if (allSelected) return new Set();
      return new Set(filteredVariables.map((v) => v.id));
    });
  };

  const handleBulkAssign = async () => {
    if (selectedIds.size === 0) return;
    setBulkApplying(true);
    try {
      const updated = await apiFetch<Variable[]>("/variables/bulk-categorize", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variable_ids: Array.from(selectedIds),
          group_id: bulkGroupId || null,
          subgroup_id: bulkSubgroupId || null,
        }),
      });
      const byId = new Map(updated.map((v) => [v.id, v]));
      setVariables((prev) => prev.map((v) => byId.get(v.id) ?? v));
      fetchGroups();
      toast.success(t("toasts.bulkCategorized", { count: updated.length }));
      setSelectedIds(new Set());
      setBulkGroupId("");
      setBulkSubgroupId("");
    } catch (err: any) {
      toast.error((err as Error)?.message || t("toasts.bulkCategorizeFailed"));
    } finally {
      setBulkApplying(false);
    }
  };

  const handleBulkToggleExcluded = async (exclude: boolean) => {
    if (selectedIds.size === 0) return;
    setBulkApplying(true);
    try {
      const updated = await apiFetch<Variable[]>("/variables/bulk-categorize", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variable_ids: Array.from(selectedIds), is_excluded: exclude }),
      });
      const byId = new Map(updated.map((v) => [v.id, v]));
      setVariables((prev) => prev.map((v) => byId.get(v.id) ?? v));
      toast.success(exclude ? t("toasts.bulkHidden", { count: updated.length }) : t("toasts.bulkUnhidden", { count: updated.length }));
      setSelectedIds(new Set());
    } catch (err: any) {
      toast.error((err as Error)?.message || t("toasts.bulkUpdateFailed"));
    } finally {
      setBulkApplying(false);
    }
  };

  const openHistory = async (variable: Variable) => {
    try {
      const data = await apiFetch<HistoryItem[]>(`/variables/${variable.id}/history`);
      setHistory(data);
      setHistoryVar(variable);
    } catch (err: any) {
      toast.error(err?.message || t("toasts.historyFailed"));
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
      toast.info(t("toasts.noUndo"));
      return;
    }
    try {
      await apiFetch(`/variables/${latest.id}/undo`, { method: "POST" });
      if (activeDatasetId) fetchVariables(activeDatasetId);
      toast.success(t("toasts.undone", { name: latest.name }));
    } catch (err: any) {
      toast.error((err as Error)?.message || t("toasts.undoFailed"));
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

  const requiresColumn = op === "lag" || op === "decay" || op === "log" || op === "hill" || op === "adstock";
  const requiresLeftRight = op === "add" || op === "sub" || op === "mul" || op === "div";

  return (
    <section>
      <PageHeader
        title={t("title")}
        subtitle={t("eyebrow")}
        actions={
          <div className="flex items-center gap-3">
            <Select
              wrapperClassName="w-auto"
              aria-label={t("datasetSelectAria")}
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
            </Select>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleUndo}
              disabled={!canEdit}
              title={!canEdit ? readOnlyTitle : undefined}
            >
              {t("undo")}
            </Button>
          </div>
        }
      />

      <div className="space-y-6">
        <Card className="space-y-4">
          <CardHeader as="h2" title={t("builder.title")} subtitle={t("builder.subtitle")} />
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Eyebrow htmlFor="transform-op">{t("builder.operation")}</Eyebrow>
              <Select id="transform-op" value={op} onChange={(e) => setOp(e.target.value as any)}>
                <option value="lag">{t("builder.ops.lag")}</option>
                <option value="decay">{t("builder.ops.decay")}</option>
                <option value="log">{t("builder.ops.log")}</option>
                <option value="add">{t("builder.ops.add")}</option>
                <option value="sub">{t("builder.ops.sub")}</option>
                <option value="mul">{t("builder.ops.mul")}</option>
                <option value="div">{t("builder.ops.div")}</option>
                <option value="hill">{t("builder.ops.hill")}</option>
                <option value="adstock">{t("builder.ops.adstock")}</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Eyebrow htmlFor="transform-new-name">{t("builder.newNameRequired")}</Eyebrow>
              <Input
                id="transform-new-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("builder.newNamePlaceholder")}
                required
              />
            </div>
            {requiresColumn && (
              <div className="space-y-2">
                <Eyebrow htmlFor="transform-column">{t("builder.columnRequired")}</Eyebrow>
                <div>
                  <Input
                    id="transform-column"
                    list="column-options"
                    value={column}
                    onChange={(e) => setColumn(e.target.value)}
                    placeholder={t("builder.columnPlaceholder")}
                    required
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
                <Eyebrow htmlFor="transform-periods">{t("builder.periodsOptional")}</Eyebrow>
                <Input id="transform-periods" type="number" value={n} onChange={(e) => setN(parseInt(e.target.value) || 1)} />
              </div>
            )}
            {op === "decay" && (
              <div className="space-y-2">
                <Eyebrow htmlFor="transform-alpha">{t("builder.alphaOptional")}</Eyebrow>
                <Input id="transform-alpha" type="number" step="0.05" value={alpha} onChange={(e) => setAlpha(parseFloat(e.target.value) || 0.5)} />
              </div>
            )}
            {op === "hill" && (
              <>
                <div className="space-y-2">
                  <Eyebrow htmlFor="transform-hill-k">{t("builder.hillKOptional")}</Eyebrow>
                  <Input id="transform-hill-k" type="number" step="0.1" value={hillK} onChange={(e) => setHillK(parseFloat(e.target.value) || 0)} />
                </div>
                <div className="space-y-2">
                  <Eyebrow htmlFor="transform-hill-s">{t("builder.hillSOptional")}</Eyebrow>
                  <Input id="transform-hill-s" type="number" step="0.1" value={hillS} onChange={(e) => setHillS(parseFloat(e.target.value) || 0)} />
                </div>
              </>
            )}
            {op === "adstock" && (
              <div className="space-y-2">
                <Eyebrow htmlFor="transform-adstock-decay">{t("builder.decayOptional")}</Eyebrow>
                <Input
                  id="transform-adstock-decay"
                  type="number"
                  step="0.05"
                  value={adstockDecay}
                  onChange={(e) => setAdstockDecay(parseFloat(e.target.value) || 0)}
                />
              </div>
            )}
            {requiresLeftRight && (
              <>
                <div className="space-y-2">
                  <Eyebrow htmlFor="transform-left">{t("builder.leftRequired")}</Eyebrow>
                  <div>
                    <Input
                      id="transform-left"
                      list="left-options"
                      value={left}
                      onChange={(e) => setLeft(e.target.value)}
                      placeholder={t("builder.variablePlaceholder")}
                      required
                    />
                    <datalist id="left-options">
                      {datasetColumns.map((col) => (
                        <option key={col.name} value={col.name} />
                      ))}
                    </datalist>
                  </div>
                </div>
                <div className="space-y-2">
                  <Eyebrow htmlFor="transform-right">{t("builder.rightRequired")}</Eyebrow>
                  <div>
                    <Input
                      id="transform-right"
                      list="right-options"
                      value={right}
                      onChange={(e) => setRight(e.target.value)}
                      placeholder={t("builder.variablePlaceholder")}
                      required
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
          <p className="text-2xs text-muted">{t("builder.requiredLegend")}</p>
          <div className="flex justify-end">
            <Button onClick={handleTransform} disabled={!canEdit || loading || !newName} title={!canEdit ? readOnlyTitle : undefined}>
              {loading ? t("builder.creating") : t("builder.create")}
            </Button>
          </div>
          <div className="rounded-xl border border-line p-4 space-y-3">
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={showPreview} onChange={() => setShowPreview((prev) => !prev)} />
              {t("builder.showPreview")}
            </label>
            {showPreview ? (
              previewLoading ? (
                <Skeleton className="h-chart-sm w-full" />
              ) : previewError ? (
                <ErrorText className="text-sm">
                  {previewError}{" "}
                  <button className="underline" onClick={retryPreview}>
                    {t("builder.retry")}
                  </button>
                </ErrorText>
              ) : previewData ? (
                <>
                  <PreviewChart data={previewData} originalLabel={t("builder.seriesOriginal")} transformedLabel={t("builder.seriesTransformed")} />
                  {previewData.stats && (
                    <div className="text-xs text-muted flex flex-wrap gap-4 tabular-nums">
                      <span>{t("builder.statMeanOriginal", { value: previewData.stats.mean_original?.toFixed(2) ?? "—" })}</span>
                      <span>{t("builder.statMeanTransformed", { value: previewData.stats.mean_transformed?.toFixed(2) ?? "—" })}</span>
                      <span>{t("builder.statCorrelation", { value: previewData.stats.correlation?.toFixed(2) ?? "—" })}</span>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted">{t("builder.previewHint")}</p>
              )
            ) : (
              <p className="text-sm text-muted">{t("builder.previewDisabled")}</p>
            )}
          </div>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[320px,1fr]">
          <Card className="space-y-4">
            <CardHeader as="h2" title={t("variablesCard.title")} subtitle={t("variablesCard.subtitle")} />
          <Input
            placeholder={t("variablesCard.searchPlaceholder")}
            aria-label={t("variablesCard.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Select
              wrapperClassName="flex-1 min-w-[140px]"
              aria-label={t("variablesCard.dtypeFilterAria")}
              value={dtypeFilter}
              onChange={(e) => setDtypeFilter(e.target.value)}
            >
              <option value="">{t("variablesCard.allDtypes")}</option>
              {dtypeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </Select>
            <label className="flex items-center gap-2 text-xs text-muted whitespace-nowrap">
              <input type="checkbox" checked={showDerivedOnly} onChange={(e) => setShowDerivedOnly(e.target.checked)} />
              {t("variablesCard.derivedOnly")}
            </label>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={filteredVariables.length > 0 && filteredVariables.every((v) => selectedIds.has(v.id))}
              onChange={toggleSelectAllFiltered}
            />
            {t("variablesCard.selectAllFiltered", { count: filteredVariables.length })}
          </label>
          {selectedIds.size > 0 && (
            <div className="rounded-xl border border-dashed border-line-2 p-3 space-y-2 text-xs">
              <p className="font-medium text-sm text-ink">{t("variablesCard.selectedCount", { count: selectedIds.size })}</p>
              <RowActions className="flex-wrap gap-2">
                <Select
                  wrapperClassName="w-auto"
                  aria-label={t("variablesCard.bulkGroupAria")}
                  value={bulkGroupId}
                  onChange={(e) => {
                    setBulkGroupId(e.target.value);
                    setBulkSubgroupId("");
                  }}
                >
                  <option value="">{t("variablesCard.noGroup")}</option>
                  {activeGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
                <Select
                  wrapperClassName="w-auto"
                  aria-label={t("variablesCard.bulkSubgroupAria")}
                  value={bulkSubgroupId}
                  onChange={(e) => setBulkSubgroupId(e.target.value)}
                >
                  <option value="">{t("variablesCard.noSubgroup")}</option>
                  {(activeGroups.find((g) => g.id === bulkGroupId)?.subgroups || []).map((sg) => (
                    <option key={sg.id} value={sg.id}>
                      {sg.name}
                    </option>
                  ))}
                </Select>
                <Button size="sm" onClick={handleBulkAssign} disabled={!canEdit || bulkApplying} title={!canEdit ? readOnlyTitle : undefined}>
                  {t("variablesCard.assign")}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => handleBulkToggleExcluded(true)} disabled={!canEdit || bulkApplying} title={!canEdit ? readOnlyTitle : undefined}>
                  {t("variablesCard.hide")}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => handleBulkToggleExcluded(false)} disabled={!canEdit || bulkApplying} title={!canEdit ? readOnlyTitle : undefined}>
                  {t("variablesCard.unhide")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
                  {tCommon("cancel")}
                </Button>
              </RowActions>
            </div>
          )}
          <div className="max-h-[500px] space-y-2 overflow-y-auto pr-2">
            {variablesLoading ? (
              <>
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </>
            ) : filteredVariables.length === 0 ? (
              <EmptyState title={t("variablesCard.emptyTitle")} description={t("variablesCard.emptyDescription")} />
            ) : (
              filteredVariables.map((variable) => (
                <VariableRow
                  key={variable.id}
                  variable={variable}
                  selected={selectedIds.has(variable.id)}
                  onToggleSelect={() => toggleSelected(variable.id)}
                  onDragStart={(event) => {
                    event.dataTransfer?.setData("text/plain", variable.id);
                    setDraggingVar(variable);
                  }}
                  onDragEnd={() => setDraggingVar(null)}
                  onHistory={() => openHistory(variable)}
                  historyLabel={t("variablesCard.history")}
                />
              ))
            )}
          </div>
        </Card>

          <Card className="space-y-4">
            <CardHeader as="h2" title={t("groups.title")} subtitle={t("groups.subtitle")} />
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Eyebrow htmlFor="new-group-name">{t("groups.newGroup")}</Eyebrow>
                <div className="flex gap-2">
                  <Input
                    id="new-group-name"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder={t("groups.groupNamePlaceholder")}
                  />
                  <Button
                    size="sm"
                    disabled={!canEdit}
                    title={!canEdit ? readOnlyTitle : undefined}
                    onClick={async () => {
                      if (!newGroupName.trim()) return;
                      try {
                        await apiFetch("/groups", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ name: newGroupName }),
                        });
                        setNewGroupName("");
                        fetchGroups();
                        toast.success(t("toasts.groupCreated"));
                      } catch (err: any) {
                        toast.error((err as Error)?.message || t("toasts.groupCreateFailed"));
                      }
                    }}
                  >
                    {t("groups.add")}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Eyebrow htmlFor="new-subgroup-parent">{t("groups.newSubgroup")}</Eyebrow>
                <div className="flex flex-wrap gap-2">
                  <Select
                    id="new-subgroup-parent"
                    wrapperClassName="flex-1 min-w-[140px]"
                    value={newSubgroupParent}
                    onChange={(e) => setNewSubgroupParent(e.target.value)}
                  >
                    <option value="">{t("groups.selectGroup")}</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </Select>
                  <Input
                    className="flex-1 min-w-[120px]"
                    value={newSubgroupName}
                    onChange={(e) => setNewSubgroupName(e.target.value)}
                    placeholder={t("groups.subgroupNamePlaceholder")}
                  />
                  <Button
                    size="sm"
                    className="shrink-0"
                    disabled={!canEdit}
                    title={!canEdit ? readOnlyTitle : undefined}
                    onClick={async () => {
                      if (!newSubgroupParent || !newSubgroupName.trim()) return;
                      try {
                        await apiFetch("/groups/subgroups", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ group_id: newSubgroupParent, name: newSubgroupName }),
                        });
                        setNewSubgroupName("");
                        fetchGroups();
                        toast.success(t("toasts.subgroupCreated"));
                      } catch (err: any) {
                        toast.error((err as Error)?.message || t("toasts.subgroupCreateFailed"));
                      }
                    }}
                  >
                    {t("groups.add")}
                  </Button>
                </div>
              </div>
            </div>
            <div
              className={clsx(
                "rounded-xl border border-dashed p-4 text-sm text-muted",
                draggingVar ? "border-accent" : "border-line-2"
              )}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const variableId = e.dataTransfer.getData("text/plain");
                const targetId = variableId || draggingVar?.id;
                if (targetId) handleCategorize(targetId, null, null);
              }}
            >
              {t("groups.dropToClear")}
            </div>
            {groupsLoading ? (
              <div className="grid gap-4 md:grid-cols-2">
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-32 w-full" />
              </div>
            ) : activeGroups.length === 0 ? (
              <EmptyState title={t("groups.emptyTitle")} description={t("groups.emptyDescription")} />
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {activeGroups.map((group) => (
                  <div
                    key={group.id}
                    className={clsx(
                      "rounded-xl border p-4 space-y-3 transition",
                      draggingVar ? "border-dashed border-accent" : "border-line"
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
                              className="rounded-full border border-border-control bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                              value={groupDraft}
                              onChange={(e) => setGroupDraft(e.target.value.slice(0, 40))}
                              aria-label={t("groups.renameAria", { name: group.name })}
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
                            {groupError && <ErrorText className="text-xs">{groupError}</ErrorText>}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="flex items-center gap-2 group cursor-pointer text-left disabled:cursor-not-allowed disabled:opacity-60"
                              onClick={() => startGroupRename(group)}
                              disabled={!canEdit}
                              title={!canEdit ? readOnlyTitle : undefined}
                            >
                              <span className="font-medium text-ink truncate max-w-[220px]">{group.name}</span>
                              <Pencil size={14} className="text-muted opacity-0 group-hover:opacity-100 transition" />
                            </button>
                            <IconButton
                              size="sm"
                              className="!text-bad hover:!bg-bad-bg"
                              aria-label={t("groups.deleteAria", { name: group.name })}
                              onClick={() => {
                                setGroupToDelete(group);
                                setGroupDeleteError("");
                              }}
                              disabled={!canEdit}
                              title={!canEdit ? readOnlyTitle : undefined}
                            >
                              <Trash2 size={14} />
                            </IconButton>
                          </div>
                        )}
                      </div>
                      <Badge>{t("groups.subgroupCount", { count: group.subgroups.length })}</Badge>
                      {group.is_baseline && <Badge variant="accent">{t("groups.baseline")}</Badge>}
                    </div>
                    <label className="flex items-center gap-2 text-xs text-muted" title={t("groups.mediaTooltip")}>
                      <input
                        type="checkbox"
                        checked={group.apply_media_transform}
                        disabled={!canEdit}
                        onChange={() => toggleGroupMediaTransform(group)}
                      />
                      {t("groups.mediaLabel")}
                    </label>
                    <label className="flex items-center gap-2 text-xs text-muted" title={t("groups.baselineTooltip")}>
                      <input
                        type="checkbox"
                        checked={group.is_baseline}
                        disabled={!canEdit}
                        onChange={() => toggleGroupBaseline(group)}
                      />
                      {t("groups.baselineLabel")}
                    </label>
                    <div className="space-y-2">
                      {group.subgroups.map((sub) => (
                        <div
                          key={sub.id}
                          className="rounded-lg border border-dashed border-line-2 px-3 py-2 text-sm"
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
                                className="rounded-full border border-border-control bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                value={subgroupDraft}
                                onChange={(e) => setSubgroupDraft(e.target.value.slice(0, 40))}
                                aria-label={t("groups.renameAria", { name: sub.name })}
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
                                <ErrorText className="text-xs">{subgroupError}</ErrorText>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center justify-between gap-2">
                              <button
                                type="button"
                                className="flex-1 flex items-center gap-2 group text-left disabled:cursor-not-allowed disabled:opacity-60"
                                onClick={() => startSubgroupRename(group.id, sub)}
                                disabled={!canEdit}
                                title={!canEdit ? readOnlyTitle : undefined}
                              >
                                <span className="truncate text-ink">{sub.name}</span>
                                <Pencil size={14} className="text-muted opacity-0 group-hover:opacity-100 transition" />
                              </button>
                              <label
                                className="flex items-center gap-1 text-3xs uppercase text-muted shrink-0"
                                title={t("groups.mediaTooltip")}
                              >
                                <input
                                  type="checkbox"
                                  checked={sub.apply_media_transform}
                                  disabled={!canEdit}
                                  onChange={() => toggleSubgroupMediaTransform(group, sub)}
                                />
                                {t("groups.mediaShort")}
                              </label>
                              <IconButton
                                size="sm"
                                className="!text-bad hover:!bg-bad-bg"
                                aria-label={t("groups.deleteAria", { name: sub.name })}
                                onClick={() => {
                                  setSubgroupToDelete({ group, subgroup: sub });
                                  setSubgroupDeleteError("");
                                }}
                                disabled={!canEdit}
                                title={!canEdit ? readOnlyTitle : undefined}
                              >
                                <Trash2 size={14} />
                              </IconButton>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    <GroupAssignments variables={variables} groupId={group.id} subgroupIds={group.subgroups.map((s) => s.id)} label={t("groups.assigned")} />
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <InvestmentChannels
          datasetId={activeDatasetId}
          variableNames={variables.map((v) => v.name)}
          datasetColumns={datasetColumns}
          canEdit={canEdit}
        />

        <ConversionSettingsCard datasetId={activeDatasetId} datasetColumns={datasetColumns} canEdit={canEdit} />
      </div>

      <Modal open={!!historyVar} onClose={() => setHistoryVar(null)} title={t("history.title", { name: historyVar?.name ?? "" })}>
        <div className="max-h-[360px] overflow-y-auto space-y-3">
          {history.length === 0 && <p className="text-sm text-muted">{t("history.empty")}</p>}
          {history.map((item) => (
            <div key={item.id} className="rounded-lg border border-line p-3 text-sm space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-medium uppercase text-xs text-muted">{item.op}</span>
                <span className="text-xs text-muted">{new Date(item.created_at).toLocaleString()}</span>
              </div>
              <pre className="text-xs text-muted overflow-x-auto">{JSON.stringify(item.params, null, 2)}</pre>
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" onClick={() => setHistoryVar(null)}>
            {tCommon("close")}
          </Button>
        </div>
      </Modal>

      <Modal open={!!groupToDelete} onClose={closeGroupDeleteModal} title={t("groups.deleteTitle", { name: groupToDelete?.name ?? "" })}>
        {groupDeleteError && <ErrorText className="text-sm">{groupDeleteError}</ErrorText>}
        <p className="text-sm text-ink">{t("groups.deleteBody", { count: groupVariableCount })}</p>
        <ErrorText className="text-xs">{t("groups.cannotUndo")}</ErrorText>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={closeGroupDeleteModal} disabled={groupDeleteLoading}>
            {tCommon("cancel")}
          </Button>
          <Button variant="danger" onClick={confirmDeleteGroup} disabled={!canEdit || groupDeleteLoading} title={!canEdit ? readOnlyTitle : undefined}>
            {groupDeleteLoading ? t("groups.deleting") : t("groups.deleteConfirm")}
          </Button>
        </div>
      </Modal>

      <Modal
        open={!!subgroupToDelete}
        onClose={closeSubgroupDeleteModal}
        title={t("groups.deleteSubgroupTitle", { name: subgroupToDelete?.subgroup.name ?? "" })}
      >
        {subgroupDeleteError && <ErrorText className="text-sm">{subgroupDeleteError}</ErrorText>}
        <p className="text-sm text-ink">
          {t("groups.deleteSubgroupBody", { count: subgroupVariableCount, group: subgroupToDelete?.group.name ?? "" })}
        </p>
        <ErrorText className="text-xs">{t("groups.cannotUndo")}</ErrorText>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={closeSubgroupDeleteModal} disabled={subgroupDeleteLoading}>
            {tCommon("cancel")}
          </Button>
          <Button
            variant="danger"
            onClick={confirmDeleteSubgroup}
            disabled={!canEdit || subgroupDeleteLoading}
            title={!canEdit ? readOnlyTitle : undefined}
          >
            {subgroupDeleteLoading ? t("groups.deleting") : t("groups.deleteSubgroupConfirm")}
          </Button>
        </div>
      </Modal>
    </section>
  );
}

function VariableRow({
  variable,
  selected,
  onToggleSelect,
  onDragStart,
  onDragEnd,
  onHistory,
  historyLabel,
}: {
  variable: Variable;
  selected: boolean;
  onToggleSelect: () => void;
  onDragStart: (event: React.DragEvent) => void;
  onDragEnd: () => void;
  onHistory: () => void;
  historyLabel: string;
}) {
  return (
    <div
      className="rounded-xl border border-line p-3 text-sm bg-surface cursor-grab active:cursor-grabbing"
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 shrink-0 text-muted" aria-hidden />
          <input
            type="checkbox"
            checked={selected}
            onClick={(e) => e.stopPropagation()}
            onChange={onToggleSelect}
            aria-label={variable.name}
          />
          <div>
            <p className="font-medium text-ink">{variable.name}</p>
            <p className="text-xs text-muted">{variable.dtype}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {variable.is_derived && <Badge variant="neutral">fx</Badge>}
          {(variable.group_name || variable.subgroup_name) && (
            <Badge variant="neutral">{variable.subgroup_name || variable.group_name}</Badge>
          )}
          {variable.is_derived && (
            <button className="text-xs text-accent underline" onClick={onHistory}>
              {historyLabel}
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
  label,
}: {
  variables: Variable[];
  groupId: string;
  subgroupIds: string[];
  label: string;
}) {
  const members = variables.filter((v) => v.group_id === groupId || subgroupIds.includes(v.subgroup_id || ""));
  if (!members.length) return null;
  return (
    <div className="text-xs text-muted">
      {label}:{" "}
      {members.map((m, idx) => (
        <span key={m.id}>{idx > 0 && ", "}{m.name}</span>
      ))}
    </div>
  );
}

function PreviewChart({
  data,
  originalLabel,
  transformedLabel,
}: {
  data: { time: (string | number)[]; original: (number | null)[]; transformed: (number | null)[] };
  originalLabel: string;
  transformedLabel: string;
}) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const chartData = data.time.map((time, index) => ({
    time,
    original: data.original[index],
    transformed: data.transformed[index],
  }));

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="time" tick={{ fontSize: 10 }} minTickGap={20} />
          <YAxis tick={{ fontSize: 10 }} />
          <RechartsTooltip />
          <Legend />
          <Line type="monotone" dataKey="original" name={originalLabel} stroke={chartColor(0, isDark)} dot={false} />
          <Line type="monotone" dataKey="transformed" name={transformedLabel} stroke={chartColor(1, isDark)} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
