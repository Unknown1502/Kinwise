"""Deterministic intent router: lets judges run the full demo without Bedrock access.

It is still a real MCP client: every answer comes from the Kinwise MCP server.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from .mcp_session import KinwiseMcp, text_of
from .models import AskRequest, AskResponse

WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
_NUMBER_WORDS = {"an": 1, "a": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "ten": 10,
                 "fifteen": 15, "twenty": 20, "thirty": 30, "forty five": 45, "ninety": 90}

_SCAM_WORDS = re.compile(
    r"\b(call(ed|er)?|phone|letter|text(ed)?|email|bank|ftc|irs|police|social security|gold|gift ?cards?|"
    r"bitcoin|crypto|courier|wire|warrant|compromised|legit|real|scam)\b",
    re.I,
)
_TIME = re.compile(r"\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?=\b|$)", re.I)
_RANGE = re.compile(
    r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|-|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b", re.I
)


@dataclass(frozen=True)
class Intent:
    tool: str | None
    args: dict[str, Any]


def _to_24h(hour: int, minute: int, meridiem: str | None, default_pm: bool = True) -> tuple[int, int]:
    m = (meridiem or "").lower().replace(".", "")
    if m == "pm" and hour < 12:
        hour += 12
    elif m == "am" and hour == 12:
        hour = 0
    elif not m and default_pm and 1 <= hour <= 7:
        hour += 12  # "at 2" for a reminder almost always means 2 PM
    return hour % 24, minute


def parse_reminder(text: str, now: datetime) -> tuple[str, datetime]:
    """'Remind me at 2 PM: courier from the bank…' → ('courier from the bank…', today 14:00)."""
    body = re.sub(r"^\s*(alexa[, ]+)?(please\s+)?remind me( to)?\s*", "", text, flags=re.I)
    when = now + timedelta(hours=1)
    match = _TIME.search(body)
    if match and (match.group(3) or match.group(2) or re.search(r"\bat\s+\d", body, re.I)):
        hour, minute = _to_24h(int(match.group(1)), int(match.group(2) or 0), match.group(3))
        when = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if when < now - timedelta(minutes=1):
            when += timedelta(days=1)
        body = (body[: match.start()] + body[match.end() :]).strip()
    if re.search(r"\btomorrow\b", body, re.I):
        when += timedelta(days=1) if when.date() == now.date() else timedelta(0)
        body = re.sub(r"\btomorrow\b", "", body, flags=re.I)
    body = re.sub(r"^[\s:,.-]+|[\s:,.-]+$", "", body)
    return (body or "your reminder"), when


def parse_visit(text: str, now: datetime) -> dict[str, Any] | None:
    """'Add Maria the nurse on Tuesday from 2 to 3 PM as an expected visitor' → tool args."""
    rng = _RANGE.search(text)
    if not rng:
        return None
    end_mer = rng.group(6)
    start_mer = rng.group(3) or end_mer
    sh, sm = _to_24h(int(rng.group(1)), int(rng.group(2) or 0), start_mer)
    eh, em = _to_24h(int(rng.group(4)), int(rng.group(5) or 0), end_mer)
    if (eh, em) <= (sh, sm):
        eh = (sh + 1) % 24
    weekday = next((d for d in WEEKDAYS if re.search(rf"\b{d}s?\b", text, re.I)), None)
    label_match = re.search(r"\badd\s+(.+?)\s+(?:on|every|from|at|this|next|tomorrow)\b", text, re.I)
    label = (label_match.group(1) if label_match else "Visitor").strip(" ,")
    label = re.sub(r"^(an?|the)\s+", "", label, flags=re.I)
    label = label[:1].upper() + label[1:]
    args: dict[str, Any] = {"label": label, "start": f"{sh:02d}:{sm:02d}", "end": f"{eh:02d}:{em:02d}"}
    if weekday and not re.search(r"\b(this|next)\b", text, re.I):
        args["weekday"] = weekday
    else:
        day = now.date() + (timedelta(days=1) if re.search(r"\btomorrow\b", text, re.I) else timedelta(0))
        if weekday:
            delta = (WEEKDAYS.index(weekday) - now.weekday()) % 7 or 7
            day = now.date() + timedelta(days=delta)
        args["date"] = day.isoformat()
    return args


def classify(persona: str, text: str, now: datetime) -> Intent:
    t = text.lower()
    if persona == "resident":
        if re.search(r"\bremind me\b", t):
            body, when = parse_reminder(text, now)
            return Intent("kinwise_add_reminder", {"text": body, "at": when.isoformat()})
        if re.search(r"\bprivacy\b", t):
            minutes = 60
            m = re.search(rf"(\d+|{'|'.join(_NUMBER_WORDS)})\s*(minutes?|mins?|hours?|hrs?)", t)
            if re.search(r"\bhalf an hour\b", t):
                minutes = 30
            elif m:
                n = int(m.group(1)) if m.group(1).isdigit() else _NUMBER_WORDS[m.group(1)]
                minutes = n * (60 if m.group(2).startswith("h") else 1)
            elif re.search(r"\b(stop|end|turn off)\b", t):
                minutes = 0
            return Intent("kinwise_set_privacy_hour", {"minutes": max(0, min(720, minutes))})
        if re.search(r"\bwhy\b.*\b(pause|alert|stop)", t):
            return Intent("kinwise_explain_last_alert", {})
        on_tv = re.search(r"\b(tv|television|telly)\b", t)
        if re.search(r"\b(messages?|notes?)\b", t) and (on_tv or re.search(r"\b(read|hear)\b", t)):
            return Intent("kinwise_read_on_tv", {"topic": "messages"})
        if on_tv and re.search(r"\b(today|day|plan|schedule)\b", t):
            return Intent("kinwise_read_on_tv", {"topic": "today"})
        if re.search(r"\b(call|ring|phone)\s+(priya|my daughter|family)\b", t):
            return Intent("call_family", {})
        if _SCAM_WORDS.search(t) and not re.search(r"\btoday\b.*\bhappening\b", t):
            return Intent("kinwise_check_call", {"description": text})
        if re.search(r"\b(today|schedule|happening|visitors?|who.*coming)\b", t):
            return Intent("kinwise_get_today", {})
    else:
        if re.search(r"\bsend\b.*\bmessage\b", t):
            msg = re.split(r"message\s*(?:to\s+\w+\s*)?[:,-]?\s*", text, maxsplit=1, flags=re.I)
            body = msg[1].strip() if len(msg) > 1 and msg[1].strip() else text
            return Intent("kinwise_send_family_message", {"text": body[:280]})
        if re.search(r"\bwhy\b.*\b(alert|pause)", t):
            return Intent("kinwise_explain_last_alert", {})
        if re.search(r"\b(add|expect)", t) and (args := parse_visit(text, now)):
            return Intent("kinwise_add_expected_visit", args)
        if re.search(r"\b(how|what).*(mom|day|going|doing|happened)", t):
            return Intent("kinwise_get_day_timeline", {})
        if re.search(r"\btoday\b", t):
            return Intent("kinwise_get_today", {})
    return Intent(None, {})


HELP = {
    "resident": "I can set reminders, give you a second opinion on a call, tell you who's expected today, give "
    "you some privacy time, or read your messages on the TV.",
    "caregiver": "I can tell you how your mom's day is going, explain an alert, add an expected visitor for her "
    "approval, or send a message to her TV.",
}


async def answer_offline(req: AskRequest, hub_mcp_url: str) -> AskResponse:
    now = datetime.now(ZoneInfo(req.timezone))
    intent = classify(req.persona, req.text, now)
    async with KinwiseMcp(hub_mcp_url, req.token) as mcp:
        if intent.tool is None:
            reply = HELP[req.persona]
        elif intent.tool == "call_family":
            today = await mcp.call("kinwise_get_today")
            alert = (today.get("structuredContent") or {}).get("activeAlert")
            if alert and alert.get("status") == "active":
                result = await mcp.call(
                    "kinwise_respond_to_alert", {"alertId": alert["id"], "action": "call_family"}
                )
                reply = text_of(result)
            else:
                reply = "I'll let Priya know you'd like to talk. In this simulation I can't place phone calls."
        else:
            result = await mcp.call(intent.tool, intent.args)
            reply = text_of(result) or "Done."
        return AskResponse(reply=reply, toolCalls=mcp.calls, sessionId=req.session_id, model="offline-router")
