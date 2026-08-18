"use client";

import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Eyebrow } from "@/components/ui/eyebrow";
import { apiFetch, ApiError } from "@/lib/api";
import { translateApiError } from "@/lib/error-messages";

type SourceMode = "manual" | "dataset_column" | "rate_metric";

type MetricConfig = {
  value?: number | null;
  column?: string | null;
  rate_value?: number | null;
  metric_column?: string | null;
};

type MetricInput = { source_mode: SourceMode; config: MetricConfig };

type ConversionSettingsResponse = {
  dataset_id: string;
  conversion_rate: MetricInput;
  avg_value: MetricInput;
};

function emptyMetric(): MetricInput {
  return { source_mode: "manual", config: {} };
}

function MetricEditor({
  label,
  value,
  onChange,
  datasetColumns,
}: {
  label: string;
  value: MetricInput;
  onChange: (next: MetricInput) => void;
  datasetColumns: { name: string; dtype: string }[];
}) {
  return (
    <div className="space-y-2">
      <Eyebrow>{label}</Eyebrow>
      <Select
        value={value.source_mode}
        onChange={(e) => onChange({ source_mode: e.target.value as SourceMode, config: {} })}
      >
        <option value="manual">Valor fijo</option>
        <option value="dataset_column">Columna del dataset</option>
        <option value="rate_metric">Tasa × métrica</option>
      </Select>
      {value.source_mode === "manual" && (
        <Input
          type="number"
          step="0.0001"
          value={value.config.value ?? ""}
          onChange={(e) => onChange({ ...value, config: { value: parseFloat(e.target.value) || 0 } })}
          placeholder="0.18"
        />
      )}
      {value.source_mode === "dataset_column" && (
        <Select
          value={value.config.column ?? ""}
          onChange={(e) => onChange({ ...value, config: { column: e.target.value } })}
        >
          <option value="">Select column</option>
          {datasetColumns.map((col) => (
            <option key={col.name} value={col.name}>
              {col.name}
            </option>
          ))}
        </Select>
      )}
      {value.source_mode === "rate_metric" && (
        <div className="grid gap-2 grid-cols-2">
          <Input
            type="number"
            step="0.0001"
            value={value.config.rate_value ?? ""}
            onChange={(e) =>
              onChange({ ...value, config: { ...value.config, rate_value: parseFloat(e.target.value) || 0 } })
            }
            placeholder="Rate"
          />
          <Select
            value={value.config.metric_column ?? ""}
            onChange={(e) => onChange({ ...value, config: { ...value.config, metric_column: e.target.value } })}
          >
            <option value="">Select column</option>
            {datasetColumns.map((col) => (
              <option key={col.name} value={col.name}>
                {col.name}
              </option>
            ))}
          </Select>
        </div>
      )}
    </div>
  );
}

export function ConversionSettingsCard({
  datasetId,
  datasetColumns,
  canEdit,
}: {
  datasetId: string | null;
  datasetColumns: { name: string; dtype: string }[];
  canEdit: boolean;
}) {
  const tErrors = useTranslations("errors");
  const tToasts = useTranslations("transform.conversionSettings.toasts");
  const [conversionRate, setConversionRate] = useState<MetricInput>(emptyMetric());
  const [avgValue, setAvgValue] = useState<MetricInput>(emptyMetric());
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchSettings = useCallback(async () => {
    if (!datasetId) return;
    setLoading(true);
    try {
      const data = await apiFetch<ConversionSettingsResponse | null>(
        `/economics/conversion-settings?dataset_id=${datasetId}`
      );
      if (data) {
        setConversionRate(data.conversion_rate);
        setAvgValue(data.avg_value);
        setConfigured(true);
      } else {
        setConversionRate(emptyMetric());
        setAvgValue(emptyMetric());
        setConfigured(false);
      }
    } catch (error) {
      toast.error(error instanceof ApiError ? translateApiError(error, tErrors) : tToasts("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [datasetId, tErrors, tToasts]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSave = async () => {
    if (!datasetId) return;
    setSaving(true);
    try {
      await apiFetch("/economics/conversion-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataset_id: datasetId, conversion_rate: conversionRate, avg_value: avgValue }),
      });
      toast.success(tToasts("saved"));
      setConfigured(true);
    } catch (error) {
      toast.error(error instanceof ApiError ? translateApiError(error, tErrors) : tToasts("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!datasetId) return;
    setSaving(true);
    try {
      await apiFetch(`/economics/conversion-settings?dataset_id=${datasetId}`, { method: "DELETE" });
      setConversionRate(emptyMetric());
      setAvgValue(emptyMetric());
      setConfigured(false);
      toast.success(tToasts("cleared"));
    } catch (error) {
      toast.error(error instanceof ApiError ? translateApiError(error, tErrors) : tToasts("clearFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (!datasetId) return null;

  return (
    <Card className="space-y-4">
      <CardHeader
        title="Conversion settings"
        subtitle="Tasa de conversión y valor promedio para ROI/ROAS en Analysis"
      />
      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <MetricEditor
              label="Tasa de conversión"
              value={conversionRate}
              onChange={setConversionRate}
              datasetColumns={datasetColumns}
            />
            <MetricEditor label="Valor promedio" value={avgValue} onChange={setAvgValue} datasetColumns={datasetColumns} />
          </div>
          <div className="flex gap-2 justify-end">
            {configured && (
              <Button variant="ghost" size="sm" onClick={handleClear} disabled={!canEdit || saving}>
                Clear
              </Button>
            )}
            <Button size="sm" onClick={handleSave} disabled={!canEdit || saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
