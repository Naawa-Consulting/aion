from __future__ import annotations

import io
import json
import uuid
from typing import List, Optional

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlmodel import Session, select

from ..auth import CurrentMembership, get_current_membership, require_write_access
from ..db import get_session
from ..models import Dataset, InvestmentChannel, Variable
from ..routers.analysis import _apply_date_filter, _fit_from_model, _parse_date, _ts_key
from ..schemas import (
    ChannelEconomics,
    CreateInvestmentChannelRequest,
    EconomicsChannelSeries,
    EconomicsModelInfo,
    EconomicsStackedTotals,
    EconomicsTotals,
    InvestmentChannelConfig,
    InvestmentChannelOut,
    UpdateInvestmentChannelRequest,
)
from ..services.analysis import (
    AnalysisCacheKey,
    compute_contributions,
    get_cached_view,
    invalidate_cache_for_dataset,
    set_cached_view,
)
from ..services.economics import compute_channel_economics
from ..tenancy import get_scoped

router = APIRouter()


def _dataset_column_names(ds: Dataset) -> set[str]:
    return {c["name"] for c in json.loads(ds.columns_json)}


def _validate_channel_config(
    session: Session, ds: Dataset, source_mode: str, config: InvestmentChannelConfig
) -> None:
    columns = _dataset_column_names(ds)
    if source_mode == "dataset_column":
        if not config.cost_column:
            raise HTTPException(status_code=400, detail="cost_column is required for dataset_column mode")
        if config.cost_column not in columns:
            raise HTTPException(status_code=400, detail=f"Column not found in dataset: {config.cost_column}")
    elif source_mode == "rate_metric":
        if config.rate_value is None or not config.metric_column:
            raise HTTPException(status_code=400, detail="rate_value and metric_column are required for rate_metric mode")
        if config.metric_column not in columns:
            raise HTTPException(status_code=400, detail=f"Column not found in dataset: {config.metric_column}")
    elif source_mode == "manual":
        if not config.entries:
            raise HTTPException(status_code=400, detail="At least one entry is required for manual mode")
        for entry in config.entries:
            if entry.end_date < entry.start_date:
                raise HTTPException(status_code=400, detail="Manual entry end_date must not be before start_date")
    else:
        raise HTTPException(status_code=400, detail=f"Invalid source_mode: {source_mode}")


def _validate_proxy_variable(session: Session, ds: Dataset, company_id: str, proxy_variable: Optional[str]) -> None:
    if not proxy_variable:
        return
    exists = session.exec(
        select(Variable).where(
            Variable.dataset_id == ds.id,
            Variable.company_id == company_id,
            Variable.name == proxy_variable,
        )
    ).first()
    if not exists:
        raise HTTPException(status_code=400, detail=f"Variable not found in dataset: {proxy_variable}")


def _channel_out(channel: InvestmentChannel) -> InvestmentChannelOut:
    return InvestmentChannelOut(
        id=channel.id,
        dataset_id=channel.dataset_id,
        name=channel.name,
        source_mode=channel.source_mode,
        config=InvestmentChannelConfig(**json.loads(channel.config_json)),
        proxy_variable=channel.proxy_variable,
        created_at=channel.created_at,
    )


@router.get("/channels", response_model=List[InvestmentChannelOut])
def list_channels(
    dataset_id: str = Query(...),
    membership: CurrentMembership = Depends(get_current_membership),
    session: Session = Depends(get_session),
):
    get_scoped(session, Dataset, dataset_id, membership.company_id)
    channels = session.exec(
        select(InvestmentChannel).where(
            InvestmentChannel.company_id == membership.company_id,
            InvestmentChannel.dataset_id == dataset_id,
        )
    ).all()
    return [_channel_out(c) for c in channels]


@router.post("/channels", response_model=InvestmentChannelOut)
def create_channel(
    body: CreateInvestmentChannelRequest,
    membership: CurrentMembership = Depends(require_write_access),
    session: Session = Depends(get_session),
):
    ds = get_scoped(session, Dataset, body.dataset_id, membership.company_id)
    _validate_channel_config(session, ds, body.source_mode, body.config)
    _validate_proxy_variable(session, ds, membership.company_id, body.proxy_variable)

    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    conflict = session.exec(
        select(InvestmentChannel).where(
            InvestmentChannel.company_id == membership.company_id,
            InvestmentChannel.dataset_id == ds.id,
            func.lower(InvestmentChannel.name) == name.lower(),
        )
    ).first()
    if conflict:
        raise HTTPException(status_code=400, detail="A channel with this name already exists")

    channel = InvestmentChannel(
        id=str(uuid.uuid4()),
        company_id=membership.company_id,
        dataset_id=ds.id,
        name=name,
        source_mode=body.source_mode,
        config_json=body.config.model_dump_json(exclude_none=True),
        proxy_variable=body.proxy_variable,
    )
    session.add(channel)
    session.commit()
    invalidate_cache_for_dataset(ds.id)
    return _channel_out(channel)


@router.patch("/channels/{channel_id}", response_model=InvestmentChannelOut)
def update_channel(
    channel_id: str,
    body: UpdateInvestmentChannelRequest,
    membership: CurrentMembership = Depends(require_write_access),
    session: Session = Depends(get_session),
):
    channel = get_scoped(session, InvestmentChannel, channel_id, membership.company_id)
    ds = get_scoped(session, Dataset, channel.dataset_id, membership.company_id)

    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name cannot be empty")
        conflict = session.exec(
            select(InvestmentChannel).where(
                InvestmentChannel.company_id == membership.company_id,
                InvestmentChannel.dataset_id == ds.id,
                func.lower(InvestmentChannel.name) == name.lower(),
                InvestmentChannel.id != channel_id,
            )
        ).first()
        if conflict:
            raise HTTPException(status_code=400, detail="A channel with this name already exists")
        channel.name = name

    new_mode = body.source_mode if body.source_mode is not None else channel.source_mode
    if body.config is not None:
        _validate_channel_config(session, ds, new_mode, body.config)
        channel.source_mode = new_mode
        channel.config_json = body.config.model_dump_json(exclude_none=True)
    elif body.source_mode is not None:
        # switching mode without a new config is meaningless — the existing config almost
        # certainly won't match the new mode's required fields
        raise HTTPException(status_code=400, detail="config is required when changing source_mode")

    if body.unset_proxy_variable:
        channel.proxy_variable = None
    elif body.proxy_variable is not None:
        _validate_proxy_variable(session, ds, membership.company_id, body.proxy_variable)
        channel.proxy_variable = body.proxy_variable

    session.add(channel)
    session.commit()
    session.refresh(channel)
    invalidate_cache_for_dataset(ds.id)
    return _channel_out(channel)


@router.delete("/channels/{channel_id}")
def delete_channel(
    channel_id: str,
    membership: CurrentMembership = Depends(require_write_access),
    session: Session = Depends(get_session),
):
    channel = get_scoped(session, InvestmentChannel, channel_id, membership.company_id)
    dataset_id = channel.dataset_id
    session.delete(channel)
    session.commit()
    invalidate_cache_for_dataset(dataset_id)
    return {"deleted_channel_id": channel_id}


def _load_channels(session: Session, company_id: str, dataset_id: str) -> List[InvestmentChannel]:
    return session.exec(
        select(InvestmentChannel).where(
            InvestmentChannel.company_id == company_id,
            InvestmentChannel.dataset_id == dataset_id,
        )
    ).all()


def _fit_with_fallback(session: Session, model_id: str, company_id: str, time_col, start_ts, end_ts):
    """Same fallback as analysis.py's summary/stacked: if the date-filtered fit doesn't have
    enough rows, refit on the full history (correct adstock carryover) and slice the raw frame
    afterward instead of failing outright."""
    try:
        m, ds, work, X, Xc, y, params, filtered_df = _fit_from_model(
            session, model_id, company_id, time_col, start_ts, end_ts
        )
    except HTTPException as exc:
        if exc.detail != "Insufficient rows after cleaning for analysis" or (start_ts is None and end_ts is None):
            raise
        m, ds, work, X, Xc, y, params, full_df = _fit_from_model(session, model_id, company_id)
        filtered_df = _apply_date_filter(full_df.copy(), getattr(ds, "time_variable", None) or time_col, start_ts, end_ts)
        if filtered_df.empty:
            raise HTTPException(status_code=400, detail="No rows available for the selected date range")
    if filtered_df is None:
        filtered_df = work
    return m, ds, work, X, Xc, y, params, filtered_df


@router.get("/{model_id}/summary")
def economics_summary(
    model_id: str,
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    membership: CurrentMembership = Depends(get_current_membership),
    session: Session = Depends(get_session),
):
    start_ts = _parse_date(start_date)
    end_ts = _parse_date(end_date)
    m, ds, work, X, Xc, y, params, filtered_df = _fit_with_fallback(
        session, model_id, membership.company_id, None, start_ts, end_ts
    )

    cache_key = AnalysisCacheKey(
        dataset_id=ds.id, model_id=m.id, start=_ts_key(start_ts), end=_ts_key(end_ts), view="econ_summary"
    )
    cached = get_cached_view(cache_key)
    if cached is not None:
        return cached

    time_field = getattr(ds, "time_variable", None)
    contrib_result = compute_contributions(
        dataset_id=ds.id,
        model_id=m.id,
        df=filtered_df,
        design_frame=X,
        time_column=time_field,
        start=start_ts,
        end=end_ts,
        params=params,
        predictors=list(X.columns),
    )

    channels = _load_channels(session, membership.company_id, ds.id)
    per_channel = compute_channel_economics(
        model=m, filtered_df=contrib_result.frame, contrib_result=contrib_result, channels=channels, time_column=time_field
    )

    total_investment = sum(float(pc["investment_series"].sum()) for pc in per_channel)
    modeled_investment = sum(float(pc["investment_series"].sum()) for pc in per_channel if pc["is_modeled"])
    non_modeled_investment = total_investment - modeled_investment
    total_revenue = sum(
        float(pc["revenue_series"].sum()) for pc in per_channel if pc["revenue_series"] is not None
    )
    total_contribution = sum(
        float(pc["contribution_series"].sum()) for pc in per_channel if pc["contribution_series"] is not None
    )
    economics_configured = m.conversion_rate is not None and m.avg_value is not None
    roi_total = (
        (total_revenue - total_investment) / total_investment if (economics_configured and total_investment) else None
    )
    roas_total = total_revenue / total_investment if (economics_configured and total_investment) else None

    channel_rows: List[ChannelEconomics] = []
    for pc in per_channel:
        ch: InvestmentChannel = pc["channel"]
        inv = float(pc["investment_series"].sum())
        rev = float(pc["revenue_series"].sum()) if pc["revenue_series"] is not None else None
        contrib = float(pc["contribution_series"].sum()) if pc["contribution_series"] is not None else None
        roi = (rev - inv) / inv if (rev is not None and inv > 0) else None
        roas = (rev / inv) if (rev is not None and inv > 0) else None
        share_inv = inv / total_investment if total_investment else 0.0
        share_contrib = (contrib / total_contribution) if (contrib is not None and total_contribution) else None
        channel_rows.append(
            ChannelEconomics(
                id=ch.id,
                name=ch.name,
                source_mode=ch.source_mode,
                proxy_variable=ch.proxy_variable,
                is_modeled=pc["is_modeled"],
                proxy_in_current_model=pc["proxy_in_current_model"],
                misconfigured=pc["misconfigured"],
                investment=inv,
                revenue=rev,
                contribution=contrib,
                roi=roi,
                roas=roas,
                share_of_investment=share_inv,
                share_of_contribution=share_contrib,
            )
        )

    response = {
        "model": EconomicsModelInfo(
            id=m.id,
            name=m.name,
            dataset_id=m.dataset_id,
            y_var=m.y_var,
            x_vars=json.loads(m.x_vars_json),
            conversion_rate=m.conversion_rate,
            avg_value=m.avg_value,
        ).model_dump(),
        "economics_configured": economics_configured,
        "totals": EconomicsTotals(
            investment=total_investment,
            revenue=total_revenue,
            contribution=total_contribution,
            roi=roi_total,
            roas=roas_total,
            modeled_investment=modeled_investment,
            non_modeled_investment=non_modeled_investment,
        ).model_dump(),
        "channels": [c.model_dump() for c in channel_rows],
    }
    set_cached_view(cache_key, response)
    return response


@router.get("/{model_id}/stacked")
def economics_stacked(
    model_id: str,
    time_col: str = Query(...),
    freq: str = Query("month"),
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    membership: CurrentMembership = Depends(get_current_membership),
    session: Session = Depends(get_session),
):
    start_ts = _parse_date(start_date)
    end_ts = _parse_date(end_date)
    m, ds, work, X, Xc, y, params, filtered_df = _fit_with_fallback(
        session, model_id, membership.company_id, time_col, start_ts, end_ts
    )

    cache_key = AnalysisCacheKey(
        dataset_id=ds.id,
        model_id=m.id,
        start=_ts_key(start_ts),
        end=_ts_key(end_ts),
        view="econ_stacked",
        extra=(time_col, freq),
    )
    cached = get_cached_view(cache_key)
    if cached is not None:
        return cached

    contrib_result = compute_contributions(
        dataset_id=ds.id,
        model_id=m.id,
        df=filtered_df,
        design_frame=X,
        time_column=time_col,
        start=start_ts,
        end=end_ts,
        params=params,
        predictors=list(X.columns),
    )

    channels = _load_channels(session, membership.company_id, ds.id)
    per_channel = compute_channel_economics(
        model=m, filtered_df=contrib_result.frame, contrib_result=contrib_result, channels=channels, time_column=time_col
    )

    freq_map = {"day": "D", "week": "W", "month": "M"}
    rule = freq_map.get(freq, "M")
    periods = contrib_result.time_values.dt.to_period(rule).astype(str)
    period_index = sorted(periods.unique().tolist())

    total_inv = pd.Series(0.0, index=period_index)
    total_rev = pd.Series(0.0, index=period_index)
    series_out = []
    for pc in per_channel:
        ch: InvestmentChannel = pc["channel"]
        inv_by_period = pc["investment_series"].groupby(periods).sum().reindex(period_index).fillna(0.0)
        total_inv = total_inv.add(inv_by_period, fill_value=0.0)
        if pc["revenue_series"] is not None:
            rev_by_period = pc["revenue_series"].groupby(periods).sum().reindex(period_index).fillna(0.0)
            total_rev = total_rev.add(rev_by_period, fill_value=0.0)
            revenue_list = [float(v) for v in rev_by_period.tolist()]
        else:
            revenue_list = [None] * len(period_index)
        series_out.append(
            EconomicsChannelSeries(
                channel_id=ch.id,
                channel_name=ch.name,
                is_modeled=pc["is_modeled"],
                investment=[float(v) for v in inv_by_period.tolist()],
                revenue=revenue_list,
            ).model_dump()
        )

    response = {
        "index": [str(p) for p in period_index],
        "totals": EconomicsStackedTotals(
            investment=[float(v) for v in total_inv.tolist()], revenue=[float(v) for v in total_rev.tolist()]
        ).model_dump(),
        "series": series_out,
    }
    set_cached_view(cache_key, response)
    return response


@router.get("/{model_id}/export/summary.xlsx")
def export_economics_summary(
    model_id: str,
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    membership: CurrentMembership = Depends(get_current_membership),
    session: Session = Depends(get_session),
):
    data = economics_summary(model_id, start_date, end_date, membership, session)
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        pd.DataFrame(data["channels"]).to_excel(writer, index=False, sheet_name="channels")
        pd.DataFrame([data["totals"]]).to_excel(writer, index=False, sheet_name="totals")
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=economics_summary.xlsx"},
    )


@router.get("/{model_id}/export/stacked.xlsx")
def export_economics_stacked(
    model_id: str,
    time_col: str = Query(...),
    freq: str = Query("month"),
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    membership: CurrentMembership = Depends(get_current_membership),
    session: Session = Depends(get_session),
):
    data = economics_stacked(model_id, time_col, freq, start_date, end_date, membership, session)
    index = data["index"]
    rows = [
        {
            "period": idx,
            "total_investment": data["totals"]["investment"][i],
            "total_revenue": data["totals"]["revenue"][i],
            **{f"{s['channel_name']} (inv)": s["investment"][i] for s in data["series"]},
            **{f"{s['channel_name']} (rev)": s["revenue"][i] for s in data["series"]},
        }
        for i, idx in enumerate(index)
    ]
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        pd.DataFrame(rows).to_excel(writer, index=False, sheet_name="stacked")
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=economics_stacked.xlsx"},
    )
