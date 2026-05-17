import os
from pathlib import Path

import pytest

os.environ.setdefault("ZATCA_SANDBOX_BASE_URL", "https://example.invalid/sandbox")
os.environ.setdefault("ZATCA_SIMULATION_BASE_URL", "https://example.invalid/simulation")
os.environ.setdefault("ZATCA_PRODUCTION_BASE_URL", "https://example.invalid/production")
os.environ.setdefault("SECRET_KEY", "test-secret")
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://postgres:postgres@localhost/test")


SAMPLES = Path(__file__).parent / "fixtures" / "samples"


@pytest.fixture(scope="session")
def simplified_invoice_sample() -> bytes:
    return (SAMPLES / "Simplified" / "Invoice" / "Simplified_Invoice.xml").read_bytes()


@pytest.fixture(scope="session")
def standard_invoice_sample() -> bytes:
    return (SAMPLES / "Standard" / "Invoice" / "Standard_Invoice.xml").read_bytes()
