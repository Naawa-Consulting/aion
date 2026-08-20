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
  type Theme as GlideTheme,
  CompactSelection,
} from "@glideapps/glide-data-grid";
import { useTheme } from "next-themes";
import { ArrowRightToLine } from "lucide-react";

import { parseNumericInput } from "@/lib/format";

import "@glideapps/glide-data-grid/dist/index.css";

const LIGHT_GRID_THEME: Partial<GlideTheme> = {
  accentColor: "#4b3fb0",
  accentFg: "#ffffff",
  accentLight: "#eeecfb",
  textDark: "#17181c",
  textMedium: "#52555e",
  textLight: "#6d7178",
  textBubble: "#17181c",
  textHeader: "#52555e",
  textHeaderSelected: "#17181c",
  bgIconHeader: "#52555e",
  fgIconHeader: "#fafafb",
  bgCell: "#ffffff",
  bgCellMedium: "#fafafb",
  bgHeader: "#fafafb",
  bgHeaderHasFocus: "#eeecfb",
  bgHeaderHovered: "#fafafb",
  bgBubble: "#fafafb",
  borderColor: "#e5e6ea",
  horizontalBorderColor: "#e5e6ea",
  fontFamily: "var(--font-ui)",
};

const DARK_GRID_THEME: Partial<GlideTheme> = {
  ...LIGHT_GRID_THEME,
  accentColor: "#a79bf5",
  accentFg: "#0b0c0e",
  accentLight: "#221d3d",
  textDark: "#f2f3f5",
  textMedium: "#aab0b8",
  textLight: "#81858e",
  textBubble: "#f2f3f5",
  textHeader: "#aab0b8",
  textHeaderSelected: "#f2f3f5",
  bgIconHeader: "#aab0b8",
  fgIconHeader: "#1b1e22",
  bgCell: "#16181b",
  bgCellMedium: "#1b1e22",
  bgHeader: "#1b1e22",
  bgHeaderHasFocus: "#221d3d",
  bgHeaderHovered: "#1b1e22",
  bgBubble: "#1b1e22",
  borderColor: "#262a2f",
  horizontalBorderColor: "#262a2f",
};

type ScenarioVariable = {
  name: string;
  displayName?: string;
  baselineMean: number;
  // Fase 5/P2: seasonal per-period baseline (raw units) from `ScenarioSummary.variable_baselines`
  // — falls back to `baselineMean` for a period with no entry (e.g. before the first preview).
  baselineByPeriod?: Record<string, number>;
  // Fase 5/P8: $-per-unit rate when this variable is an InvestmentChannel's proxy. `editMode`
  // only converts display/input for rows where this is set — everything else stays in units
  // regardless of the global toggle (never hidden, just not $-convertible).
  dollarRate?: number | null;
  group?: string | null;
};

export type MultipliersMap = Record<string, Record<string, number>>;
export type AbsoluteValuesMap = Record<string, Record<string, number>>;

export type ScenarioSheetGlideProps = {
  variables: ScenarioVariable[];
  periods: string[];
  multipliers: MultipliersMap;
  absoluteValues?: AbsoluteValuesMap;
  editMode: "units" | "dollars";
  onMultipliersChange: (
    next: MultipliersMap,
    nextAbsolute?: AbsoluteValuesMap
  ) => void;
  groupColumnLabel?: string;
  variableColumnLabel?: string;
  totalColumnLabel?: string;
  totalRowLabel?: string;
  fillRightLabel?: string;
  // Called whenever one or more edited/pasted cells were discarded for not being a valid
  // number, with the count of discarded cells — lets the caller surface a toast instead of
  // the previous silent no-op (the cell just reverts to its prior value either way).
  onInvalidInput?: (count: number) => void;
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

function baselineForPeriod(variable: ScenarioVariable | undefined, periodId: string): number {
  if (!variable) return 0;
  const perPeriod = variable.baselineByPeriod?.[periodId];
  if (perPeriod != null && Number.isFinite(perPeriod)) return perPeriod;
  return Number.isFinite(variable.baselineMean) ? variable.baselineMean : 0;
}

// Raw (native-unit) <-> display (native unit, or $ when in "dollars" mode and the variable has a
// resolvable dollarRate) conversion. `gridData` always stores RAW values — display conversion
// happens only at render/parse time so toggling editMode never requires regenerating the grid.
function toDisplay(variable: ScenarioVariable | undefined, raw: number, editMode: "units" | "dollars"): number {
  if (editMode === "dollars" && variable?.dollarRate) return raw * variable.dollarRate;
  return raw;
}

function toRaw(variable: ScenarioVariable | undefined, display: number, editMode: "units" | "dollars"): number {
  if (editMode === "dollars" && variable?.dollarRate) return display / variable.dollarRate;
  return display;
}

const readonlyTextCell = (text: string): GridCell => ({
  kind: GridCellKind.Text,
  data: text,
  displayData: text,
  allowOverlay: false,
  readonly: true,
});

const ScenarioSheetGlide: React.FC<ScenarioSheetGlideProps> = ({
  variables = [],
  periods = [],
  multipliers = {},
  absoluteValues,
  editMode = "units",
  onMultipliersChange,
  groupColumnLabel = "Group",
  variableColumnLabel = "Variable",
  totalColumnLabel = "Total",
  totalRowLabel = "Total",
  fillRightLabel = "Fill selected row right",
  onInvalidInput,
}) => {
  const { resolvedTheme } = useTheme();
  const gridTheme = resolvedTheme === "dark" ? DARK_GRID_THEME : LIGHT_GRID_THEME;

  const periodLabels = useMemo(() => {
    if (periods && periods.length > 0) {
      return periods;
    }
    return Array.from({ length: FALLBACK_PERIOD_COUNT }).map(
      (_value, idx) => `Period ${idx + 1}`
    );
  }, [periods]);

  const periodCount = periodLabels.length;
  const TOTAL_COL = 2 + periodCount;
  const totalColumns = 3 + periodCount;

  const columns: GridColumn[] = useMemo(
    () => [
      { id: "group", title: groupColumnLabel, width: 160 },
      { id: "variable", title: variableColumnLabel, width: 220 },
      ...periodLabels.map((label) => ({ id: label, title: label, grow: 1 })),
      { id: "__total__", title: totalColumnLabel, width: 110 },
    ],
    [periodLabels, groupColumnLabel, variableColumnLabel, totalColumnLabel]
  );

  const computeRawValue = useCallback(
    (
      variable: ScenarioVariable | undefined,
      periodId: string,
      rowIdx: number,
      periodIdx: number
    ) => {
      if (!variable) {
        return rowIdx * 10 + periodIdx + 1;
      }
      const override = absoluteValues?.[variable.name]?.[periodId];
      if (override != null && Number.isFinite(override)) {
        return override;
      }
      const baseline = baselineForPeriod(variable, periodId);
      const multiplier = multipliers[variable.name]?.[periodId] ?? 1;
      return baseline * multiplier;
    },
    [absoluteValues, multipliers]
  );

  const applyAbsoluteChanges = useCallback(
    (changes: { row: number; col: number; rawValue: number }[]) => {
      if (!changes.length) return;
      const nextMultipliers = cloneMultipliers(multipliers);
      let nextAbsolute = cloneAbsolute(absoluteValues);
      let dirty = false;

      changes.forEach(({ row, col, rawValue }) => {
        if (col <= 1 || col === TOTAL_COL) return;
        const variable = variables[row];
        if (!variable) return;
        const periodId = periodLabels[col - 2];
        if (!periodId) return;
        const baseline = baselineForPeriod(variable, periodId);
        const safeBaseline = baseline > 0 ? baseline : 1;
        const multiplier = baseline === 0 ? 0 : Number((rawValue / safeBaseline).toFixed(6));
        const varMultiplierEntry = {
          ...(nextMultipliers[variable.name] ?? {}),
        };
        varMultiplierEntry[periodId] = multiplier;
        nextMultipliers[variable.name] = varMultiplierEntry;

        if (!nextAbsolute) {
          nextAbsolute = {};
        }
        const absEntry = { ...(nextAbsolute[variable.name] ?? {}) };
        absEntry[periodId] = Number(rawValue.toFixed(2));
        nextAbsolute[variable.name] = absEntry;
        dirty = true;
      });

      if (dirty) {
        onMultipliersChange(nextMultipliers, nextAbsolute);
      }
    },
    [absoluteValues, multipliers, onMultipliersChange, periodLabels, variables, TOTAL_COL]
  );

  const createInitialRows = useCallback(
    (count: number, vars: ScenarioVariable[]) =>
      Array.from({ length: count }).map((_, rowIdx) => {
        const variable = vars[rowIdx];
        const variableName = variable?.displayName ?? variable?.name ?? `Variable ${rowIdx + 1}`;
        const groupName = variable?.group ?? "Other";
        const numericValues = periodLabels.map((periodId, periodIdx) =>
          computeRawValue(variable, periodId, rowIdx, periodIdx)
        );
        return [groupName || "Other", variableName, ...numericValues];
      }),
    [computeRawValue, periodLabels]
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

  const rowCount = gridData.length;
  const totalsRow = rowCount; // one implicit extra row, rendered but never stored in gridData

  const rowTotalsRaw = useMemo(
    () =>
      gridData.map((row) => {
        let sum = 0;
        for (let c = 2; c < 2 + periodCount; c += 1) sum += Number(row[c]) || 0;
        return sum;
      }),
    [gridData, periodCount]
  );

  const periodTotalsDisplay = useMemo(() => {
    const totals = new Array(periodCount).fill(0);
    gridData.forEach((row, rowIdx) => {
      const variable = variables[rowIdx];
      for (let p = 0; p < periodCount; p += 1) {
        totals[p] += toDisplay(variable, Number(row[2 + p]) || 0, editMode);
      }
    });
    return totals;
  }, [gridData, variables, periodCount, editMode]);

  const grandTotalDisplay = useMemo(
    () => periodTotalsDisplay.reduce((sum, value) => sum + value, 0),
    [periodTotalsDisplay]
  );

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

  const isProtectedCell = useCallback(
    (col: number, row: number) => col <= 1 || col === TOTAL_COL || row === totalsRow,
    [TOTAL_COL, totalsRow]
  );

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      if (row === totalsRow) {
        if (col === 0) return readonlyTextCell(totalRowLabel);
        if (col === 1) return readonlyTextCell("");
        if (col === TOTAL_COL) return readonlyTextCell(formatNumericDisplay(grandTotalDisplay));
        return readonlyTextCell(formatNumericDisplay(periodTotalsDisplay[col - 2] ?? 0));
      }
      const value = gridData[row]?.[col] ?? 0;
      if (col === 0 || col === 1) {
        return readonlyTextCell(String(value));
      }
      const variable = variables[row];
      if (col === TOTAL_COL) {
        return readonlyTextCell(formatNumericDisplay(toDisplay(variable, rowTotalsRaw[row] ?? 0, editMode)));
      }
      const display = toDisplay(variable, Number(value) || 0, editMode);
      return {
        kind: GridCellKind.Text,
        data: display.toString(),
        // Editing is handled entirely by our own activeEdit overlay below (via
        // onCellActivated/handleKeyDown) — allowOverlay:true would additionally let
        // glide-data-grid's own internal reselect() open its built-in overlay editor on
        // the same activation (double-click/Enter/typing), a second editor fighting our
        // custom one for focus and DOM state, which is what caused the arrow-key lockup.
        displayData: formatNumericDisplay(display),
        allowOverlay: false,
        readonly: false,
      };
    },
    [gridData, variables, totalsRow, TOTAL_COL, totalRowLabel, grandTotalDisplay, periodTotalsDisplay, rowTotalsRaw, editMode]
  );

  const updateCell = useCallback(
    (cell: Item, newValue: EditableGridCell) => {
      if (isProtectedCell(cell[0], cell[1])) return;
      if (
        newValue.kind !== GridCellKind.Number &&
        newValue.kind !== GridCellKind.Text
      ) {
        return;
      }

      const raw =
        newValue.kind === GridCellKind.Number ? newValue.data : newValue.data;
      const parsedDisplay = parseNumericInput(raw as string | number);
      if (!Number.isFinite(parsedDisplay)) {
        onInvalidInput?.(1);
        return;
      }
      const variable = variables[cell[1]];
      const parsedRaw = toRaw(variable, parsedDisplay, editMode);

      setGridData((prev) => {
        const next = prev.map((row) => [...row]);
        const [col, row] = cell;
        next[row][col] = parsedRaw;
        return next;
      });
      applyAbsoluteChanges([{ row: cell[1], col: cell[0], rawValue: parsedRaw }]);
    },
    [applyAbsoluteChanges, onInvalidInput, isProtectedCell, variables, editMode]
  );

  const beginEdit = useCallback(
    (cell: Item, initialValue?: string) => {
      if (isProtectedCell(cell[0], cell[1])) return;
      const [col, row] = cell;
      const variable = variables[row];
      const currentRaw = gridData[row]?.[col] ?? 0;
      const currentDisplay = toDisplay(variable, Number(currentRaw) || 0, editMode);
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
          initialValue ?? (Number.isFinite(currentDisplay) ? String(currentDisplay) : ""),
      });
    },
    [gridData, isProtectedCell, variables, editMode]
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
      if (isProtectedCell(selectionCell[0], selectionCell[1])) return;
      event.preventDefault();
      beginEdit(selectionCell, event.key);
    },
    [activeEdit, beginEdit, gridSelection, lastCell, isProtectedCell]
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
      endRow: Math.min(rowCount - 1, range.y + range.height - 1),
    };
  }, [gridSelection, rowCount, totalColumns]);

  const handleCopyCapture = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      if (activeEdit) return;
      const bounds = getSelectionBounds();
      if (!bounds) return;
      const lines: string[] = [];
      for (let r = bounds.startRow; r <= bounds.endRow; r += 1) {
        const row = gridData[r] ?? [];
        const variable = variables[r];
        const cells: string[] = [];
        for (let c = bounds.startCol; c <= bounds.endCol; c += 1) {
          if (c >= 2 && c < TOTAL_COL) {
            cells.push(String(toDisplay(variable, Number(row[c]) || 0, editMode)));
          } else {
            cells.push(String(row[c] ?? ""));
          }
        }
        lines.push(cells.join("\t"));
      }
      const payload = lines.join("\n");
      event.preventDefault();
      event.clipboardData?.setData("text/plain", payload);
    },
    [activeEdit, getSelectionBounds, gridData, variables, TOTAL_COL, editMode]
  );

  const handlePasteCapture = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      if (activeEdit) return;
      const bounds = getSelectionBounds();
      if (!bounds) return;
      const text = event.clipboardData?.getData("text/plain");
      if (!text) return;
      const rowsCopy = gridData.map((row) => [...row]);
      const updates: { row: number; col: number; rawValue: number }[] = [];
      const rawLines = text.split(/\r?\n/).filter((line) => line.length > 0);
      if (!rawLines.length) return;

      const matrix = rawLines.map((line) => line.split("\t"));
      const matrixRows = Math.max(1, matrix.length);
      const matrixCols = Math.max(1, ...matrix.map((row) => row.length));

      let rejectedCount = 0;
      for (let r = bounds.startRow; r <= bounds.endRow; r += 1) {
        if (r >= rowsCopy.length) break;
        const variable = variables[r];
        for (let c = bounds.startCol; c <= bounds.endCol; c += 1) {
          if (c >= totalColumns) break;
          if (c < 2 || c === TOTAL_COL) continue;
          const rowOffset = r - bounds.startRow;
          const colOffset = c - bounds.startCol;
          const sourceRow = matrix[rowOffset % matrixRows] ?? [];
          const valueToUse = sourceRow[colOffset % matrixCols];
          if (valueToUse == null || valueToUse === "") continue;
          // Strips thousands separators/currency symbols (e.g. "$5,000.00") so a paste from
          // Excel doesn't silently fail — see lib/format.ts::parseNumericInput.
          const parsedDisplay = parseNumericInput(valueToUse);
          if (Number.isFinite(parsedDisplay)) {
            const parsedRaw = toRaw(variable, parsedDisplay, editMode);
            rowsCopy[r][c] = parsedRaw;
            updates.push({ row: r, col: c, rawValue: parsedRaw });
          } else {
            rejectedCount += 1;
          }
        }
      }
      event.preventDefault();
      setGridData(rowsCopy);
      applyAbsoluteChanges(updates);
      if (rejectedCount > 0) onInvalidInput?.(rejectedCount);
    },
    [activeEdit, applyAbsoluteChanges, getSelectionBounds, gridData, onInvalidInput, totalColumns, TOTAL_COL, variables, editMode]
  );

  const fillSelectedRowRight = useCallback(() => {
    const row = gridSelection.current?.cell?.[1] ?? lastCell?.[1];
    if (row == null || row >= rowCount || periodCount < 2) return;
    const sourceRaw = Number(gridData[row]?.[2]) || 0;
    const updates: { row: number; col: number; rawValue: number }[] = [];
    setGridData((prev) => {
      const next = prev.map((r) => [...r]);
      for (let p = 1; p < periodCount; p += 1) {
        next[row][2 + p] = sourceRaw;
        updates.push({ row, col: 2 + p, rawValue: sourceRaw });
      }
      return next;
    });
    applyAbsoluteChanges(updates);
  }, [gridSelection, lastCell, rowCount, periodCount, gridData, applyAbsoluteChanges]);

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: 420,
          borderRadius: 12,
          border: "1px solid var(--line)",
          overflow: "hidden",
          position: "relative",
        }}
        onCopyCapture={handleCopyCapture}
        onPasteCapture={handlePasteCapture}
        onKeyDownCapture={handleKeyDown}
      >
        <DataEditor
          ref={editorRef}
          theme={gridTheme}
          columns={columns}
          rows={rowCount + 1}
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
              border: "2px solid var(--accent)",
              borderRadius: 4,
              padding: "0 8px",
              fontSize: 14,
              zIndex: 5,
              background: "var(--surface)",
              color: "var(--ink)",
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
      <button
        type="button"
        onClick={fillSelectedRowRight}
        disabled={periodCount < 2}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted transition hover:text-ink disabled:opacity-50"
      >
        <ArrowRightToLine className="h-3.5 w-3.5" />
        {fillRightLabel}
      </button>
    </div>
  );
};

export default ScenarioSheetGlide;
