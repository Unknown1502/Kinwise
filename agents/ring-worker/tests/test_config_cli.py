from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest
import respx

from kinwise_ring import cli
from kinwise_ring.config import ConfigError, Settings, aws_credentials_available
from kinwise_ring.hub_client import sign_body
from kinwise_ring.simulate import build_demo_event

from .conftest import make_jpeg

NO_AWS = {"AWS_SHARED_CREDENTIALS_FILE": "/nonexistent/creds", "AWS_CONFIG_FILE": "/nonexistent/config"}


def test_defaults():
    s = Settings.from_env(dict(NO_AWS))
    assert s.hub_url == "http://localhost:8787"
    assert s.ingest_secret == "dev-ingest-secret"
    assert s.household_id == "hh-asha"
    assert s.ring_api_base == "https://api.amazonvision.com"
    assert (s.poll_seconds, s.live_every_seconds, s.person_cooldown_seconds) == (5.0, 20.0, 60.0)
    assert s.perception_mode == "offline"
    assert s.perception_model_id == "us.amazon.nova-2-lite-v1:0"
    assert s.aws_region == "us-east-1"
    assert s.watermark_crop == 0.15
    assert s.state_dir == Path(".kinwise-data")
    assert not s.has_ring_credentials


def test_values_from_env():
    s = Settings.from_env(
        {
            **NO_AWS,
            "HUB_URL": "http://hub:9000/",
            "RING_DEVICE_IDS": " d1, d2 ,,",
            "RING_TOKEN_FILE": "ring-token.txt",
            "POLL_SECONDS": "2.5",
            "PERCEPTION_MODE": "BEDROCK",
            "WATERMARK_CROP": "0.2",
            "AWS_REGION": "us-west-2",
        }
    )
    assert s.hub_url == "http://hub:9000"
    assert s.ring_device_ids == ("d1", "d2")
    assert s.ring_token_file == Path("ring-token.txt") and s.uses_playground_token
    assert s.poll_seconds == 2.5
    assert s.perception_mode == "bedrock"
    assert s.watermark_crop == 0.2
    assert s.aws_region == "us-west-2"


def test_perception_mode_defaults_to_bedrock_with_aws_credentials():
    assert Settings.from_env({**NO_AWS, "AWS_ACCESS_KEY_ID": "AKIA..."}).perception_mode == "bedrock"
    assert aws_credentials_available({**NO_AWS, "AWS_PROFILE": "dev"})
    assert not aws_credentials_available(NO_AWS)


@pytest.mark.parametrize(
    "env",
    [{"POLL_SECONDS": "fast"}, {"POLL_SECONDS": "0.1"}, {"PERCEPTION_MODE": "magic"}, {"WATERMARK_CROP": "0.7"}],
)
def test_invalid_values(env):
    with pytest.raises(ConfigError):
        Settings.from_env({**NO_AWS, **env})


def test_demo_event_shapes():
    person = build_demo_event("hh-asha", carrying="a small box")
    assert person.source == "demo" and person.ring_event_type == "button_press"
    assert person.event_id.startswith("demo-")
    assert person.perception.description == "A person at the front door holding a small box"
    nobody = build_demo_event("hh-asha", person=False, carrying="ignored")
    assert nobody.perception.person_present is False and nobody.perception.carrying is None
    assert nobody.perception.people_count == 0


@pytest.fixture
def clean_env(monkeypatch, tmp_path):
    for key in ("RING_TOKEN", "RING_TOKEN_FILE", "RING_CLIENT_ID", "RING_CLIENT_SECRET", "RING_REFRESH_TOKEN"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("HUB_URL", "http://hub.test")
    monkeypatch.setenv("INGEST_SECRET", "s3cret")
    monkeypatch.setenv("PERCEPTION_MODE", "offline")
    monkeypatch.setenv("STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("RING_API_BASE", "https://api.amazonvision.com")
    return tmp_path


@respx.mock
def test_cli_simulate_posts_a_signed_demo_event(clean_env, capsys):
    route = respx.post("http://hub.test/events/visitor").mock(
        return_value=httpx.Response(200, json={"duplicate": False, "decision": "gentle", "alertId": "a1"})
    )
    code = cli.main(["--env-file", str(clean_env / "none.env"), "simulate", "--carrying", "a small box"])
    assert code == 0
    request = route.calls.last.request
    assert request.headers["x-kinwise-signature"] == sign_body("s3cret", request.content)
    body = json.loads(request.content)
    assert body["source"] == "demo" and body["householdId"] == "hh-asha"
    assert body["perception"]["carrying"] == "a small box"
    out = json.loads(capsys.readouterr().out)
    assert out["hub"]["alertId"] == "a1"


@respx.mock
def test_cli_simulate_no_person(clean_env):
    route = respx.post("http://hub.test/events/visitor").mock(
        return_value=httpx.Response(200, json={"duplicate": False, "decision": "activity"})
    )
    assert cli.main(["--env-file", "none.env", "simulate", "--no-person"]) == 0
    assert json.loads(route.calls.last.request.content)["perception"]["personPresent"] is False


@respx.mock
def test_cli_devices(clean_env, monkeypatch, capsys):
    monkeypatch.setenv("RING_TOKEN", "playground-token")
    route = respx.get("https://api.amazonvision.com/v1/devices").mock(
        return_value=httpx.Response(200, json={"data": [{"id": "d1", "attributes": {"name": "Front Door"}}]})
    )
    assert cli.main(["--env-file", "none.env", "devices", "--json"]) == 0
    assert route.calls.last.request.headers["authorization"] == "Bearer playground-token"
    assert json.loads(capsys.readouterr().out) == [{"id": "d1", "name": "Front Door", "kind": None, "online": None}]


def test_cli_without_ring_credentials_fails_cleanly(clean_env, capsys):
    assert cli.main(["--env-file", "none.env", "devices"]) == 1
    assert "No Ring credentials" in capsys.readouterr().err


@respx.mock
def test_cli_snapshot_warns_and_writes_only_where_asked(clean_env, monkeypatch, capsys):
    monkeypatch.setenv("RING_TOKEN", "playground-token")
    jpeg = make_jpeg()
    respx.post("https://api.amazonvision.com/v1/devices/d1/media/image/download").mock(
        return_value=httpx.Response(200, content=jpeg, headers={"content-type": "image/jpeg"})
    )
    out = clean_env / "captures" / "front.jpg"
    assert cli.main(["--env-file", "none.env", "snapshot", "d1", "--out", str(out), "--method", "stored"]) == 0
    assert out.read_bytes() == jpeg
    assert "PRIVACY WARNING" in capsys.readouterr().err


@respx.mock
def test_cli_poll_once(clean_env, monkeypatch, capsys):
    monkeypatch.setenv("RING_TOKEN", "playground-token")
    monkeypatch.setenv("RING_DEVICE_IDS", "d1")
    respx.get("https://api.amazonvision.com/v1/history/devices/d1/events").mock(
        return_value=httpx.Response(200, json={"data": []})
    )
    assert cli.main(["--env-file", "none.env", "poll", "--once"]) == 0
    assert json.loads(capsys.readouterr().out)["delivered"] == 0
    assert (clean_env / "state" / "ring-seen.json").exists()
