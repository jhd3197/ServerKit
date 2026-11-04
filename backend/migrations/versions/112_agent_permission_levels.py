"""Agent-reported permission level, report bookkeeping and service checks."""
import sqlalchemy as sa
from alembic import op

revision = '112_agent_permission_levels'
down_revision = '111_preview_runtime'
branch_labels = None
depends_on = None

SERVER_COLUMNS = [
    ('permission_level', sa.String(16)),
    ('permission_level_updated_at', sa.DateTime()),
    ('requested_permission_level', sa.String(16)),
    ('last_report_at', sa.DateTime()),
    ('report_interval_seconds', sa.Integer()),
    ('service_checks', sa.JSON()),
]


def upgrade():
    inspector = sa.inspect(op.get_bind())
    existing = {c['name'] for c in inspector.get_columns('servers')}
    for name, kind in SERVER_COLUMNS:
        if name not in existing:
            op.add_column('servers', sa.Column(name, kind, nullable=True))
    existing = {c['name'] for c in inspector.get_columns('metric_alerts')}
    if 'detail' not in existing:
        op.add_column('metric_alerts', sa.Column('detail', sa.Text(), nullable=True))


def downgrade():
    with op.batch_alter_table('metric_alerts') as batch:
        batch.drop_column('detail')
    with op.batch_alter_table('servers') as batch:
        for name, _ in reversed(SERVER_COLUMNS):
            batch.drop_column(name)
