"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import DataGrid, { type Column, type EditorProps, type RowsChangeData } from "react-data-grid";

type ScenarioVariable = {
  name: string;
  baselineMean: number;
};

export type MultipliersMap = Record<string, Record<string, number>>;

type ScenarioGridProps = {
  variables: ScenarioVariable[];
  periods: string[];
  multipliers: MultipliersMap;
  editMode: "multipliers" | "absolute";
  onMultipliersChange: (next: MultipliersMap) => void;
};

type GridRow = {
  variable: string;
  baseline_mean_value: number;
  baseline_display: string;
  row_index: number;
} & Record<string, number | string>;

const DEFAULT_MULTIPLIER = 1;
const MIN_MULTIPLIER = 0;
const MAX_MULTIPLIER = 10;
const MEAN_FORMATTER = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const sanitizeMultiplierValue = (value: number | undefined) => {
  const num = Number(value);
  if (!Number.isFinite(num) || Number.isNaN(num)) return DEFAULT_MULTIPLIER;
  if (num < MIN_MULTIPLIER) return MIN_MULTIPLIER;
  if (num > MAX_MULTIPLIER) return MAX_MULTIPLIER;
  return Number(num.toFixed(3));
};

const clampMultiplier = (value: number): number => {
  if (!Number.isFinite(value) || Number.isNaN(value)) {
    return DEFAULT_MULTIPLIER;
  }
  if (value < MIN_MULTIPLIER) return MIN_MULTIPLIER;
  if (value > MAX_MULTIPLIER) return MAX_MULTIPLIER;
  return Number(value.toFixed(3));
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

type PeriodEditorProps = EditorProps<GridRow> & {
  editMode: "multipliers" | "absolute";
};

const PeriodEditor: React.FC<PeriodEditorProps> = ({
  row,
  column,
  onRowChange,
  onClose,
  editMode,
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
  const [value, setValue] = useState<string>(() => {
    if (editMode === "absolute") {
      return Number.isFinite(storedValue)
        ? storedValue.toFixed(2)
        : "0.00";
    }
    return storedValue.toString();
  });

  const commit = useCallback(
    (newValue: string, close = true) => {
      const parsed = Number(newValue);
      if (!Number.isFinite(parsed)) {
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
        displayValue = Number(parsed.toFixed(2));
      } else {
        nextMultiplier = sanitizeMultiplierValue(parsed);
        displayValue = nextMultiplier;
      }
      onRowChange({ ...row, [periodKey]: displayValue }, true);
      if (close) onClose(true);
    },
    [editMode, mean, multiplier, onClose, onRowChange, periodKey, row]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit(value);
      } else if (event.key === "Escape") {
        event.preventDefault();
        onClose(true);
      }
    },
    [commit, onClose, value]
  );

  return (
    <input
      autoFocus
      className="w-full border border-transparent bg-transparent px-2 py-1 text-sm outline-none focus:border-[var(--color-border)] focus:bg-white focus:shadow-inner"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => commit(value)}
      onKeyDown={handleKeyDown}
      inputMode="decimal"
    />
  );
};

const ScenarioGrid: React.FC<ScenarioGridProps> = ({
  variables,
  periods,
  multipliers,
  editMode,
  onMultipliersChange,
}) => {
  const buildRows = useCallback(() => {
    return variables.map<GridRow>((variable, rowIndex) => {
      const periodValues = multipliers[variable.name] ?? {};
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
        const cellValue =
          editMode === "absolute"
            ? Number(getDisplayValue(multiplier, meanValue, editMode).toFixed(2))
            : multiplier;
        row[period] = cellValue;
      });
      return row;
    });
  }, [variables, periods, multipliers, editMode]);

  const [rows, setRows] = useState<GridRow[]>(() => buildRows());
  const [selection, setSelection] = useState<SelectionRange | null>(null);
  const [isDraggingSelection, setIsDraggingSelection] = useState(false);
  const [dragAnchor, setDragAnchor] = useState<CellCoord | null>(null);

  useEffect(() => {
    setRows(buildRows());
    setSelection(null);
    setDragAnchor(null);
    setIsDraggingSelection(false);
  }, [buildRows, editMode]);

  const periodKeys = useMemo(() => periods, [periods]);

  useEffect(() => {
    const handleMouseUp = () => {
      setIsDraggingSelection(false);
      setDragAnchor(null);
    };
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, []);

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
        const anchor = dragAnchor ?? selection?.start ?? coord;
        const merged = clampSelectionRange({ start: anchor, end: coord });
        setSelection(merged);
        setDragAnchor(anchor);
        setIsDraggingSelection(true);
        return;
      }
      setSelection({ start: coord, end: coord });
      setDragAnchor(coord);
      setIsDraggingSelection(false);
    },
    [periodKeys, selection, clampSelectionRange, dragAnchor]
  );

  const handlePeriodCellMouseEnter = useCallback(
    (rowIdx: number, periodKey: string) => {
      if (!isDraggingSelection) return;
      const periodIndex = periodKeys.indexOf(periodKey);
      if (periodIndex < 0) return;
      const coord: CellCoord = { row: rowIdx, col: periodIndex };
      const anchor = dragAnchor ?? selection?.start ?? coord;
      setSelection(clampSelectionRange({ start: anchor, end: coord }));
    },
    [isDraggingSelection, periodKeys, clampSelectionRange, dragAnchor, selection]
  );

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
      editor: (props) => <PeriodEditor {...props} editMode={editMode} />,
      renderCell: ({ row }) => {
        const rowIdx = row.row_index;
        const mean = Number(row.baseline_mean_value ?? 0);
        const rawCell = Number(row[period]);
        const displayValue =
          editMode === "absolute"
            ? rawCell
            : getDisplayValue(rawCell, mean, editMode);
        const selected = isCellSelected(rowIdx, period);
        return (
          <div
            className={`px-2 py-1 ${selected ? "scenario-grid-cell-selected" : ""}`}
            onMouseDown={(event) => handlePeriodCellMouseDown(rowIdx, period, event)}
            onMouseEnter={() => handlePeriodCellMouseEnter(rowIdx, period)}
          >
            {Number.isFinite(displayValue) ? displayValue.toFixed(2) : DEFAULT_MULTIPLIER.toFixed(2)}
          </div>
        );
      },
      valueFormatter: ({ row }) => {
        const mean = Number(row.baseline_mean_value ?? 0);
        const rawCell = Number(row[period]);
        const value =
          editMode === "absolute"
            ? rawCell
            : getDisplayValue(rawCell, mean, editMode);
        if (!Number.isFinite(value)) return DEFAULT_MULTIPLIER.toFixed(2);
        return value.toFixed(2);
      },
    }));

    return [...base, ...periodColumns];
  }, [periods, editMode, isCellSelected, handlePeriodCellMouseDown, handlePeriodCellMouseEnter]);

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
      const rawValue = Number(updatedRow[columnKey]);
      if (Number.isNaN(rawValue)) return;
      const mean = Number(updatedRow.baseline_mean_value ?? 0);
      const variableName = updatedRow.variable;
      const existing = multipliers[variableName] ?? {};
      let newMultiplier = existing[columnKey] ?? DEFAULT_MULTIPLIER;
      let nextDisplayValue = rawValue;
      if (editMode === "multipliers") {
        newMultiplier = rawValue;
        nextDisplayValue = newMultiplier;
      } else if (mean !== 0) {
        newMultiplier = rawValue / mean;
        nextDisplayValue = rawValue;
      } else {
        nextDisplayValue = rawValue;
      }
      newMultiplier = sanitizeMultiplierValue(newMultiplier);
      const nextRows = [...updatedRows];
      nextRows[rowIndex] = {
        ...updatedRow,
        [columnKey]: editMode === "absolute" ? Number(nextDisplayValue.toFixed(2)) : newMultiplier,
      };
      setRows(nextRows);
      onMultipliersChange({
        ...multipliers,
        [variableName]: {
          ...existing,
          [columnKey]: newMultiplier,
        },
      });
    },
    [multipliers, onMultipliersChange, periodKeys, editMode]
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
              ? Number(rawCell.toFixed(2))
              : getDisplayValue(rawCell, mean, editMode);
          cells.push(
            editMode === "absolute"
              ? displayValue.toFixed(2)
              : String(displayValue)
          );
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
              ? Number(numericValue.toFixed(2))
              : nextMultiplier;
          updatedRows[targetRowIndex] = row;
          const variableName = row.variable;
          const periodMap = { ...(nextMultipliers[variableName] ?? {}) };
          periodMap[periodKey] = nextMultiplier;
          nextMultipliers[variableName] = periodMap;
        });
      });
      setRows(updatedRows);
      onMultipliersChange(nextMultipliers);
    },
    [currentSelection, multipliers, rows, periodKeys, onMultipliersChange, editMode]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!currentSelection) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
        event.preventDefault();
        copySelection(null);
      }
    },
    [currentSelection, copySelection]
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
