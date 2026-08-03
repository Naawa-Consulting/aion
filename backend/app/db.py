from typing import Iterator

from sqlmodel import Session, SQLModel, create_engine

from .config import settings

DATABASE_URL = settings.database_url or "sqlite:///./data/app.db"

engine = create_engine(DATABASE_URL, echo=False)


def init_db() -> None:
    """Create tables directly from the models, bypassing Alembic.

    Only for local/test convenience against a throwaway SQLite/Postgres DB. Real
    deployments run `alembic upgrade head` before the process starts (see Dockerfile) —
    this function must never be called from `main.py` in production.
    """
    from . import models  # noqa: F401 ensures models are registered

    SQLModel.metadata.create_all(engine)


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session
