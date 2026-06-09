"""Dev convenience: create all tables from the ORM metadata.

    python -m scripts.create_tables

For anything beyond local dev, use Alembic migrations instead.
"""
import asyncio

# Import every app's models so they register on Base.metadata.
# (account has no model of its own — it reuses user.User.)
import finance.models  # noqa: F401
import invoice.models  # noqa: F401
import settings.models  # noqa: F401
import user.models  # noqa: F401
from core.database import Base, engine


async def main() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("All tables created.")


if __name__ == "__main__":
    asyncio.run(main())
