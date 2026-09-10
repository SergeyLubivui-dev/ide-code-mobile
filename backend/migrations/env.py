import os
from alembic import context
from sqlalchemy import create_engine, pool

url = os.environ["DATABASE_URL"].replace("postgresql://", "postgresql+psycopg://", 1)

if context.is_offline_mode():
    context.configure(url=url, literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()
else:
    engine = create_engine(url, poolclass=pool.NullPool)
    with engine.connect() as connection:
        # Serialize migration containers targeting the same database.
        connection.exec_driver_sql("SELECT pg_advisory_lock(761492035)")
        connection.commit()
        try:
            context.configure(connection=connection)
            with context.begin_transaction():
                context.run_migrations()
        finally:
            connection.exec_driver_sql("SELECT pg_advisory_unlock(761492035)")
            connection.commit()
