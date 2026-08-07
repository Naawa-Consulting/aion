from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..auth import CurrentMembership, CurrentUser, require_company_admin, require_platform_admin
from ..db import get_session
from ..models import Company, Membership
from ..schemas import (
    AddMembershipRequest,
    CompanyOut,
    CreateCompanyRequest,
    MembershipOut,
    UpdateMembershipRequest,
)

router = APIRouter()


@router.post("/companies", response_model=CompanyOut)
def create_company(
    body: CreateCompanyRequest,
    user: CurrentUser = Depends(require_platform_admin),
    session: Session = Depends(get_session),
):
    company = Company(id=str(uuid.uuid4()), name=body.name.strip())
    session.add(company)
    membership = Membership(
        id=str(uuid.uuid4()),
        user_id=body.admin_user_id,
        company_id=company.id,
        role="admin_compania",
    )
    session.add(membership)
    session.commit()
    return CompanyOut(id=company.id, name=company.name, created_at=company.created_at)


@router.get("/companies", response_model=list[CompanyOut])
def list_companies(
    user: CurrentUser = Depends(require_platform_admin),
    session: Session = Depends(get_session),
):
    companies = session.exec(select(Company).order_by(Company.created_at.desc())).all()
    return [CompanyOut(id=c.id, name=c.name, created_at=c.created_at) for c in companies]


@router.get("/companies/{company_id}/members", response_model=list[MembershipOut])
def list_members(
    company_id: str,
    membership: CurrentMembership = Depends(require_company_admin),
    session: Session = Depends(get_session),
):
    members = session.exec(select(Membership).where(Membership.company_id == company_id)).all()
    return [
        MembershipOut(user_id=m.user_id, company_id=m.company_id, role=m.role, created_at=m.created_at)
        for m in members
    ]


@router.post("/companies/{company_id}/members", response_model=MembershipOut)
def add_member(
    company_id: str,
    body: AddMembershipRequest,
    membership: CurrentMembership = Depends(require_company_admin),
    session: Session = Depends(get_session),
):
    existing = session.exec(
        select(Membership).where(Membership.company_id == company_id, Membership.user_id == body.user_id)
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="User is already a member of this company")
    new_member = Membership(
        id=str(uuid.uuid4()), user_id=body.user_id, company_id=company_id, role=body.role
    )
    session.add(new_member)
    session.commit()
    return MembershipOut(
        user_id=new_member.user_id,
        company_id=new_member.company_id,
        role=new_member.role,
        created_at=new_member.created_at,
    )


@router.patch("/companies/{company_id}/members/{user_id}", response_model=MembershipOut)
def update_member_role(
    company_id: str,
    user_id: str,
    body: UpdateMembershipRequest,
    membership: CurrentMembership = Depends(require_company_admin),
    session: Session = Depends(get_session),
):
    target = session.exec(
        select(Membership).where(Membership.company_id == company_id, Membership.user_id == user_id)
    ).first()
    if not target:
        raise HTTPException(status_code=404, detail="Membership not found")
    target.role = body.role
    session.add(target)
    session.commit()
    return MembershipOut(
        user_id=target.user_id, company_id=target.company_id, role=target.role, created_at=target.created_at
    )


@router.delete("/companies/{company_id}/members/{user_id}")
def remove_member(
    company_id: str,
    user_id: str,
    membership: CurrentMembership = Depends(require_company_admin),
    session: Session = Depends(get_session),
):
    target = session.exec(
        select(Membership).where(Membership.company_id == company_id, Membership.user_id == user_id)
    ).first()
    if not target:
        raise HTTPException(status_code=404, detail="Membership not found")
    session.delete(target)
    session.commit()
    return {"status": "ok"}
