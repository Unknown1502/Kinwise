# Kinwise for Fire TV (Vega OS)

The resident's screen: the **home screen** (a day clock with today's visits, reminders and notes
from family), **the Pause**, consent and privacy controls, and the access log. React Native for Vega, D-pad first, built for a 10-foot screen.

The project layout mirrors Amazon's sample
[`AmazonAppDev/react-native-multi-tv-app-sample/apps/vega`](https://github.com/AmazonAppDev/react-native-multi-tv-app-sample/tree/main/apps/vega)
(`manifest.toml`, `app.json`, `index.js`, `metro.config.js`, `babel.config.js`,
`react-native.config.js`, `tsconfig.json`, `jest.config.json`).

> The Vega SDK runs on **Ubuntu 20.04+ or macOS only**. On Windows, develop with the browser
> preview in [`../tv-preview`](../tv-preview) (react-native-web). It renders this same `src/`.
> Do not run `npm install` here on Windows.
>
> To review every screen without a hub or a staged scenario, run the fixture hub from
> `packages/tv-preview` (`npx tsx scripts/fixture-hub.ts`), open
> `http://localhost:5174/?hub=http://localhost:8799&token=dev-tv`, and switch screens with
> `curl -X POST localhost:8799/__fixture/pause` (also `home`, `privacy`, `watching`, `gentle`,
> `expected`, `onboarding`, `proposals`, `empty`).

## How it fits together

| Path | What it is |
|---|---|
| `src/App.tsx` | Small state machine: `selectScreen(state)` picks onboarding, pause or home (plus a gentle or expected overlay). Settings and the 5 s "Calling…" confirmation are local state. |
| `src/api.ts` | Typed client for `/tv/*` (bearer device token, 8 s timeouts via `AbortController`). |
| `src/hooks/useHubState.ts` + `src/logic/poller.ts` | Polls `GET /tv/state` every 2 s, backs off to 15 s on errors, shows "Reconnecting…" after 10 s. |
| `src/screens/*`, `src/overlays/*` | Onboarding (3 steps), Home, Pause, Calling, Settings & privacy, gentle panel, expected toast. |
| `src/components/Focusable.tsx` | The single focusable primitive. The focused item grows slightly and gets a 5 px ring (white on the backdrop, deep on light cards and on the Pause). It sets label, role and state, and speaks the label on focus when VoiceView is on. |
| `src/theme/theme.ts`, `src/theme/surface.tsx` | Colours, the type scale and the bundled typeface; `OnSurface` switches focus styling on light and persimmon backgrounds. |
| `src/components/Icon.tsx`, `Avatar.tsx` | Lucide icons and coloured icon badges; a family member's initial on a warm disc. |
| `src/logic/today.ts` | The home screen's day logic: "Monday afternoon", one time-ordered agenda, and privacy time left (measured on the hub's clock). |
| `*.vega.ts(x)` | Vega-only overrides. Metro resolves `vega.tsx`/`vega.ts` first. The plain files are what the web preview uses. |

Vega-only files:

- `src/config.vega.ts`: **the hub URL constant to edit** (see below).
- `src/remote.vega.ts`: `TVEventHandler` → `react-tv-space-navigation`, and `BackHandler` → Back.
- `src/theme/scale.vega.ts`: maps the 1920×1080 design canvas to the TV window.
- `src/components/FamilyVideo.vega.tsx`: the caregiver's Pause video via `@amazon-devices/react-native-w3cmedia`. Captions are always shown as large text.

## 1. Point the app at your hub

The Vega Virtual Device and a Fire TV stick are separate network hosts. On them, `localhost` is
the device, not your computer. Edit **one constant** in `src/config.vega.ts`:

```ts
export const HUB_URL = 'http://192.168.1.50:8787'; // LAN IP of the machine running the hub
```

- Find the IP with `hostname -I` (Ubuntu) or `ipconfig getifaddr en0` (macOS).
- Run the hub so that it listens on all interfaces. `npm run dev:hub` already binds to `0.0.0.0`.
- Or use the deployed API Gateway URL plus a device token from the hub's `DEVICE_TOKENS`.
- `DEVICE_TOKEN = 'dev-tv'` works with the hub's `AUTH_MODE=dev`.

## 2. Install the Vega SDK (Ubuntu, or Ubuntu in WSL2)

> **Verified 2026-10-07 on Windows 11 + WSL2 (Ubuntu 24.04), Vega SDK 0.24.12112.** Amazon only lists native
> Ubuntu/macOS, but the Vega Virtual Device ran under WSL2 because `/dev/kvm` is available (Intel VT-x, nested
> virtualization). Keep the distro on a large drive: `wsl --install Ubuntu-24.04 --name kinwise-ubuntu --location D:\WSL\kinwise-ubuntu`.

```bash
sudo apt-get install -y curl lz4 jq build-essential git watchman libjpeg62   # jq is required by the installer
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs
ls -l /dev/kvm && sudo usermod -aG kvm $USER                                 # KVM for the Virtual Device
curl -fsSL https://sdk-installer.vega.labcollab.net/get_vvm.sh -o get_vvm.sh
NONINTERACTIVE=true bash get_vvm.sh            # installs the vega CLI + latest SDK (+ Virtual Device)
vega sdk install 0.24.12112                     # re-run if a download stalls; it resumes cleanly
cat >> ~/.profile <<'EOF'
export KEPLER_SDK_PATH="$HOME/vega/sdk/vega-sdk/main/0.24.12112"
export PATH="$HOME/vega/bin:$KEPLER_SDK_PATH/bin:$PATH"
EOF
```

WSL tips from our build:
- In `/etc/wsl.conf` set `[interop] appendWindowsPath=false`, or Linux may pick up Windows' `npm`/`node`.
- If WSL logs *"Failed to configure network (networkingMode Nat), falling back to VirtioProxy"*, long-running downloads can stall after a while. `wsl --shutdown` restores full speed, and npm is more robust with `npm config set fetch-timeout 20000` and `maxsockets 3`.
- From Git Bash, run `MSYS_NO_PATHCONV=1 wsl …` (or use PowerShell); otherwise Git Bash rewrites `/home/...` paths.

## 3. Build

```bash
cd packages/tv-app
npm install                 # .npmrc sets legacy-peer-deps (RN 0.72 + @amazon-devices peers)
npm run build:debug         # react-native build-kepler --build-type Debug   (~2 min)
# npm run build:release
```

The build prints the package paths, for example:

- `build/x86_64-debug/tv-app_x86_64.vpkg` (Vega Virtual Device)
- `build/armv7-debug/tv-app_armv7.vpkg` and `build/aarch64-debug/tv-app_aarch64.vpkg` (Fire TV sticks)

## 4. Run on the Vega Virtual Device

```bash
vega virtual-device start --timeout 240        # boots in ~30 s with KVM; a window opens (WSLg on Windows)
vega device list                               # → VirtualDevice : tv - x86_64
vega run-app build/x86_64-debug/tv-app_x86_64.vpkg com.kinwise.tv.main -d VirtualDevice
vega virtual-device stop
```

> Under WSL the Virtual Device stops when the WSL session that started it ends. Keep that session open, for
> example with a script that starts it and then loops on `vega virtual-device status`.

On the Virtual Device, the keyboard stands in for the remote:

| Key | Remote button |
|---|---|
| Arrow keys | D-pad |
| ENTER | Select |
| ESC | Back |

The vpkg architecture must match your machine.

## 5. Run on a Fire TV Stick (Vega OS)

1. Connect the stick over USB and HDMI, pair the remote, and sign in.
2. Register its serial number (DSN) for Developer Mode in the developer console.
3. On the TV, open **Settings → My Fire TV → About** and press Select seven times on the device name. Then open **Developer options → Developer Mode** and note the 6-digit code.
4. Enable Developer Mode from your computer:

```bash
vega devmode login
vega devmode enable-device --code <6-digit code>   # the device reboots
vega device list
vega device install-app --packagePath build/armv7-release/KinwiseTV_armv7.vpkg
vega device launch-app --appName com.kinwise.tv.main
```

## 6. Try the hero flow

With the hub running (`npm run dev:hub` at the repo root):

1. Ask Kinwise to check a scary call (Echo simulator, or MCP `kinwise_check_call` as `dev-asha`).
2. Ring the demo doorbell:

```bash
curl -X POST http://<hub>:8787/dev/visitor -H 'content-type: application/json' -d '{}'
```

The Pause takes over the TV within one poll (≤ 2 s). **Call Priya** has focus. VoiceView reads the
Pause aloud, and selecting **Call Priya** notifies the caregiver.

## Accessibility and 10-foot rules (enforced in code)

- **D-pad first.** `react-tv-space-navigation` 5.2.0 handles focus. There is one active
  `SpatialNavigationRoot` per screen. An overlay deactivates the root beneath it, so only one ring
  ever shows.
- **Text and margins.** Nothing is smaller than 28 px and body copy is 32 px, on a 1920×1080
  canvas. Every screen keeps 5% overscan margins (96 × 54 px).
- **Focus.** The focused item grows by up to 5% (instantly when Reduce Motion is on) and gets a
  5 px ring with a 4 px gap: white on the backdrop, deep on the apricot card, the light visitor
  sheet and the persimmon Pause.
- **Labels.** Every focusable element sets `accessibilityLabel` and `accessibilityRole`, plus
  `accessibilityState` and `aria-*` (selected, checked, busy).
- **VoiceView.** `AccessibilityInfo.announceForAccessibility` announces:
  - the Pause, the gentle panel, the expected toast and the calling confirmation;
  - each focus change while a screen reader is on, because spatial focus is not native focus.
- **Calm Pause.** The Pause turns the whole screen persimmon, not red. A stray Back press never
  closes it. Dismiss is always one press away.

## Voice

The TV says what changed, wherever the change came from (the remote, Alexa, Priya's phone or the
Ring doorbell): the Pause and other visitors at the door, new family notes, privacy time starting
and ending, the safety watch, the "Calling Priya" confirmation, and anything Alexa asks the TV to
read (`kinwise_read_on_tv`). `src/logic/narration.ts` decides the words (unit-tested);
`src/voice/useVoice.ts` fetches each line from the hub as natural speech (Amazon Polly) and plays
it with Vega's `AudioPlayer` (`src/voice/player.vega.ts`) or an `<audio>` element in the preview.
The hub hands out signed links (`GET /speech/<token>.mp3`) because Vega's player cannot send an
Authorization header. **Settings & privacy → Voice** turns reading aloud off, and **Hear the
voice** plays a sample. If the hub has no voice configured, the TV stays quiet.

## Design

A warm family display, in the spirit of an Echo Show home screen. The time and a greeting
("Good afternoon, Asha") come first. The newest note from family is the largest thing on screen,
on an apricot card with the sender's initial. Today's visits and reminders share one list in time
order, each marked with its own colour and icon; items whose time has passed fade. Focus works like
Fire TV's own: the selected item turns white and grows slightly.

| Token | Hex | Used for |
|---|---|---|
| Backdrop | `#0F3142` + `assets/home-bg.png` | Blue-teal evening gradient with a warm lamp glow |
| Apricot | `#FFD5BA` | Notes from family |
| Mint | `#7FDDB8` | Visitors, "Kinwise is on", switches that are on |
| Sun | `#FFD166` | Reminders, "New", primary buttons |
| Coral | `#FF8A65` | Scam warnings and the safety watch |
| Lilac | `#C9B8FF` | Privacy time |
| Persimmon | `#EE6A3C` | The Pause (the whole screen) |
| Deep | `#0B2230` | Text on light surfaces and on the Pause |

The typeface is **Atkinson Hyperlegible Next** by the Braille Institute, drawn for readers with
low vision. The four weights live in `assets/fonts/` under the SIL Open Font License
(`assets/fonts/OFL.txt`). Each weight is its own family name, so Vega and the browser preview
resolve the same file.

Icons are [Lucide](https://lucide.dev) (ISC licence, `assets/icons/LICENSE-lucide.txt`),
pre-rendered as light and dark PNGs so Vega needs no image tinting.
