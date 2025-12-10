"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DataGrid, { type Column, type EditorProps, type RowsChangeData } from "react-data-grid";

type ScenarioVariable = {
  name: string;
  baselineMean: number;
};

export type MultipliersMap = Record<string, Record<string, number>>;
type AbsoluteValuesMap = Record<string, Record<string, number>>;

type ScenarioGridProps = {
  variables: ScenarioVariable[];
  periods: string[];
  multipliers: MultipliersMap;
  absoluteValues?: AbsoluteValuesMap;
  editMode: "multipliers" | "absolute";
  onMultipliersChange: (next: MultipliersMap, absoluteOverrides?: AbsoluteValuesMap) => void;
};

type GridRow = {
  variable: string;
  baseline_mean_value: number;
  baseline_display: string;
  row_index: number;
} & Record<string, number | string>;

const DEFAULT_MULTIPLIER = 1;
const MIN_MULTIPLIER = 0;
const MAX_MULTIPLIER = 1_000_000;
const MAX_ABSOLUTE_VALUE = 1_000_000_000;
const MEAN_FORMATTER = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const sanitizeMultiplierValue = (value: number | undefined) => {
  const num = Number(value);
  if (!Number.isFinite(num) || Number.isNaN(num)) return DEFAULT_MULTIPLIER;
  if (num < MIN_MULTIPLIER) return MIN_MULTIPLIER;
  if (num > MAX_MULTIPLIER) return MAX_MULTIPLIER;
  return num;
};

const clampMultiplier = (value: number): number => {
  if (!Number.isFinite(value) || Number.isNaN(value)) {
    return DEFAULT_MULTIPLIER;
  }
  if (value < MIN_MULTIPLIER) return MIN_MULTIPLIER;
  if (value > MAX_MULTIPLIER) return MAX_MULTIPLIER;
  return value;
};

type CellCoord = { row: number; col: number };

type SelectionRange = {
  start: CellCoord;
  end: CellCoord;
};

const convertAbsoluteToMultiplier = (value: number, mean: number, fallback: number) => {
  if (mean === 0) return fallback;
  return sanitizeMultiplierValue(value / mean);
};

const getDisplayValue = (
  multiplier: number,
  mean: number,
  mode: "multipliers" | "absolute"
) => {
  if (mode === "absolute") {
    return multiplier * mean;
  }
  return multiplier;
};

const roundAbsoluteValue = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(2));
};

const formatAbsoluteDisplay = (value: number) => {
  if (!Number.isFinite(value)) return "";
  const rounded = roundAbsoluteValue(value);
  const hasFraction = Math.abs(rounded % 1) > Number.EPSILON;
  return rounded.toLocaleString(undefined, {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  });
};

const formatMultiplierDisplay = (value: number) => {
  if (!Number.isFinite(value)) return Number(DEFAULT_MULTIPLIER).toFixed(2);
  const rounded = Number(value.toFixed(2));
  const hasFraction = Math.abs(rounded % 1) > Number.EPSILON;
  return rounded.toLocaleString(undefined, {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  });
};

type PeriodEditorProps = EditorProps<GridRow> & {
  editMode: "multipliers" | "absolute";
  openMode: "single" | "double";
  onEditorStateChange?: (editing: boolean) => void;
};

const PeriodEditor: React.FC<PeriodEditorProps> = ({
  row,
  column,
  onRowChange,
  onClose,
  editMode,
  openMode,
  onEditorStateChange,
}) => {
  const periodKey = String(column.key);
  const mean = Number(row.baseline_mean_value ?? 0);
  const storedValue = Number(row[periodKey] ?? DEFAULT_MULTIPLIER);
  const multiplier =
    editMode === "absolute"
      ? mean === 0
        ? DEFAULT_MULTIPLIER
        : sanitizeMultiplierValue(storedValue / mean)
      : storedValue;
  const initialDisplay =
    editMode === "absolute"
      ? Number.isFinite(storedValue)
        ? storedValue.toString()
        : ""
      : storedValue.toString();
  const [value, setValue] = useState<string>(initialDisplay);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    onEditorStateChange?.(true);
    return () => {
      onEditorStateChange?.(false);
    };
  }, [onEditorStateChange]);

  useEffect(() => {
    const input = inputRef.current;
    if (input) {
      input.focus();
      if (openMode === "single") {
        input.select();
      } else {
        const len = input.value.length;
        try {
          input.setSelectionRange(len, len);
        } catch {
          /* ignore */
        }
      }
    }
  }, [openMode]);

  useEffect(() => {
    setValue(initialDisplay);
  }, [initialDisplay]);

  const commit = useCallback(
    (rawValue: string, close = true) => {
      if (!rawValue || rawValue === "-" || rawValue === "." || rawValue === "-.") {
        setValue(initialDisplay);
        if (close) onClose(true);
        return;
      }
      const parsed = Number(rawValue);
      if (!Number.isFinite(parsed)) {
        setValue(initialDisplay);
        if (close) onClose(true);
        return;
      }
      let nextMultiplier = multiplier;
      let displayValue = parsed;
      if (editMode === "absolute") {
        nextMultiplier =
          mean === 0
            ? multiplier
            : sanitizeMultiplierValue(parsed / mean);
        displayValue = parsed;
      } else {
        nextMultiplier = sanitizeMultiplierValue(parsed);
        displayValue = nextMultiplier;
      }
      onRowChange({ ...row, [periodKey]: displayValue }, true);
      if (close) onClose(true);
    },
    [editMode, initialDisplay, mean, multiplier, onClose, onRowChange, periodKey, row]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit(value);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose(true);
        return;
      }
      const isPrintable =
        event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
      if (openMode === "single" && isPrintable) {
        const input = event.currentTarget;
        const wholeSelected =
          input.selectionStart === 0 &&
          input.selectionEnd === input.value.length;
        if (wholeSelected) {
          event.preventDefault();
          const next = event.key;
          setValue(next);
          requestAnimationFrame(() => {
            if (inputRef.current) {
              const len = inputRef.current.value.length;
              try {
                inputRef.current.setSelectionRange(len, len);
              } catch {
                /* ignore */
              }
            }
          });
        }
      }
    },
    [commit, onClose, openMode, value]
  );

  return (
    <input
      autoFocus
      ref={inputRef}
      className="w-full border border-transparent bg-transparent px-2 py-1 text-sm outline-none focus:border-[var(--color-border)] focus:bg-white focus:shadow-inner"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => commit(value)}
      onKeyDown={handleKeyDown}
      inputMode="decimal"
      type="text"
    />
  );
};

const ScenarioGrid: React.FC<ScenarioGridProps> = ({
  variables,
  periods,
  multipliers,
  absoluteValues,
  editMode,
  onMultipliersChange,
}) => {
  const editTriggerRef = useRef<"click" | "double" | "keyboard">("click");
  const buildRows = useCallback(() => {
    return variables.map<GridRow>((variable, rowIndex) => {
      const periodValues = multipliers[variable.name] ?? {};
      const absoluteMap = absoluteValues?.[variable.name] ?? {};
      const meanValue = Number(variable.baselineMean ?? 0);
      const row: GridRow = {
        variable: variable.name,
        baseline_mean_value: meanValue,
        baseline_display: Number.isFinite(meanValue)
          ? MEAN_FORMATTER.format(meanValue)
          : "0.00",
        row_index: rowIndex,
      };
      periods.forEach((period) => {
        const raw = periodValues[period] ?? DEFAULT_MULTIPLIER;
        const multiplier = clampMultiplier(Number(raw));
        if (editMode === "absolute") {
          const absValue = Number(absoluteMap?.[period]);
          const fallback = getDisplayValue(multiplier, meanValue, "absolute");
          row[period] = roundAbsoluteValue(
            Number.isFinite(absValue) ? absValue : fallback
          );
        } else {
          row[period] = multiplier;
        }
      });
      return row;
    });
  }, [variables, periods, multipliers, absoluteValues, editMode]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [rows, setRows] = useState<GridRow[]>(() => buildRows());
  const [selection, setSelection] = useState<SelectionRange | null>(null);
  const [isDraggingSelection, setIsDraggingSelection] = useState(false);
  const [dragAnchor, setDragAnchor] = useState<CellCoord | null>(null);
  const [activeCell, setActiveCell] = useState<CellCoord | null>(null);
  const [anchorCell, setAnchorCell] = useState<CellCoord | null>(null);
  const shiftSelectingRef = useRef(false);

  useEffect(() => {
    setRows(buildRows());
    setSelection(null);
    setDragAnchor(null);
    setIsDraggingSelection(false);
    setActiveCell(null);
    setAnchorCell(null);
  }, [buildRows, editMode]);

  const periodKeys = useMemo(() => periods, [periods]);
  const buildAbsoluteValueMap = useCallback(
    (gridRows: GridRow[]): AbsoluteValuesMap => {
      const map: AbsoluteValuesMap = {};
      gridRows.forEach((row) => {
        const variableName = row.variable;
        const entry: Record<string, number> = {};
        periodKeys.forEach((period) => {
        const value = Number(row[period]);
        if (Number.isFinite(value)) {
          entry[period] = roundAbsoluteValue(value);
        }
      });
      map[variableName] = entry;
      });
      return map;
    },
    [periodKeys]
  );

  useEffect(() => {
    const handleMouseUp = () => {
      setIsDraggingSelection(false);
      setDragAnchor(null);
    };
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, []);

  useEffect(() => {
    if (selection || !rows.length || !periodKeys.length) return;
    const coord: CellCoord = { row: 0, col: 0 };
    setSelection({ start: coord, end: coord });
    setActiveCell(coord);
    setAnchorCell(coord);
  }, [selection, rows.length, periodKeys.length]);

  const clampCell = useCallback(
    (cell: CellCoord): CellCoord => ({
      row: Math.max(0, Math.min(rows.length - 1, cell.row)),
      col: Math.max(0, Math.min(periodKeys.length - 1, cell.col)),
    }),
    [rows.length, periodKeys.length]
  );

  const clampSelectionRange = useCallback((range: SelectionRange | null): SelectionRange | null => {
    if (!range) return null;
    const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max));
    const rowMax = rows.length - 1;
    const colMax = periodKeys.length - 1;
    const startRow = clamp(Math.min(range.start.row, range.end.row), rowMax);
    const endRow = clamp(Math.max(range.start.row, range.end.row), rowMax);
    const startCol = clamp(Math.min(range.start.col, range.end.col), colMax);
    const endCol = clamp(Math.max(range.start.col, range.end.col), colMax);
    return {
      start: { row: startRow, col: startCol },
      end: { row: endRow, col: endCol },
    };
  }, [rows.length, periodKeys.length]);

  const isCellSelected = useCallback(
    (rowIdx: number, periodKey: string) => {
      const range = clampSelectionRange(selection);
      if (!range) return false;
      const colIdx = periodKeys.indexOf(periodKey);
      if (colIdx < 0) return false;
      return (
        rowIdx >= range.start.row &&
        rowIdx <= range.end.row &&
        colIdx >= range.start.col &&
        colIdx <= range.end.col
      );
    },
    [selection, clampSelectionRange, periodKeys]
  );


  const handlePeriodCellMouseDown = useCallback(
    (rowIdx: number, periodKey: string, event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const periodIndex = periodKeys.indexOf(periodKey);
      if (periodIndex < 0) return;
      const coord: CellCoord = { row: rowIdx, col: periodIndex };
      if (event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        const anchor = anchorCell ?? dragAnchor ?? selection?.start ?? coord;
        const merged = clampSelectionRange({ start: anchor, end: coord });
        setSelection(merged);
        setDragAnchor(anchor);
        setAnchorCell(anchor);
        setActiveCell(coord);
        setIsDraggingSelection(true);
        return;
      }
      const single = { start: coord, end: coord };
      setSelection(single);
      setAnchorCell(coord);
      setActiveCell(coord);
      setDragAnchor(coord);
      setIsDraggingSelection(false);
      shiftSelectingRef.current = false;
    },
    [periodKeys, selection, clampSelectionRange, dragAnchor, anchorCell]
  );

  const handlePeriodCellMouseEnter = useCallback(
    (rowIdx: number, periodKey: string) => {
      if (!isDraggingSelection) return;
      const periodIndex = periodKeys.indexOf(periodKey);
      if (periodIndex < 0) return;
      const coord: CellCoord = { row: rowIdx, col: periodIndex };
      const anchor = dragAnchor ?? selection?.start ?? coord;
      const rect = clampSelectionRange({ start: anchor, end: coord });
      setSelection(rect);
      setActiveCell(coord);
    },
    [isDraggingSelection, periodKeys, clampSelectionRange, dragAnchor, selection]
  );

  const isEditingRef = useRef(false);
  const handleEditorStateChange = useCallback((editing: boolean) => {
    isEditingRef.current = editing;
  }, []);

  const columns = useMemo<Column<GridRow>[]>(() => {
    const base: Column<GridRow>[] = [
      {
        key: "variable",
        name: "Variable",
        frozen: true,
        width: 220,
        resizable: true,
      },
      {
        key: "baseline_display",
        name: (
          <div className="flex items-center gap-1">
            Mean
            <span
              className="cursor-help text-[var(--color-muted)]"
              title="Historical mean of this variable in the calibration period."
            >
              ?             </span>
          </div>
        ),
        frozen: true,
        width: 150,
        resizable: true,
        renderCell: ({ row }) => (
          <span className="text-xs text-[var(--color-muted)]">
            {row.baseline_display}
          </span>
        ),
      },
    ];

    const periodColumns = periods.map<Column<GridRow>>((period) => ({
      key: period,
      name: period,
      editable: true,
      width: 120,
      resizable: true,
      editor: (props) => (
        <PeriodEditor
          {...props}
          editMode={editMode}
          openMode={editTriggerRef.current === "click" ? "single" : "double"}
          onEditorStateChange={handleEditorStateChange}
        />
      ),
      renderCell: ({ row }) => {
        const rowIdx = row.row_index;
        const mean = Number(row.baseline_mean_value ?? 0);
        const rawCell = Number(row[period]);
        const selected = isCellSelected(rowIdx, period);
        const formatted =
          editMode === "absolute"
            ? formatAbsoluteDisplay(rawCell)
            : formatMultiplierDisplay(rawCell);
        return (
          <div
            className={`px-2 py-1 ${selected ? "scenario-grid-cell-selected" : ""}`}
            onMouseDown={(event) => {
              editTriggerRef.current = event.detail >= 2 ? "double" : "click";
              handlePeriodCellMouseDown(rowIdx, period, event);
            }}
            onMouseEnter={() => handlePeriodCellMouseEnter(rowIdx, period)}
            onKeyDownCapture={(event) => {
              if (event.key === "Tab" || event.key === "Enter" || event.key.length === 1) {
                editTriggerRef.current = "keyboard";
              }
            }}
          >
            {formatted || DEFAULT_MULTIPLIER.toFixed(3)}
          </div>
        );
      },
      valueFormatter: ({ row }) => {
        const rawCell = Number(row[period]);
        if (editMode === "absolute") {
          return formatAbsoluteDisplay(rawCell);
        }
        return formatMultiplierDisplay(rawCell);
      },
    }));

    return [...base, ...periodColumns];
  }, [periods, editMode, isCellSelected, handlePeriodCellMouseDown, handlePeriodCellMouseEnter, handleEditorStateChange]);

  const handleRowsChange = useCallback(
    (updatedRows: GridRow[], data: RowsChangeData<GridRow>) => {
      if (!data?.indexes?.length || !data.column) {
        setRows(updatedRows);
        return;
      }
      const columnKey = String(data.column.key);
      if (!periodKeys.includes(columnKey)) {
        setRows(updatedRows);
        return;
      }
      const rowIndex = data.indexes[0];
      const updatedRow = updatedRows[rowIndex];
      if (!updatedRow) return;
      let rawValue = Number(updatedRow[columnKey]);
      if (Number.isNaN(rawValue)) return;
      const mean = Number(updatedRow.baseline_mean_value ?? 0);
      const variableName = updatedRow.variable;
      const existing = multipliers[variableName] ?? {};
      let newMultiplier = existing[columnKey] ?? DEFAULT_MULTIPLIER;
      let nextDisplayValue = rawValue;
      if (editMode === "multipliers") {
        newMultiplier = rawValue;
        nextDisplayValue = newMultiplier;
      } else {
        rawValue = Math.min(Math.max(rawValue, 0), MAX_ABSOLUTE_VALUE);
        const safeMean = mean === 0 ? 1 : mean;
        newMultiplier = rawValue / safeMean;
        nextDisplayValue = roundAbsoluteValue(rawValue);
      }
      newMultiplier = sanitizeMultiplierValue(newMultiplier);
      const nextRows = [...updatedRows];
      nextRows[rowIndex] = {
        ...updatedRow,
        [columnKey]: editMode === "absolute" ? nextDisplayValue : newMultiplier,
      };
      setRows(nextRows);
      const nextMultiplierMap = {
        ...multipliers,
        [variableName]: {
          ...existing,
          [columnKey]: newMultiplier,
        },
      };
      const absoluteOverride = editMode === "absolute" ? buildAbsoluteValueMap(nextRows) : undefined;
      onMultipliersChange(nextMultiplierMap, absoluteOverride);
    },
    [multipliers, onMultipliersChange, periodKeys, editMode, buildAbsoluteValueMap]
  );


  const currentSelection = clampSelectionRange(selection);

  const copySelection = useCallback(
    (clipboardData: DataTransfer | null) => {
      if (!currentSelection) return;
      const lines: string[] = [];
      for (let r = currentSelection.start.row; r <= currentSelection.end.row; r += 1) {
        const row = rows[r];
        if (!row) continue;
        const cells: string[] = [];
        for (let c = currentSelection.start.col; c <= currentSelection.end.col; c += 1) {
          const periodKey = periodKeys[c];
          const mean = Number(row.baseline_mean_value ?? 0);
          const rawCell = Number(row[periodKey]);
          const displayValue =
            editMode === "absolute"
              ? Number(row[periodKey])
              : getDisplayValue(Number(row[periodKey]), mean, editMode);
          cells.push(String(displayValue));
        }
        lines.push(cells.join("\t"));
      }
      const payload = lines.join("\n");
      if (clipboardData) {
        clipboardData.setData("text/plain", payload);
      } else if (navigator?.clipboard?.writeText) {
        navigator.clipboard.writeText(payload).catch(() => {});
      }
    },
    [currentSelection, rows, periodKeys, editMode]
  );

  const pasteSelection = useCallback(
    (text: string) => {
      if (!currentSelection) return;
      const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
      if (!lines.length) return;
      const nextMultipliers: MultipliersMap = { ...multipliers };
      const updatedRows = [...rows];
      lines.forEach((line, rowOffset) => {
        const targetRowIndex = currentSelection.start.row + rowOffset;
        if (targetRowIndex > currentSelection.end.row || targetRowIndex >= rows.length) return;
        const values = line.split(/\t/);
        values.forEach((valueText, colOffset) => {
          const targetColIndex = currentSelection.start.col + colOffset;
          if (targetColIndex > currentSelection.end.col || targetColIndex >= periodKeys.length) return;
          const periodKey = periodKeys[targetColIndex];
          const numericValue = Number(valueText);
          const row = { ...updatedRows[targetRowIndex] };
          const mean = Number(row.baseline_mean_value ?? 0);
          const currentMultiplier =
            (nextMultipliers[row.variable]?.[periodKey] ?? DEFAULT_MULTIPLIER);
          const nextMultiplier =
            editMode === "absolute"
              ? convertAbsoluteToMultiplier(numericValue, mean, currentMultiplier)
              : clampMultiplier(numericValue);
          row[periodKey] =
            editMode === "absolute"
              ? roundAbsoluteValue(Math.min(Math.max(numericValue, 0), MAX_ABSOLUTE_VALUE))
              : nextMultiplier;
          updatedRows[targetRowIndex] = row;
          const variableName = row.variable;
          const periodMap = { ...(nextMultipliers[variableName] ?? {}) };
          periodMap[periodKey] = nextMultiplier;
          nextMultipliers[variableName] = periodMap;
        });
      });
      setRows(updatedRows);
      const absoluteOverride =
        editMode === "absolute" ? buildAbsoluteValueMap(updatedRows) : undefined;
      onMultipliersChange(nextMultipliers, absoluteOverride);
    },
    [currentSelection, multipliers, rows, periodKeys, onMultipliersChange, editMode, buildAbsoluteValueMap]
  );

  const moveActive = useCallback(
    (deltaRow: number, deltaCol: number, extend: boolean) => {
      if (!rows.length || !periodKeys.length) return;
      const current =
        activeCell ??
        selection?.end ??
        ({
          row: 0,
          col: 0,
        } as CellCoord);
      const next = clampCell({ row: current.row + deltaRow, col: current.col + deltaCol });
      if (extend) {
        const anchor = anchorCell ?? current;
        setAnchorCell(anchor);
        setActiveCell(next);
        setSelection(clampSelectionRange({ start: anchor, end: next }));
      } else {
        shiftSelectingRef.current = false;
        setAnchorCell(next);
        setActiveCell(next);
        setSelection({ start: next, end: next });
      }
    },
    [activeCell, anchorCell, clampCell, clampSelectionRange, periodKeys.length, rows.length, selection]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (isEditingRef.current) return;
      if (currentSelection && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
        event.preventDefault();
        copySelection(null);
        return;
      }
      const isArrow =
        event.key === "ArrowUp" ||
        event.key === "ArrowDown" ||
        event.key === "ArrowLeft" ||
        event.key === "ArrowRight";
      if (!isArrow) return;
      event.preventDefault();
      const extend = event.shiftKey;
      if (extend) {
        if (!shiftSelectingRef.current) {
          const start = activeCell ?? selection?.end ?? { row: 0, col: 0 };
          setAnchorCell(start);
          shiftSelectingRef.current = true;
        }
      } else {
        shiftSelectingRef.current = false;
      }
      switch (event.key) {
        case "ArrowUp":
          moveActive(-1, 0, extend);
          break;
        case "ArrowDown":
          moveActive(1, 0, extend);
          break;
        case "ArrowLeft":
          moveActive(0, -1, extend);
          break;
        case "ArrowRight":
          moveActive(0, 1, extend);
          break;
        default:
          break;
      }
    },
    [copySelection, currentSelection, moveActive, activeCell, selection]
  );

  const handleCopyEvent = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      if (!currentSelection) return;
      event.preventDefault();
      copySelection(event.clipboardData);
    },
    [currentSelection, copySelection]
  );

  const handlePasteEvent = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      if (!currentSelection) return;
      event.preventDefault();
      const text = event.clipboardData.getData("text/plain");
      pasteSelection(text);
    },
    [currentSelection, pasteSelection]
  );

  return (
    <div
      ref={containerRef}
      className="rounded-2xl border border-[var(--color-border)] focus-within:ring-2 focus-within:ring-[var(--color-border)]"
      tabIndex={0}
      onCopyCapture={handleCopyEvent}
      onPasteCapture={handlePasteEvent}
      onKeyDownCapture={handleKeyDown}
    >
      <DataGrid
        className="rdg-light"
        defaultColumnOptions={{
          resizable: true,
          editorOptions: { editOnClick: true },
        }}
        columns={columns}
        rows={rows}
        onRowsChange={handleRowsChange}
        rowHeight={40}
        headerRowHeight={42}
        rowKeyGetter={(row) => row.variable}
        enableVirtualization
        style={{
          blockSize: Math.min(520, Math.max(240, variables.length * 42 + 60)),
        }}
      />
    </div>
  );
};

export default ScenarioGrid;
