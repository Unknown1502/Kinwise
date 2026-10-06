"""`kinwise-ring` command line: devices · poll · live · webhook · simulate · snapshot."""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from .config import ConfigError, Settings, ensure_state_dir
from .errors import HubError, RingApiError
from .frames import FrameGrabError

log = logging.getLogger("kinwise_ring")

SNAPSHOT_WARNING = (
    "PRIVACY WARNING: `snapshot` is a developer tool. It writes a camera frame to disk, which the\n"
    "worker never does in normal operation. Keep it out of git (captures/ and frames/ are ignored),\n"
    "do not share it, and delete it when you are done."
)


def configure_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    for noisy in ("httpx", "httpcore", "aioice", "aiortc", "botocore", "boto3", "urllib3"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def _describe(settings: Settings) -> str:
    ring = "oauth" if settings.uses_oauth else "playground-token" if settings.uses_playground_token else "none"
    perception = settings.perception_mode
    if perception == "bedrock":
        perception += f" ({settings.perception_model_id}, {settings.aws_region})"
    return f"hub={settings.hub_url} household={settings.household_id} ring={ring} perception={perception}"


def _wire(settings: Settings) -> tuple[Any, Any, Any]:
    from .browser_frames import make_grabber
    from .hub_client import HubClient
    from .perception import build_perception
    from .pipeline import VisitorPipeline
    from .ring_api import RingClient
    from .tokens import build_token_provider

    ring = RingClient(build_token_provider(settings), settings.ring_api_base)
    hub = HubClient(settings.hub_url, settings.ingest_secret)
    pipeline = VisitorPipeline(
        household_id=settings.household_id,
        hub=hub,
        perception=build_perception(settings.perception_mode, settings.perception_model_id, settings.aws_region),
        grabber=make_grabber(ring, settings),
        watermark_crop=settings.watermark_crop,
    )
    return ring, hub, pipeline


async def cmd_devices(settings: Settings, args: argparse.Namespace) -> int:
    from .ring_api import RingClient
    from .tokens import build_token_provider

    async with RingClient(build_token_provider(settings), settings.ring_api_base) as ring:
        devices = await ring.list_devices()
    if args.json:
        print(json.dumps([{"id": d.id, "name": d.name, "kind": d.kind, "online": d.online} for d in devices], indent=2))
        return 0
    if not devices:
        print("No Ring devices are visible to this token.")
        return 0
    for d in devices:
        online = "online" if d.online else "offline" if d.online is False else "status?"
        print(f"{d.id}\t{d.name}\t{d.kind or '-'}\t{online}")
    return 0


async def cmd_poll(settings: Settings, args: argparse.Namespace) -> int:
    from .poller import EventPoller, SeenStore, resolve_device_ids

    log.info("poll mode: %s", _describe(settings))
    ring, hub, pipeline = _wire(settings)
    try:
        device_ids = await resolve_device_ids(ring, settings.ring_device_ids)
        store = SeenStore(ensure_state_dir(settings.state_dir) / "ring-seen.json")
        poller = EventPoller(ring, pipeline, store, device_ids, poll_seconds=settings.poll_seconds)
        if args.once:
            results = await poller.poll_once()
            print(json.dumps({"delivered": len(results), "results": results}))
        else:
            await poller.run(asyncio.Event())
    finally:
        await ring.aclose()
        await hub.aclose()
    return 0


async def cmd_live(settings: Settings, args: argparse.Namespace) -> int:
    from .poller import LiveWatcher, resolve_device_ids

    log.info("live mode: %s", _describe(settings))
    if settings.perception_mode != "bedrock":
        log.warning("PERCEPTION_MODE=offline cannot see people in a frame; live mode will report nobody. Use bedrock.")
    ring, hub, pipeline = _wire(settings)
    try:
        device_ids = await resolve_device_ids(ring, settings.ring_device_ids)
        watcher = LiveWatcher(
            pipeline,
            device_ids,
            every_seconds=settings.live_every_seconds,
            cooldown_seconds=settings.person_cooldown_seconds,
        )
        if args.once:
            results = await watcher.tick()
            print(json.dumps({"delivered": len(results), "results": results}))
        else:
            await watcher.run(asyncio.Event())
    finally:
        await ring.aclose()
        await hub.aclose()
    return 0


def cmd_webhook(settings: Settings, args: argparse.Namespace) -> int:
    import uvicorn

    from .webhook import build_app_from_settings

    log.info("webhook mode on %s:%d: %s", args.host, args.port, _describe(settings))
    uvicorn.run(build_app_from_settings(settings), host=args.host, port=args.port, log_level="info")
    return 0


async def cmd_simulate(settings: Settings, args: argparse.Namespace) -> int:
    from .hub_client import HubClient
    from .simulate import build_demo_event

    event = build_demo_event(
        settings.household_id,
        person=args.person,
        description=args.description,
        carrying=args.carrying,
        device_id=args.device_id,
        people_count=args.count,
    )
    hub = HubClient(settings.hub_url, settings.ingest_secret)
    try:
        result = await hub.post_visitor(event)
    finally:
        await hub.aclose()
    print(json.dumps({"eventId": event.event_id, "perception": event.perception.to_hub(), "hub": result}, indent=2))
    return 0


async def _fetch_snapshot(settings: Settings, device_id: str, method: str) -> bytes | None:
    from .browser_frames import make_grabber
    from .errors import RingApiError
    from .ring_api import RingClient
    from .tokens import build_token_provider

    data: bytes | None = None
    async with RingClient(build_token_provider(settings), settings.ring_api_base) as ring:
        if method in ("auto", "stored"):
            try:
                data = await ring.download_image(device_id)
            except RingApiError as err:
                # The real Playground answers 403 "Cannot authorize: empty request body" (verified 2026-10-06).
                if method == "stored":
                    raise
                log.info("stored image unavailable (%s); using live view", err)
            if data is None:
                log.info("no stored image; using live view")
        if data is None and method in ("auto", "live"):
            data = await make_grabber(ring, settings).grab_jpeg(device_id)
    return data


def cmd_snapshot(settings: Settings, args: argparse.Namespace) -> int:
    print(SNAPSHOT_WARNING, file=sys.stderr)
    out = Path(args.out)
    if not {"captures", "frames"} & {p.lower() for p in out.resolve().parent.parts}:
        print("Note: consider writing under captures/ (git-ignored).", file=sys.stderr)
    data = asyncio.run(_fetch_snapshot(settings, args.device_id, args.method))
    if not data:
        print("No image available.", file=sys.stderr)
        return 1
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)
    print(f"wrote {len(data)} bytes to {out}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="kinwise-ring",
        description="Kinwise Ring worker: Ring Partner API activity -> neutral visitor events for the Kinwise hub.",
    )
    parser.add_argument("--env-file", default=".env", help="dotenv file to load (default: .env)")
    parser.add_argument("-v", "--verbose", action="store_true", help="debug logging")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("devices", help="list the Ring devices visible to the token")
    p.add_argument("--json", action="store_true", help="print JSON")
    p.set_defaults(func=cmd_devices)

    p = sub.add_parser("poll", help="poll event history and report new visitor events")
    p.add_argument("--once", action="store_true", help="poll once and exit")
    p.set_defaults(func=cmd_poll)

    p = sub.add_parser("live", help="periodically grab a live-view frame (Playground demo mode)")
    p.add_argument("--once", action="store_true", help="check each device once and exit")
    p.set_defaults(func=cmd_live)

    p = sub.add_parser("webhook", help="run the Ring webhook receiver")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8090)
    p.set_defaults(func=cmd_webhook)

    p = sub.add_parser("simulate", help="send a scripted visitor event to the hub (no Ring)")
    p.add_argument("--person", dest="person", action="store_true", default=True, help="a person is present (default)")
    p.add_argument("--no-person", dest="person", action="store_false", help="no person (activity only)")
    p.add_argument("--description", help="neutral one-sentence description")
    p.add_argument("--carrying", help='carried object, e.g. "a small box"')
    p.add_argument("--count", type=int, default=None, help="people count (default 1 with --person)")
    p.add_argument("--device-id", default="demo-front-door")
    p.set_defaults(func=cmd_simulate)

    p = sub.add_parser("snapshot", help="DEV ONLY: save one frame to disk (prints a privacy warning)")
    p.add_argument("device_id")
    p.add_argument("--out", required=True, help="output file, e.g. captures/front.jpg")
    p.add_argument("--method", choices=("auto", "stored", "live"), default="auto")
    p.set_defaults(func=cmd_snapshot)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        # Never crash on a non-ASCII device name when output is redirected on Windows (cp1252).
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(errors="backslashreplace")
    args = build_parser().parse_args(argv)
    configure_logging(args.verbose)
    try:
        settings = Settings.from_env(env_file=args.env_file)
        result = args.func(settings, args)
        if asyncio.iscoroutine(result):
            result = asyncio.run(result)
        return int(result or 0)
    except KeyboardInterrupt:
        log.info("stopped")
        return 0
    except (ConfigError, RingApiError, HubError, FrameGrabError, RuntimeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
