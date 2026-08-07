"""variable is_excluded, dataset dependent_variable, group is_baseline, conversion settings

Revision ID: 7319575dbfe9
Revises: 9373a11759cc
Create Date: 2026-08-06 00:00:00.000000

"""
import json
import uuid
from datetime import datetime, timezone
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = '7319575dbfe9'
down_revision: Union[str, Sequence[str], None] = '9373a11759cc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"

    # --- Variable.is_excluded / Dataset.dependent_variable / Group.is_baseline ---
    # server_default required on the two booleans: both tables already have production rows.
    op.add_column('variable', sa.Column('is_excluded', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('dataset', sa.Column('dependent_variable', sqlmodel.sql.sqltypes.AutoString(), nullable=True))
    op.add_column('group', sa.Column('is_baseline', sa.Boolean(), nullable=False, server_default=sa.false()))

    # --- ConversionSettings: dataset-scoped replacement for Model.conversion_rate/avg_value ---
    op.create_table(
        'conversionsettings',
        sa.Column('id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('company_id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('dataset_id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('conversion_rate_mode', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('conversion_rate_config_json', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('avg_value_mode', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('avg_value_config_json', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['company_id'], ['company.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('company_id', 'dataset_id', name='uq_conversion_settings_company_dataset'),
    )
    op.create_index(op.f('ix_conversionsettings_company_id'), 'conversionsettings', ['company_id'], unique=False)
    op.create_index(op.f('ix_conversionsettings_dataset_id'), 'conversionsettings', ['dataset_id'], unique=False)
    if is_postgres:
        op.execute('ALTER TABLE "conversionsettings" ENABLE ROW LEVEL SECURITY')

    # --- Data migration: fold Model.conversion_rate/avg_value into ConversionSettings ---
    # The old scheme was per-model; the new one is per-dataset. Where several models on the
    # same dataset had different values, keep only one: prefer hero > challenger1 >
    # challenger2 > none, tie-break by most recently created. Any other value is dropped —
    # there is no per-dataset representation that can keep more than one — documented in
    # BITACORA.md so this is a visible, not silent, decision.
    model_table = sa.table(
        'model',
        sa.column('id', sqlmodel.sql.sqltypes.AutoString()),
        sa.column('company_id', sqlmodel.sql.sqltypes.AutoString()),
        sa.column('dataset_id', sqlmodel.sql.sqltypes.AutoString()),
        sa.column('role', sqlmodel.sql.sqltypes.AutoString()),
        sa.column('conversion_rate', sa.Float()),
        sa.column('avg_value', sa.Float()),
        sa.column('created_at', sa.DateTime()),
    )
    rows = bind.execute(
        sa.select(
            model_table.c.id,
            model_table.c.company_id,
            model_table.c.dataset_id,
            model_table.c.role,
            model_table.c.conversion_rate,
            model_table.c.avg_value,
            model_table.c.created_at,
        ).where(
            model_table.c.conversion_rate.is_not(None),
            model_table.c.avg_value.is_not(None),
        )
    ).fetchall()

    role_priority = {"hero": 0, "challenger1": 1, "challenger2": 2, "none": 3}
    best_by_dataset: dict[tuple, object] = {}
    for row in rows:
        key = (row.company_id, row.dataset_id)
        current = best_by_dataset.get(key)
        if current is None:
            best_by_dataset[key] = row
            continue
        cur_rank = role_priority.get(current.role, 3)
        cand_rank = role_priority.get(row.role, 3)
        if cand_rank < cur_rank or (cand_rank == cur_rank and row.created_at > current.created_at):
            best_by_dataset[key] = row

    if best_by_dataset:
        conversion_settings_table = sa.table(
            'conversionsettings',
            sa.column('id', sqlmodel.sql.sqltypes.AutoString()),
            sa.column('company_id', sqlmodel.sql.sqltypes.AutoString()),
            sa.column('dataset_id', sqlmodel.sql.sqltypes.AutoString()),
            sa.column('conversion_rate_mode', sqlmodel.sql.sqltypes.AutoString()),
            sa.column('conversion_rate_config_json', sqlmodel.sql.sqltypes.AutoString()),
            sa.column('avg_value_mode', sqlmodel.sql.sqltypes.AutoString()),
            sa.column('avg_value_config_json', sqlmodel.sql.sqltypes.AutoString()),
            sa.column('created_at', sa.DateTime()),
        )
        now = datetime.now(timezone.utc)
        for (company_id, dataset_id), row in best_by_dataset.items():
            bind.execute(
                conversion_settings_table.insert().values(
                    id=str(uuid.uuid4()),
                    company_id=company_id,
                    dataset_id=dataset_id,
                    conversion_rate_mode="manual",
                    conversion_rate_config_json=json.dumps({"value": row.conversion_rate}),
                    avg_value_mode="manual",
                    avg_value_config_json=json.dumps({"value": row.avg_value}),
                    created_at=now,
                )
            )

    # --- Remove the now-migrated per-Model fields ---
    op.drop_column('model', 'avg_value')
    op.drop_column('model', 'conversion_rate')


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column('model', sa.Column('conversion_rate', sa.Float(), nullable=True))
    op.add_column('model', sa.Column('avg_value', sa.Float(), nullable=True))

    if op.get_bind().dialect.name == "postgresql":
        op.execute('ALTER TABLE "conversionsettings" DISABLE ROW LEVEL SECURITY')
    op.drop_index(op.f('ix_conversionsettings_dataset_id'), table_name='conversionsettings')
    op.drop_index(op.f('ix_conversionsettings_company_id'), table_name='conversionsettings')
    op.drop_table('conversionsettings')

    op.drop_column('group', 'is_baseline')
    op.drop_column('dataset', 'dependent_variable')
    op.drop_column('variable', 'is_excluded')
