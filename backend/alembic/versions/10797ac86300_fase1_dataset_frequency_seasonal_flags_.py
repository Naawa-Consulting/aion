"""Fase 1: dataset frequency, seasonal flags, per-model media grid, grid search scores

Revision ID: 10797ac86300
Revises: 0f1f2d646f73
Create Date: 2026-08-18 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '10797ac86300'
down_revision: Union[str, Sequence[str], None] = '0f1f2d646f73'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('dataset', sa.Column('frequency', sa.String(), nullable=True))
    # server_default required: group/subgroup already have production rows; False preserves
    # the previous blanket calendar-bucketing behavior being turned off by default here (see
    # BITACORA — the plan chose opt-in False since this phase ships no UI yet to flip it on).
    op.add_column('group', sa.Column('is_seasonal', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('subgroup', sa.Column('is_seasonal', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('model', sa.Column('media_grid_json', sa.Text(), nullable=True))
    op.add_column('modeltransform', sa.Column('best_score', sa.Float(), nullable=True))
    op.add_column('modeltransform', sa.Column('runner_up_score', sa.Float(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('modeltransform', 'runner_up_score')
    op.drop_column('modeltransform', 'best_score')
    op.drop_column('model', 'media_grid_json')
    op.drop_column('subgroup', 'is_seasonal')
    op.drop_column('group', 'is_seasonal')
    op.drop_column('dataset', 'frequency')
