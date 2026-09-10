"""Passwordless sign-in: users are identified by email and carry a display name."""
from alembic import op

revision = "0002_passwordless"
down_revision = "0001_engine"
branch_labels = None
depends_on = None

def upgrade():
    op.execute("""
    ALTER TABLE users ADD COLUMN name text NOT NULL DEFAULT '';
    ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
    ALTER TABLE users ALTER COLUMN password_hash DROP DEFAULT;
    UPDATE users SET name = split_part(email, '@', 1) WHERE name = '';
    ALTER TABLE users ALTER COLUMN name DROP DEFAULT;
    ALTER TABLE users ADD CONSTRAINT users_name_present CHECK (length(name) BETWEEN 1 AND 64);
    """)

def downgrade():
    op.execute("""
    ALTER TABLE users DROP CONSTRAINT users_name_present;
    ALTER TABLE users DROP COLUMN name;
    UPDATE users SET password_hash = '' WHERE password_hash IS NULL;
    ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;
    """)
