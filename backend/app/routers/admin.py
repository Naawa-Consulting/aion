from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, func, select

from ..auth import (
    CurrentMembership,
    CurrentUser,
    require_admin_privilege,
    require_company_admin,
    require_platform_admin,
)
from ..db import get_session
from ..models import Company, Dataset, Membership
from ..schemas import (
    AddMembershipRequest,
    CompanyOut,
    CreateCompanyRequest,
    MembershipOut,
    UpdateCompanyRequest,
    UpdateMembershipRequest,
    UserLookupOut,
)
from ..utils.supabase_admin import find_user_by_email, find_user_by_id

router = APIRouter()


def _safe_email(user_id: str) -> str | None:
    """Best-effort email lookup for display purposes — a Supabase Admin API hiccup
    shouldn't fail listing a company's members, just show their id without an email."""
    try:
        found = find_user_by_id(user_id)
    except Exception:
        return None
    return found.get("email") if found else None


@router.get("/users/lookup", response_model=UserLookupOut)
def lookup_user_by_email(
    email: str,
    user: CurrentUser = Depends(require_admin_privilege),
):
    found = find_user_by_email(email)
    if not found:
        raise HTTPException(status_code=404, detail="No user found with that email")
    return UserLookupOut(user_id=found["id"], email=found.get("email", email))


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


@router.patch("/companies/{company_id}", response_model=CompanyOut)
def rename_company(
    company_id: str,
    body: UpdateCompanyRequest,
    user: CurrentUser = Depends(require_platform_admin),
    session: Session = Depends(get_session),
):
    company = session.get(Company, company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    company.name = body.name.strip()
    session.add(company)
    session.commit()
    return CompanyOut(id=company.id, name=company.name, created_at=company.created_at)


@router.delete("/companies/{company_id}")
def delete_company(
    company_id: str,
    user: CurrentUser = Depends(require_platform_admin),
    session: Session = Depends(get_session),
):
    company = session.get(Company, company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    member_count = session.exec(
        select(func.count()).select_from(Membership).where(Membership.company_id == company_id)
    ).one()
    dataset_count = session.exec(
        select(func.count()).select_from(Dataset).where(Dataset.company_id == company_id)
    ).one()
    if member_count or dataset_count:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Cannot delete a company with existing data ({member_count} members, "
                f"{dataset_count} datasets) — remove members and datasets first."
            ),
        )
    session.delete(company)
    session.commit()
    return {"status": "ok"}


@router.get("/companies/{company_id}/members", response_model=list[MembershipOut])
def list_members(
    company_id: str,
    membership: CurrentMembership = Depends(require_company_admin),
    session: Session = Depends(get_session),
):
    members = session.exec(select(Membership).where(Membership.company_id == company_id)).all()
    return [
        MembershipOut(
            user_id=m.user_id,
            email=_safe_email(m.user_id),
            company_id=m.company_id,
            role=m.role,
            created_at=m.created_at,
        )
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
        email=_safe_email(new_member.user_id),
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
        user_id=target.user_id,
        email=_safe_email(target.user_id),
        company_id=target.company_id,
        role=target.role,
        created_at=target.created_at,
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
