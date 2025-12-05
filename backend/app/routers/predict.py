from __future__ import annotations

import calendar
import io
import json
import uuid
from collections import defaultdict
from datetime import date, timedelta
from typing import Dict

import numpy as np
import pandas as pd
import statsmodels.api as sm
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from ..db import get_session
from ..models import Scenario, Model
from ..routers.analysis import _fit_from_model, _group_maps
from ..schemas import (
    Adjustment,
    SimulationRequest,
    ScenarioCreate,
    ScenarioUpdate,
    ScenarioPreviewRequest,
    ScenarioOut,
    ScenarioSummary,
    ScenarioSeriesPoint,
    ScenarioTimeseriesResponse,
    ScenarioTimeseriesSlice,
    ContributionSlice,
    PeriodValue,
)


router = APIRouter()


def _compute_contributions(session: Session, model_id: str, adjustments: dict[str, float]):
    m, ds, work, X, Xc, y, params, _ = _fit_from_model(session, model_id)
    var_map, sg_map, g_map = _group_maps(session, ds.id)

    X_adj = X.copy()
    for col in X.columns:
        mult = float(adjustments.get(col, 1.0))
        X_adj[col] = pd.to_numeric(X[col], errors='coerce').fillna(0.0) * mult

    contrib_rows = []
    group_totals: Dict[str, float] = {}
    subgroup_totals: Dict[str, float] = {}

    UNASSIGNED = "_unassigned_"

    for name in X.columns:
        coef = float(params.get(name, 0.0))
        mean = float(X[name].mean())
        adjusted_mean = float(X_adj[name].mean())
        contribution = coef * adjusted_mean
        mult = float(adjustments.get(name, 1.0))
        mapping = var_map.get(name, {})
        sg_id = mapping.get("subgroup_id")
        gid = mapping.get("group_id")
        sg = sg_map.get(sg_id) if sg_id else None
        g = g_map.get(gid) if gid else (g_map.get(sg.group_id) if sg else None)
        contrib_rows.append({
            "name": name,
            "coef": coef,
            "baseline_mean": mean,
            "multiplier": mult,
            "adjusted_mean": adjusted_mean,
            "contribution": contribution,
            "group_id": g.id if g else None,
            "group_name": g.name if g else None,
            "subgroup_id": sg.id if sg else None,
            "subgroup_name": sg.name if sg else None,
        })
        if sg:
            subgroup_totals[sg.id] = subgroup_totals.get(sg.id, 0.0) + contribution
            grp_id = g.id if g else sg.group_id
            if grp_id:
                group_totals[grp_id] = group_totals.get(grp_id, 0.0) + contribution
            else:
                group_totals[UNASSIGNED] = group_totals.get(UNASSIGNED, 0.0) + contribution
        elif g:
            group_totals[g.id] = group_totals.get(g.id, 0.0) + contribution
        else:
            subgroup_totals[UNASSIGNED] = subgroup_totals.get(UNASSIGNED, 0.0) + contribution
            group_totals[UNASSIGNED] = group_totals.get(UNASSIGNED, 0.0) + contribution

    intercept = float(params.get('const', 0.0))
    total = float(sum(r["contribution"] for r in contrib_rows) + intercept)

    group_rows = []
    for gid, val in group_totals.items():
        if gid == UNASSIGNED:
            group_rows.append({"group_id": None, "group_name": "Unassigned", "contribution": float(val)})
        else:
            group_rows.append({
                "group_id": gid,
                "group_name": g_map[gid].name if gid in g_map else None,
                "contribution": float(val),
            })

    subgroup_rows = []
    for sid, val in subgroup_totals.items():
        if sid == UNASSIGNED:
            subgroup_rows.append({"subgroup_id": None, "subgroup_name": "Unassigned", "group_id": None, "group_name": None, "contribution": float(val)})
        else:
            subgroup_rows.append({
                "subgroup_id": sid,
                "subgroup_name": sg_map[sid].name if sid in sg_map else None,
                "group_id": sg_map[sid].group_id if sid in sg_map else None,
                "group_name": g_map.get(sg_map[sid].group_id).name if (sid in sg_map and sg_map[sid].group_id in g_map) else None,
                "contribution": float(val),
            })

    return {
        "model": {
            "id": m.id,
            "name": m.name,
            "dataset_id": m.dataset_id,
            "y_var": m.y_var,
            "x_vars": json.loads(m.x_vars_json),
        },
        "intercept": intercept,
        "total": total,
        "variables": contrib_rows,
        "groups": group_rows,
        "subgroups": subgroup_rows,
    }


OTHER_KEY = "__other__"
BASELINE_KEY = "__baseline__"


def _add_months(value: date, months: int) -> date:
    month = value.month - 1 + months
    year = value.year + month // 12
    month = month % 12 + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def _period_sequence(start_date: date, horizon: int, freq: str) -> list[date]:
    if horizon <= 0:
        return []
    periods: list[date] = []
    current = start_date
    for _ in range(horizon):
        periods.append(current)
        if freq == "day":
            current = current + timedelta(days=1)
        elif freq == "week":
            current = current + timedelta(weeks=1)
        else:
            current = _add_months(current, 1)
    return periods


def _label_for_period(period: date, freq: str) -> str:
    if freq == "day":
        return period.isoformat()
    if freq == "week":
        iso = period.isocalendar()
        return f"{iso.year}-W{iso.week:02d}"
    return period.strftime("%Y-%m")


def _dump_definition(horizon: int, start_date: date, freq: str, adjustments: dict[str, dict[str, PeriodValue]]) -> str:
    payload = {
        "horizon": horizon,
        "start_date": start_date.isoformat(),
        "freq": freq,
        "adjustments": {
            period: {var: (value.model_dump() if isinstance(value, PeriodValue) else value) for var, value in vars_.items()}
            for period, vars_ in adjustments.items()
        },
    }
    return json.dumps(payload)


def _load_adjustments(data: dict | None) -> dict[str, dict[str, PeriodValue]]:
    if not isinstance(data, dict):
        return {}
    output: dict[str, dict[str, PeriodValue]] = {}
    for period, mapping in data.items():
        if not isinstance(mapping, dict):
            continue
        period_map: dict[str, PeriodValue] = {}
        for var, payload in mapping.items():
            if isinstance(payload, dict):
                try:
                    period_map[var] = PeriodValue(**payload)
                    continue
                except Exception:
                    pass
            try:
                period_map[var] = PeriodValue(mode="multiplier", value=float(payload))
            except Exception:
                continue
        if period_map:
            output[period] = period_map
    return output


def _load_definition(record: Scenario) -> ScenarioCreate:
    raw = None
    if record.adjustments_json:
        try:
            raw = json.loads(record.adjustments_json)
        except json.JSONDecodeError:
            raw = None
    start_date = date.today()
    freq = "month"
    horizon = 1
    adjustments: dict[str, dict[str, PeriodValue]] = {}

    if isinstance(raw, dict) and "horizon" in raw:
        horizon = int(raw.get("horizon", 1) or 1)
        freq = raw.get("freq", "month") or "month"
        start_val = raw.get("start_date")
        if isinstance(start_val, str):
            try:
                start_date = date.fromisoformat(start_val)
            except ValueError:
                start_date = date.today()
        adjustments = _load_adjustments(raw.get("adjustments"))
    elif isinstance(raw, list):
        # legacy structure: list of {variable, multiplier}
        period_key = start_date.isoformat()
        legacy: dict[str, PeriodValue] = {}
        for entry in raw:
            variable = entry.get("variable")
            if not variable:
                continue
            try:
                mult = float(entry.get("multiplier", 1.0))
            except Exception:
                mult = 1.0
            legacy[variable] = PeriodValue(mode="multiplier", value=mult)
        if legacy:
            adjustments[period_key] = legacy

    return ScenarioCreate(
        model_id=record.model_id,
        name=record.name,
        horizon=horizon,
        start_date=start_date,
        freq=freq,
        adjustments=adjustments,
    )


def _load_summary(record: Scenario) -> ScenarioSummary | None:
    if not record.results_json:
        return None
    try:
        payload = json.loads(record.results_json)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    try:
        return ScenarioSummary(
            periods=payload.get("periods", []),
            total=float(payload.get("total", 0.0)),
            average_per_period=float(payload.get("average_per_period", 0.0)),
            groups=[ContributionSlice(**row) for row in payload.get("groups", [])],
            subgroups=[ContributionSlice(**row) for row in payload.get("subgroups", [])],
            series=[ScenarioSeriesPoint(**row) for row in payload.get("series", [])],
        )
    except Exception:
        return None


def _serialize_group_totals(raw: defaultdict[str, float], g_map: dict) -> list[ContributionSlice]:
    slices: list[ContributionSlice] = []
    for key, val in raw.items():
        if abs(val) < 1e-9:
            continue
        if key == BASELINE_KEY:
            slices.append(ContributionSlice(id="baseline", name="Baseline", value=float(val)))
        elif key == OTHER_KEY or key is None:
            slices.append(ContributionSlice(id=None, name="Other", value=float(val)))
        else:
            g = g_map.get(key)
            name = g.name if g else "Other"
            slices.append(ContributionSlice(id=key, name=name, value=float(val)))
    slices.sort(key=lambda item: item.value, reverse=True)
    return slices


def _serialize_subgroup_totals(raw: defaultdict[str, float], sg_map: dict, g_map: dict) -> list[ContributionSlice]:
    slices: list[ContributionSlice] = []
    for key, val in raw.items():
        if abs(val) < 1e-9:
            continue
        if key == BASELINE_KEY:
            slices.append(ContributionSlice(id="baseline", name="Baseline", value=float(val)))
        elif key == OTHER_KEY or key is None:
            slices.append(ContributionSlice(id=None, name="Other", value=float(val)))
        else:
            sg = sg_map.get(key)
            name = sg.name if sg else "Other"
            slices.append(ContributionSlice(id=key, name=name, value=float(val)))
    slices.sort(key=lambda item: item.value, reverse=True)
    return slices


def _accumulate_contribution(
    group_totals: defaultdict[str, float],
    subgroup_totals: defaultdict[str, float],
    var_name: str,
    contribution: float,
    var_map: dict,
    sg_map: dict,
    g_map: dict,
):
    mapping = var_map.get(var_name, {})
    sg_id = mapping.get("subgroup_id")
    gid = mapping.get("group_id")
    if sg_id and sg_id in sg_map:
        subgroup_totals[sg_id] += contribution
        gid = gid or sg_map[sg_id].group_id
        if gid:
            group_totals[gid] += contribution
        else:
            group_totals[OTHER_KEY] += contribution
    elif gid and gid in g_map:
        group_totals[gid] += contribution
    else:
        subgroup_totals[OTHER_KEY] += contribution
        group_totals[OTHER_KEY] += contribution


def _compute_plan(
    session: Session,
    model_id: str,
    *,
    horizon: int,
    start_date: date,
    freq: str,
    adjustments: dict[str, dict[str, PeriodValue]],
):
    m, ds, work, X, Xc, y, params, _ = _fit_from_model(session, model_id)
    var_map, sg_map, g_map = _group_maps(session, ds.id)

    baseline_means: dict[str, float] = {}
    coef_map: dict[str, float] = {}
    for name in X.columns:
        series = pd.to_numeric(X[name], errors="coerce").fillna(0.0)
        baseline_means[name] = float(series.mean())
        coef_map[name] = float(params.get(name, 0.0))

    intercept = float(params.get("const", 0.0))
    period_dates = _period_sequence(start_date, horizon, freq)
    labels = [_label_for_period(p, freq) for p in period_dates]

    aggregate_groups: defaultdict[str, float] = defaultdict(float)
    aggregate_subgroups: defaultdict[str, float] = defaultdict(float)
    series_points: list[ScenarioTimeseriesSlice] = []

    for label in labels:
        group_totals: defaultdict[str, float] = defaultdict(float)
        subgroup_totals: defaultdict[str, float] = defaultdict(float)
        total = 0.0
        period_adjustments = adjustments.get(label, {})
        for name in X.columns:
            baseline_val = baseline_means[name]
            adj = period_adjustments.get(name)
            if isinstance(adj, PeriodValue):
                value = baseline_val * adj.value if adj.mode == "multiplier" else adj.value
            else:
                value = baseline_val
            contribution = coef_map[name] * value
            total += contribution
            _accumulate_contribution(group_totals, subgroup_totals, name, contribution, var_map, sg_map, g_map)

        total += intercept
        group_totals[BASELINE_KEY] += intercept
        subgroup_totals[BASELINE_KEY] += intercept
        for key, val in group_totals.items():
            aggregate_groups[key] += val
        for key, val in subgroup_totals.items():
            aggregate_subgroups[key] += val

        series_points.append(
            ScenarioTimeseriesSlice(
                period=label,
                y_pred=float(total),
                by_group=_serialize_group_totals(group_totals, g_map),
                by_subgroup=_serialize_subgroup_totals(subgroup_totals, sg_map, g_map),
            )
        )

    total_value = sum(point.y_pred for point in series_points)
    summary = ScenarioSummary(
        periods=labels,
        total=total_value,
        average_per_period=total_value / horizon if horizon else 0.0,
        groups=_serialize_group_totals(aggregate_groups, g_map),
        subgroups=_serialize_subgroup_totals(aggregate_subgroups, sg_map, g_map),
        series=[ScenarioSeriesPoint(period=point.period, y_pred=point.y_pred) for point in series_points],
    )
    return summary, series_points


def _scenario_out_from_record(record: Scenario, session: Session, summary: ScenarioSummary | None = None) -> ScenarioOut:
    definition = _load_definition(record)
    summary_data = summary or _load_summary(record)
    if summary_data is None:
        summary_data, _ = _compute_plan(
            session,
            record.model_id,
            horizon=definition.horizon,
            start_date=definition.start_date,
            freq=definition.freq,
            adjustments=definition.adjustments,
        )
        record.results_json = json.dumps(summary_data.model_dump())
        session.add(record)
        session.commit()
    return ScenarioOut(
        id=record.id,
        model_id=record.model_id,
        name=record.name,
        horizon=definition.horizon,
        start_date=definition.start_date,
        freq=definition.freq,
        adjustments=definition.adjustments,
        summary=summary_data,
    )


def _require_model(session: Session, model_id: str) -> Model:
    model = session.get(Model, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    return model


def _ensure_scenario_capacity(session: Session, model_id: str, limit: int = 3):
    existing = session.exec(select(Scenario.id).where(Scenario.model_id == model_id)).all()
    if len(existing) >= limit:
        raise HTTPException(status_code=400, detail=f"Maximum {limit} scenarios per model")

@router.post("/{model_id}/simulate")
def simulate(model_id: str, body: SimulationRequest, session: Session = Depends(get_session)):
    adjustments = {adj.variable: adj.multiplier for adj in body.adjustments}
    result = _compute_contributions(session, model_id, adjustments)
    return result


@router.post("/scenarios/preview", response_model=ScenarioSummary)
def preview_scenario(body: ScenarioPreviewRequest, session: Session = Depends(get_session)):
    _require_model(session, body.model_id)
    summary, _ = _compute_plan(
        session,
        body.model_id,
        horizon=body.horizon,
        start_date=body.start_date,
        freq=body.freq,
        adjustments=body.adjustments,
    )
    return summary


@router.post("/scenarios", response_model=ScenarioOut)
def create_scenario(body: ScenarioCreate, session: Session = Depends(get_session)):
    _require_model(session, body.model_id)
    _ensure_scenario_capacity(session, body.model_id)
    summary, _ = _compute_plan(
        session,
        body.model_id,
        horizon=body.horizon,
        start_date=body.start_date,
        freq=body.freq,
        adjustments=body.adjustments,
    )
    record = Scenario(
        id=str(uuid.uuid4()),
        model_id=body.model_id,
        name=body.name,
        adjustments_json=_dump_definition(body.horizon, body.start_date, body.freq, body.adjustments),
        results_json=json.dumps(summary.model_dump()),
    )
    session.add(record)
    session.commit()
    session.refresh(record)
    return _scenario_out_from_record(record, session, summary)


@router.get("/scenarios", response_model=list[ScenarioOut])
def list_scenarios(model_id: str = Query(...), session: Session = Depends(get_session)):
    _require_model(session, model_id)
    records = session.exec(select(Scenario).where(Scenario.model_id == model_id).order_by(Scenario.created_at)).all()
    return [_scenario_out_from_record(record, session) for record in records]


@router.get("/scenarios/{scenario_id}", response_model=ScenarioOut)
def get_scenario(scenario_id: str, session: Session = Depends(get_session)):
    record = session.get(Scenario, scenario_id)
    if not record:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return _scenario_out_from_record(record, session)


@router.patch("/scenarios/{scenario_id}", response_model=ScenarioOut)
def update_scenario(scenario_id: str, body: ScenarioUpdate, session: Session = Depends(get_session)):
    record = session.get(Scenario, scenario_id)
    if not record:
        raise HTTPException(status_code=404, detail="Scenario not found")
    definition = _load_definition(record)
    name = body.name or record.name
    horizon = body.horizon or definition.horizon
    start_date = body.start_date or definition.start_date
    freq = body.freq or definition.freq
    adjustments = body.adjustments or definition.adjustments

    summary, _ = _compute_plan(
        session,
        record.model_id,
        horizon=horizon,
        start_date=start_date,
        freq=freq,
        adjustments=adjustments,
    )
    record.name = name
    record.adjustments_json = _dump_definition(horizon, start_date, freq, adjustments)
    record.results_json = json.dumps(summary.model_dump())
    session.add(record)
    session.commit()
    session.refresh(record)
    return _scenario_out_from_record(record, session, summary)


@router.delete("/scenarios/{scenario_id}")
def delete_scenario(scenario_id: str, session: Session = Depends(get_session)):
    record = session.get(Scenario, scenario_id)
    if not record:
        raise HTTPException(status_code=404, detail="Scenario not found")
    session.delete(record)
    session.commit()
    return {"status": "ok"}


@router.get("/scenarios/{scenario_id}/timeseries", response_model=ScenarioTimeseriesResponse)
def scenario_timeseries(scenario_id: str, session: Session = Depends(get_session)):
    record = session.get(Scenario, scenario_id)
    if not record:
        raise HTTPException(status_code=404, detail="Scenario not found")
    definition = _load_definition(record)
    summary, series = _compute_plan(
        session,
        record.model_id,
        horizon=definition.horizon,
        start_date=definition.start_date,
        freq=definition.freq,
        adjustments=definition.adjustments,
    )
    record.results_json = json.dumps(summary.model_dump())
    session.add(record)
    session.commit()
    return ScenarioTimeseriesResponse(
        scenario_id=scenario_id,
        model_id=record.model_id,
        periods=summary.periods,
        series=series,
    )


@router.post("/scenarios/{scenario_id}/import", response_model=ScenarioOut)
async def import_scenario_plan(scenario_id: str, file: UploadFile = File(...), session: Session = Depends(get_session)):
    record = session.get(Scenario, scenario_id)
    if not record:
        raise HTTPException(status_code=404, detail="Scenario not found")
    content = await file.read()
    try:
        df = pd.read_csv(io.BytesIO(content))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Unable to parse CSV: {exc}") from exc
    df.columns = [str(col).strip().lower() for col in df.columns]
    required_cols = {"period", "variable", "mode", "value"}
    missing = required_cols - set(df.columns)
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing columns: {', '.join(missing)}")

    definition = _load_definition(record)
    adjustments = {period: dict(vars_) for period, vars_ in definition.adjustments.items()}
    for _, row in df.iterrows():
        period = str(row.get("period") or "").strip()
        variable = str(row.get("variable") or "").strip()
        if not period or not variable:
            continue
        mode = str(row.get("mode") or "multiplier").strip().lower()
        if mode not in {"multiplier", "value"}:
            mode = "multiplier"
        try:
            value = float(row.get("value"))
        except (TypeError, ValueError):
            continue
        adjustments.setdefault(period, {})[variable] = PeriodValue(mode=mode, value=value)

    summary, _ = _compute_plan(
        session,
        record.model_id,
        horizon=definition.horizon,
        start_date=definition.start_date,
        freq=definition.freq,
        adjustments=adjustments,
    )
    record.adjustments_json = _dump_definition(definition.horizon, definition.start_date, definition.freq, adjustments)
    record.results_json = json.dumps(summary.model_dump())
    session.add(record)
    session.commit()
    session.refresh(record)
    return _scenario_out_from_record(record, session, summary)


@router.get("/scenarios/{scenario_id}/export")
def export_scenario_plan(
    scenario_id: str,
    format: str = Query("csv", regex="^(csv|xlsx)$"),
    session: Session = Depends(get_session),
):
    record = session.get(Scenario, scenario_id)
    if not record:
        raise HTTPException(status_code=404, detail="Scenario not found")
    definition = _load_definition(record)
    rows: list[dict] = []
    for period, mapping in definition.adjustments.items():
        for variable, value in mapping.items():
            rows.append(
                {
                    "period": period,
                    "variable": variable,
                    "mode": value.mode if isinstance(value, PeriodValue) else "multiplier",
                    "value": value.value if isinstance(value, PeriodValue) else float(value),
                }
            )
    if not rows:
        rows.append({"period": definition.start_date.isoformat(), "variable": "", "mode": "multiplier", "value": 1.0})
    df = pd.DataFrame(rows)

    filename = f"scenario-{scenario_id}.{format}"
    if format == "xlsx":
        buffer = io.BytesIO()
        with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
            df.to_excel(writer, index=False)
        buffer.seek(0)
        return StreamingResponse(
            buffer,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )

    csv_buffer = io.StringIO()
    df.to_csv(csv_buffer, index=False)
    csv_buffer.seek(0)
    return StreamingResponse(
        io.BytesIO(csv_buffer.getvalue().encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
