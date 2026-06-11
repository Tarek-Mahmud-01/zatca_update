import base64

from fastapi import APIRouter

from app.crypto import get_server_pubkey_spki

router = APIRouter(prefix="/crypto", tags=["crypto"])


@router.get("/pubkey")
async def get_pubkey() -> dict:
    """Return the server's ephemeral EC P-256 public key (SPKI-DER, base64).

    Clients use this to perform ECDH key agreement and derive a shared
    AES-256-GCM session key for payload encryption.
    """
    return {"pubkey": base64.b64encode(get_server_pubkey_spki()).decode(), "format": "spki-der"}
