from __future__ import annotations

import json

import pytest

from kinwise_ring.perception import (
    SYSTEM_PROMPT,
    BedrockPerception,
    OfflinePerception,
    Perception,
    PerceptionParseError,
    build_perception,
    is_neutral,
    parse_perception_json,
)

from .conftest import make_jpeg

GOOD = {"person_present": True, "people_count": 1, "carrying": "a small box", "description": "A person at the door"}


def test_plain_json():
    p = parse_perception_json(json.dumps(GOOD))
    assert p == Perception(True, 1, "a small box", "A person at the door")


def test_fenced_json():
    text = "```json\n" + json.dumps(GOOD, indent=2) + "\n```"
    assert parse_perception_json(text).carrying == "a small box"


def test_json_inside_prose_with_braces_in_strings():
    obj = dict(GOOD, description="A person at the door {holding} a box")
    text = "Sure! Here is the analysis: " + json.dumps(obj) + " Hope that helps {not json}."
    assert parse_perception_json(text).description == "A person at the door {holding} a box"


def test_camel_case_keys_are_accepted():
    text = '{"personPresent": false, "peopleCount": 0, "carrying": null, "description": "An empty porch"}'
    assert parse_perception_json(text) == Perception(False, 0, None, "An empty porch")


@pytest.mark.parametrize(
    "patch",
    [
        {"person_present": "yes"},
        {"person_present": None},
        {"people_count": "two"},
        {"people_count": 1.5},
        {"people_count": True},
        {"carrying": 5},
        {"description": ""},
        {"description": None},
        {"description": ["A person"]},
    ],
)
def test_invalid_types_raise(patch):
    with pytest.raises(PerceptionParseError):
        parse_perception_json(json.dumps(dict(GOOD, **patch)))


@pytest.mark.parametrize("text", ["", "   ", "no json here", "{broken", "[1, 2, 3]", "{'single': 'quotes'}"])
def test_garbage_raises(text):
    with pytest.raises(PerceptionParseError):
        parse_perception_json(text)


def test_counts_are_clamped_and_made_consistent():
    assert parse_perception_json(json.dumps(dict(GOOD, people_count=42))).people_count == 10
    assert parse_perception_json(json.dumps(dict(GOOD, people_count=0))).people_count == 1
    assert parse_perception_json(json.dumps(dict(GOOD, people_count=2.0))).people_count == 2
    absent = parse_perception_json(json.dumps(dict(GOOD, person_present=False, people_count=3)))
    assert (absent.people_count, absent.carrying) == (0, None)


def test_description_is_one_line_and_truncated():
    long = "A person at the front door " + "with a parcel " * 20
    p = parse_perception_json(json.dumps(dict(GOOD, description="  A person\n at the door  ")))
    assert p.description == "A person at the door"
    assert len(parse_perception_json(json.dumps(dict(GOOD, description=long))).description) <= 140


@pytest.mark.parametrize("carrying", ["none", "Nothing", "", "N/A", "null"])
def test_empty_carrying_becomes_none(carrying):
    assert parse_perception_json(json.dumps(dict(GOOD, carrying=carrying))).carrying is None


@pytest.mark.parametrize(
    "description",
    [
        "An elderly man holding a box",
        "A young woman at the door",
        "A person wearing a delivery uniform",
        "A suspicious person near the door",
        "A courier with a parcel",
        "She is holding a box",
        "A black person at the door",
        "A delivery person at the door",
    ],
)
def test_non_neutral_descriptions_are_replaced(description):
    p = parse_perception_json(json.dumps(dict(GOOD, description=description)))
    assert p.description == "A person at the front door holding a small box"
    assert is_neutral(p.description)


def test_neutral_descriptions_are_kept():
    for text in ("A person at the front door holding a small box", "Two people on the porch", "A package by the door"):
        assert is_neutral(text), text


def test_non_neutral_carrying_is_dropped():
    p = parse_perception_json(json.dumps(dict(GOOD, carrying="a man's bag")))
    assert p.carrying is None


@pytest.mark.parametrize(
    "event_type, sub_type, expected",
    [
        ("button_press", None, Perception(True, 1, None, "A person rang the doorbell")),
        ("motion_detected", "human", Perception(True, 1, None, "A person at the front door")),
        ("motion_detected", "vehicle", Perception(False, 0, None, "A vehicle in the driveway")),
        ("motion_detected", "package", Perception(False, 0, None, "A package at the front door")),
        ("motion_detected", None, Perception(False, 0, None, "Motion at the front door")),
        ("on_demand", None, Perception(False, 0, None, "Motion at the front door")),
    ],
)
async def test_offline_perception_mapping(event_type, sub_type, expected):
    assert await OfflinePerception().analyze(make_jpeg(), event_type=event_type, sub_type=sub_type) == expected


class FakeBedrock:
    def __init__(self, text: str | None = None, error: Exception | None = None) -> None:
        self.text = text
        self.error = error
        self.requests: list[dict] = []

    def converse(self, **kwargs):
        self.requests.append(kwargs)
        if self.error:
            raise self.error
        return {
            "output": {"message": {"role": "assistant", "content": [{"text": self.text}]}},
            "stopReason": "end_turn",
        }


async def test_bedrock_perception_builds_a_converse_request_and_parses():
    fake = FakeBedrock("```json\n" + json.dumps(GOOD) + "\n```")
    engine = BedrockPerception("us.amazon.nova-2-lite-v1:0", client=fake)
    jpeg = make_jpeg()
    result = await engine.analyze(jpeg, event_type="on_demand")
    assert result == Perception(True, 1, "a small box", "A person at the door")
    (request,) = fake.requests
    assert request["modelId"] == "us.amazon.nova-2-lite-v1:0"
    image_block, text_block = request["messages"][0]["content"]
    assert image_block == {"image": {"format": "jpeg", "source": {"bytes": jpeg}}}
    assert "JSON" in text_block["text"]
    assert request["system"][0]["text"] == SYSTEM_PROMPT
    assert "Never identify anyone" in SYSTEM_PROMPT and "gender" in SYSTEM_PROMPT


async def test_bedrock_garbage_falls_back_to_event_heuristic():
    engine = BedrockPerception("m", client=FakeBedrock("I cannot help with that."))
    result = await engine.analyze(make_jpeg(), event_type="motion_detected", sub_type="vehicle")
    assert result == Perception(False, 0, None, "A vehicle in the driveway")


async def test_bedrock_errors_fall_back_to_event_heuristic():
    engine = BedrockPerception("m", client=FakeBedrock(error=RuntimeError("AccessDenied")))
    result = await engine.analyze(make_jpeg(), event_type="button_press")
    assert result.person_present is True


async def test_bedrock_without_image_does_not_call_the_model():
    fake = FakeBedrock(json.dumps(GOOD))
    result = await BedrockPerception("m", client=fake).analyze(None, event_type="motion_detected", sub_type="human")
    assert fake.requests == []
    assert result.description == "A person at the front door"


async def test_doorbell_press_overrides_an_empty_frame():
    nobody = json.dumps({"person_present": False, "people_count": 0, "carrying": None, "description": "An empty porch"})
    engine = BedrockPerception("m", client=FakeBedrock(nobody))
    pressed = await engine.analyze(make_jpeg(), event_type="button_press")
    assert pressed.person_present is True and pressed.people_count == 1
    live = await engine.analyze(make_jpeg(), event_type="on_demand")
    assert live.person_present is False


def test_to_hub_and_build_perception():
    assert Perception(True, 2, None, "Two people").to_hub() == {
        "personPresent": True,
        "peopleCount": 2,
        "description": "Two people",
    }
    assert isinstance(build_perception("offline", "m", "us-east-1"), OfflinePerception)
    assert isinstance(build_perception("bedrock", "m", "us-east-1"), BedrockPerception)
