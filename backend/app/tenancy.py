from __future__ import annotations

from typing import Type, TypeVar

from fastapi import HTTPException
from sqlmodel import Session, SQLModel

ModelT = TypeVar("ModelT", bound=SQLModel)


def get_scoped(session: Session, model_cls: Type[ModelT], obj_id: object, company_id: str) -> ModelT:
    """session.get() + tenant guard. Returns 404 (not 403) when the row exists but belongs
    to a different company, so we never confirm the existence of another tenant's id."""
    obj = session.get(model_cls, obj_id)
    if not obj or getattr(obj, "company_id", None) != company_id:
        raise HTTPException(status_code=404, detail=f"{model_cls.__name__} not found")
    return obj
