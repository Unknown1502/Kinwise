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
