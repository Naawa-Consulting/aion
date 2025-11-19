from __future__ import annotations

import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlmodel import Session, select, delete

from ..db import get_session
from ..models import Group, Subgroup, Dataset, Variable
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


@router.get("", response_model=List[GroupOut])
def list_groups(session: Session = Depends(get_session)):
    groups = session.exec(select(Group)).all()
    group_ids = [g.id for g in groups]
    subgroups = session.exec(select(Subgroup)).all() if groups else []
    sg_by_gid: dict[str, list[Subgroup]] = {gid: [] for gid in group_ids}
    for sg in subgroups:
        sg_by_gid.setdefault(sg.group_id, []).append(sg)
    out: list[GroupOut] = []
    for g in groups:
        out.append(GroupOut(
            id=g.id,
            name=g.name,
            subgroups=[SubgroupOut(id=sg.id, name=sg.name, group_id=sg.group_id) for sg in sg_by_gid.get(g.id, [])]
        ))
    return out


@router.post("", response_model=GroupOut)
def create_group(body: CreateGroupRequest, session: Session = Depends(get_session)):
    g = Group(id=str(uuid.uuid4()), name=body.name)
    session.add(g)
    session.commit()
    return GroupOut(id=g.id, name=g.name, subgroups=[])


@router.post("/subgroups", response_model=SubgroupOut)
def create_subgroup(body: CreateSubgroupRequest, session: Session = Depends(get_session)):
    g = session.get(Group, body.group_id)
    if not g:
        raise HTTPException(status_code=404, detail="Group not found")
    sg = Subgroup(id=str(uuid.uuid4()), group_id=g.id, name=body.name)
    session.add(sg)
    session.commit()
    return SubgroupOut(id=sg.id, group_id=sg.group_id, name=sg.name)


@router.post("/assign")
def assign_variable(body: AssignVariableRequest, session: Session = Depends(get_session)):
    ds = session.get(Dataset, body.dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    var = session.exec(
        select(Variable).where(
            (Variable.dataset_id == body.dataset_id) & (Variable.name == body.variable_name)
        )
    ).first()
    if not var:
        raise HTTPException(status_code=404, detail="Variable not found")

    group = session.get(Group, body.group_id) if body.group_id else None
    subgroup = session.get(Subgroup, body.subgroup_id) if body.subgroup_id else None

    if subgroup and group and subgroup.group_id != group.id:
        raise HTTPException(status_code=400, detail="Subgroup does not belong to group")
    if subgroup and not group:
        group = session.get(Group, subgroup.group_id)
    if body.group_id and not group:
        raise HTTPException(status_code=404, detail="Group not found")
    if body.subgroup_id and not subgroup:
        raise HTTPException(status_code=404, detail="Subgroup not found")

    var.group_id = group.id if group else None
    var.subgroup_id = subgroup.id if subgroup else None
    session.add(var)
    session.commit()
    return {"status": "ok"}


@router.patch("/{group_id}", response_model=GroupOut)
def rename_group(group_id: str, body: RenameGroupRequest, session: Session = Depends(get_session)):
    group = session.get(Group, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    new_name = body.name.strip()
    if not new_name:
        raise HTTPException(status_code=400, detail={"error": "Name cannot be empty"})
    conflict = session.exec(
        select(Group).where(func.lower(Group.name) == new_name.lower(), Group.id != group_id)
    ).first()
    if conflict:
        raise HTTPException(status_code=400, detail={"error": "Group name already exists"})
    group.name = new_name
    session.add(group)
    session.commit()
    session.refresh(group)
    subgroups = session.exec(select(Subgroup).where(Subgroup.group_id == group.id)).all()
    return GroupOut(
        id=group.id,
        name=group.name,
        subgroups=[SubgroupOut(id=sg.id, name=sg.name, group_id=sg.group_id) for sg in subgroups],
    )


@router.patch("/subgroups/{subgroup_id}", response_model=SubgroupOut)
def rename_subgroup(subgroup_id: str, body: RenameSubgroupRequest, session: Session = Depends(get_session)):
    subgroup = session.get(Subgroup, subgroup_id)
    if not subgroup:
        raise HTTPException(status_code=404, detail="Subgroup not found")
    new_name = body.name.strip()
    if not new_name:
        raise HTTPException(status_code=400, detail={"error": "Name cannot be empty"})
    conflict = session.exec(
        select(Subgroup).where(
            Subgroup.group_id == subgroup.group_id,
            func.lower(Subgroup.name) == new_name.lower(),
            Subgroup.id != subgroup_id,
        )
    ).first()
    if conflict:
        raise HTTPException(status_code=400, detail={"error": "Subgroup name already exists in this group"})
    subgroup.name = new_name
    session.add(subgroup)
    session.commit()
    session.refresh(subgroup)
    return SubgroupOut(id=subgroup.id, group_id=subgroup.group_id, name=subgroup.name)


@router.delete("/{group_id}")
def delete_group(
    group_id: str,
    reassign: str = Query("uncategorized", regex="^(uncategorized|none)$"),
    session: Session = Depends(get_session),
):
    group = session.get(Group, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    variable_count = session.exec(
        select(func.count()).select_from(Variable).where(Variable.group_id == group_id)
    ).one()
    count_value = int(variable_count[0] if isinstance(variable_count, tuple) else variable_count or 0)
    session.exec(delete(Subgroup).where(Subgroup.group_id == group_id))
    session.exec(
        Variable.__table__.update()
        .where(Variable.group_id == group_id)
        .values(group_id=None, subgroup_id=None)
    )
    session.exec(delete(Group).where(Group.id == group_id))
    session.commit()
    return {"deleted_group_id": group_id, "reassigned_variables": count_value}


@router.delete("/subgroups/{subgroup_id}")
def delete_subgroup(subgroup_id: str, session: Session = Depends(get_session)):
    subgroup = session.get(Subgroup, subgroup_id)
    if not subgroup:
        raise HTTPException(status_code=404, detail="Subgroup not found")

    variable_count = session.exec(
        select(func.count()).select_from(Variable).where(Variable.subgroup_id == subgroup_id)
    ).one()
    count_value = int(variable_count[0] if isinstance(variable_count, tuple) else variable_count or 0)
    session.exec(
        Variable.__table__.update()
        .where(Variable.subgroup_id == subgroup_id)
        .values(subgroup_id=None)
    )
    session.exec(delete(Subgroup).where(Subgroup.id == subgroup_id))
    session.commit()
    return {
        "deleted_subgroup_id": subgroup_id,
        "cleared_subgroup_assignments": count_value,
    }
