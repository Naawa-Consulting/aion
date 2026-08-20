from __future__ import annotations

from sqlmodel import Session, select

from ..models import InvestmentChannel, Variable


def channel_label_map(session: Session, dataset_id: str, company_id: str) -> dict[str, str]:
    """Maps a raw Variable.name to the business-friendly name of the InvestmentChannel it's
    the proxy for, so query screens can show "Facebook Ads" instead of
    "dig_ctv_branding_impresiones". Variables with no associated channel are absent from the
    map — callers should fall back to Variable.display_name, then the raw name."""
    channels = session.exec(
        select(InvestmentChannel).where(
            InvestmentChannel.dataset_id == dataset_id,
            InvestmentChannel.company_id == company_id,
            InvestmentChannel.proxy_variable.is_not(None),
        )
    ).all()
    return {c.proxy_variable: c.name for c in channels}


def variable_label_map(session: Session, dataset_id: str, company_id: str) -> dict[str, tuple[str | None, str | None]]:
    """Maps Variable.name -> (display_name, unit) for every variable in a dataset, so callers
    can resolve a business-friendly label/unit without a second per-variable query."""
    vars_ = session.exec(
        select(Variable).where(Variable.dataset_id == dataset_id, Variable.company_id == company_id)
    ).all()
    return {v.name: (v.display_name, v.unit) for v in vars_}


def resolve_label(name: str, channel_map: dict[str, str], var_map: dict[str, tuple[str | None, str | None]]) -> str:
    """Priority: curated InvestmentChannel name (existing economics-layer label) -> Variable.display_name
    -> raw column name."""
    if name in channel_map:
        return channel_map[name]
    display_name, _ = var_map.get(name, (None, None))
    return display_name or name


def resolve_unit(name: str, var_map: dict[str, tuple[str | None, str | None]]) -> str | None:
    _, unit = var_map.get(name, (None, None))
    return unit
