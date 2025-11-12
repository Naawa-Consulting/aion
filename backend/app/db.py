from pathlib import Path
from typing import Iterator

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


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session

