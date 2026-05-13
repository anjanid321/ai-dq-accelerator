"""SQLAlchemy models for the dq_app schema."""
from __future__ import annotations

import uuid
from sqlalchemy import (
    Column, DateTime, Float, ForeignKey, Index, String, Text, func, text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class Session(Base):
    __tablename__ = "sessions"
    __table_args__ = (
        Index(
            "ix_sessions_active",
            "created_at",
            postgresql_where=text("deleted_at IS NULL"),
        ),
        {"schema": "dq_app"},
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    filename = Column(Text, nullable=False)
    file_ext = Column(Text, nullable=False)
    use_case = Column(Text)
    target_column = Column(Text)
    description = Column(Text)
    stage = Column(String, nullable=False)
    current_score = Column(Float)
    baseline_score = Column(Float)
    output_dir = Column(Text)
    zip_path = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    deleted_at = Column(DateTime(timezone=True))

    snapshots = relationship(
        "StageSnapshot",
        back_populates="session",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class StageSnapshot(Base):
    __tablename__ = "stage_snapshots"
    __table_args__ = ({"schema": "dq_app"},)

    session_id = Column(
        UUID(as_uuid=True),
        ForeignKey("dq_app.sessions.id", ondelete="CASCADE"),
        primary_key=True,
    )
    stage = Column(String, primary_key=True)
    payload = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    session = relationship("Session", back_populates="snapshots")
