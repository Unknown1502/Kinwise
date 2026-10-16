# Demo: repeatable scenario and a 2:40 storyboard

The rules require a video under 3 minutes (judges need not watch past it), public on YouTube or Vimeo, in English, showing the project working on the platform it was built for. The footage below was recorded from the real running system; the narration is for you to write and speak.

## Run the story yourself (about 5 minutes)

```bash
node scripts/setup.mjs
node scripts/dev.mjs --offline            # hub :8787 · concierge :8081 · Echo :5173 · TV :5174
node scripts/demo-scenario.mjs            # reminder → "is this call real?" → doorbell → Pause → Meera's timeline
```

Or by hand: open http://localhost:5173 and http://localhost:5174 side by side, ask "A man from the FTC called… is that real?" in Asha's Echo, press **Ring the doorbell**, then press OK on the TV's **Call Meera**. **Reset demo** returns to a clean first-run state. Against the hosted hub, add a persona token to the TV URL (`?hub=<hub>&token=<tv token>`) and to the Echo simulator's environment (see the testing instructions).

What is simulated, and said so on screen: the Alexa+ surface (the Echo simulator), Meera's phone panel, and the doorbell that rings the Pause (the Ring Playground has no person scene). What is real: the MCP server, the hub's rules, the hosted AWS stack, the Ring Partner API calls, the Vega app on the Vega Virtual Device, the Polly voice, and the e-mail with its one-tap link.

## Storyboard (target 2:40)

| Time | Show | Footage | Say (in your words) |
|---|---|---|---|
| 0:00–0:15 | The **Pause** full screen on the Vega device, spoken | `take6/vega` 0:25–0:40 (+ `vega-simulator-with-voice.mp4`) | The hook: a scam in two steps, and one device that knows both. |
| 0:15–0:40 | Asha asks Alexa: "is this call real?"; the card lists the warning signs | `take5` Echo 0:38–0:62 | What Kinwise noticed, kindly. Only categories are kept, never her words. |
| 0:40–1:00 | The doorbell rings; the TV pauses and says *why* | `take5` TV 1:04–1:20 | The link between the earlier call and the visitor is the idea. |
| 1:00–1:30 | Call Meera → "Telling Meera now" → Meera's phone gets the e-mail with **I'm calling now** → her note on the TV, read aloud | `take5` 1:20–1:35 (TV and Echo) + **your phone clip** of the real e-mail | The family is told for real, and Asha sees the answer. |
| 1:30–1:45 | Nobody answers: the chip turns amber, then "please call Meera yourself" | `take6/browser-unanswered/tv-unanswered-condensed.mp4` | It never promises help that is not coming. |
| 1:45–2:05 | The same app on the **Vega Virtual Device** (simulator, no physical Fire TV) | `take6/vega` 0:52–1:30 | Fire TV track: say it is the simulator. |
| 2:05–2:20 | The **real Ring Partner API**: device online, live frame, "no one at the door", nothing sent | `take6/ring/ring-worker-live.mp4` (use 0:10–0:35) | Ring track: the Playground has no person scene, so the Pause comes from our labelled doorbell. |
| 2:20–2:35 | AWS and the open-source kit: the stack, AgentCore READY, the conformance result | `take6/aws/aws-1-stack.png`, `aws-2-compute.png` (5 s each) + `alexa-mcp-conformance` output | AWS Builder and Open Source. Say these are CLI output, not the console. |
| 2:35–2:40 | Settings & privacy: "who has seen my information" | `take6/vega` 1:06–1:14 | Consent and dignity: she owns every switch. |

Keep the Polly voice lines under your narration at about 20% volume (they are in `take5/audio` and `take6/vega/voice`). Avoid any third-party music or logos.

## Still needed to finish the video

1. Your script and narration.
2. A clip of the real e-mail arriving on your phone and the button working (blocker 6 in [`judging-evidence.md`](judging-evidence.md)).
3. The edit under 3:00, then a public upload to YouTube or Vimeo and the link in the form.
