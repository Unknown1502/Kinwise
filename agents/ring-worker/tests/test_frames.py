from __future__ import annotations

import asyncio
import io

import pytest
from PIL import Image

from kinwise_ring.errors import RingApiError
from kinwise_ring.frames import FrameGrabber, FrameGrabError, crop_watermark, image_to_jpeg


def banded_jpeg(width: int = 200, height: int = 400, band: int = 60) -> bytes:
    """Red watermark band on top, blue scene below."""
    img = Image.new("RGB", (width, height), (0, 0, 255))
    img.paste((255, 0, 0), (0, 0, width, band))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=95)
    return buf.getvalue()


def test_crop_watermark_removes_the_top_band():
    cropped = crop_watermark(banded_jpeg(), 0.15)
    with Image.open(io.BytesIO(cropped)) as img:
        assert img.size == (200, 340)
        r, _g, b = img.convert("RGB").getpixel((100, 2))
        assert b > 200 and r < 60  # top row is now scene (blue), not watermark (red)


def test_crop_watermark_noop_and_clamp():
    original = banded_jpeg()
    assert crop_watermark(original, 0) is original
    with Image.open(io.BytesIO(crop_watermark(original, 0.9))) as img:
        assert img.size == (200, 200)  # clamped to 50%


def test_image_to_jpeg_downscales_to_max_width():
    big = Image.new("RGB", (2560, 1440), (10, 20, 30))
    with Image.open(io.BytesIO(image_to_jpeg(big, 1280))) as img:
        assert img.format == "JPEG" and img.size == (1280, 720)
    small = Image.new("RGBA", (640, 480))
    with Image.open(io.BytesIO(image_to_jpeg(small, 1280))) as img:
        assert img.size == (640, 480) and img.mode == "RGB"


class FakePeer:
    def __init__(self, with_audio: bool, *, frame: Image.Image | None = None, offer_error: Exception | None = None):
        self.with_audio = with_audio
        self.frame = frame
        self.offer_error = offer_error
        self.answer: str | None = None
        self.closed = False

    async def create_offer(self) -> str:
        if self.offer_error:
            raise self.offer_error
        return "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=recvonly\r\n" + ("m=audio\r\n" if self.with_audio else "")

    async def set_answer(self, sdp: str) -> None:
        self.answer = sdp

    async def first_frame(self) -> Image.Image:
        if self.frame is None:
            await asyncio.sleep(3600)  # never produces a frame
        return self.frame

    async def close(self) -> None:
        self.closed = True


class FakeWhep:
    def __init__(self, errors: list[Exception] | None = None):
        self.errors = list(errors or [])
        self.offers: list[str] = []
        self.deleted: list[str] = []

    async def create_whep_session(self, device_id: str, sdp_offer: str):
        self.offers.append(sdp_offer)
        if self.errors:
            raise self.errors.pop(0)
        return "v=0\r\nanswer\r\n", f"https://api.amazonvision.com/whep/{device_id}/{len(self.offers)}"

    async def delete_whep_session(self, session_url: str) -> None:
        self.deleted.append(session_url)


def factory(peers: list[FakePeer], **kwargs):
    def make(with_audio: bool) -> FakePeer:
        peer = FakePeer(with_audio, **kwargs)
        peers.append(peer)
        return peer

    return make


async def test_grab_returns_jpeg_and_cleans_up():
    peers: list[FakePeer] = []
    whep = FakeWhep()
    grabber = FrameGrabber(whep, peer_factory=factory(peers, frame=Image.new("RGB", (1920, 1080))))
    jpeg = await grabber.grab_jpeg("d1")
    with Image.open(io.BytesIO(jpeg)) as img:
        assert img.size == (1280, 720)
    assert peers[0].closed and peers[0].answer == "v=0\r\nanswer\r\n"
    assert whep.deleted == ["https://api.amazonvision.com/whep/d1/1"]
    assert "m=audio" not in whep.offers[0]


async def test_session_is_deleted_even_when_no_frame_arrives():
    peers: list[FakePeer] = []
    whep = FakeWhep()
    grabber = FrameGrabber(whep, peer_factory=factory(peers, frame=None), frame_timeout_s=0.05)
    with pytest.raises(FrameGrabError):
        await grabber.grab_jpeg("d1")
    assert peers[0].closed
    assert whep.deleted == ["https://api.amazonvision.com/whep/d1/1"]


async def test_offer_failure_closes_peer_without_a_session():
    peers: list[FakePeer] = []
    whep = FakeWhep()
    grabber = FrameGrabber(whep, peer_factory=factory(peers, offer_error=RuntimeError("no ICE")))
    with pytest.raises(RuntimeError):
        await grabber.grab_jpeg("d1")
    assert peers[0].closed and whep.offers == [] and whep.deleted == []


async def test_rejected_video_only_offer_is_retried_with_audio():
    peers: list[FakePeer] = []
    whep = FakeWhep(errors=[RingApiError(400, "audio required")])
    grabber = FrameGrabber(whep, peer_factory=factory(peers, frame=Image.new("RGB", (64, 48))))
    assert await grabber.grab_jpeg("d1")
    assert [p.with_audio for p in peers] == [False, True]
    assert all(p.closed for p in peers)
    assert whep.deleted == ["https://api.amazonvision.com/whep/d1/2"]
    # The device is remembered as needing audio.
    await grabber.grab_jpeg("d1")
    assert peers[-1].with_audio is True


async def test_offline_device_is_not_retried():
    peers: list[FakePeer] = []
    whep = FakeWhep(errors=[RingApiError(503, "offline")])
    grabber = FrameGrabber(whep, peer_factory=factory(peers, frame=Image.new("RGB", (64, 48))))
    with pytest.raises(RingApiError):
        await grabber.grab_jpeg("d1")
    assert len(peers) == 1 and peers[0].closed


async def test_cleanup_failures_do_not_mask_the_result():
    class BrokenWhep(FakeWhep):
        async def delete_whep_session(self, session_url: str) -> None:
            raise RingApiError(500, "delete failed")

    peers: list[FakePeer] = []
    grabber = FrameGrabber(BrokenWhep(), peer_factory=factory(peers, frame=Image.new("RGB", (64, 48))))
    assert await grabber.grab_jpeg("d1")


async def test_real_aiortc_offer_is_receive_only():
    pytest.importorskip("aiortc")
    from kinwise_ring.frames import AiortcPeerSession

    peer = AiortcPeerSession(with_audio=False, ice_servers=[])  # no STUN: no network traffic
    try:
        sdp = await asyncio.wait_for(peer.create_offer(), 20)
    finally:
        await peer.close()
    assert "m=video" in sdp and "a=recvonly" in sdp and "m=audio" not in sdp

    peer = AiortcPeerSession(with_audio=True, ice_servers=[])
    try:
        sdp = await asyncio.wait_for(peer.create_offer(), 20)
    finally:
        await peer.close()
    assert "m=audio" in sdp


async def test_real_aiortc_loopback_grab_end_to_end():
    """Real WebRTC on localhost: an in-process aiortc 'Ring' answers the WHEP offer and streams video."""
    pytest.importorskip("aiortc")
    from aiortc import RTCConfiguration, RTCPeerConnection, RTCSessionDescription
    from aiortc.mediastreams import VideoStreamTrack

    from kinwise_ring.frames import AiortcPeerSession

    class LoopbackWhep:
        def __init__(self) -> None:
            self.sessions: dict[str, RTCPeerConnection] = {}
            self.deleted: list[str] = []

        async def create_whep_session(self, device_id: str, sdp_offer: str):
            assert "a=recvonly" in sdp_offer
            pc = RTCPeerConnection(RTCConfiguration(iceServers=[]))
            await pc.setRemoteDescription(RTCSessionDescription(sdp=sdp_offer, type="offer"))
            pc.addTrack(VideoStreamTrack())
            await pc.setLocalDescription(await pc.createAnswer())
            url = f"https://api.amazonvision.com/whep/{device_id}/{len(self.sessions)}"
            self.sessions[url] = pc
            return pc.localDescription.sdp, url

        async def delete_whep_session(self, session_url: str) -> None:
            self.deleted.append(session_url)
            await self.sessions[session_url].close()

    whep = LoopbackWhep()
    grabber = FrameGrabber(whep, peer_factory=lambda audio: AiortcPeerSession(audio, ice_servers=[]))
    jpeg = await asyncio.wait_for(grabber.grab_jpeg("d1"), 30)
    with Image.open(io.BytesIO(jpeg)) as img:
        assert img.format == "JPEG" and img.size == (640, 480)
    assert whep.deleted == ["https://api.amazonvision.com/whep/d1/0"]
