import time
import json
import logging
import requests
from typing import Optional, Dict, Any
from fastapi import Header, HTTPException

from backend.paths import LICENSE_FILE_PATH

logger = logging.getLogger("sentinelx.firebase_verifier")

FIREBASE_PROJECT_ID = "sentinelx-ai-production-6a42a"
GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"

# In-memory token verification cache: { token: (payload, expires_at_timestamp) }
_token_cache: Dict[str, tuple[Dict[str, Any], float]] = {}

def verify_firebase_id_token(token: str) -> Optional[Dict[str, Any]]:
    """
    Cryptographically verifies a Firebase ID Token using Google's public tokeninfo endpoint.
    Caches verified tokens for up to 5 minutes to keep local camera API latency at sub-millisecond speeds.
    Requires ZERO private service account keys on the client laptop.
    """
    if not token or not isinstance(token, str):
        return None

    now = time.time()

    # 1. Check in-memory cache
    if token in _token_cache:
        cached_payload, cache_exp = _token_cache[token]
        if now < cache_exp:
            return cached_payload
        else:
            del _token_cache[token]

    # 2. Verify with Google OAuth2 TokenInfo service
    try:
        response = requests.get(
            GOOGLE_TOKENINFO_URL,
            params={"id_token": token},
            timeout=5.0
        )
        if response.status_code != 200:
            logger.debug(f"Google token verification failed (status {response.status_code})")
            return None

        payload = response.json()

        # 3. Validate Audience and Issuer
        expected_aud = FIREBASE_PROJECT_ID
        expected_iss = f"https://securetoken.google.com/{FIREBASE_PROJECT_ID}"

        if payload.get("aud") != expected_aud or payload.get("iss") != expected_iss:
            logger.warning("Token verification rejected: Audience or Issuer mismatch.")
            return None

        exp = float(payload.get("exp", 0))
        if now > exp:
            logger.debug("Token has expired.")
            return None

        # Cache verified token for 5 minutes (or until actual exp, whichever is sooner)
        cache_ttl = min(300.0, exp - now)
        if cache_ttl > 0:
            _token_cache[token] = (payload, now + cache_ttl)

        return payload
    except Exception as e:
        logger.warning(f"Error connecting to Google token verification service: {e}")
        return None

async def require_firebase_company_user(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """
    FastAPI Dependency: Authenticates company users via Firebase ID token.
    Enforces that the user has an active authenticated session before accessing protected endpoints.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Authentication required: Missing or invalid Bearer token."
        )

    token = authorization.replace("Bearer ", "").strip()
    payload = verify_firebase_id_token(token)

    if not payload:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired Firebase authentication token."
        )

    return payload
