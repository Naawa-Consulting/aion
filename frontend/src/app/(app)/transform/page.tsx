"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import clsx from "clsx";
import { Pencil, Trash2, GripVertical, Info } from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  Legend,
  Line,
  Bar,
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
import { Tooltip as InfoPopover } from "@/components/ui/tooltip";
import { useGlobalStore } from "@/lib/store";
import { useKeyboardShortcut } from "@/hooks/useKeyboardShortcut";
import { apiFetch, ApiError } from "@/lib/api";
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
  display_name?: string | null;
  unit?: string | null;
  created_at?: string | null;
};

type Group = {
  id: string;
  name: string;
  apply_media_transform: boolean;
  is_baseline: boolean;
  is_seasonal: boolean;
  subgroups: { id: string; name: string; group_id: string; apply_media_transform: boolean; is_seasonal: boolean }[];
};
type TransformOp =
  | "lag" | "decay" | "log" | "add" | "sub" | "mul" | "div" | "hill" | "adstock"
  | "constant" | "date_dummy" | "trend" | "fourier";
type PreviewPayload = {
  dataset_id: string;
  operation: TransformOp;
  column?: string;
  params: Record<string, string | number | boolean | null>;
  limit: number;
};
type PreviewData = {
  time: (string | number)[];
  original: (number | null)[] | null;
  transformed: (number | null)[];
  dependent?: (number | null)[] | null;
  dependent_label?: string | null;
  stats?: {
    mean_original?: number;
    mean_transformed?: number;
    correlation?: number;
    correlation_dependent_before?: number | null;
    correlation_dependent_after?: number | null;
  };
};
type PendingGroupFlag = {
  group: Group;
  kind: "media" | "baseline" | "seasonal";
  subgroup?: { id: string; name: string; is_seasonal: boolean };
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
  const [adstockLag, setAdstockLag] = useState(0);
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [constantValue, setConstantValue] = useState(1);
  const [dummyStart, setDummyStart] = useState("");
  const [dummyEnd, setDummyEnd] = useState("");
  const [fourierPeriod, setFourierPeriod] = useState(12);
  const [fourierHarmonic, setFourierHarmonic] = useState(1);
  const [fourierTrig, setFourierTrig] = useState<"sin" | "cos">("sin");
  const [newName, setNewName] = useState("");
  const [search, setSearch] = useState("");
  const [dtypeFilter, setDtypeFilter] = useState("");
  const [showDerivedOnly, setShowDerivedOnly] = useState(false);
  const [showUncategorizedOnly, setShowUncategorizedOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkGroupId, setBulkGroupId] = useState("");
  const [bulkSubgroupId, setBulkSubgroupId] = useState("");
  const [bulkApplying, setBulkApplying] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
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
  // A02-R2: is_baseline/apply_media_transform/is_seasonal are company-wide flags that
  // retroactively affect every model (is_seasonal also affects Predict's forecast, T6) built on
  // this group's variables — confirm before applying, instead of firing on the checkbox's own
  // onChange. subgroup is set when confirming a subgroup-level flag instead of the group itself.
  const [pendingGroupFlag, setPendingGroupFlag] = useState<PendingGroupFlag | null>(null);
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
      return { ...base, column, params: { decay: adstockDecay, lag: adstockLag } as Record<string, string | number | boolean | null> };
    }
    if (op === "constant") {
      return { ...base, params: { value: constantValue } as Record<string, string | number | boolean | null> };
    }
    if (op === "date_dummy") {
      if (!dummyStart || !dummyEnd) return null;
      return { ...base, params: { start_date: dummyStart, end_date: dummyEnd } as Record<string, string | number | boolean | null> };
    }
    if (op === "trend") {
      return { ...base, params: {} };
    }
    if (op === "fourier") {
      if (!fourierPeriod) return null;
      return {
        ...base,
        params: { period: fourierPeriod, harmonic: fourierHarmonic, trig: fourierTrig } as Record<string, string | number | boolean | null>,
      };
    }
    if (!left || !right) return null;
    return { ...base, column: left, params: { left, right } };
  }, [
    activeDatasetId, op, column, n, alpha, hillK, hillS, adstockDecay, adstockLag, left, right,
    constantValue, dummyStart, dummyEnd, fourierPeriod, fourierHarmonic, fourierTrig,
  ]);
  const runPreview = useCallback(
    async (payload: PreviewPayload, signal?: AbortSignal) => {
      setPreviewLoading(true);
      setPreviewError("");
      try {
        const data = await apiFetch<PreviewData>("/variables/transform/preview", {
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
      if (showUncategorizedOnly && v.group_id) return false;
      if (search && !v.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (dtypeFilter && !v.dtype.toLowerCase().includes(dtypeFilter.toLowerCase())) return false;
      return true;
    });
    setFilteredVariables(next);
  }, [variables, search, dtypeFilter, showDerivedOnly, showUncategorizedOnly]);

  const uncategorizedCount = useMemo(() => variables.filter((v) => !v.group_id).length, [variables]);

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
      // Only reassign when the current selection (persisted from a previous session, or a
      // stale id whose dataset was deleted) isn't in the fresh list — never override an
      // active, still-valid selection with "most recently created" on every fetch.
      if (data.length && !data.some((ds) => ds.id === datasetId)) {
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
      toast.error(error instanceof ApiError ? translateApiError(error, tErrors) : t("toasts.groupUpdateFailed"));
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
      toast.error(error instanceof ApiError ? translateApiError(error, tErrors) : t("toasts.groupUpdateFailed"));
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
      toast.error(error instanceof ApiError ? translateApiError(error, tErrors) : t("toasts.subgroupUpdateFailed"));
    }
  };

  const toggleGroupSeasonal = async (group: Group) => {
    const next = !group.is_seasonal;
    setGroups((prev) => prev.map((g) => (g.id === group.id ? { ...g, is_seasonal: next } : g)));
    try {
      await apiFetch(`/groups/${group.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_seasonal: next }),
      });
      toast.success(next ? t("toasts.seasonalOn", { name: group.name }) : t("toasts.seasonalOff", { name: group.name }));
    } catch (error: any) {
      setGroups((prev) => prev.map((g) => (g.id === group.id ? { ...g, is_seasonal: !next } : g)));
      toast.error(error instanceof ApiError ? translateApiError(error, tErrors) : t("toasts.groupUpdateFailed"));
    }
  };

  const toggleSubgroupSeasonal = async (group: Group, subgroup: { id: string; name: string; is_seasonal: boolean }) => {
    const next = !subgroup.is_seasonal;
    setGroups((prev) =>
      prev.map((g) =>
        g.id === group.id
          ? { ...g, subgroups: g.subgroups.map((s) => (s.id === subgroup.id ? { ...s, is_seasonal: next } : s)) }
          : g
      )
    );
    try {
      await apiFetch(`/groups/subgroups/${subgroup.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_seasonal: next }),
      });
      toast.success(next ? t("toasts.seasonalOn", { name: subgroup.name }) : t("toasts.seasonalOff", { name: subgroup.name }));
    } catch (error: any) {
      setGroups((prev) =>
        prev.map((g) =>
          g.id === group.id
            ? { ...g, subgroups: g.subgroups.map((s) => (s.id === subgroup.id ? { ...s, is_seasonal: !next } : s)) }
            : g
        )
      );
      toast.error(error instanceof ApiError ? translateApiError(error, tErrors) : t("toasts.subgroupUpdateFailed"));
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
        payload.lag = adstockLag;
      } else if (op === "constant") {
        payload.value = constantValue;
      } else if (op === "date_dummy") {
        payload.start_date = dummyStart;
        payload.end_date = dummyEnd;
      } else if (op === "trend") {
        // no params
      } else if (op === "fourier") {
        payload.period = fourierPeriod;
        payload.harmonic = fourierHarmonic;
        payload.trig = fourierTrig;
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
      toast.error(err instanceof ApiError ? translateApiError(err, tErrors) : t("toasts.transformFailed"));
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
      toast.error(err instanceof ApiError ? translateApiError(err, tErrors) : t("toasts.categorizeFailed"));
    }
  };

  const handleUpdateLabel = async (variableId: string, displayName: string, unit: string) => {
    try {
      const updated = await apiFetch<Variable>(`/variables/${variableId}/categorization`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: displayName || null, unit: unit || null }),
      });
      setVariables((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
      toast.success(t("toasts.categorized"));
    } catch (err: any) {
      toast.error(err instanceof ApiError ? translateApiError(err, tErrors) : t("toasts.categorizeFailed"));
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
      toast.error(err instanceof ApiError ? translateApiError(err, tErrors) : t("toasts.bulkCategorizeFailed"));
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
      toast.error(err instanceof ApiError ? translateApiError(err, tErrors) : t("toasts.bulkUpdateFailed"));
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
      toast.error(err instanceof ApiError ? translateApiError(err, tErrors) : t("toasts.historyFailed"));
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
      toast.error(err instanceof ApiError ? translateApiError(err, tErrors) : t("toasts.undoFailed"));
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
              disabledReason={!canEdit ? readOnlyTitle : undefined}
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
                <optgroup label={t("builder.opGroups.transform")}>
                  <option value="lag">{t("builder.ops.lag")}</option>
                  <option value="decay">{t("builder.ops.decay")}</option>
                  <option value="log">{t("builder.ops.log")}</option>
                  <option value="add">{t("builder.ops.add")}</option>
                  <option value="sub">{t("builder.ops.sub")}</option>
                  <option value="mul">{t("builder.ops.mul")}</option>
                  <option value="div">{t("builder.ops.div")}</option>
                  <option value="hill">{t("builder.ops.hill")}</option>
                  <option value="adstock">{t("builder.ops.adstock")}</option>
                </optgroup>
                <optgroup label={t("builder.opGroups.generate")}>
                  <option value="constant">{t("builder.ops.constant")}</option>
                  <option value="date_dummy">{t("builder.ops.date_dummy")}</option>
                  <option value="trend">{t("builder.ops.trend")}</option>
                  <option value="fourier">{t("builder.ops.fourier")}</option>
                </optgroup>
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
              <>
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
                <div className="space-y-2">
                  <Eyebrow htmlFor="transform-adstock-lag">{t("builder.lagOptional")}</Eyebrow>
                  <Input
                    id="transform-adstock-lag"
                    type="number"
                    min={0}
                    value={adstockLag}
                    onChange={(e) => setAdstockLag(Math.max(0, parseInt(e.target.value) || 0))}
                  />
                </div>
              </>
            )}
            {op === "constant" && (
              <div className="space-y-2">
                <Eyebrow htmlFor="transform-constant-value">{t("builder.constantValue")}</Eyebrow>
                <Input
                  id="transform-constant-value"
                  type="number"
                  step="any"
                  value={constantValue}
                  onChange={(e) => setConstantValue(parseFloat(e.target.value) || 0)}
                />
              </div>
            )}
            {op === "date_dummy" && (
              <>
                <div className="space-y-2">
                  <Eyebrow htmlFor="transform-dummy-start">{t("builder.dummyStartRequired")}</Eyebrow>
                  <Input id="transform-dummy-start" type="date" value={dummyStart} onChange={(e) => setDummyStart(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Eyebrow htmlFor="transform-dummy-end">{t("builder.dummyEndRequired")}</Eyebrow>
                  <Input id="transform-dummy-end" type="date" value={dummyEnd} onChange={(e) => setDummyEnd(e.target.value)} required />
                </div>
              </>
            )}
            {op === "trend" && (
              <p className="text-sm text-muted md:col-span-2">{t("builder.trendHint")}</p>
            )}
            {op === "fourier" && (
              <>
                <div className="space-y-2">
                  <Eyebrow htmlFor="transform-fourier-period">{t("builder.fourierPeriodRequired")}</Eyebrow>
                  <Input
                    id="transform-fourier-period"
                    type="number"
                    step="any"
                    value={fourierPeriod}
                    onChange={(e) => setFourierPeriod(parseFloat(e.target.value) || 0)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Eyebrow htmlFor="transform-fourier-harmonic">{t("builder.fourierHarmonicOptional")}</Eyebrow>
                  <Input
                    id="transform-fourier-harmonic"
                    type="number"
                    min={1}
                    value={fourierHarmonic}
                    onChange={(e) => setFourierHarmonic(Math.max(1, parseInt(e.target.value) || 1))}
                  />
                </div>
                <div className="space-y-2">
                  <Eyebrow htmlFor="transform-fourier-trig">{t("builder.fourierTrigOptional")}</Eyebrow>
                  <Select id="transform-fourier-trig" value={fourierTrig} onChange={(e) => setFourierTrig(e.target.value as "sin" | "cos")}>
                    <option value="sin">sin</option>
                    <option value="cos">cos</option>
                  </Select>
                </div>
              </>
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
            <Button onClick={handleTransform} disabled={!canEdit || loading || !newName} disabledReason={!canEdit ? readOnlyTitle : undefined}>
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
                  <PreviewChart
                    data={previewData}
                    originalLabel={t("builder.seriesOriginal")}
                    transformedLabel={t("builder.seriesTransformed")}
                    dependentLabel={previewData.dependent_label ? t("builder.seriesDependent", { name: previewData.dependent_label }) : ""}
                  />
                  {previewData.stats && (
                    <div className="text-xs text-muted flex flex-wrap gap-4 tabular-nums">
                      {previewData.stats.mean_original != null && (
                        <span>{t("builder.statMeanOriginal", { value: previewData.stats.mean_original.toFixed(2) })}</span>
                      )}
                      <span>{t("builder.statMeanTransformed", { value: previewData.stats.mean_transformed?.toFixed(2) ?? "—" })}</span>
                      {previewData.stats.correlation_dependent_before != null || previewData.stats.correlation_dependent_after != null ? (
                        <>
                          <span>{t("builder.statCorrDependentBefore", { value: previewData.stats.correlation_dependent_before?.toFixed(2) ?? "—" })}</span>
                          <span>{t("builder.statCorrDependentAfter", { value: previewData.stats.correlation_dependent_after?.toFixed(2) ?? "—" })}</span>
                        </>
                      ) : previewData.stats.correlation != null ? (
                        <span>{t("builder.statCorrelation", { value: previewData.stats.correlation.toFixed(2) })}</span>
                      ) : null}
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
            <label className="flex items-center gap-2 text-xs text-muted whitespace-nowrap">
              <input
                type="checkbox"
                checked={showUncategorizedOnly}
                onChange={(e) => setShowUncategorizedOnly(e.target.checked)}
              />
              {t("variablesCard.uncategorizedOnly", { count: uncategorizedCount })}
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
                <Button size="sm" onClick={handleBulkAssign} disabled={!canEdit || bulkApplying} disabledReason={!canEdit ? readOnlyTitle : undefined}>
                  {t("variablesCard.assign")}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => handleBulkToggleExcluded(true)} disabled={!canEdit || bulkApplying} disabledReason={!canEdit ? readOnlyTitle : undefined}>
                  {t("variablesCard.hide")}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => handleBulkToggleExcluded(false)} disabled={!canEdit || bulkApplying} disabledReason={!canEdit ? readOnlyTitle : undefined}>
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
                  onSaveLabel={(displayName, unit) => handleUpdateLabel(variable.id, displayName, unit)}
                  canEdit={canEdit}
                  displayNameLabel={t("variablesCard.displayNameLabel")}
                  unitLabel={t("variablesCard.unitLabel")}
                  saveLabel={t("variablesCard.saveLabel")}
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
                    disabledReason={!canEdit ? readOnlyTitle : undefined}
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
                        toast.error(err instanceof ApiError ? translateApiError(err, tErrors) : t("toasts.groupCreateFailed"));
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
                    disabledReason={!canEdit ? readOnlyTitle : undefined}
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
                        toast.error(err instanceof ApiError ? translateApiError(err, tErrors) : t("toasts.subgroupCreateFailed"));
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
                            {!canEdit ? (
                              <InfoPopover content={readOnlyTitle}>
                                <button
                                  type="button"
                                  className="flex items-center gap-2 group cursor-pointer text-left disabled:cursor-not-allowed disabled:opacity-60"
                                  onClick={() => startGroupRename(group)}
                                  disabled
                                >
                                  <span className="font-medium text-ink truncate max-w-[220px]">{group.name}</span>
                                  <Pencil size={14} className="text-muted opacity-0 group-hover:opacity-100 transition" />
                                </button>
                              </InfoPopover>
                            ) : (
                              <button
                                type="button"
                                className="flex items-center gap-2 group cursor-pointer text-left disabled:cursor-not-allowed disabled:opacity-60"
                                onClick={() => startGroupRename(group)}
                              >
                                <span className="font-medium text-ink truncate max-w-[220px]">{group.name}</span>
                                <Pencil size={14} className="text-muted opacity-0 group-hover:opacity-100 transition" />
                              </button>
                            )}
                            <IconButton
                              size="sm"
                              className="!text-bad hover:!bg-bad-bg"
                              aria-label={t("groups.deleteAria", { name: group.name })}
                              onClick={() => {
                                setGroupToDelete(group);
                                setGroupDeleteError("");
                              }}
                              disabled={!canEdit}
                              disabledReason={!canEdit ? readOnlyTitle : undefined}
                            >
                              <Trash2 size={14} />
                            </IconButton>
                          </div>
                        )}
                      </div>
                      <Badge>{t("groups.subgroupCount", { count: group.subgroups.length })}</Badge>
                      {group.is_baseline && <Badge variant="accent">{t("groups.baseline")}</Badge>}
                    </div>
                    <label className="flex items-center gap-2 text-xs text-muted">
                      <input
                        type="checkbox"
                        checked={group.apply_media_transform}
                        disabled={!canEdit}
                        onChange={() => setPendingGroupFlag({ group, kind: "media" })}
                      />
                      {t("groups.mediaLabel")}
                      <InfoTooltip label={t("groups.mediaLabel")} content={t("groups.mediaTooltip")} />
                    </label>
                    <label className="flex items-center gap-2 text-xs text-muted">
                      <input
                        type="checkbox"
                        checked={group.is_baseline}
                        disabled={!canEdit}
                        onChange={() => setPendingGroupFlag({ group, kind: "baseline" })}
                      />
                      {t("groups.baselineLabel")}
                      <InfoTooltip label={t("groups.baselineLabel")} content={t("groups.baselineTooltip")} />
                    </label>
                    <label className="flex items-center gap-2 text-xs text-muted">
                      <input
                        type="checkbox"
                        checked={group.is_seasonal}
                        disabled={!canEdit}
                        onChange={() => setPendingGroupFlag({ group, kind: "seasonal" })}
                      />
                      {t("groups.seasonalLabel")}
                      <InfoTooltip label={t("groups.seasonalLabel")} content={t("groups.seasonalTooltip")} />
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
                              {!canEdit ? (
                                <InfoPopover content={readOnlyTitle} triggerClassName="flex-1">
                                  <button
                                    type="button"
                                    className="flex-1 flex items-center gap-2 group text-left disabled:cursor-not-allowed disabled:opacity-60"
                                    onClick={() => startSubgroupRename(group.id, sub)}
                                    disabled
                                  >
                                    <span className="truncate text-ink">{sub.name}</span>
                                    <Pencil size={14} className="text-muted opacity-0 group-hover:opacity-100 transition" />
                                  </button>
                                </InfoPopover>
                              ) : (
                                <button
                                  type="button"
                                  className="flex-1 flex items-center gap-2 group text-left disabled:cursor-not-allowed disabled:opacity-60"
                                  onClick={() => startSubgroupRename(group.id, sub)}
                                >
                                  <span className="truncate text-ink">{sub.name}</span>
                                  <Pencil size={14} className="text-muted opacity-0 group-hover:opacity-100 transition" />
                                </button>
                              )}
                              <label className="flex items-center gap-1 text-3xs uppercase text-muted shrink-0">
                                <input
                                  type="checkbox"
                                  checked={sub.apply_media_transform}
                                  disabled={!canEdit}
                                  onChange={() => toggleSubgroupMediaTransform(group, sub)}
                                />
                                {t("groups.mediaShort")}
                                <InfoTooltip label={t("groups.mediaLabel")} content={t("groups.mediaTooltip")} />
                              </label>
                              <label className="flex items-center gap-1 text-3xs uppercase text-muted shrink-0">
                                <input
                                  type="checkbox"
                                  checked={sub.is_seasonal}
                                  disabled={!canEdit}
                                  onChange={() => setPendingGroupFlag({ group, kind: "seasonal", subgroup: sub })}
                                />
                                {t("groups.seasonalShort")}
                                <InfoTooltip label={t("groups.seasonalLabel")} content={t("groups.seasonalTooltip")} />
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
                                disabledReason={!canEdit ? readOnlyTitle : undefined}
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
          <Button variant="danger" onClick={confirmDeleteGroup} disabled={!canEdit || groupDeleteLoading} disabledReason={!canEdit ? readOnlyTitle : undefined}>
            {groupDeleteLoading ? t("groups.deleting") : t("groups.deleteConfirm")}
          </Button>
        </div>
      </Modal>

      <Modal
        open={!!pendingGroupFlag}
        onClose={() => setPendingGroupFlag(null)}
        title={t("groups.confirmFlagTitle")}
      >
        <p className="text-sm text-ink">
          {pendingGroupFlag?.subgroup
            ? t("groups.confirmSeasonalBody", { name: pendingGroupFlag.subgroup.name })
            : pendingGroupFlag?.kind === "baseline"
            ? t("groups.confirmBaselineBody", { name: pendingGroupFlag.group.name })
            : pendingGroupFlag?.kind === "seasonal"
            ? t("groups.confirmSeasonalBody", { name: pendingGroupFlag.group.name })
            : t("groups.confirmMediaBody", { name: pendingGroupFlag?.group.name ?? "" })}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setPendingGroupFlag(null)}>
            {tCommon("cancel")}
          </Button>
          <Button
            onClick={async () => {
              if (!pendingGroupFlag) return;
              const { group, kind, subgroup } = pendingGroupFlag;
              setPendingGroupFlag(null);
              if (subgroup) {
                await toggleSubgroupSeasonal(group, subgroup);
              } else if (kind === "baseline") {
                await toggleGroupBaseline(group);
              } else if (kind === "seasonal") {
                await toggleGroupSeasonal(group);
              } else {
                await toggleGroupMediaTransform(group);
              }
            }}
          >
            {tCommon("confirm")}
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
            disabledReason={!canEdit ? readOnlyTitle : undefined}
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
  onSaveLabel,
  canEdit,
  displayNameLabel,
  unitLabel,
  saveLabel,
}: {
  variable: Variable;
  selected: boolean;
  onToggleSelect: () => void;
  onDragStart: (event: React.DragEvent) => void;
  onDragEnd: () => void;
  onHistory: () => void;
  historyLabel: string;
  onSaveLabel: (displayName: string, unit: string) => void;
  canEdit: boolean;
  displayNameLabel: string;
  unitLabel: string;
  saveLabel: string;
}) {
  const [editingLabel, setEditingLabel] = useState(false);
  const [draftDisplayName, setDraftDisplayName] = useState(variable.display_name ?? "");
  const [draftUnit, setDraftUnit] = useState(variable.unit ?? "");

  return (
    <div
      className="rounded-xl border border-line p-3 text-sm bg-surface cursor-grab active:cursor-grabbing"
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <GripVertical className="h-4 w-4 shrink-0 text-muted" aria-hidden />
          <input
            type="checkbox"
            checked={selected}
            onClick={(e) => e.stopPropagation()}
            onChange={onToggleSelect}
            aria-label={variable.name}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <p className="truncate font-medium text-ink">{variable.display_name || variable.name}</p>
              {canEdit && (
                <button
                  type="button"
                  aria-label={displayNameLabel}
                  className="shrink-0 rounded p-0.5 text-muted hover:text-ink"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingLabel((v) => !v);
                  }}
                >
                  <Pencil size={12} />
                </button>
              )}
            </div>
            <p className="text-xs text-muted">
              {variable.name} · {variable.dtype}
              {variable.unit ? ` · ${variable.unit}` : ""}
            </p>
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
      {editingLabel && (
        <div
          className="mt-2 flex flex-wrap items-center gap-2"
          draggable={false}
          onDragStart={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <Input
            value={draftDisplayName}
            onChange={(e) => setDraftDisplayName(e.target.value)}
            placeholder={displayNameLabel}
            className="h-control-sm w-[180px]"
          />
          <Input
            value={draftUnit}
            onChange={(e) => setDraftUnit(e.target.value)}
            placeholder={unitLabel}
            className="h-control-sm w-[110px]"
          />
          <Button
            size="sm"
            onClick={() => {
              onSaveLabel(draftDisplayName.trim(), draftUnit.trim());
              setEditingLabel(false);
            }}
          >
            {saveLabel}
          </Button>
        </div>
      )}
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
    <div className="space-y-1">
      <p className="text-3xs uppercase text-muted">{label} ({members.length})</p>
      <div className="flex flex-wrap gap-1">
        {members.map((m) => (
          <Badge key={m.id} variant="neutral" className="truncate max-w-[160px]">
            {m.name}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function PreviewChart({
  data,
  originalLabel,
  transformedLabel,
  dependentLabel,
}: {
  data: { time: (string | number)[]; original: (number | null)[] | null; transformed: (number | null)[]; dependent?: (number | null)[] | null };
  originalLabel: string;
  transformedLabel: string;
  dependentLabel?: string;
}) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const hasOriginal = !!data.original;
  const hasDependent = !!data.dependent;
  const chartData = data.time.map((time, index) => ({
    time,
    original: hasOriginal ? data.original![index] : undefined,
    transformed: data.transformed[index],
    dependent: hasDependent ? data.dependent![index] : undefined,
  }));

  // T3+T4: original (raw units, e.g. millions) and transformed (e.g. Hill output in [0,1]) can
  // differ by orders of magnitude — sharing one Y axis flattened the transformed line to zero.
  // Two visible axes (left=original bars, right=transformed line) fix that; dependent gets its
  // own hidden axis purely for independent scaling, not for a 3rd set of ticks.
  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart accessibilityLayer data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="time" tick={{ fontSize: 10 }} minTickGap={20} />
          <YAxis yAxisId="left" tick={{ fontSize: 10 }} hide={!hasOriginal} />
          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
          {hasDependent && <YAxis yAxisId="dependent" hide />}
          <RechartsTooltip />
          <Legend />
          {hasOriginal && (
            <Bar yAxisId="left" dataKey="original" name={originalLabel} fill={chartColor(0, isDark)} opacity={0.6} />
          )}
          <Line yAxisId="right" type="monotone" dataKey="transformed" name={transformedLabel} stroke={chartColor(1, isDark)} dot={false} strokeWidth={2} />
          {hasDependent && (
            <Line
              yAxisId="dependent"
              type="monotone"
              dataKey="dependent"
              name={dependentLabel || "dependent"}
              stroke={chartColor(2, isDark)}
              strokeDasharray="4 3"
              dot={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function InfoTooltip({ label, content }: { label: string; content: string }) {
  return (
    <InfoPopover content={<span style={{ whiteSpace: "normal", display: "block", width: "max-content", maxWidth: 220 }}>{content}</span>}>
      <button
        type="button"
        aria-label={label}
        className="-m-1.5 rounded-full p-1.5 text-muted transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Info className="h-3 w-3" />
      </button>
    </InfoPopover>
  );
}
