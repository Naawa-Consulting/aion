"""fase5 scenario is_featured

Revision ID: d84d1b12cb13
Revises: 10797ac86300
Create Date: 2026-08-18 20:52:03.154941

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd84d1b12cb13'
down_revision: Union[str, Sequence[str], None] = '10797ac86300'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('scenario', sa.Column('is_featured', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('scenario', 'is_featured')
