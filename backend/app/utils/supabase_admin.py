from __future__ import annotations

import httpx

from ..config import settings


def find_user_by_email(email: str) -> dict | None:
    """Looks up a Supabase auth user by exact email via the GoTrue Admin API
    (`/auth/v1/admin/users`), using the service role key — mirrors the direct-httpx
    pattern of `utils/storage.py` rather than pulling in the full supabase-py SDK for
    one call. Returns the raw user object (has "id"/"email") or None if not found.
    Filters by exact email match client-side in addition to the server-side `email`
    query param, since not every GoTrue version treats it as an exact filter.
    """
    resp = httpx.get(
        f"{settings.supabase_url}/auth/v1/admin/users",
        headers={
            "Authorization": f"Bearer {settings.supabase_service_role_key}",
            "apikey": settings.supabase_service_role_key,
        },
        params={"email": email},
        timeout=15.0,
    )
    resp.raise_for_status()
    body = resp.json()
    users = body.get("users", []) if isinstance(body, dict) else body
    target = email.strip().lower()
    for candidate in users:
        if (candidate.get("email") or "").lower() == target:
            return candidate
    return None


def find_user_by_id(user_id: str) -> dict | None:
    """Looks up a Supabase auth user by id, so admin UIs can show a membership's email
    instead of a raw UUID. Returns None (not raised) on 404 so one deleted/broken auth
    user doesn't break listing the rest of a company's members."""
    resp = httpx.get(
        f"{settings.supabase_url}/auth/v1/admin/users/{user_id}",
        headers={
            "Authorization": f"Bearer {settings.supabase_service_role_key}",
            "apikey": settings.supabase_service_role_key,
        },
        timeout=15.0,
    )
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    return resp.json()
