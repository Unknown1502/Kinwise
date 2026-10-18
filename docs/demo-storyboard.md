# Demo: repeatable scenario and a 2:40 storyboard

> **Final cut (2026-10-18), supersedes the shot table below.** The submitted video is `kinwise-demo.mp4`, 2:42, recorded from the deployed version (`22ab5c2`): the Echo question and its privacy review; the real Vega consent sheet (Not now focused, then Turn on); the real Vega Pause; Meera's three answers (sent, shown, not confirmed) shown as the hub's exact words on the card; the e-mail text card; Settings and "who has seen my information" from the deployed app; the real Ring Playground clip; fresh AWS CLI evidence images; the conformance run recorded earlier (the same 22/22 and 16/16 were re-run on the final commit); and the Echo "under the hood" view. Labels in the video say what is simulated, and the spoken paraphrase drift is captioned. The old `take5` / `take6` footage below it is no longer used except the Ring clip, the conformance recording and the e-mail card text.

The rules require a video under 3 minutes (judges need not watch past it), public on YouTube or Vimeo, in English, showing the project working on the platform it was built for. The footage below was recorded from the real running system; the narration is for you to write and speak.

## Run the story yourself (about 5 minutes)

```bash
node scripts/setup.mjs
node scripts/dev.mjs --offline            # hub :8787 · concierge :8081 · Echo :5173 · TV :5174
node scripts/demo-scenario.mjs            # reminder → "is this call real?" → "turn it on" → doorbell → Pause → Meera's timeline
node scripts/demo-scenario.mjs --decline  # the same with "Not now": the doorbell gives only a gentle note
```

Or by hand: open http://localhost:5173 and http://localhost:5174 side by side, ask "A man from the FTC called… is that real?" in Asha's Echo, press **Ring the doorbell**, then press OK on the TV's **Call Meera**. **Reset demo** returns to a clean first-run state. Against the hosted hub, add a persona token to the TV URL (`?hub=<hub>&token=<tv token>`) and to the Echo simulator's environment (see the testing instructions).

What is simulated, and said so on screen: the Alexa+ surface (the Echo simulator), Meera's phone panel, and the doorbell that rings the Pause (the Ring Playground has no person scene). What is real: the MCP server, the hub's rules, the hosted AWS stack, the Ring Partner API calls, the Vega app on the Vega Virtual Device, the Polly voice, and the e-mail with its one-tap link.

## Storyboard (target 2:40)

| Time | Show | Footage | Say (in your words) |
|---|---|---|---|
| 0:00–0:15 | The **Pause** full screen on the Vega device, spoken | `take6/vega` 0:25–0:40 (+ `vega-simulator-with-voice.mp4`) | The hook: a scam in two steps, and one device that knows both. |
| 0:15–0:40 | Asha asks Alexa: "is this call real?"; the card lists the warning signs | `take5` Echo 0:38–0:62 | What Kinwise noticed, kindly. Only categories are kept, never her words. |
| 0:30–0:40 | **Asha is asked**, not told: "turn on a 6-hour safety watch, and tell Meera if it looks serious?" She presses **Turn on on the TV** (saying it to Alexa only points her to the TV) | Echo question card and the TV sheet (re-record on the current build) | Consent is hers and only her authenticated TV can start it; "Not now" keeps everything off. |
| 0:40–1:00 | The doorbell rings; the TV pauses and says *why* | `take5` TV 1:04–1:20 | The link between the earlier call and the visitor is the idea. |
| 1:00–1:30 | Call Meera → "Telling Meera now" → Meera's phone gets the e-mail with **I'm calling now** → her note on the TV, read aloud | `take5` 1:20–1:35 (TV and Echo) + **your phone clip** of the real e-mail | The family is told for real, and Asha sees the answer. |
| 1:30–1:45 | Nobody answers: the chip turns amber, then "please call Meera yourself" | `take6/browser-unanswered/tv-unanswered-condensed.mp4` | It never promises help that is not coming. |
| 1:45–2:05 | The same app on the **Vega Virtual Device** (simulator, no physical Fire TV) | `take6/vega` 0:52–1:30 | Fire TV track: say it is the simulator. |
| 2:05–2:20 | The **real Ring Partner API**: device online, live frame, "no one at the door", nothing sent | `take6/ring/ring-worker-live.mp4` (use 0:10–0:35) | Ring track: the Playground has no person scene, so the Pause comes from our labelled doorbell. |
| 2:20–2:35 | AWS and the open-source kit: the stack, AgentCore READY, the conformance result | `take6/aws/aws-1-stack.png`, `aws-2-compute.png` (5 s each) + `alexa-mcp-conformance` output | AWS Builder and Open Source. Say these are CLI output, not the console. |
| 2:35–2:40 | Settings & privacy: "who has seen my information" | `take6/vega` 1:06–1:14 | Consent and dignity: she owns every switch. |

Keep the Polly voice lines under your narration at about 20% volume (they are in `take5/audio` and `take6/vega/voice`). Avoid any third-party music or logos.

## Footage that had to be re-recorded after the consent change (done 2026-10-18, see the final cut above)

The footage in `take5` and `take6` shows the old behaviour (the watch starts by itself) and the old TV chip text ("Meera has been told", now "Message sent to Meera"). Before the final video: redeploy the hosted stack, rebuild the Vega app, and record the Echo question card plus one "Not now" run. `python scripts/golden-path-check.py` reproduces both paths (and the "TV closed" failure) in a real browser against the local stack: 15 checks.

## Still needed to finish the video

1. Your script and narration.
2. A clip of the real e-mail arriving on your phone and the button working (blocker 6 in [`judging-evidence.md`](judging-evidence.md)).
3. The edit under 3:00, then a public upload to YouTube or Vimeo and the link in the form.
