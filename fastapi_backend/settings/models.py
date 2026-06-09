"""Per-user key/value preference store."""
import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from core.mixins import TimestampMixin, UUIDMixin
from settings.constants import MAX_KEY_LENGTH, MAX_VALUE_LENGTH


class Preference(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "preferences"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    key: Mapped[str] = mapped_column(String(MAX_KEY_LENGTH), nullable=False)
    value: Mapped[str] = mapped_column(String(MAX_VALUE_LENGTH), nullable=False, default="")

    __table_args__ = (UniqueConstraint("user_id", "key", name="uq_pref_user_key"),)
