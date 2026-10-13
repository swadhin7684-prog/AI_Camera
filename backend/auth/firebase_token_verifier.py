"""
Isolated, production-grade Firebase ID Token Verifier for SentinelX AI.
Implements RFC 7519 / Google Identity Firebase ID token verification
using cryptographic RS256 public key validation, JWKS caching, and claim checks.
Zero private credentials or service accounts are required on the client device.
"""

import time
import re
import threading
import logging
from typing import Dict, Any, Optional, Tuple, List
import requests
import jwt
from jwt.algorithms import RSAAlgorithm

logger = logging.getLogger("sentinelx.auth.token_verifier")

DEFAULT_FIREBASE_PROJECT_ID = "sentinelx-ai-production-6a42a"
GOOGLE_JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"

# ----------------- EXCEPTIONS ----------------- #

class FirebaseTokenError(Exception):
    """Base exception for all Firebase token verification errors."""
    pass

class FirebaseKeyFetchError(FirebaseTokenError):
    """Raised when Google public JWKS keys cannot be fetched from network."""
    pass

class InvalidTokenStructureError(FirebaseTokenError):
    """Raised when token is malformed, not a JWT, or missing headers."""
    pass

class InvalidTokenSignatureError(FirebaseTokenError):
    """Raised when cryptographic signature does not match public key."""
    pass

class ExpiredTokenError(FirebaseTokenError):
    """Raised when token exp timestamp has passed."""
    pass

class InvalidAudienceError(FirebaseTokenError):
    """Raised when token aud claim does not match Firebase project ID."""
    pass

class InvalidIssuerError(FirebaseTokenError):
    """Raised when token iss claim does not match https://securetoken.google.com/<projectId>."""
    pass

class MissingClaimError(FirebaseTokenError):
    """Raised when a required claim (sub, exp, iss, aud, auth_time) is missing or empty."""
    pass


# ----------------- TOKEN VERIFIER ----------------- #

class FirebaseTokenVerifier:
    """
    Thread-safe cryptographic verifier for Firebase ID Tokens.
    - Caches Google public keys respecting HTTP Cache-Control headers.
    - Performs key rotation refreshes if an unknown 'kid' is encountered.
    - Validates RS256 signature, audience (project_id), issuer, exp, sub, auth_time.
    """

    def __init__(
        self,
        project_id: str = DEFAULT_FIREBASE_PROJECT_ID,
        jwks_url: str = GOOGLE_JWKS_URL,
        network_timeout: float = 5.0,
        clock_skew_leeway: int = 10,
        session: Optional[requests.Session] = None
    ):
        self.project_id = project_id
        self.jwks_url = jwks_url
        self.network_timeout = network_timeout
        self.clock_skew_leeway = clock_skew_leeway
        self._session = session or requests.Session()

        # Cache structure: { kid: rsa_public_key_object }
        self._keys_cache: Dict[str, Any] = {}
        self._cache_expires_at: float = 0.0
        self._last_refresh_attempt: float = 0.0
        self._lock = threading.Lock()

    @property
    def expected_issuer(self) -> str:
        return f"https://securetoken.google.com/{self.project_id}"

    def _parse_max_age(self, cache_control_header: Optional[str]) -> int:
        """Parses max-age value from Cache-Control header, default 3600 seconds."""
        if not cache_control_header:
            return 3600
        match = re.search(r"max-age=(\d+)", cache_control_header)
        if match:
            return max(60, int(match.group(1)))
        return 3600

    def refresh_keys(self, force: bool = False) -> Dict[str, Any]:
        """
        Fetches Google's latest public JWKS keys.
        Thread-safe and respects cache TTL unless forced.
        """
        now = time.time()
        with self._lock:
            if not force and self._keys_cache and now < self._cache_expires_at:
                return self._keys_cache

            # Throttling rapid failed requests (min 2 seconds between network attempts)
            if now - self._last_refresh_attempt < 2.0 and self._keys_cache:
                return self._keys_cache

            self._last_refresh_attempt = now

            try:
                response = self._session.get(self.jwks_url, timeout=self.network_timeout)
                if response.status_code != 200:
                    raise FirebaseKeyFetchError(
                        f"Failed to fetch Google JWKS: HTTP {response.status_code} {response.text[:100]}"
                    )

                data = response.json()
                keys = data.get("keys", [])
                if not keys:
                    raise FirebaseKeyFetchError("Google JWKS response contained no keys.")

                new_cache: Dict[str, Any] = {}
                for key_dict in keys:
                    kid = key_dict.get("kid")
                    if kid and key_dict.get("kty") == "RSA":
                        try:
                            public_key = RSAAlgorithm.from_jwk(key_dict)
                            new_cache[kid] = public_key
                        except Exception as parse_err:
                            logger.warning(f"Failed to parse JWK key {kid}: {parse_err}")

                if not new_cache:
                    raise FirebaseKeyFetchError("No valid RSA keys could be parsed from Google JWKS.")

                max_age = self._parse_max_age(response.headers.get("Cache-Control"))
                self._keys_cache = new_cache
                self._cache_expires_at = now + max_age
                logger.info(f"Refreshed Google public keys (cached {len(new_cache)} keys for {max_age}s).")
                return self._keys_cache

            except requests.RequestException as req_err:
                # If network fails but we still have an expired cache, use it as fallback with warning
                if self._keys_cache:
                    logger.warning(f"Google JWKS fetch failed ({req_err}), falling back to stale cached keys.")
                    return self._keys_cache
                raise FirebaseKeyFetchError(f"Network error fetching Google public keys: {req_err}") from req_err

    def get_public_key(self, kid: str) -> Any:
        """Retrieves public key for kid, refreshing cache if unknown kid is observed."""
        now = time.time()
        with self._lock:
            if kid in self._keys_cache and now < self._cache_expires_at:
                return self._keys_cache[kid]

        # Key not in cache or cache expired -> refresh
        updated_cache = self.refresh_keys(force=True)
        if kid not in updated_cache:
            raise InvalidTokenSignatureError(
                f"Unknown key ID ('kid'='{kid}'). Token was not signed by a recognized Google certificate."
            )
        return updated_cache[kid]

    def verify_token(self, token: str) -> Dict[str, Any]:
        """
        Cryptographically verifies a Firebase ID token.
        
        Validation Checklist:
        1. Valid JWT format and header.
        2. alg == 'RS256'.
        3. kid present and found in Google's published JWKS.
        4. Valid RSA signature.
        5. aud == self.project_id.
        6. iss == https://securetoken.google.com/<self.project_id>.
        7. sub is non-empty string <= 128 characters.
        8. exp is in the future.
        9. auth_time is in the past.
        
        Returns the decoded payload dict.
        Raises a subclass of FirebaseTokenError upon failure.
        """
        if not token or not isinstance(token, str):
            raise InvalidTokenStructureError("Token must be a non-empty string.")

        # 1. Inspect unverified header
        try:
            unverified_header = jwt.get_unverified_header(token)
        except Exception as e:
            raise InvalidTokenStructureError(f"Malformed JWT header: {e}") from e

        alg = unverified_header.get("alg")
        if alg != "RS256":
            raise InvalidTokenStructureError(
                f"Invalid algorithm '{alg}'. Firebase ID tokens must be signed with 'RS256'."
            )

        kid = unverified_header.get("kid")
        if not kid:
            raise InvalidTokenStructureError("Missing 'kid' (Key ID) in JWT header.")

        # 2. Retrieve public key
        public_key = self.get_public_key(kid)

        # 3. Cryptographically decode and verify signature + standard claims
        try:
            payload = jwt.decode(
                token,
                key=public_key,
                algorithms=["RS256"],
                audience=self.project_id,
                issuer=self.expected_issuer,
                leeway=self.clock_skew_leeway,
                options={
                    "require": ["exp", "iss", "aud", "sub", "iat"],
                    "verify_exp": True,
                    "verify_iss": True,
                    "verify_aud": True,
                    "verify_iat": True,
                }
            )
        except jwt.ExpiredSignatureError as e:
            raise ExpiredTokenError(f"Firebase token has expired: {e}") from e
        except jwt.InvalidAudienceError as e:
            raise InvalidAudienceError(
                f"Token audience mismatch. Expected '{self.project_id}', but token has different aud."
            ) from e
        except jwt.InvalidIssuerError as e:
            raise InvalidIssuerError(
                f"Token issuer mismatch. Expected '{self.expected_issuer}', but token has different iss."
            ) from e
        except jwt.InvalidSignatureError as e:
            raise InvalidTokenSignatureError(f"Cryptographic signature verification failed: {e}") from e
        except jwt.MissingRequiredClaimError as e:
            raise MissingClaimError(f"Missing required claim: {e}") from e
        except jwt.InvalidTokenError as e:
            raise InvalidTokenStructureError(f"Invalid token: {e}") from e

        # 4. Deep claim inspections
        sub = payload.get("sub")
        if not isinstance(sub, str) or not sub.strip():
            raise MissingClaimError("Token 'sub' (User UID) must be a non-empty string.")
        if len(sub) > 128:
            raise MissingClaimError("Token 'sub' exceeds 128 characters.")

        auth_time = payload.get("auth_time")
        if auth_time is not None:
            now = time.time()
            if isinstance(auth_time, (int, float)) and auth_time > (now + self.clock_skew_leeway):
                raise MissingClaimError(f"Token auth_time is in the future: {auth_time}")

        return payload

    def verify_token_safe(self, token: str) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        """Safe wrapper returning (payload, None) on success or (None, error_message) on failure."""
        try:
            payload = self.verify_token(token)
            return payload, None
        except FirebaseTokenError as err:
            return None, str(err)
        except Exception as unk_err:
            return None, f"Unexpected token verification error: {unk_err}"


# Global singleton verifier instance
default_firebase_verifier = FirebaseTokenVerifier()
