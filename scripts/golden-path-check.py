"""Golden path in a real browser against the LOCAL stack (hub :8787, Echo :5173, TV :5174).

Run: node scripts/dev.mjs --offline   (another terminal), then:  pip install playwright && python scripts/golden-path-check.py
Uses Microsoft Edge (channel "msedge"); change `channel` to "chrome" or drop it for bundled Chromium.

Authorize path: ask -> question -> a spoken "turn it on" does NOT start it -> Turn on on the TV -> doorbell -> Pause on the TV
                -> TV reports it shown -> Call Meera.
Refuse path:    ask -> question -> "Not now" -> doorbell -> only a gentle note, nobody told.
Review path:    "Review privacy" explains and changes nothing.
Failure path:   TV page closed -> the Pause is "sent", never "shown".
Prints PASS/FAIL per check and exits non-zero on any failure. Never prints tokens.
"""
import asyncio
import json
import os
import sys
import tempfile
import urllib.request

from playwright.async_api import TimeoutError as PlaywrightTimeout
from playwright.async_api import async_playwright

HUB, ECHO, TV = "http://localhost:8787", "http://localhost:5173", "http://localhost:5174"
CALL = "A man from the FTC called. He said a courier will collect my gold and I shouldn't tell my family. Is that real?"
results = []


def check(ok, name, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""), flush=True)


def api(method, path, token="dev-tv", body=None):
    req = urllib.request.Request(HUB + path, method=method, data=json.dumps(body or {}).encode() if method != "GET" else None,
                                 headers={"authorization": f"Bearer {token}", "content-type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read() or "{}")


def notices():
    return api("GET", "/dev/notices")["notices"]


def reset():
    api("POST", "/dev/reset", "dev-asha")
    api("POST", "/tv/consent", "dev-tv", {"onboarded": True})


async def ask(echo, text):
    await echo.locator('input[name="persona"][value="asha"]').check()
    box = echo.locator("#ask-asha")
    await box.fill(text)
    await box.press("Enter")
    await echo.locator('.screen[data-persona="asha"] .reply-text').last.wait_for(timeout=60_000)
    await echo.wait_for_timeout(2000)


def card(echo):
    return echo.frame_locator("iframe").last


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="msedge", headless=True)
        ctx = await browser.new_context(viewport={"width": 1700, "height": 1000})

        # ---------- authorize ----------
        reset()
        tv, echo = await ctx.new_page(), await ctx.new_page()
        await tv.goto(TV)
        await echo.goto(ECHO)
        await tv.wait_for_timeout(3000)
        await ask(echo, CALL)
        st = api("GET", "/tv/state")
        check(st["watch"]["state"] == "offered" and st["today"]["safety"]["level"] == "none",
              "A flagged call only OFFERS a watch: the TV state shows a question and no watch", f"watch={st['watch']['state']} safety={st['today']['safety']['level']}")
        check(not notices(), "Nobody in the family was told before she answered")
        buttons = {n: await card(echo).get_by_role("button", name=n).count() for n in ("Turn on", "Not now", "Review privacy")}
        check(buttons == {"Turn on": 0, "Not now": 1, "Review privacy": 1}, "The Echo card offers Not now and Review privacy, and no Turn on (it cannot verify who is speaking)", str(buttons))
        card_text = await card(echo).locator("body").inner_text()
        check("press Turn on on your TV" in card_text, "The Echo card says where to confirm")
        await echo.screenshot(path=os.path.join(tempfile.gettempdir(), "kinwise-gp-question.png"))

        await card(echo).get_by_role("button", name="Review privacy").click()
        await echo.wait_for_timeout(2500)
        txt = await card(echo).locator("body").inner_text()
        check("never your words" in txt.lower() and "Meera" in txt, "Review privacy explains what is shared (never your words; who is told)")
        check(api("GET", "/tv/state")["watch"]["state"] == "offered" and not notices(), "Review privacy changed nothing")

        await ask(echo, "Yes, turn it on")
        st = api("GET", "/tv/state")
        check(st["watch"]["state"] == "offered" and st["today"]["safety"]["level"] == "none" and not notices(),
              "Saying 'turn it on' to Alexa starts nothing and tells nobody", f"watch={st['watch']['state']}")
        try:
            await tv.locator('[data-testid="watch-offer-overlay"]').wait_for(timeout=10_000)
            check(True, "The question is waiting on the TV")
        except PlaywrightTimeout:
            check(False, "The question is waiting on the TV")
        await tv.screenshot(path=os.path.join(tempfile.gettempdir(), "kinwise-gp-tv-question.png"))
        await tv.locator('[data-testid="focusable:Turn on a 6 hour safety watch"]').click()
        await tv.wait_for_timeout(2500)
        st = api("GET", "/tv/state")
        check(st["watch"]["state"] == "on" and st["today"]["safety"]["level"] == "high", "Turn on, pressed on the TV, starts the six-hour watch (server and TV state agree)")
        check([n["kind"] for n in notices()] == ["risk_high"], "Meera got exactly one safety signal, only after Turn on on the TV")

        await echo.get_by_role("button", name="Ring the doorbell").click()
        try:
            await tv.locator('[data-testid="pause-screen"]').wait_for(timeout=15_000)
            check(True, "The TV shows the Pause after the watch was authorised")
        except PlaywrightTimeout:
            check(False, "The TV shows the Pause after the watch was authorised")
        await tv.wait_for_timeout(3500)
        st = api("GET", "/tv/state")
        check(st["activeAlert"]["delivery"] == "shown", "The TV reported the Pause as shown (the hub otherwise says only 'sent')", st["activeAlert"].get("delivery"))
        await tv.screenshot(path=os.path.join(tempfile.gettempdir(), "kinwise-gp-pause.png"))
        await tv.locator('[data-testid="focusable:Call Meera"]').click()
        await tv.wait_for_timeout(2500)
        check(any(n["kind"] == "call_request" for n in notices()), "Call Meera sends the one-tap e-mail request")
        await tv.close(); await echo.close()

        # ---------- refuse ----------
        reset()
        tv, echo = await ctx.new_page(), await ctx.new_page()
        await tv.goto(TV)
        await echo.goto(ECHO)
        await tv.wait_for_timeout(3000)
        await ask(echo, CALL)
        await card(echo).get_by_role("button", name="Not now").click()
        await echo.wait_for_timeout(2500)
        st = api("GET", "/tv/state")
        check(st["watch"]["state"] == "declined" and st["today"]["safety"]["level"] == "none", "Not now keeps the watch off")
        await echo.get_by_role("button", name="Ring the doorbell").click()
        await tv.wait_for_timeout(5000)
        st = api("GET", "/tv/state")
        check(st["activeAlert"]["kind"] == "gentle" and await tv.locator('[data-testid="pause-screen"]').count() == 0, "After Not now a visitor gets only a gentle note, no Pause")
        check(not notices(), "After Not now, nobody in the family was told anything")
        await tv.close(); await echo.close()

        # ---------- failure: the TV app is not open ----------
        reset()
        echo = await ctx.new_page()
        await echo.goto(ECHO)
        await ask(echo, CALL)
        offer_id = api("GET", "/tv/state")["watch"]["offer"]["id"]
        api("POST", "/tv/watch", "dev-tv", {"choice": "turn_on", "offerId": offer_id})  # answered on the TV (naming the question), then the TV app is closed before the doorbell
        await echo.get_by_role("button", name="Ring the doorbell").click()
        await echo.wait_for_timeout(3000)
        st = api("GET", "/tv/state")
        check(st["activeAlert"]["kind"] == "pause" and st["activeAlert"]["delivery"] == "sent", "With no TV app open the Pause is 'sent', never 'shown'", st["activeAlert"].get("delivery"))
        pause = [n for n in notices() if n["kind"] == "pause"]
        check(pause and "cannot tell whether" in pause[0]["body"], "The family notice does not claim she saw it", pause[0]["body"][-70:] if pause else "no notice")
        await browser.close()
    print(f"\n{sum(results)}/{len(results)} checks passed", flush=True)
    sys.exit(0 if all(results) else 1)


asyncio.run(main())
