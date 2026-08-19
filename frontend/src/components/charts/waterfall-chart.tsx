"use client";

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTheme } from "next-themes";

import { EmptyState } from "@/components/ui/empty-state";
import { formatChartNumber, formatChartPercent } from "@/lib/chart-format";

// Extracted from executive-summary/page.tsx (Fase 8, A4) so Analysis can reuse the same
// attribution waterfall instead of a bespoke chart per page.
export type WaterfallSegment = {
  key: string;
  name: string;
  contribution: number;
  percent: number;
  color: string;
};

type WaterfallChartProps = {
  baseline?: WaterfallSegment | null;
  segments: WaterfallSegment[];
  totalLabel: string;
  tooltipValueLabel: string;
  tooltipPercentLabel: string;
  tooltipDeltaLabel: string;
  emptyLabel: string;
  baselineHint?: string;
  heightClassName?: string;
  yAxisLabel?: string;
};

type WaterfallDatum = WaterfallSegment & {
  base: number;
  range: number;
  isTotal?: boolean;
};

export function WaterfallChart({
  baseline,
  segments,
  totalLabel,
  tooltipValueLabel,
  tooltipPercentLabel,
  tooltipDeltaLabel,
  emptyLabel,
  baselineHint,
  heightClassName = "h-chart-md",
  yAxisLabel,
}: WaterfallChartProps) {
  const { resolvedTheme } = useTheme();
  const isDarkTheme = resolvedTheme === "dark";
  const mutedColor = isDarkTheme ? "#81858e" : "#6d7178";
  const lineColor = isDarkTheme ? "#262a2f" : "#e5e6ea";
  const surfaceColor = isDarkTheme ? "#16181b" : "#ffffff";
  const inkColor = isDarkTheme ? "#f2f3f5" : "#17181c";

  // Baseline anchors at 0, each segment steps the running total up or down, and a closing
  // Total bar spans 0 → the final cumulative percent (always 100% by construction, since
  // `percent` is each row's share of `total_contribution`).
  const data: WaterfallDatum[] = [];
  let cumulative = 0;
  const pushStep = (segment: WaterfallSegment) => {
    const start = cumulative;
    cumulative += segment.percent;
    data.push({ ...segment, base: Math.min(start, cumulative), range: Math.abs(cumulative - start) });
  };
  if (baseline) pushStep(baseline);
  segments.forEach(pushStep);
  const hasData = Boolean(baseline) || segments.length > 0;
  if (hasData) {
    data.push({
      key: "total",
      name: totalLabel,
      base: Math.min(0, cumulative),
      range: Math.abs(cumulative),
      contribution: (baseline?.contribution ?? 0) + segments.reduce((sum, s) => sum + s.contribution, 0),
      percent: cumulative,
      color: inkColor,
      isTotal: true,
    });
  }

  if (!data.length) return <EmptyState title={emptyLabel} />;

  return (
    <>
      <div className={heightClassName}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 24, bottom: 8, left: yAxisLabel ? 12 : 0 }}>
            <CartesianGrid vertical={false} stroke={lineColor} />
            <XAxis
              type="category"
              dataKey="name"
              tick={{ fill: mutedColor, fontSize: 12 }}
              axisLine={{ stroke: lineColor }}
              tickLine={false}
            />
            <YAxis
              type="number"
              tickFormatter={(v) => formatChartPercent(v, 0)}
              tick={{ fill: mutedColor, fontSize: 12 }}
              axisLine={{ stroke: lineColor }}
              tickLine={false}
              label={
                yAxisLabel
                  ? { value: yAxisLabel, angle: -90, position: "insideLeft", style: { fill: mutedColor, fontSize: 11, textAnchor: "middle" } }
                  : undefined
              }
            />
            <Tooltip
              cursor={{ fill: lineColor, opacity: 0.4 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as WaterfallDatum;
                return (
                  <div
                    className="rounded-lg border px-3 py-2 text-xs shadow-[var(--shadow-soft)]"
                    style={{ background: surfaceColor, borderColor: lineColor }}
                  >
                    <p className="font-medium text-ink">{d.name}</p>
                    <p className="text-muted">
                      {tooltipValueLabel}: {formatChartNumber(d.contribution, 1)}
                    </p>
                    <p className="text-muted">
                      {d.isTotal ? tooltipPercentLabel : tooltipDeltaLabel}: {formatChartPercent(d.percent, 1)}
                    </p>
                  </div>
                );
              }}
            />
            {/* Invisible foundation bar: positions the visible "range" segment at the right
                cumulative offset so each step floats instead of starting at 0. */}
            <Bar dataKey="base" stackId="waterfall" fill="transparent" isAnimationActive={false} />
            <Bar dataKey="range" stackId="waterfall" radius={[4, 4, 0, 0]} barSize={40}>
              {data.map((d) => (
                <Cell key={d.key} fill={d.color} />
              ))}
              <LabelList
                dataKey="percent"
                content={(props: any) => {
                  const { x, y, width, height, value, index } = props;
                  const d = data[index as number];
                  if (!d || typeof value !== "number") return null;
                  const positive = value >= 0;
                  const labelY = positive ? y - 6 : y + height + 14;
                  const text = `${!d.isTotal && value > 0 ? "+" : ""}${formatChartPercent(value, 1)}`;
                  return (
                    <text x={x + width / 2} y={labelY} textAnchor="middle" fontSize={12} fontWeight={500} fill={inkColor}>
                      {text}
                    </text>
                  );
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {baseline && baselineHint && <p className="text-xs text-muted">{baselineHint}</p>}
    </>
  );
}
