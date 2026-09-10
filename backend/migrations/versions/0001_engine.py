"""Users, access control, projects, snapshots, audit; filesystem content lives in a volume."""
from alembic import op

revision = "0001_engine"
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    op.execute("""
    CREATE TABLE users (
        id uuid PRIMARY KEY, email text NOT NULL UNIQUE CHECK (email = lower(email)),
        password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE auth_sessions (
        token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);
    CREATE INDEX auth_sessions_user ON auth_sessions(user_id);
    CREATE TABLE projects (
        id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        metadata jsonb NOT NULL, revision integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX projects_owner ON projects(owner_id, updated_at DESC);
    CREATE TABLE project_members (
        project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role text NOT NULL CHECK (role IN ('viewer', 'editor')), PRIMARY KEY(project_id,user_id)
    );
    CREATE INDEX members_user ON project_members(user_id);
    CREATE TABLE snapshots (
        id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id), message text NOT NULL, files jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX snapshots_project ON snapshots(project_id,created_at DESC);
    CREATE TABLE audit_events (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id), action text NOT NULL, path text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX audit_project ON audit_events(project_id,id DESC);
    """)

def downgrade():
    for table in ("audit_events", "snapshots", "project_members", "projects", "auth_sessions", "users"):
        op.execute(f"DROP TABLE {table}")
