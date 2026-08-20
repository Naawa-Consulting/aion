"""fase6 variable display_name/unit

Revision ID: a1c3f9e7d2b4
Revises: d84d1b12cb13
Create Date: 2026-08-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = 'a1c3f9e7d2b4'
down_revision: Union[str, Sequence[str], None] = 'd84d1b12cb13'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('variable', sa.Column('display_name', sqlmodel.sql.sqltypes.AutoString(), nullable=True))
    op.add_column('variable', sa.Column('unit', sqlmodel.sql.sqltypes.AutoString(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('variable', 'unit')
    op.drop_column('variable', 'display_name')
