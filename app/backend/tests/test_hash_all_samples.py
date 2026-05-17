"""Byte-equivalence with every SDK sample.

For each ``Data/Samples/**/*.xml`` we extract the embedded
``<ds:Reference Id="invoiceSignedData"><ds:DigestValue>…</>`` — the digest the
SDK actually signed when it produced the sample — and assert that our
``compute_invoice_hash`` reproduces the same base64 SHA-256.

If anyone ever changes ``canonicalize._strip_for_invoice_hash`` in a way that
loses the tail-whitespace preservation trick, this entire test grid goes red.
"""
from __future__ import annotations

import os

import pytest
from lxml import etree

from app.zatca.canonicalize import NS
from app.zatca.hash import compute_invoice_hash

SAMPLES_ROOT = os.path.join(os.path.dirname(__file__), "fixtures", "samples")


def _collect_sample_cases() -> list[tuple[str, str, str]]:
    """Return (test_id, absolute_path, expected_digest_b64) for every signed sample."""
    out: list[tuple[str, str, str]] = []
    for root_dir, _, files in os.walk(SAMPLES_ROOT):
        for name in files:
            if not name.endswith(".xml"):
                continue
            path = os.path.join(root_dir, name)
            with open(path, "rb") as f:
                xml = f.read()
            try:
                root = etree.fromstring(xml)
            except etree.XMLSyntaxError:
                continue
            dv = root.xpath(
                ".//ds:Reference[@Id='invoiceSignedData']/ds:DigestValue",
                namespaces=NS,
            )
            if not dv or not dv[0].text:
                continue
            expected = dv[0].text.strip()
            test_id = (
                os.path.relpath(path, SAMPLES_ROOT)
                .replace(os.sep, "/")
                .replace(" ", "_")
            )
            out.append((test_id, path, expected))
    return sorted(out)


_CASES = _collect_sample_cases()


@pytest.mark.parametrize(
    "path,expected",
    [(case[1], case[2]) for case in _CASES],
    ids=[case[0] for case in _CASES],
)
def test_sample_hash_matches_embedded_digest(path: str, expected: str) -> None:
    with open(path, "rb") as f:
        xml = f.read()
    got = compute_invoice_hash(xml)
    assert got == expected, (
        f"hash mismatch on {path}\n  expected: {expected}\n  got:      {got}"
    )


def test_all_signed_sample_files_are_discovered() -> None:
    """Sanity: make sure we found the 26 signed samples we expect.

    If the SDK ships more, this assertion's lower bound stays stable but the
    upper one keeps adding coverage automatically.
    """
    assert len(_CASES) >= 26, (
        f"only {len(_CASES)} signed samples discovered under {SAMPLES_ROOT}"
    )
