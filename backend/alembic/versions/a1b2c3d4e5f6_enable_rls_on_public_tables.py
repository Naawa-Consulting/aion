"""enable RLS on public tables

Supabase flags every public-schema table without Row-Level Security as
"publicly accessible": with RLS off, the anon/authenticated keys could read
or write these tables directly through Supabase's auto-generated PostgREST
API. The backend never uses that path (it connects straight to Postgres via
AION_DATABASE_URL as the `postgres` role, which owns these tables and always
bypasses RLS), so enabling RLS here is a no-op for the app and closes the
gap for anyone using the Supabase client keys directly. No policies are
defined on purpose (deny-by-default) — per BITACORA.md, real authorization
stays in the application layer (tenancy.py), this is just closing the
PostgREST exposure the security scanner flagged.

Revision ID: a1b2c3d4e5f6
Revises: 7f4d461579cd
Create Date: 2026-08-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "7f4d461579cd"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = [
    "company",
    "membership",
    "dataset",
    "variable",
    "group",
    "subgroup",
    "variablehistory",
    "model",
    "modelmetrics",
    "modeltransform",
    "scenario",
    "alembic_version",
]


def upgrade() -> None:
    # ROW LEVEL SECURITY is Postgres-only syntax; guarding by dialect lets `alembic upgrade
    # head` still run cleanly against the local SQLite dev fallback (see db.py) instead of
    # crashing on a fresh local setup — no behavior change against real Postgres.
    if op.get_bind().dialect.name != "postgresql":
        return
    for table in TABLES:
        op.execute(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    for table in TABLES:
        op.execute(f'ALTER TABLE "{table}" DISABLE ROW LEVEL SECURITY')
