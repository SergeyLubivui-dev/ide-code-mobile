"""Destructive migration checks run ONLY in a newly-created disposable database."""
import os
import subprocess
import sys
import uuid
import psycopg
from psycopg import sql
from sqlalchemy.engine import make_url

original = make_url(os.environ["DATABASE_URL"])
name = "astra_migration_test_" + uuid.uuid4().hex
test_url = original.set(database=name).render_as_string(hide_password=False)
env = {**os.environ, "DATABASE_URL": test_url}
with psycopg.connect(original.render_as_string(hide_password=False), autocommit=True) as admin:
    admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    try:
        for command in (("upgrade", "head"), ("upgrade", "head"), ("downgrade", "base"), ("upgrade", "head")):
            subprocess.run([sys.executable, "-m", "alembic", *command], check=True, env=env)
            with psycopg.connect(test_url) as check:
                tables = {row[0] for row in check.execute("SELECT tablename FROM pg_tables WHERE schemaname='public'")}
                expected = {"users", "auth_sessions", "projects", "project_members", "snapshots", "audit_events"}
                if command[0] == "downgrade":
                    assert not tables.intersection(expected), tables
                else:
                    assert expected.issubset(tables), tables
                    assert check.execute("SELECT version_num FROM alembic_version").fetchone()[0] == "0002_passwordless"
            print("PASS", *command, flush=True)
    finally:
        assert name.startswith("astra_migration_test_") and name != original.database
        admin.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))
        print("Disposable migration database removed", flush=True)
