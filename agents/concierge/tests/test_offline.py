from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from kinwise_concierge.brain import trim_history
from kinwise_concierge.mcp_session import ui_uri_from_meta
from kinwise_concierge.models import AskRequest, AskResponse, BadRequest, ToolCallRecord, mcp_result_to_wire
from kinwise_concierge.offline import classify, parse_reminder, parse_visit
from kinwise_concierge.prompts import system_prompt

NY = ZoneInfo("America/New_York")
NOW = datetime(2026, 10, 8, 10, 15, tzinfo=NY)  # Thursday


def test_reminder_parsing_pm_and_text():
    body, when = parse_reminder("Remind me at 2 PM: courier from the bank is picking up a package", NOW)
    assert body == "courier from the bank is picking up a package"
    assert when.hour == 14 and when.minute == 0 and when.date() == NOW.date()


def test_reminder_bare_hour_means_afternoon_and_past_times_roll_over():
    _, when = parse_reminder("remind me at 3 to call the pharmacy", NOW)
    assert when.hour == 15
    _, when = parse_reminder("remind me at 9:30 am to water plants", NOW)
    assert (when.hour, when.minute) == (9, 30) and when.day == 9


def test_reminder_without_time_defaults_to_one_hour():
    body, when = parse_reminder("Remind me to take my pills", NOW)
    assert body == "take my pills"
    assert when.hour == 11


@pytest.mark.parametrize(
    ("persona", "text", "tool"),
    [
        ("resident", "Remind me at 2 PM: courier from the bank", "kinwise_add_reminder"),
        ("resident", "A man from the FTC called and said a courier will come. Is that real?", "kinwise_check_call"),
        ("resident", "What's happening today?", "kinwise_get_today"),
        ("resident", "Why did my TV pause?", "kinwise_explain_last_alert"),
        ("resident", "Give me an hour of privacy", "kinwise_set_privacy_hour"),
        ("resident", "Call Priya", "call_family"),
        ("caregiver", "How's Mom's day going?", "kinwise_get_day_timeline"),
        ("caregiver", "Why did Kinwise alert?", "kinwise_explain_last_alert"),
        ("caregiver", "Send Mom a message: Dinner Sunday? ❤️", "kinwise_send_family_message"),
        ("caregiver", "Add Maria the nurse on Tuesday from 2 to 3 PM as an expected visitor", "kinwise_add_expected_visit"),
        ("resident", "tell me a joke", None),
    ],
)
def test_intents(persona, text, tool):
    assert classify(persona, text, NOW).tool == tool


def test_privacy_minutes():
    assert classify("resident", "privacy for 30 minutes", NOW).args == {"minutes": 30}
    assert classify("resident", "give me two hours of privacy", NOW).args == {"minutes": 120}
    assert classify("resident", "Give me an hour of privacy", NOW).args == {"minutes": 60}
    assert classify("resident", "privacy for half an hour", NOW).args == {"minutes": 30}
    assert classify("resident", "stop privacy time", NOW).args == {"minutes": 0}


def test_family_message_body():
    intent = classify("caregiver", "Send Mom a message: Dinner Sunday? ❤️", NOW)
    assert intent.args == {"text": "Dinner Sunday? ❤️"}


def test_visit_parsing_weekly_and_one_off():
    assert parse_visit("Add Maria the nurse on Tuesday from 2 to 3 PM as an expected visitor", NOW) == {
        "label": "Maria the nurse",
        "start": "14:00",
        "end": "15:00",
        "weekday": "tuesday",
    }
    one_off = parse_visit("Add the plumber tomorrow 10am to 11am", NOW)
    assert one_off == {"label": "Plumber", "start": "10:00", "end": "11:00", "date": "2026-10-09"}
    assert parse_visit("add someone sometime", NOW) is None


def test_request_validation():
    ok = AskRequest.parse({"persona": "resident", "text": " hi ", "token": "t", "sessionId": "s", "householdTimezone": "UTC"})
    assert ok.text == "hi" and ok.timezone == "UTC"
    for bad in ({}, {"persona": "x", "text": "a", "token": "t"}, {"persona": "resident", "text": "", "token": "t"},
                {"persona": "resident", "text": "a"}):
        with pytest.raises(BadRequest):
            AskRequest.parse(bad)


def test_result_normalisation_and_response_shape():
    wire = mcp_result_to_wire({"status": "error", "content": [{"text": "nope"}], "structuredContent": {"a": 1}})
    assert wire == {"content": [{"type": "text", "text": "nope"}], "structuredContent": {"a": 1}, "isError": True}
    out = AskResponse(reply="hi", toolCalls=[ToolCallRecord(name="x", arguments={}, result={})], sessionId="s").to_dict()
    assert "uiResourceUri" not in out["toolCalls"][0]
    assert set(out) == {"reply", "toolCalls", "sessionId", "model", "latencyMs"}


def test_ui_meta_both_forms():
    assert ui_uri_from_meta({"ui": {"resourceUri": "ui://kinwise/pause"}}) == "ui://kinwise/pause"
    assert ui_uri_from_meta({"ui/resourceUri": "ui://kinwise/today"}) == "ui://kinwise/today"
    assert ui_uri_from_meta(None) is None


def test_history_trim_starts_at_user_text():
    msgs = [
        {"role": "user", "content": [{"text": "a"}]},
        {"role": "assistant", "content": [{"toolUse": {}}]},
        {"role": "user", "content": [{"toolResult": {}}]},
        {"role": "assistant", "content": [{"text": "b"}]},
        {"role": "user", "content": [{"text": "c"}]},
        {"role": "assistant", "content": [{"text": "d"}]},
    ]
    assert trim_history(msgs, 4) == msgs[4:]
    assert trim_history(msgs, 6) == msgs


def test_system_prompt_has_local_time_and_persona_rules():
    p = system_prompt("resident", "America/New_York", NOW)
    assert "2026-10-08T10:15:00-04:00" in p and "Thursday" in p
    assert "kinwise_check_call" in p
    assert "kinwise_get_day_timeline" in system_prompt("caregiver", "America/New_York", NOW)


def test_hub_url_validation():
    base = {"persona": "resident", "text": "hi", "token": "t"}
    assert AskRequest.parse({**base, "hubMcpUrl": "https://abc.execute-api.us-east-1.amazonaws.com/mcp"}).hub_mcp_url
    assert AskRequest.parse({**base, "hubMcpUrl": "http://localhost:8787/mcp"}).hub_mcp_url == "http://localhost:8787/mcp"
    assert AskRequest.parse(base).hub_mcp_url is None
    for bad in ("http://evil.example/mcp", "https://evil.example/steal", "ftp://localhost/mcp", "https://evil.example/mcp"):
        with pytest.raises(BadRequest):
            AskRequest.parse({**base, "hubMcpUrl": bad})


def test_hub_url_allowlist(monkeypatch):
    base = {"persona": "resident", "text": "hi", "token": "t", "hubMcpUrl": "https://hub.kinwise.app/mcp"}
    with pytest.raises(BadRequest):
        AskRequest.parse(base)
    monkeypatch.setenv("ALLOWED_HUB_HOSTS", "kinwise.app")
    assert AskRequest.parse(base).hub_mcp_url == "https://hub.kinwise.app/mcp"
