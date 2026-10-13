"""
Phase 1 Unit and Integration Tests for FirebaseTokenVerifier.
Validates:
1. Valid tokens with valid RS256 signatures and claims.
2. Invalid signatures and tampered tokens.
3. Wrong project audience.
4. Wrong issuer.
5. Expired tokens.
6. Missing/invalid claims (sub, aud, iss, alg).
7. Network/key-refresh failure and stale cache scenarios.
8. Live Google JWKS connectivity.
"""

import time
import json
import pytest
import requests
import jwt
from unittest.mock import Mock, patch
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization
from jwt.algorithms import RSAAlgorithm

from backend.auth.firebase_token_verifier import (
    FirebaseTokenVerifier,
    FirebaseKeyFetchError,
    InvalidTokenStructureError,
    InvalidTokenSignatureError,
    ExpiredTokenError,
    InvalidAudienceError,
    InvalidIssuerError,
    MissingClaimError,
    DEFAULT_FIREBASE_PROJECT_ID
)


@pytest.fixture(scope="module")
def rsa_keypair():
    """Generates a test RSA private/public keypair and JWK representation."""
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048
    )
    public_key = private_key.public_key()
    jwk_dict = json.loads(RSAAlgorithm.to_jwk(public_key))
    jwk_dict["kid"] = "test-key-id-01"
    jwk_dict["kty"] = "RSA"
    jwk_dict["alg"] = "RS256"
    jwk_dict["use"] = "sig"
    return private_key, public_key, jwk_dict


@pytest.fixture(scope="module")
def wrong_rsa_keypair():
    """Generates a second distinct RSA keypair to simulate signature mismatches."""
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048
    )
    return private_key


def create_test_token(
    private_key,
    kid: str = "test-key-id-01",
    project_id: str = DEFAULT_FIREBASE_PROJECT_ID,
    sub: str = "test-worker-uuid-1234",
    aud: str = None,
    iss: str = None,
    exp_offset: int = 3600,
    auth_time_offset: int = -60,
    extra_claims: dict = None,
    algorithm: str = "RS256",
    headers: dict = None
) -> str:
    now = int(time.time())
    payload = {
        "aud": aud if aud is not None else project_id,
        "iss": iss if iss is not None else f"https://securetoken.google.com/{project_id}",
        "sub": sub,
        "iat": now - 60,
        "exp": now + exp_offset,
        "auth_time": now + auth_time_offset
    }
    if extra_claims:
        payload.update(extra_claims)

    jwt_headers = {"kid": kid, "alg": algorithm}
    if headers:
        jwt_headers.update(headers)

    return jwt.encode(payload, private_key, algorithm=algorithm, headers=jwt_headers)


class TestFirebaseTokenVerifier:

    def test_valid_token_verification(self, rsa_keypair):
        """Test that a valid token signed with the matching key decodes successfully."""
        private_key, _, jwk_dict = rsa_keypair

        # Mock Session returning JWKS containing the public key
        mock_session = Mock(spec=requests.Session)
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.headers = {"Cache-Control": "public, max-age=1800"}
        mock_response.json.return_value = {"keys": [jwk_dict]}
        mock_session.get.return_value = mock_response

        verifier = FirebaseTokenVerifier(session=mock_session)
        token = create_test_token(
            private_key,
            sub="worker_alpha_99",
            extra_claims={"company_id": "ACME_IND", "role": "SAFETY_OFFICER"}
        )

        payload = verifier.verify_token(token)
        assert payload["sub"] == "worker_alpha_99"
        assert payload["company_id"] == "ACME_IND"
        assert payload["role"] == "SAFETY_OFFICER"
        assert payload["aud"] == DEFAULT_FIREBASE_PROJECT_ID

        # Safe wrapper test
        safe_payload, err = verifier.verify_token_safe(token)
        assert err is None
        assert safe_payload["sub"] == "worker_alpha_99"

    def test_invalid_signature_fails(self, rsa_keypair, wrong_rsa_keypair):
        """Test that a token signed with the wrong private key is rejected."""
        _, _, jwk_dict = rsa_keypair

        mock_session = Mock(spec=requests.Session)
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.headers = {"Cache-Control": "public, max-age=1800"}
        mock_response.json.return_value = {"keys": [jwk_dict]}
        mock_session.get.return_value = mock_response

        verifier = FirebaseTokenVerifier(session=mock_session)
        # Signed with wrong_rsa_keypair but presenting kid test-key-id-01
        forged_token = create_test_token(wrong_rsa_keypair, kid="test-key-id-01")

        with pytest.raises(InvalidTokenSignatureError):
            verifier.verify_token(forged_token)

        safe_payload, err = verifier.verify_token_safe(forged_token)
        assert safe_payload is None
        assert "signature verification failed" in err.lower()

    def test_wrong_project_audience_fails(self, rsa_keypair):
        """Test that tokens intended for another Firebase project are rejected."""
        private_key, _, jwk_dict = rsa_keypair

        mock_session = Mock(spec=requests.Session)
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.headers = {"Cache-Control": "public, max-age=1800"}
        mock_response.json.return_value = {"keys": [jwk_dict]}
        mock_session.get.return_value = mock_response

        verifier = FirebaseTokenVerifier(project_id=DEFAULT_FIREBASE_PROJECT_ID, session=mock_session)
        # Token aud is set to a foreign project while iss matches expected project
        foreign_token = create_test_token(
            private_key,
            aud="foreign-rogue-project",
            iss=f"https://securetoken.google.com/{DEFAULT_FIREBASE_PROJECT_ID}"
        )

        with pytest.raises(InvalidAudienceError):
            verifier.verify_token(foreign_token)

        safe_payload, err = verifier.verify_token_safe(foreign_token)
        assert safe_payload is None
        assert "audience mismatch" in err.lower()

    def test_wrong_issuer_fails(self, rsa_keypair):
        """Test that tokens from an unauthorized issuer are rejected."""
        private_key, _, jwk_dict = rsa_keypair

        mock_session = Mock(spec=requests.Session)
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.headers = {"Cache-Control": "public, max-age=1800"}
        mock_response.json.return_value = {"keys": [jwk_dict]}
        mock_session.get.return_value = mock_response

        verifier = FirebaseTokenVerifier(session=mock_session)
        rogue_token = create_test_token(private_key, iss="https://attacker.com/auth")

        with pytest.raises(InvalidIssuerError):
            verifier.verify_token(rogue_token)

        safe_payload, err = verifier.verify_token_safe(rogue_token)
        assert safe_payload is None
        assert "issuer mismatch" in err.lower()

    def test_expired_token_fails(self, rsa_keypair):
        """Test that expired tokens are rejected."""
        private_key, _, jwk_dict = rsa_keypair

        mock_session = Mock(spec=requests.Session)
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.headers = {"Cache-Control": "public, max-age=1800"}
        mock_response.json.return_value = {"keys": [jwk_dict]}
        mock_session.get.return_value = mock_response

        verifier = FirebaseTokenVerifier(clock_skew_leeway=0, session=mock_session)
        expired_token = create_test_token(private_key, exp_offset=-300)

        with pytest.raises(ExpiredTokenError):
            verifier.verify_token(expired_token)

        safe_payload, err = verifier.verify_token_safe(expired_token)
        assert safe_payload is None
        assert "expired" in err.lower()

    def test_missing_sub_claim_fails(self, rsa_keypair):
        """Test that tokens without a valid user UID ('sub') are rejected."""
        private_key, _, jwk_dict = rsa_keypair

        mock_session = Mock(spec=requests.Session)
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.headers = {"Cache-Control": "public, max-age=1800"}
        mock_response.json.return_value = {"keys": [jwk_dict]}
        mock_session.get.return_value = mock_response

        verifier = FirebaseTokenVerifier(session=mock_session)
        # sub is empty whitespace
        empty_sub_token = create_test_token(private_key, sub="   ")

        with pytest.raises(MissingClaimError):
            verifier.verify_token(empty_sub_token)

    def test_invalid_algorithm_fails(self, rsa_keypair):
        """Test that tokens using non-RS256 algorithms (or 'none') are rejected immediately."""
        private_key, _, jwk_dict = rsa_keypair
        verifier = FirebaseTokenVerifier()

        # Symmetric token simulating alg confusion with >= 32 byte secret
        symmetric_token = jwt.encode({"sub": "admin"}, "01234567890123456789012345678901", algorithm="HS256")

        with pytest.raises(InvalidTokenStructureError) as exc_info:
            verifier.verify_token(symmetric_token)
        assert "must be signed with 'rs256'" in str(exc_info.value).lower()

    def test_network_failure_handling(self):
        """Test behavior when network is down and cache is empty."""
        mock_session = Mock(spec=requests.Session)
        mock_session.get.side_effect = requests.ConnectionError("Network unreachable")

        verifier = FirebaseTokenVerifier(session=mock_session)

        # Empty cache + network failure -> FirebaseKeyFetchError
        with pytest.raises(FirebaseKeyFetchError) as exc_info:
            verifier.refresh_keys(force=True)
        assert "network error" in str(exc_info.value).lower()

    def test_stale_cache_fallback_on_network_outage(self, rsa_keypair):
        """Test that if network drops after keys are cached, stale keys still allow valid verification."""
        private_key, _, jwk_dict = rsa_keypair

        mock_session = Mock(spec=requests.Session)
        # First call succeeds
        mock_resp_ok = Mock()
        mock_resp_ok.status_code = 200
        mock_resp_ok.headers = {"Cache-Control": "public, max-age=1"}
        mock_resp_ok.json.return_value = {"keys": [jwk_dict]}
        
        # Subsequent call fails (network drops)
        mock_session.get.side_effect = [
            mock_resp_ok,
            requests.ConnectionError("DNS failure / offline")
        ]

        verifier = FirebaseTokenVerifier(session=mock_session)
        verifier.refresh_keys()
        assert "test-key-id-01" in verifier._keys_cache

        # Artificially expire cache timestamp
        verifier._cache_expires_at = time.time() - 10

        # Verify token when offline -> should gracefully use cached key instead of crashing
        token = create_test_token(private_key)
        payload = verifier.verify_token(token)
        assert payload["sub"] == "test-worker-uuid-1234"

    def test_live_google_jwks_connectivity(self):
        """Smoke test verifying connection and parsing against the real Google public endpoint."""
        verifier = FirebaseTokenVerifier()
        keys = verifier.refresh_keys(force=True)
        assert len(keys) >= 2, "Expected at least 2 active Google public signing keys."
        for kid, key_obj in keys.items():
            assert key_obj is not None
            assert kid != ""
