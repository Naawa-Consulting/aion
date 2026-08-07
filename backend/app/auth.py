from __future__ import annotations

import time
from dataclasses import dataclass

import httpx
from fastapi import Depends, Header, HTTPException
from jose import JWTError, jwt

from sqlmodel import Session, select

from .config import settings
from .db import get_session
from .models import Membership

WRITE_ROLES = ("modelador", "admin_compania")
COMPANY_ADMIN_ROLE = "admin_compania"

_JWKS_CACHE_TTL_SECONDS = 3600
_jwks_cache: dict | None = None
_jwks_cache_at: float = 0.0


@dataclass
class CurrentUser:
    user_id: str
    email: str | None = None


@dataclass
class CurrentMembership:
    user_id: str
    company_id: str
    role: str
    email: str | None = None


def _get_jwks(force_refresh: bool = False) -> dict:
    global _jwks_cache, _jwks_cache_at
    if _jwks_cache is None or force_refresh or (time.time() - _jwks_cache_at) > _JWKS_CACHE_TTL_SECONDS:
        resp = httpx.get(f"{settings.supabase_url}/auth/v1/.well-known/jwks.json", timeout=10.0)
        resp.raise_for_status()
        _jwks_cache = resp.json()
        _jwks_cache_at = time.time()
    return _jwks_cache


def _find_jwk(kid: str | None, force_refresh: bool = False) -> dict | None:
    jwks = _get_jwks(force_refresh=force_refresh)
    for key in jwks.get("keys", []):
        if key.get("kid") == kid:
            return key
    return None


def _decode_token(token: str) -> dict:
    """Supabase projects sign session JWTs either with a legacy shared HS256 secret
    (`SUPABASE_JWT_SECRET`) or with the newer per-project asymmetric signing keys
    (ES256/RS256, published at /auth/v1/.well-known/jwks.json) — this project uses the
    latter. Branch on the token's own `alg` header so either kind works."""
    try:
        header = jwt.get_unverified_header(token)
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired token") from exc

    alg = header.get("alg")
    try:
        if alg == "HS256":
            if not settings.supabase_jwt_secret:
                raise HTTPException(status_code=500, detail="SUPABASE_JWT_SECRET is not configured")
            return jwt.decode(
                token, settings.supabase_jwt_secret, algorithms=["HS256"], audience="authenticated"
            )

        kid = header.get("kid")
        key = _find_jwk(kid) or _find_jwk(kid, force_refresh=True)  # retry once after key rotation
        if not key:
            raise HTTPException(status_code=401, detail="Invalid or expired token")
        return jwt.decode(token, key, algorithms=[alg], audience="authenticated")
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired token") from exc


def get_current_user(authorization: str = Header(...)) -> CurrentUser:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    payload = _decode_token(authorization.removeprefix("Bearer ").strip())
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token missing subject")
    return CurrentUser(user_id=user_id, email=payload.get("email"))


def get_current_membership(
    x_company_id: str = Header(..., alias="X-Company-Id"),
    user: CurrentUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CurrentMembership:
    membership = session.exec(
        select(Membership).where(
            Membership.user_id == user.user_id,
            Membership.company_id == x_company_id,
        )
    ).first()
    if not membership:
        raise HTTPException(status_code=403, detail="No access to this company")
    return CurrentMembership(
        user_id=user.user_id,
        company_id=membership.company_id,
        role=membership.role,
        email=user.email,
    )


def require_role(*roles: str):
    def _checker(membership: CurrentMembership = Depends(get_current_membership)) -> CurrentMembership:
        if membership.role not in roles:
            raise HTTPException(status_code=403, detail="Insufficient role")
        return membership

    return _checker


require_write_access = require_role(*WRITE_ROLES)


def is_platform_admin(email: str | None) -> bool:
    if not email:
        return False
    return email.lower() in settings.platform_admin_email_set


def require_platform_admin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not is_platform_admin(user.email):
        raise HTTPException(status_code=403, detail="Platform admin only")
    return user


def require_company_admin(company_id: str, user: CurrentUser = Depends(get_current_user), session: Session = Depends(get_session)) -> CurrentMembership:
    """Like get_current_membership, but scoped to the company_id in the URL path rather
    than the X-Company-Id header — used by /admin/companies/{company_id}/... routes so a
    caller can't administer a different company than the one in the URL."""
    membership = session.exec(
        select(Membership).where(
            Membership.user_id == user.user_id,
            Membership.company_id == company_id,
        )
    ).first()
    if not membership or membership.role != COMPANY_ADMIN_ROLE:
        raise HTTPException(status_code=403, detail="Company admin only")
    return CurrentMembership(
        user_id=user.user_id,
        company_id=company_id,
        role=membership.role,
        email=user.email,
    )
