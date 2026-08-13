from __future__ import annotations

import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlmodel import Session, select, delete

from ..auth import CurrentMembership, get_current_membership, require_write_access
from ..db import get_session
from ..errors import api_error
from ..models import Group, Subgroup, Dataset, Variable
from ..services.analysis import clear_analysis_cache
from ..tenancy import get_scoped
from ..schemas import (
    GroupOut,
    SubgroupOut,
    CreateGroupRequest,
    CreateSubgroupRequest,
    AssignVariableRequest,
    RenameGroupRequest,
    RenameSubgroupRequest,
)


router = APIRouter()


def _clear_other_baselines(session: Session, company_id: str, exclude_group_id: Optional[str]) -> None:
    """Only one group per company may be the baseline group — clear the flag on any other."""
    others = session.exec(
        select(Group).where(Group.company_id == company_id, Group.is_baseline == True)
    ).all()
    for other in others:
        if other.id == exclude_group_id:
            continue
        other.is_baseline = False
        session.add(other)


@router.get("", response_model=List[GroupOut])
def list_groups(
    membership: CurrentMembership = Depends(get_current_membership),
    session: Session = Depends(get_session),
):
    groups = session.exec(select(Group).where(Group.company_id == membership.company_id)).all()
    group_ids = [g.id for g in groups]
    subgroups = (
        session.exec(select(Subgroup).where(Subgroup.company_id == membership.company_id)).all()
        if groups
        else []
    )
    sg_by_gid: dict[str, list[Subgroup]] = {gid: [] for gid in group_ids}
    for sg in subgroups:
        sg_by_gid.setdefault(sg.group_id, []).append(sg)
    out: list[GroupOut] = []
    for g in groups:
        out.append(GroupOut(
            id=g.id,
            name=g.name,
            apply_media_transform=g.apply_media_transform,
            is_baseline=g.is_baseline,
            subgroups=[
                SubgroupOut(id=sg.id, name=sg.name, group_id=sg.group_id, apply_media_transform=sg.apply_media_transform)
                for sg in sg_by_gid.get(g.id, [])
            ]
        ))
    return out


@router.post("", response_model=GroupOut)
def create_group(
    body: CreateGroupRequest,
    membership: CurrentMembership = Depends(require_write_access),
    session: Session = Depends(get_session),
):
    if body.is_baseline:
        _clear_other_baselines(session, membership.company_id, exclude_group_id=None)
    g = Group(
        id=str(uuid.uuid4()),
        company_id=membership.company_id,
        name=body.name,
        apply_media_transform=body.apply_media_transform,
        is_baseline=body.is_baseline,
    )
    session.add(g)
    session.commit()
    return GroupOut(
        id=g.id,
        name=g.name,
        apply_media_transform=g.apply_media_transform,
        is_baseline=g.is_baseline,
        subgroups=[],
    )


@router.post("/subgroups", response_model=SubgroupOut)
def create_subgroup(
    body: CreateSubgroupRequest,
    membership: CurrentMembership = Depends(require_write_access),
    session: Session = Depends(get_session),
):
    g = get_scoped(session, Group, body.group_id, membership.company_id)
    sg = Subgroup(
        id=str(uuid.uuid4()),
        company_id=membership.company_id,
        group_id=g.id,
        name=body.name,
        apply_media_transform=body.apply_media_transform,
    )
    session.add(sg)
    session.commit()
    return SubgroupOut(id=sg.id, group_id=sg.group_id, name=sg.name, apply_media_transform=sg.apply_media_transform)


@router.post("/assign")
def assign_variable(
    body: AssignVariableRequest,
    membership: CurrentMembership = Depends(require_write_access),
    session: Session = Depends(get_session),
):
    ds = get_scoped(session, Dataset, body.dataset_id, membership.company_id)

    var = session.exec(
        select(Variable).where(
            (Variable.dataset_id == ds.id)
            & (Variable.company_id == membership.company_id)
            & (Variable.name == body.variable_name)
        )
    ).first()
    if not var:
        raise api_error(404, "VARIABLE_NOT_FOUND", "Variable not found")

    group = get_scoped(session, Group, body.group_id, membership.company_id) if body.group_id else None
    subgroup = get_scoped(session, Subgroup, body.subgroup_id, membership.company_id) if body.subgroup_id else None

    if subgroup and group and subgroup.group_id != group.id:
        raise api_error(400, "SUBGROUP_GROUP_MISMATCH", "Subgroup does not belong to group")
    if subgroup and not group:
        group = get_scoped(session, Group, subgroup.group_id, membership.company_id)

    var.group_id = group.id if group else None
    var.subgroup_id = subgroup.id if subgroup else None
    session.add(var)
    session.commit()
    return {"status": "ok"}


@router.patch("/{group_id}", response_model=GroupOut)
def rename_group(
    group_id: str,
    body: RenameGroupRequest,
    membership: CurrentMembership = Depends(require_write_access),
    session: Session = Depends(get_session),
):
    group = get_scoped(session, Group, group_id, membership.company_id)
    if body.name is not None:
        new_name = body.name.strip()
        if not new_name:
            raise api_error(400, "GROUP_NAME_EMPTY", "Name cannot be empty")
        conflict = session.exec(
            select(Group).where(
                Group.company_id == membership.company_id,
                func.lower(Group.name) == new_name.lower(),
                Group.id != group_id,
            )
        ).first()
        if conflict:
            raise api_error(400, "GROUP_NAME_CONFLICT", "Group name already exists")
        group.name = new_name
    if body.apply_media_transform is not None:
        group.apply_media_transform = body.apply_media_transform
    baseline_changed = body.is_baseline is not None and body.is_baseline != group.is_baseline
    if body.is_baseline is not None:
        if body.is_baseline:
            _clear_other_baselines(session, membership.company_id, exclude_group_id=group.id)
        group.is_baseline = body.is_baseline
    session.add(group)
    session.commit()
    session.refresh(group)
    if baseline_changed:
        clear_analysis_cache()
    subgroups = session.exec(
        select(Subgroup).where(Subgroup.group_id == group.id, Subgroup.company_id == membership.company_id)
    ).all()
    return GroupOut(
        id=group.id,
        name=group.name,
        apply_media_transform=group.apply_media_transform,
        is_baseline=group.is_baseline,
        subgroups=[
            SubgroupOut(id=sg.id, name=sg.name, group_id=sg.group_id, apply_media_transform=sg.apply_media_transform)
            for sg in subgroups
        ],
    )


@router.patch("/subgroups/{subgroup_id}", response_model=SubgroupOut)
def rename_subgroup(
    subgroup_id: str,
    body: RenameSubgroupRequest,
    membership: CurrentMembership = Depends(require_write_access),
    session: Session = Depends(get_session),
):
    subgroup = get_scoped(session, Subgroup, subgroup_id, membership.company_id)
    if body.name is not None:
        new_name = body.name.strip()
        if not new_name:
            raise api_error(400, "GROUP_NAME_EMPTY", "Name cannot be empty")
        conflict = session.exec(
            select(Subgroup).where(
                Subgroup.group_id == subgroup.group_id,
                Subgroup.company_id == membership.company_id,
                func.lower(Subgroup.name) == new_name.lower(),
                Subgroup.id != subgroup_id,
            )
        ).first()
        if conflict:
            raise api_error(400, "SUBGROUP_NAME_CONFLICT", "Subgroup name already exists in this group")
        subgroup.name = new_name
    if body.apply_media_transform is not None:
        subgroup.apply_media_transform = body.apply_media_transform
    session.add(subgroup)
    session.commit()
    session.refresh(subgroup)
    return SubgroupOut(
        id=subgroup.id,
        group_id=subgroup.group_id,
        name=subgroup.name,
        apply_media_transform=subgroup.apply_media_transform,
    )


@router.delete("/{group_id}")
def delete_group(
    group_id: str,
    reassign: str = Query("uncategorized", regex="^(uncategorized|none)$"),
    membership: CurrentMembership = Depends(require_write_access),
    session: Session = Depends(get_session),
):
    group = get_scoped(session, Group, group_id, membership.company_id)

    variable_count = session.exec(
        select(func.count())
        .select_from(Variable)
        .where(Variable.group_id == group_id, Variable.company_id == membership.company_id)
    ).one()
    count_value = int(variable_count[0] if isinstance(variable_count, tuple) else variable_count or 0)
    session.exec(
        delete(Subgroup).where(Subgroup.group_id == group_id, Subgroup.company_id == membership.company_id)
    )
    session.exec(
        Variable.__table__.update()
        .where(Variable.group_id == group_id, Variable.company_id == membership.company_id)
        .values(group_id=None, subgroup_id=None)
    )
    session.exec(delete(Group).where(Group.id == group.id, Group.company_id == membership.company_id))
    session.commit()
    return {"deleted_group_id": group_id, "reassigned_variables": count_value}


@router.delete("/subgroups/{subgroup_id}")
def delete_subgroup(
    subgroup_id: str,
    membership: CurrentMembership = Depends(require_write_access),
    session: Session = Depends(get_session),
):
    subgroup = get_scoped(session, Subgroup, subgroup_id, membership.company_id)

    variable_count = session.exec(
        select(func.count())
        .select_from(Variable)
        .where(Variable.subgroup_id == subgroup_id, Variable.company_id == membership.company_id)
    ).one()
    count_value = int(variable_count[0] if isinstance(variable_count, tuple) else variable_count or 0)
    session.exec(
        Variable.__table__.update()
        .where(Variable.subgroup_id == subgroup_id, Variable.company_id == membership.company_id)
        .values(subgroup_id=None)
    )
    session.exec(
        delete(Subgroup).where(Subgroup.id == subgroup.id, Subgroup.company_id == membership.company_id)
    )
    session.commit()
    return {
        "deleted_subgroup_id": subgroup_id,
        "cleared_subgroup_assignments": count_value,
    }
