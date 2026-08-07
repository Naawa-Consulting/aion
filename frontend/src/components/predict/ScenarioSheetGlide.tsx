"use client";

import React, { useMemo, useState, useCallback, useRef, useEffect } from "react";
import DataEditor, {
  type EditableGridCell,
  GridCellKind,
  type GridCell,
  type GridColumn,
  type Item,
  type DataEditorRef,
  type GridSelection,
  CompactSelection,
} from "@glideapps/glide-data-grid";

import "@glideapps/glide-data-grid/dist/index.css";

type ScenarioVariable = {
  name: string;
  baselineMean: number;
  group?: string | null;
};

export type MultipliersMap = Record<string, Record<string, number>>;
export type AbsoluteValuesMap = Record<string, Record<string, number>>;

export type ScenarioSheetGlideProps = {
  variables: ScenarioVariable[];
  periods: string[];
  multipliers: MultipliersMap;
  absoluteValues?: AbsoluteValuesMap;
  editMode: "multipliers" | "absolute";
  onMultipliersChange: (
    next: MultipliersMap,
    nextAbsolute?: AbsoluteValuesMap
  ) => void;
};

const DEFAULT_ROWS = 20;
const FALLBACK_PERIOD_COUNT = 6;

type CellRect = { x: number; y: number; width: number; height: number };

const formatNumericDisplay = (value: string | number): string => {
  const numericValue =
    typeof value === "number" ? value : Number((value ?? "").toString());
  if (Number.isFinite(numericValue)) {
    return numericValue.toLocaleString(undefined, {
      maximumFractionDigits: 2,
    });
  }
  return String(value ?? "");
};

const cloneMultipliers = (source: MultipliersMap) => {
  const clone: MultipliersMap = {};
  Object.entries(source || {}).forEach(([variable, periods]) => {
    clone[variable] = { ...periods };
  });
  return clone;
};

const cloneAbsolute = (source?: AbsoluteValuesMap) => {
  if (!source) return undefined;
  const clone: AbsoluteValuesMap = {};
  Object.entries(source).forEach(([variable, periods]) => {
    clone[variable] = { ...periods };
  });
  return clone;
};

const ScenarioSheetGlide: React.FC<ScenarioSheetGlideProps> = ({
  variables = [],
  periods = [],
  multipliers = {},
  absoluteValues,
  editMode = "multipliers",
  onMultipliersChange,
}) => {
  const [sortState, setSortState] = useState<{
    column: "group" | "variable" | null;
    direction: "asc" | "desc";
  }>({ column: null, direction: "asc" });

  const periodLabels = useMemo(() => {
    if (periods && periods.length > 0) {
      return periods;
    }
    return Array.from({ length: FALLBACK_PERIOD_COUNT }).map(
      (_value, idx) => `Period ${idx + 1}`
    );
  }, [periods]);

  const periodCount = periodLabels.length;

  const columns: GridColumn[] = useMemo(
    () => [
      { id: "group", title: "Group", width: 160 },
      { id: "variable", title: "Variable", width: 220 },
      ...periodLabels.map((label) => ({ id: label, title: label, grow: 1 })),
    ],
    [periodLabels]
  );

  const totalColumns = 2 + periodCount;

  const computeAbsoluteValue = useCallback(
    (
      variable: ScenarioVariable | undefined,
      periodId: string,
      rowIdx: number,
      periodIdx: number
    ) => {
      if (!variable) {
        return rowIdx * 10 + periodIdx + 1;
      }

      const mean = Number.isFinite(variable.baselineMean)
        ? variable.baselineMean
        : 0;
      const override = absoluteValues?.[variable.name]?.[periodId];
      if (override != null && Number.isFinite(override)) {
        return override;
      }
      const multiplier = multipliers[variable.name]?.[periodId] ?? 1;
      return mean * multiplier;
    },
    [absoluteValues, multipliers]
  );

  const applyAbsoluteChanges = useCallback(
    (changes: { row: number; col: number; absValue: number }[]) => {
      if (!changes.length) return;
      const nextMultipliers = cloneMultipliers(multipliers);
      let nextAbsolute = cloneAbsolute(absoluteValues);
      let dirty = false;

      changes.forEach(({ row, col, absValue }) => {
        if (col <= 1) return;
        const variable = variables[row];
        if (!variable) return;
        const periodId = periodLabels[col - 2];
        if (!periodId) return;
        const safeMean =
          Number.isFinite(variable.baselineMean) && variable.baselineMean > 0
            ? variable.baselineMean
            : 1;
        const multiplier =
          safeMean === 0 ? 0 : Number((absValue / safeMean).toFixed(6));
        const varMultiplierEntry = {
          ...(nextMultipliers[variable.name] ?? {}),
        };
        varMultiplierEntry[periodId] = multiplier;
        nextMultipliers[variable.name] = varMultiplierEntry;

        if (!nextAbsolute) {
          nextAbsolute = {};
        }
        const absEntry = { ...(nextAbsolute[variable.name] ?? {}) };
        absEntry[periodId] = Number(absValue.toFixed(2));
        nextAbsolute[variable.name] = absEntry;
        dirty = true;
      });

      if (dirty) {
        onMultipliersChange(nextMultipliers, nextAbsolute);
      }
    },
    [absoluteValues, multipliers, onMultipliersChange, periodLabels, variables]
  );

  const createInitialRows = useCallback(
    (count: number, vars: ScenarioVariable[]) =>
      Array.from({ length: count }).map((_, rowIdx) => {
        const variable = vars[rowIdx];
        const variableName = variable?.name ?? `Variable ${rowIdx + 1}`;
        const groupName = variable?.group ?? "Other";
        const numericValues = periodLabels.map((periodId, periodIdx) =>
          computeAbsoluteValue(variable, periodId, rowIdx, periodIdx)
        );
        return [groupName || "Other", variableName, ...numericValues];
      }),
    [computeAbsoluteValue, periodLabels]
  );

  const [gridData, setGridData] = useState<(string | number)[][]>(() =>
    createInitialRows(
      Math.max(variables.length, DEFAULT_ROWS),
      variables.length
        ? variables
        : Array.from({ length: DEFAULT_ROWS }).map((_, idx) => ({
            name: `Variable ${idx + 1}`,
            baselineMean: 0,
            group: "Other",
          }))
    )
  );

  useEffect(() => {
    const effectiveVariables =
      variables.length > 0
        ? variables
        : Array.from({ length: DEFAULT_ROWS }).map((_, idx) => ({
            name: `Variable ${idx + 1}`,
            baselineMean: 0,
            group: "Other",
          }));

    const next = createInitialRows(effectiveVariables.length, effectiveVariables);
    setGridData(next);
  }, [variables, createInitialRows]);

  const [gridSelection, setGridSelection] = useState<GridSelection>({
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty(),
    current: undefined,
  });
  const [lastCell, setLastCell] = useState<Item | null>([2, 0]);

  const editorRef = useRef<DataEditorRef | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [activeEdit, setActiveEdit] = useState<{
    cell: Item;
    rect: CellRect;
    value: string;
  } | null>(null);

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const value = gridData[row]?.[col] ?? 0;
      if (col === 0) {
        return {
          kind: GridCellKind.Text,
          data: String(value),
          displayData: String(value),
          allowOverlay: false,
          readonly: true,
        };
      }
      if (col === 1) {
        return {
          kind: GridCellKind.Text,
          data: String(value),
          displayData: String(value),
          allowOverlay: false,
          readonly: true,
        };
      }
      return {
        kind: GridCellKind.Text,
        data: value.toString(),
        // Editing is handled entirely by our own activeEdit overlay below (via
        // onCellActivated/handleKeyDown) — allowOverlay:true would additionally let
        // glide-data-grid's own internal reselect() open its built-in overlay editor on
        // the same activation (double-click/Enter/typing), a second editor fighting our
        // custom one for focus and DOM state, which is what caused the arrow-key lockup.
        displayData: formatNumericDisplay(value),
        allowOverlay: false,
        readonly: false,
      };
    },
    [gridData]
  );

  const updateCell = useCallback(
    (cell: Item, newValue: EditableGridCell) => {
      if (cell[0] <= 1) return;
      if (
        newValue.kind !== GridCellKind.Number &&
        newValue.kind !== GridCellKind.Text
      ) {
        return;
      }

      const raw =
        newValue.kind === GridCellKind.Number ? newValue.data : newValue.data;
      const parsed =
        typeof raw === "number" ? raw : Number((raw ?? "").toString());
      if (!Number.isFinite(parsed)) return;

      setGridData((prev) => {
        const next = prev.map((row) => [...row]);
        const [col, row] = cell;
        next[row][col] = parsed;
        return next;
      });
      applyAbsoluteChanges([{ row: cell[1], col: cell[0], absValue: parsed }]);
    },
    [applyAbsoluteChanges]
  );

  const beginEdit = useCallback(
    (cell: Item, initialValue?: string) => {
      if (cell[0] <= 1) return;
      const [col, row] = cell;
      const currentValue = gridData[row]?.[col] ?? 0;
      // getBounds returns viewport-relative coordinates (canvas.getBoundingClientRect()
      // offset baked in) — translate into the wrapper's own coordinate space since the
      // overlay <input> is absolutely positioned within it.
      const cellBounds = editorRef.current?.getBounds(col, row);
      const containerBounds = containerRef.current?.getBoundingClientRect();
      const rect =
        cellBounds && containerBounds
          ? {
              x: cellBounds.x - containerBounds.x,
              y: cellBounds.y - containerBounds.y,
              width: cellBounds.width,
              height: cellBounds.height,
            }
          : { x: col * 120 + 1, y: row * 32 + 1, width: 120, height: 32 };
      setLastCell(cell);
      setActiveEdit({
        cell,
        rect,
        value:
          initialValue ?? (Number.isFinite(currentValue) ? String(currentValue) : ""),
      });
    },
    [gridData]
  );

  const handleCellActivated = useCallback(
    (cell: Item) => {
      beginEdit(cell);
    },
    [beginEdit]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (activeEdit) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.length !== 1) return;
      const selectionCell = gridSelection.current?.cell ?? lastCell;
      if (!selectionCell) return;
      if (selectionCell[0] <= 1) return;
      event.preventDefault();
      beginEdit(selectionCell, event.key);
    },
    [activeEdit, beginEdit, gridSelection, lastCell]
  );

  const restoreSelection = useCallback(() => {
    if (!lastCell) return;
    setGridSelection({
      columns: CompactSelection.empty(),
      rows: CompactSelection.empty(),
      current: {
        cell: lastCell,
        range: { x: lastCell[0], y: lastCell[1], width: 1, height: 1 },
        rangeStack: [],
      },
    });
  }, [lastCell]);

  const refocusGrid = useCallback(() => {
    // Restore selection first so the grid's accessibility-tree focus proxy for the
    // target cell exists before we focus it — focusing then restoring selection (the
    // previous order) let the selection update's re-render unmount/replace that same
    // proxy element right after it received focus, dropping focus to document.body and
    // leaving arrow-key navigation dead until a manual re-focus (e.g. clicking a cell).
    restoreSelection();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        editorRef.current?.focus?.();
      });
    });
  }, [restoreSelection]);

  const commitActiveEdit = useCallback(() => {
    if (!activeEdit) return;
    const { cell, value } = activeEdit;
    setActiveEdit(null);
    const cellValue: EditableGridCell = {
      kind: GridCellKind.Text,
      data: value,
      displayData: value,
      allowOverlay: false,
    };
    setLastCell(cell);
    updateCell(cell, cellValue);
    refocusGrid();
  }, [activeEdit, updateCell, refocusGrid]);

  const cancelActiveEdit = useCallback(() => {
    setActiveEdit(null);
    refocusGrid();
  }, [refocusGrid]);

  const getSelectionBounds = useCallback(() => {
    const current = gridSelection.current;
    if (!current) return null;
    const { range } = current;
    return {
      startCol: Math.max(0, range.x),
      endCol: Math.min(totalColumns - 1, range.x + range.width - 1),
      startRow: Math.max(0, range.y),
      endRow: Math.min(gridData.length - 1, range.y + range.height - 1),
    };
  }, [gridSelection, gridData.length, totalColumns]);

  const handleCopyCapture = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      if (activeEdit) return;
      const bounds = getSelectionBounds();
      if (!bounds) return;
      const lines: string[] = [];
      for (let r = bounds.startRow; r <= bounds.endRow; r += 1) {
        const row = gridData[r] ?? [];
        const cells: string[] = [];
        for (let c = bounds.startCol; c <= bounds.endCol; c += 1) {
          cells.push(String(row[c] ?? ""));
        }
        lines.push(cells.join("\t"));
      }
      const payload = lines.join("\n");
      event.preventDefault();
      event.clipboardData?.setData("text/plain", payload);
    },
    [activeEdit, getSelectionBounds, gridData]
  );

  const handlePasteCapture = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      if (activeEdit) return;
      const bounds = getSelectionBounds();
      if (!bounds) return;
      const text = event.clipboardData?.getData("text/plain");
      if (!text) return;
      const rowsCopy = gridData.map((row) => [...row]);
      const updates: { row: number; col: number; absValue: number }[] = [];
      const rawLines = text.split(/\r?\n/).filter((line) => line.length > 0);
      if (!rawLines.length) return;

      const matrix = rawLines.map((line) => line.split("\t"));
      const matrixRows = Math.max(1, matrix.length);
      const matrixCols = Math.max(1, ...matrix.map((row) => row.length));

      for (let r = bounds.startRow; r <= bounds.endRow; r += 1) {
        if (r >= rowsCopy.length) break;
        for (let c = bounds.startCol; c <= bounds.endCol; c += 1) {
          if (c >= totalColumns) break;
          const rowOffset = r - bounds.startRow;
          const colOffset = c - bounds.startCol;
          const sourceRow = matrix[rowOffset % matrixRows] ?? [];
          const valueToUse = sourceRow[colOffset % matrixCols];
          if (valueToUse == null || valueToUse === "") continue;
          const parsed = Number(valueToUse);
          if (c < 2) continue;
          if (Number.isFinite(parsed) && !Number.isNaN(parsed)) {
            rowsCopy[r][c] = parsed;
            updates.push({ row: r, col: c, absValue: parsed });
          }
        }
      }
      event.preventDefault();
      setGridData(rowsCopy);
      applyAbsoluteChanges(updates);
    },
    [activeEdit, applyAbsoluteChanges, getSelectionBounds, gridData, totalColumns]
  );

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: 420,
        borderRadius: 16,
        border: "1px solid var(--color-border, #e5e7eb)",
        overflow: "hidden",
        position: "relative",
      }}
      onCopyCapture={handleCopyCapture}
      onPasteCapture={handlePasteCapture}
      onKeyDownCapture={handleKeyDown}
    >
      <DataEditor
        ref={editorRef}
        columns={columns}
        rows={gridData.length}
        getCellContent={getCellContent}
        gridSelection={gridSelection}
        onGridSelectionChange={(selection) => {
          setGridSelection(selection);
          if (selection.current?.cell) {
            setLastCell(selection.current.cell);
          }
        }}
        onCellEdited={updateCell}
        onCellsEdited={(edits) => {
          edits.forEach((edit) => updateCell(edit.location, edit.value));
        }}
        onCellActivated={handleCellActivated}
        onHeaderClicked={(columnIndex) => {
          if (columnIndex > 1) {
            setSortState({ column: null, direction: "asc" });
            return;
          }
          setSortState((prev) => {
            const targetColumn = columnIndex === 0 ? "group" : "variable";
            if (prev.column === targetColumn) {
              return {
                column: targetColumn,
                direction: prev.direction === "asc" ? "desc" : "asc",
              };
            }
            return { column: targetColumn, direction: "asc" };
          });
        }}
        rangeSelect="rect"
        // glide-data-grid has its own window-level paste listener that, with no onPaste
        // prop, async-reads the clipboard and writes a single target cell — it resolves
        // after our synchronous handlePasteCapture (onPasteCapture below) already applied
        // the correct multi-cell paste, silently stomping it. Disabling it here makes our
        // own handler the only source of truth.
        onPaste={false}
        smoothScrollX
        smoothScrollY
      />
      {activeEdit && (
        <input
          style={{
            position: "absolute",
            left: activeEdit.rect.x,
            top: activeEdit.rect.y,
            width: activeEdit.rect.width,
            height: activeEdit.rect.height,
            border: "2px solid var(--color-accent)",
            borderRadius: 4,
            padding: "0 8px",
            fontSize: 14,
            zIndex: 5,
            background: "var(--color-card)",
            color: "var(--color-foreground)",
          }}
          value={activeEdit.value}
          onChange={(event) =>
            setActiveEdit((prev) => (prev ? { ...prev, value: event.target.value } : prev))
          }
          onBlur={commitActiveEdit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitActiveEdit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              cancelActiveEdit();
            }
          }}
          autoFocus
        />
      )}
    </div>
  );
};

export default ScenarioSheetGlide;
