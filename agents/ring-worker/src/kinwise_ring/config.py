"""Settings, read from the environment (and an optional `.env` file)."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_RING_API_BASE = "https://api.amazonvision.com"
DEFAULT_RING_OAUTH_URL = "https://oauth.ring.com/oauth/token"
DEFAULT_MODEL_ID = "us.amazon.nova-2-lite-v1:0"
PERCEPTION_MODES = ("bedrock", "offline")


class ConfigError(ValueError):
    """A setting is missing or malformed."""


@dataclass(frozen=True)
class Settings:
    hub_url: str = "http://localhost:8787"
    ingest_secret: str = "dev-ingest-secret"  # noqa: S105 - the hub's documented local-dev default
    household_id: str = "hh-asha"

    ring_api_base: str = DEFAULT_RING_API_BASE
    ring_oauth_url: str = DEFAULT_RING_OAUTH_URL
    ring_token: str | None = None
    ring_token_file: Path | None = None
    ring_client_id: str | None = None
    ring_client_secret: str | None = None
    ring_refresh_token: str | None = None
    ring_device_ids: tuple[str, ...] = ()
    ring_webhook_secret: str | None = None

    poll_seconds: float = 5.0
    live_every_seconds: float = 20.0
    person_cooldown_seconds: float = 60.0

    perception_mode: str = "offline"
    perception_model_id: str = DEFAULT_MODEL_ID
    aws_region: str = "us-east-1"
    watermark_crop: float = 0.15

    state_dir: Path = field(default_factory=lambda: Path(".kinwise-data"))

    @property
    def uses_oauth(self) -> bool:
        return bool(self.ring_client_id and self.ring_client_secret and self.ring_refresh_token)

    @property
    def uses_playground_token(self) -> bool:
        return bool(self.ring_token or self.ring_token_file)

    @property
    def has_ring_credentials(self) -> bool:
        return self.uses_oauth or self.uses_playground_token

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None, env_file: str | Path | None = ".env") -> Settings:
        """Build settings from `environ` (default: `os.environ`, after loading `env_file`)."""
        if environ is None:
            if env_file and Path(env_file).is_file():
                from dotenv import load_dotenv

                load_dotenv(env_file, override=False)
            environ = os.environ
        env = {k: v.strip() for k, v in environ.items() if isinstance(v, str)}

        def text(name: str, default: str | None = None) -> str | None:
            value = env.get(name, "")
            return value if value else default

        def number(name: str, default: float, *, minimum: float = 0.0) -> float:
            raw = env.get(name, "")
            if not raw:
                return default
            try:
                value = float(raw)
            except ValueError as exc:
                raise ConfigError(f"{name} must be a number, got {raw!r}") from exc
            if value < minimum:
                raise ConfigError(f"{name} must be >= {minimum}, got {value}")
            return value

        mode = (text("PERCEPTION_MODE") or "").lower()
        if not mode:
            mode = "bedrock" if aws_credentials_available(env) else "offline"
        if mode not in PERCEPTION_MODES:
            raise ConfigError(f"PERCEPTION_MODE must be one of {PERCEPTION_MODES}, got {mode!r}")

        crop = number("WATERMARK_CROP", 0.15)
        if crop >= 0.5:
            raise ConfigError("WATERMARK_CROP is a fraction of the frame height and must be < 0.5")

        token_file = text("RING_TOKEN_FILE")
        device_ids = tuple(d.strip() for d in (text("RING_DEVICE_IDS") or "").split(",") if d.strip())

        return cls(
            hub_url=(text("HUB_URL", "http://localhost:8787") or "").rstrip("/"),
            ingest_secret=text("INGEST_SECRET", "dev-ingest-secret") or "",
            household_id=text("HOUSEHOLD_ID", "hh-asha") or "",
            ring_api_base=(text("RING_API_BASE", DEFAULT_RING_API_BASE) or "").rstrip("/"),
            ring_oauth_url=text("RING_OAUTH_URL", DEFAULT_RING_OAUTH_URL) or DEFAULT_RING_OAUTH_URL,
            ring_token=text("RING_TOKEN"),
            ring_token_file=Path(token_file) if token_file else None,
            ring_client_id=text("RING_CLIENT_ID"),
            ring_client_secret=text("RING_CLIENT_SECRET"),
            ring_refresh_token=text("RING_REFRESH_TOKEN"),
            ring_device_ids=device_ids,
            ring_webhook_secret=text("RING_WEBHOOK_SECRET"),
            poll_seconds=number("POLL_SECONDS", 5.0, minimum=1.0),
            live_every_seconds=number("LIVE_EVERY_SECONDS", 20.0, minimum=5.0),
            person_cooldown_seconds=number("PERSON_COOLDOWN_SECONDS", 60.0),
            perception_mode=mode,
            perception_model_id=text("PERCEPTION_MODEL_ID", DEFAULT_MODEL_ID) or DEFAULT_MODEL_ID,
            aws_region=text("AWS_REGION") or text("AWS_DEFAULT_REGION") or "us-east-1",
            watermark_crop=crop,
            state_dir=Path(text("STATE_DIR", ".kinwise-data") or ".kinwise-data"),
        )


def aws_credentials_available(env: Mapping[str, str]) -> bool:
    """Cheap check for AWS credentials (no network: never touches instance metadata)."""
    if env.get("AWS_ACCESS_KEY_ID") or env.get("AWS_PROFILE"):
        return True
    if env.get("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI") or env.get("AWS_CONTAINER_CREDENTIALS_FULL_URI"):
        return True
    if env.get("AWS_WEB_IDENTITY_TOKEN_FILE"):
        return True
    home = Path.home() / ".aws"
    files = [
        Path(env["AWS_SHARED_CREDENTIALS_FILE"]) if env.get("AWS_SHARED_CREDENTIALS_FILE") else home / "credentials",
        Path(env["AWS_CONFIG_FILE"]) if env.get("AWS_CONFIG_FILE") else home / "config",
    ]
    return any(f.is_file() for f in files)


def ensure_state_dir(path: Path) -> Path:
    """Create the state directory with a catch-all .gitignore so nothing in it is ever committed."""
    path.mkdir(parents=True, exist_ok=True)
    ignore = path / ".gitignore"
    if not ignore.exists():
        ignore.write_text("# Kinwise worker state (seen ids, rotated tokens). Never commit.\n*\n", encoding="utf-8")
    return path
