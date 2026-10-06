"""Grab one live-view frame by letting a headless Chromium-family browser decode Ring's WebRTC stream.

Why a browser: Ring's live view (WHEP, H.264 baseline + RTX) is what Amazon's own sample decodes in a browser.
aiortc negotiated the session but could not decode the Developer Playground's H.264, while Edge/Chrome decode it
in ~2.5 s (verified 2026-10-06). The frame never touches disk here; callers get JPEG bytes in memory.

Requires the `playwright` package plus an installed Edge or Chrome (`BROWSER_CHANNEL`); no browser download is needed.
"""

from __future__ import annotations

import base64
import io
import logging
from typing import Any

from PIL import Image

from .frames import FrameGrabError

log = logging.getLogger(__name__)

_PAGE = '<video id="v" autoplay muted playsinline></video><canvas id="c"></canvas>'

_OFFER_JS = """async () => {
  const pc = new RTCPeerConnection(); window.pc = pc;
  pc.addTransceiver('audio', { direction: 'sendrecv' });   // same order as Amazon's ring-api-helloworld sample
  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.ontrack = (e) => {
    if (e.track.kind === 'video') document.getElementById('v').srcObject = new MediaStream([e.track]);
  };
  await pc.setLocalDescription(await pc.createOffer());
  await new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && resolve();
    setTimeout(resolve, 4000);
  });
  return pc.localDescription.sdp;
}"""

_CAPTURE_JS = """async (timeoutMs) => {
  const v = document.getElementById('v');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !(v.videoWidth > 0 && v.currentTime > 0.5)) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!v.videoWidth) return null;
  const c = document.getElementById('c');
  c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext('2d').drawImage(v, 0, 0);
  return c.toDataURL('image/jpeg', 0.85);
}"""


def _normalise_jpeg(data: bytes, max_width: int = 1280) -> bytes:
    image = Image.open(io.BytesIO(data)).convert("RGB")
    if image.width > max_width:
        image = image.resize((max_width, round(image.height * max_width / image.width)))
    out = io.BytesIO()
    image.save(out, format="JPEG", quality=85)
    return out.getvalue()


class BrowserFrameGrabber:
    def __init__(self, ring: Any, *, channel: str = "msedge", frame_timeout_s: float = 20.0) -> None:
        self._ring = ring
        self._channel = channel
        self._frame_timeout = frame_timeout_s

    async def grab_jpeg(self, device_id: str) -> bytes:
        try:
            from playwright.async_api import async_playwright
        except ImportError as exc:  # pragma: no cover - dependency is declared
            raise FrameGrabError("playwright is not installed (uv sync)") from exc

        async with async_playwright() as pw:
            try:
                browser = await pw.chromium.launch(
                    channel=self._channel, headless=True, args=["--autoplay-policy=no-user-gesture-required"]
                )
            except Exception as exc:
                raise FrameGrabError(f"could not start the {self._channel} browser: {exc}") from exc
            session_url = None
            try:
                page = await browser.new_page()
                await page.set_content(_PAGE)
                offer = await page.evaluate(_OFFER_JS)
                answer, session_url = await self._ring.create_whep_session(device_id, offer)
                await page.evaluate("async (sdp) => window.pc.setRemoteDescription({ type: 'answer', sdp })", answer)
                data_url = await page.evaluate(_CAPTURE_JS, int(self._frame_timeout * 1000))
                if not data_url:
                    raise FrameGrabError(f"no video frame within {self._frame_timeout:.0f}s")
                return _normalise_jpeg(base64.b64decode(data_url.split(",", 1)[1]))
            finally:
                if session_url:
                    try:
                        await self._ring.delete_whep_session(session_url)
                    except Exception as exc:
                        log.warning("could not close WHEP session: %s", exc)
                await browser.close()


def make_grabber(ring: Any, settings: Any) -> Any:
    """FRAME_GRABBER=browser (default) or aiortc."""
    if getattr(settings, "frame_grabber", "browser") == "aiortc":
        from .frames import FrameGrabber

        return FrameGrabber(ring)
    return BrowserFrameGrabber(ring, channel=getattr(settings, "browser_channel", "msedge"))
