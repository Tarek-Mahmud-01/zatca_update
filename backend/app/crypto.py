"""Server-side ECDH + AES-256-GCM for payload encryption.

On startup an ephemeral P-256 key pair is generated in-memory.  The public key
is served at GET /api/v1/crypto/pubkey.  Clients perform ECDH with their own
ephemeral key pair, derive the same AES-256-GCM key via HKDF-SHA-256, and use
it to encrypt every request body and decrypt every response body.
"""
from __future__ import annotations

import os

from cryptography.hazmat.primitives.asymmetric.ec import (
    ECDH,
    SECP256R1,
    generate_private_key,
)
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    PublicFormat,
    load_der_public_key,
)

_HKDF_SALT = b"zatca-api-v1"
_HKDF_INFO = b"aes-gcm"

_server_private_key = generate_private_key(SECP256R1())
_server_public_key = _server_private_key.public_key()


def get_server_pubkey_spki() -> bytes:
    """Return server public key as DER-encoded SubjectPublicKeyInfo."""
    return _server_public_key.public_bytes(Encoding.DER, PublicFormat.SubjectPublicKeyInfo)


def derive_shared_key(client_pubkey_der: bytes) -> bytes:
    """Derive AES-256 key from ECDH shared secret via HKDF-SHA-256."""
    client_pub = load_der_public_key(client_pubkey_der)
    shared = _server_private_key.exchange(ECDH(), client_pub)
    return HKDF(algorithm=SHA256(), length=32, salt=_HKDF_SALT, info=_HKDF_INFO).derive(shared)


def aes_encrypt(key: bytes, plaintext: bytes) -> tuple[bytes, bytes]:
    """AES-256-GCM encrypt. Returns (iv, ciphertext+tag)."""
    iv = os.urandom(12)
    return iv, AESGCM(key).encrypt(iv, plaintext, None)


def aes_decrypt(key: bytes, iv: bytes, ciphertext: bytes) -> bytes:
    """AES-256-GCM decrypt (raises InvalidTag on failure)."""
    return AESGCM(key).decrypt(iv, ciphertext, None)
