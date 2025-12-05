"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import DataGrid, { textEditor, type Column, type RowsChangeData } from "react-data-grid";

type ScenarioVariable = {
  name: string;
  baselineMean: number;
};

export type MultipliersMap = Record<string, Record<string, number>>;

type ScenarioGridProps = {
  variables: ScenarioVariable[];
  periods: string[];
  multipliers: MultipliersMap;
  onMultipliersChange: (next: MultipliersMap) => void;
};

type GridRow = {
  variable: string;
  baseline_mean: number;
} & Record<string, number | string>;

const DEFAULT_MULTIPLIER = 1;
const MIN_MULTIPLIER = 0;
const MAX_MULTIPLIER = 10;

const clampMultiplier = (value: number): number => {
  if (!Number.isFinite(value) || Number.isNaN(value)) {
    return DEFAULT_MULTIPLIER;
  }
  if (value < MIN_MULTIPLIER) return MIN_MULTIPLIER;
  if (value > MAX_MULTIPLIER) return MAX_MULTIPLIER;
  return Number(value.toFixed(3));
};

const ScenarioGrid: React.FC<ScenarioGridProps> = ({
  variables,
  periods,
  multipliers,
  onMultipliersChange,
}) => {
  const buildRows = useCallback(() => {
    return variables.map<GridRow>((variable) => {
      const periodValues = multipliers[variable.name] ?? {};
      const row: GridRow = {
        variable: variable.name,
        baseline_mean: variable.baselineMean,
      };
      periods.forEach((period) => {
        const raw = periodValues[period] ?? DEFAULT_MULTIPLIER;
        row[period] = clampMultiplier(Number(raw));
      });
      return row;
    });
  }, [variables, periods, multipliers]);

  const [rows, setRows] = useState<GridRow[]>(() => buildRows());

  useEffect(() => {
    setRows(buildRows());
  }, [buildRows]);

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
        key: "baseline_mean",
        name: "Baseline mean",
        frozen: true,
        width: 140,
        resizable: true,
        renderCell: ({ row }) => (
          <span className="text-xs text-[var(--color-muted)]">
            {Number(row.baseline_mean ?? 0).toLocaleString(undefined, {
              maximumFractionDigits: 2,
            })}
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
      editor: textEditor,
      valueFormatter: ({ row }) => {
        const value = Number(row[period]);
        if (!Number.isFinite(value)) return DEFAULT_MULTIPLIER.toFixed(2);
        return value.toFixed(2);
      },
    }));

    return [...base, ...periodColumns];
  }, [periods]);

  const handleRowsChange = useCallback(
    (updatedRows: GridRow[], data: RowsChangeData<GridRow>) => {
      setRows(updatedRows);
      if (!data?.indexes?.length) {
        return;
      }
      const nextMultipliers: MultipliersMap = { ...multipliers };
      data.indexes.forEach((rowIndex) => {
        const row = updatedRows[rowIndex];
        if (!row) return;
        const variableName = row.variable;
        const periodMap = { ...(nextMultipliers[variableName] ?? {}) };
        periods.forEach((period) => {
          const parsed = clampMultiplier(Number(row[period]));
          periodMap[period] = parsed;
        });
        nextMultipliers[variableName] = periodMap;
      });
      onMultipliersChange(nextMultipliers);
    },
    [multipliers, onMultipliersChange, periods]
  );

  if (!variables.length) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-[var(--color-border)]">
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
