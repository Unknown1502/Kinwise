"""Grab one still frame from a Ring camera over a WHEP live-view session.

Flow: create a receive-only WebRTC peer → POST the SDP offer to Ring (WHEP) → apply
the SDP answer → wait for the first decodable video frame → JPEG in memory → always
close the peer and DELETE the WHEP session.

Privacy: the frame only ever exists in memory. Nothing here writes to disk or logs
image bytes; audio (if the server insists on an audio m-line) is never read.

The aiortc-specific code lives in `AiortcPeerSession` behind the small `PeerSession`
protocol, and aiortc is imported lazily, so the rest of the worker (and the tests)
run without touching WebRTC.
"""

from __future__ import annotations

import asyncio
import io
import logging
from collections.abc import Awaitable, Callable
from typing import Any, Literal, Protocol

from PIL import Image

from .errors import RingApiError

log = logging.getLogger(__name__)

AudioPolicy = Literal["auto", "always", "never"]
# Statuses that suggest the WHEP server wants an audio m-line in the offer.
AUDIO_RETRY_STATUSES = frozenset({400, 406, 409, 415, 422, 488})


class FrameGrabError(RuntimeError):
    """No usable frame could be obtained."""


class PeerSession(Protocol):
    async def create_offer(self) -> str: ...

    async def set_answer(self, sdp: str) -> None: ...

    async def first_frame(self) -> Image.Image: ...

    async def close(self) -> None: ...


class WhepApi(Protocol):
    async def create_whep_session(self, device_id: str, sdp_offer: str) -> tuple[str, str | None]: ...

    async def delete_whep_session(self, session_url: str) -> None: ...


PeerFactory = Callable[[bool], PeerSession]


def image_to_jpeg(image: Image.Image, max_width: int = 1280, quality: int = 85) -> bytes:
    """Encode a PIL image as JPEG, downscaled to at most `max_width` pixels wide."""
    if image.mode != "RGB":
        image = image.convert("RGB")
    if max_width and image.width > max_width:
        height = max(1, round(image.height * max_width / image.width))
        image = image.resize((max_width, height), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    image.save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


def crop_watermark(jpeg_bytes: bytes, fraction: float = 0.15, quality: int = 90) -> bytes:
    """Drop the top `fraction` of the frame (Ring's mandatory watermark band) before analysis.

    Only used on the copy sent to the vision model; anything displayed keeps the watermark.
    """
    if fraction <= 0:
        return jpeg_bytes
    fraction = min(fraction, 0.5)
    with Image.open(io.BytesIO(jpeg_bytes)) as img:
        img.load()
        top = round(img.height * fraction)
        if top <= 0 or top >= img.height:
            return jpeg_bytes
        cropped = img.convert("RGB").crop((0, top, img.width, img.height))
    buf = io.BytesIO()
    cropped.save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


async def _quietly(awaitable: Awaitable[Any], what: str, timeout_s: float = 5.0) -> None:
    try:
        await asyncio.wait_for(awaitable, timeout_s)
    except Exception as exc:  # cleanup must never mask the real outcome
        log.warning("%s failed: %s", what, exc.__class__.__name__)


class FrameGrabber:
    def __init__(
        self,
        client: WhepApi,
        *,
        peer_factory: PeerFactory | None = None,
        frame_timeout_s: float = 12.0,
        setup_timeout_s: float = 15.0,
        max_width: int = 1280,
        audio: AudioPolicy = "auto",
    ) -> None:
        self._client = client
        self._peer_factory = peer_factory or default_peer_factory
        self._frame_timeout = frame_timeout_s
        self._setup_timeout = setup_timeout_s
        self._max_width = max_width
        self._audio = audio
        self._needs_audio: dict[str, bool] = {}

    async def grab_jpeg(self, device_id: str) -> bytes:
        """One JPEG frame from `device_id`'s live view. Raises FrameGrabError / RingApiError."""
        with_audio = self._audio == "always" or self._needs_audio.get(device_id, False)
        try:
            return await self._attempt(device_id, with_audio)
        except RingApiError as exc:
            if self._audio == "auto" and not with_audio and exc.status in AUDIO_RETRY_STATUSES:
                log.info("WHEP offer rejected (%s); retrying with a receive-only audio m-line", exc.status)
                self._needs_audio[device_id] = True
                return await self._attempt(device_id, True)
            raise

    async def _attempt(self, device_id: str, with_audio: bool) -> bytes:
        peer = self._peer_factory(with_audio)
        session_url: str | None = None
        try:
            try:
                offer = await asyncio.wait_for(peer.create_offer(), self._setup_timeout)
            except TimeoutError as exc:
                raise FrameGrabError("ICE gathering did not complete in time") from exc
            answer, session_url = await self._client.create_whep_session(device_id, offer)
            try:
                await asyncio.wait_for(peer.set_answer(answer), self._setup_timeout)
            except (TimeoutError, ValueError) as exc:
                raise FrameGrabError(f"could not apply the WHEP answer ({exc.__class__.__name__})") from exc
            try:
                image = await asyncio.wait_for(peer.first_frame(), self._frame_timeout)
            except TimeoutError as exc:
                raise FrameGrabError(f"no video frame within {self._frame_timeout:.0f}s") from exc
            jpeg = image_to_jpeg(image, self._max_width)
            log.info("frame grabbed from %s (%dx%d)", device_id, image.width, image.height)
            return jpeg
        finally:
            await _quietly(peer.close(), "closing the peer connection")
            if session_url:
                await _quietly(self._client.delete_whep_session(session_url), "deleting the WHEP session")


class AiortcPeerSession:
    """Receive-only aiortc peer connection (video, plus audio only if required)."""

    def __init__(self, with_audio: bool = False, ice_servers: list[str] | None = None) -> None:
        try:
            from aiortc import RTCConfiguration, RTCIceServer, RTCPeerConnection
        except ImportError as exc:  # pragma: no cover - depends on the platform's wheels
            raise FrameGrabError("aiortc is not installed; live-view frame grabs are unavailable") from exc
        config = None
        if ice_servers is not None:
            config = RTCConfiguration(iceServers=[RTCIceServer(urls=url) for url in ice_servers])
        self._pc = RTCPeerConnection(configuration=config)
        self._pc.addTransceiver("video", direction="recvonly")
        if with_audio:
            self._pc.addTransceiver("audio", direction="recvonly")
        loop = asyncio.get_running_loop()
        self._video_track: asyncio.Future[Any] = loop.create_future()
        self._failure: asyncio.Future[None] = loop.create_future()
        self._gathered = asyncio.Event()

        @self._pc.on("icegatheringstatechange")
        def _on_gathering() -> None:
            if self._pc.iceGatheringState == "complete":
                self._gathered.set()

        @self._pc.on("track")
        def _on_track(track: Any) -> None:
            # Audio tracks are deliberately never read.
            if track.kind == "video" and not self._video_track.done():
                self._video_track.set_result(track)

        @self._pc.on("connectionstatechange")
        def _on_state() -> None:
            if self._pc.connectionState == "failed" and not self._failure.done():
                self._failure.set_exception(FrameGrabError("WebRTC connection failed"))

    async def create_offer(self) -> str:
        offer = await self._pc.createOffer()
        await self._pc.setLocalDescription(offer)  # aiortc gathers ICE candidates here (no trickle)
        if self._pc.iceGatheringState != "complete":
            await self._gathered.wait()
        return self._pc.localDescription.sdp

    async def set_answer(self, sdp: str) -> None:
        from aiortc import RTCSessionDescription

        await self._pc.setRemoteDescription(RTCSessionDescription(sdp=sdp, type="answer"))

    async def first_frame(self) -> Image.Image:
        track = await self._race(self._video_track)
        while True:
            frame = await self._race(track.recv())
            try:
                image = frame.to_image()
            except Exception as exc:  # not decodable yet (e.g. waiting for a keyframe)
                log.debug("skipping an undecodable frame (%s)", exc.__class__.__name__)
                continue
            if image.width and image.height:
                return image

    async def _race(self, awaitable: Awaitable[Any]) -> Any:
        task = asyncio.ensure_future(awaitable)
        done, _ = await asyncio.wait({task, self._failure}, return_when=asyncio.FIRST_COMPLETED)
        if task in done:
            return task.result()
        task.cancel()
        self._failure.result()  # raises FrameGrabError
        raise FrameGrabError("WebRTC connection failed")

    async def close(self) -> None:
        await self._pc.close()
        if not self._failure.done():
            self._failure.cancel()
        elif not self._failure.cancelled():
            self._failure.exception()  # mark as retrieved


def default_peer_factory(with_audio: bool) -> PeerSession:
    return AiortcPeerSession(with_audio=with_audio)
