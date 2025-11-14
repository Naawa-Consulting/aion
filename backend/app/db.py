from pathlib import Path
from typing import Iterator

from sqlalchemy import text
from sqlmodel import SQLModel, Session, create_engine
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str | None = None
    data_root: str | None = None

    class Config:
        env_prefix = "AION_"


settings = Settings()

DATA_ROOT = Path(settings.data_root or Path(__file__).resolve().parents[2] / "data")
DATA_ROOT.mkdir(parents=True, exist_ok=True)

DB_PATH = Path(__file__).resolve().parents[1] / "data" / "app.db"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

DATABASE_URL = settings.database_url or f"sqlite:///{DB_PATH.as_posix()}"

engine = create_engine(DATABASE_URL, echo=False)


def init_db() -> None:
    from . import models  # noqa: F401 ensures models are registered
    SQLModel.metadata.create_all(engine)
    if engine.url.get_backend_name() == "sqlite":
        with engine.begin() as conn:
            info = conn.execute(text("PRAGMA table_info(dataset);")).fetchall()
            column_names = {row[1] for row in info}
            if "sample_size" not in column_names:
                conn.execute(text("ALTER TABLE dataset ADD COLUMN sample_size INTEGER"))
            if "time_variable" not in column_names:
                conn.execute(text("ALTER TABLE dataset ADD COLUMN time_variable TEXT"))
            if "time_format" not in column_names:
                conn.execute(text("ALTER TABLE dataset ADD COLUMN time_format TEXT"))
            if "time_timezone" not in column_names:
                conn.execute(text("ALTER TABLE dataset ADD COLUMN time_timezone TEXT"))
            if "previous_version_id" not in column_names:
                conn.execute(text("ALTER TABLE dataset ADD COLUMN previous_version_id TEXT"))
            if "version" not in column_names:
                conn.execute(text("ALTER TABLE dataset ADD COLUMN version INTEGER DEFAULT 1"))


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session
