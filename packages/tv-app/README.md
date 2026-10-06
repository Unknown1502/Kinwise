# Kinwise for Fire TV (Vega OS)

The resident's screen: **Today at Home**, **the Pause**, consent and privacy controls, and the
access log. React Native for Vega, D-pad first, built for a 10-foot screen.

The project layout mirrors Amazon's sample
[`AmazonAppDev/react-native-multi-tv-app-sample/apps/vega`](https://github.com/AmazonAppDev/react-native-multi-tv-app-sample/tree/main/apps/vega)
(`manifest.toml`, `app.json`, `index.js`, `metro.config.js`, `babel.config.js`,
`react-native.config.js`, `tsconfig.json`, `jest.config.json`).

> The Vega SDK runs on **Ubuntu 20.04+ or macOS only**. On Windows, develop with the browser
> preview in [`../tv-preview`](../tv-preview) (react-native-web). It renders this same `src/`.
> Do not run `npm install` here on Windows.

## How it fits together

| Path | What it is |
|---|---|
| `src/App.tsx` | Small state machine: `selectScreen(state)` picks onboarding, pause or home (plus a gentle or expected overlay). Settings and the 5 s "Calling…" confirmation are local state. |
| `src/api.ts` | Typed client for `/tv/*` (bearer device token, 8 s timeouts via `AbortController`). |
| `src/hooks/useHubState.ts` + `src/logic/poller.ts` | Polls `GET /tv/state` every 2 s, backs off to 15 s on errors, shows "Reconnecting…" after 10 s. |
| `src/screens/*`, `src/overlays/*` | Onboarding (3 steps), Home, Pause, Calling, Settings & privacy, gentle panel, expected toast. |
| `src/components/Focusable.tsx` | The single focusable primitive. It draws a 6 px amber ring, sets label, role and state, and speaks the label on focus when VoiceView is on. |
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

## 2. Install the Vega SDK (Ubuntu)

Follow Amazon's *Install the Vega SDK* guide (developer.amazon.com/docs/vega). In short:

```bash
sudo apt remove curl && sudo apt install curl          # native curl, as Amazon's guide asks
(dpkg -l | grep -q lz4 || sudo apt install -y lz4) && \
  sudo add-apt-repository -y ppa:deadsnakes/ppa && sudo apt update && \
  (dpkg -l | grep -q libpython3.8-dev || sudo apt install -y libpython3.8-dev)
# KVM must be enabled for the Vega Virtual Device; install Node.js 18+ and watchman.
# Run the Vega SDK installer from the developer portal, then add its exports, e.g.:
export KEPLER_SDK_PATH=$HOME/kepler/sdk/<version>
export PATH=$KEPLER_SDK_PATH/bin:$PATH
kepler --version            # newer SDKs also ship the same CLI as `vega`
```

## 3. Build

```bash
cd packages/tv-app
npm install                 # pulls @amazon-devices/*, react-native 0.72 and the Vega CLI platform
npm test                    # jest: selectScreen + pure logic (test/*.spec.ts)
npm run build:debug         # react-native build-kepler --build-type Debug
# npm run build:release     # react-native build-kepler --build-type Release
```

Packages are written to `build/<arch>-<buildType>/KinwiseTV_<arch>.vpkg`. For example:

- `build/x86_64-debug/KinwiseTV_x86_64.vpkg` (Vega Virtual Device on an x86_64 machine)
- `build/armv7-release/KinwiseTV_armv7.vpkg` (Fire TV Stick)

Use the exact file name the build prints.

## 4. Run on the Vega Virtual Device

```bash
vega virtual-device start                     # waits for boot; add --timeout 120 if slow
vega run-app build/x86_64-debug/KinwiseTV_x86_64.vpkg com.kinwise.tv.main -d VirtualDevice
# (older SDKs: kepler virtual-device start / kepler run-kepler <vpkg> com.kinwise.tv.main -d VirtualDevice)
npm start                                     # optional: Metro for Fast Refresh during development
vega virtual-device stop
```

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
- **Text and margins.** Body text is at least 28 px and titles are 48–64 px, on a 1920×1080
  canvas. Every screen keeps 5% overscan margins (96 × 54 px).
- **Focus ring.** It is 6 px amber `#fde68a` with a 4 px gap, so it stays visible on cream and
  orange fills.
- **Labels.** Every focusable element sets `accessibilityLabel` and `accessibilityRole`, plus
  `accessibilityState` and `aria-*` (selected, checked, busy).
- **VoiceView.** `AccessibilityInfo.announceForAccessibility` announces:
  - the Pause, the gentle panel, the expected toast and the calling confirmation;
  - each focus change while a screen reader is on, because spatial focus is not native focus.
- **Calm Pause.** The Pause is orange, not red. A stray Back press never closes it. Dismiss is
  always one press away.
