from __future__ import annotations

from fastapi import HTTPException


def api_error(status_code: int, code: str, message: str, **extra) -> HTTPException:
    """User-facing business-rule error with a stable machine-readable `code`, so the frontend
    can show a translated message instead of the raw backend string (see lib/error-messages.ts).
    Not used for 500s or tenancy/auth infrastructure errors — those stay plain HTTPExceptions."""
    return HTTPException(status_code=status_code, detail={"code": code, "message": message, **extra})
