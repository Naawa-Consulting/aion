from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from ..auth import CurrentUser, get_current_user, is_platform_admin
from ..db import get_session
from ..models import Company, Membership
from ..schemas import MyMembershipOut, MyMembershipsOut

router = APIRouter()


@router.get("/memberships", response_model=MyMembershipsOut)
def my_memberships(
    user: CurrentUser = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    memberships = session.exec(select(Membership).where(Membership.user_id == user.user_id)).all()
    company_ids = [m.company_id for m in memberships]
    companies = session.exec(select(Company).where(Company.id.in_(company_ids))).all() if company_ids else []
    company_map = {c.id: c.name for c in companies}
    return MyMembershipsOut(
        is_platform_admin=is_platform_admin(user.email),
        memberships=[
            MyMembershipOut(
                company_id=m.company_id,
                company_name=company_map.get(m.company_id, "Unknown"),
                role=m.role,
            )
            for m in memberships
        ],
    )
