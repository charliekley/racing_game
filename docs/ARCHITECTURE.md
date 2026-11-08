# Architecture

## Big picture

```
 ┌─────────────── Phone (controller page) ───────────────┐          ┌──────────────── Laptop → TV (host page) ─────────────────┐
 │ devicemotion ─► SteeringProcessor ─┐                  │          │                                                          │
 │ touch (Pointer Events) ─► TouchButtons ─┼─► 60 Hz input ──────────► PlayerManager.inputFor(slot) ─► Simulation (60 Hz fixed) │
 │ flick ─► TrickDetector ────────────┘  (unreliable)    │  WebRTC  │      ▲ keyboard / gamepad                 │              │
 │                                                       │  P2P on  │                                           ▼              │
 │ HUD (item, position, lap) ◄── events (reliable) ◄─────────LAN────── status / haptics / lobby      Renderer (Three.js,      │
 └───────────────────────────────────────────────────────┘          │                                 interpolated, 1-4 views) │
                                                                    └──────────────────────────────────────────────────────────┘
                     Signaling (only to set up the connection): public PeerJS server, behind the HostTransport/ControllerTransport interfaces
```

Four layers, each only depending on the ones below it:

| Layer | Folder | Knows about | Must NOT know about |
|---|---|---|---|
| **Shared** | `src/shared/` | protocol, room codes, colors, transport interfaces | DOM, Three.js |
| **Input** | `src/controller/`, `src/host/input/`, `src/host/playerManager.ts` | devices, network | simulation internals |
| **Simulation** (M2+) | `src/sim/` | `ControlInput` per player per tick, track data, tuning config | DOM, Three.js, network |
| **Rendering / audio / UI** (M2+) | `src/render/`, `src/audio/`, `src/host/ui/` | read-only view of sim state | changing sim state |

The simulation is pure TypeScript with a **fixed 60 Hz timestep**: every tick it
receives one `ControlInput` (steer −1..1 + button bitmask) per player and advances the
world by exactly 1/60 s. Rendering runs at whatever rate the display gives
(`requestAnimationFrame`) and **interpolates** between the last two sim states, so
motion is smooth even if the screen is 75/120 Hz or a frame is late. This keeps
physics deterministic-ish and makes the pure logic unit-testable.

## Folder structure

Current (M1) files are marked ✅, planned ones are listed so you can see where things will go.

```
racing_game/
├─ index.html                  ✅ landing page (links to host / controller)
├─ host/index.html             ✅ TV page entry
├─ controller/index.html       ✅ phone page entry
├─ vite.config.ts              ✅ multi-page build, base path, dev HTTPS, LAN IP
├─ .github/workflows/deploy.yml ✅ test + build + publish to GitHub Pages
├─ docs/ARCHITECTURE.md        ✅ this file
└─ src/
   ├─ shared/                  ✅ used by both pages
   │  ├─ protocol.ts           ✅ message types, input packet encode/decode, button bits
   │  ├─ roomCode.ts           ✅ 4-letter codes ↔ peer ids
   │  ├─ colors.ts, signal.ts  ✅
   │  └─ net/
   │     ├─ transport.ts       ✅ interfaces (swap PeerJS for something else here)
   │     └─ peerTransport.ts   ✅ PeerJS implementation + true-unreliable input channel
   ├─ controller/              ✅ phone
   │  ├─ main.ts               ✅ screens, connection, send loop, settings
   │  ├─ steering.ts           ✅ gravity vector → steering (pure, tested)
   │  ├─ trick.ts              ✅ flick detection (pure, tested)
   │  ├─ motionInput.ts        ✅ devicemotion glue
   │  ├─ touchButtons.ts       ✅ multi-touch buttons
   │  ├─ itemView.ts           ✅ item window canvas (real icons in M6)
   │  └─ device.ts, settings.ts ✅ permissions, wake lock, vibration, prefs
   ├─ host/
   │  ├─ main.ts               ✅ host entry (lobby now; game loop later)
   │  ├─ playerSlots.ts        ✅ 4 slots, rejoin, ready logic (pure, tested)
   │  ├─ playerManager.ts      ✅ phones + local devices → latest input per slot
   │  ├─ input/localInput.ts   ✅ keyboard + gamepad fallback
   │  ├─ lobbyView.ts          ✅ lobby cards + input debug readout
   │  ├─ game.ts               ✅ driving session: World + renderer + loop
   │  └─ ui/                   M3/M4 HUD, countdown, results
   ├─ sim/                     ✅ pure TS, no DOM/Three.js
   │  ├─ config.ts             ✅ ALL handling / camera tuning numbers
   │  ├─ loop.ts               ✅ fixed-timestep accumulator
   │  ├─ kart.ts               ✅ arcade kart controller (raycast ground; drift/boosts in M5)
   │  ├─ ground.ts             ✅ Ground interface + M2 test oval
   │  ├─ world.ts              ✅ all karts, tick()
   │  ├─ race.ts               M3 checkpoints, laps, ranking, countdown
   │  └─ items/                one file per item behind an `ItemBehavior` interface
   ├─ track/                   M3+
   │  ├─ tracks/*.ts           control-point files (adding a track = adding a file)
   │  └─ buildTrack.ts         spline → road/walls/ramps/checkpoints (data + meshes)
   ├─ render/                  ✅ Three.js: scene/sky, kart model, interpolated kart view,
   │                              chase camera, test-ground visuals (split-screen in M4)
   └─ audio/                   M7 Web Audio synth + optional sample overrides
```

## Networking

* **Signaling**: the host registers on the public PeerJS server as
  `tiltkart-r1-<ROOMCODE>`. A phone that knows the code asks the server to connect
  it to that ID. The server only relays the WebRTC "offer/answer" handshake
  (a few small messages); no game data goes through it.
* **Peer-to-peer**: after the handshake, WebRTC finds a direct path. On the same
  Wi-Fi that's a LAN connection (~1–5 ms). If the network blocks device-to-device
  traffic (guest/campus Wi-Fi), PeerJS falls back to a relay (TURN) server, which
  works but adds latency.
* **Two channels per phone** on one RTCPeerConnection:
  * `events` – PeerJS's reliable JSON channel: hello/welcome, ready, profile, lobby
    list, item/position status, haptics, ping/pong.
  * `input` – our own *negotiated* data channel with `ordered: false,
    maxRetransmits: 0` (true UDP-like). 8-byte packets: `seq`, `steer`, `buttons`,
    sent at 60 Hz and immediately when a button changes. The host keeps only the
    newest `seq`; lost or late packets are simply superseded.
* **Identity / rejoin**: each phone stores a random `clientId` in `localStorage`.
  The host maps `clientId → slot`; a phone that reconnects (Wi-Fi blip, page
  reload, screen lock) gets the same slot. While disconnected, its input is
  neutral, so the kart coasts to a stop.
* **Heartbeats**: both sides ping every second; a link silent for 3–4 s is closed
  and the phone auto-reconnects.
* **Swapping the transport**: implement `HostTransport` / `ControllerTransport`
  from `src/shared/net/transport.ts` (e.g. a WebSocket relay) and construct it in
  the two `main.ts` files. To use a self-hosted PeerJS server, just change
  `PEER_OPTIONS` in `peerTransport.ts` (`host`, `port`, `path`, `secure`).

## Why HTTPS everywhere

Browsers only expose motion sensors (and WebRTC, Wake Lock…) to "secure
contexts": pages served over HTTPS, or from `localhost`. A phone loading your
laptop's dev server over `http://192.168.x.x` gets no sensors. Options:

1. **GitHub Pages** (real HTTPS, no warnings) – best for play sessions.
2. **Vite dev server with a self-signed certificate** (`@vitejs/plugin-basic-ssl`)
   – the fastest edit/test loop; each device shows a one-time certificate warning.
3. **Cloudflare quick tunnel** – gives your local server a temporary public
   `https://….trycloudflare.com` URL with a valid certificate; use it when the
   self-signed route is blocked or annoying.

## Steering math (phone)

`accelerationIncludingGravity` gives the gravity direction in the phone's own axes.
Held like a wheel, gravity lies mostly in the screen plane, and the phone's roll is
`atan2(-gx, gy)` (clockwise positive). The **grip** (top of phone pointing left
or right) is worked out from gravity alone, with hysteresis, and the wheel angle is
roll minus the grip's level angle (±90°). Screen orientation is deliberately
*not* used for steering: when the browser auto-rotates the page mid-turn, the
steering must not jump. With rotation lock on, the controller UI is rotated by CSS
(`#stage`) to match the grip. Then: calibration offset (pose when
you press READY / Recenter) → 3° deadzone → scale so 45° = full lock → slight cubic
response curve → sensitivity / invert → exponential low-pass filter (40 ms). If
the phone is held almost flat (too little gravity in the screen plane) the last
value is held instead of producing noise. Some iOS versions report gravity with the
opposite sign. Steering direction is unaffected by that (negating a vector
commutes with rotating it), but the UI rotation is, so the sign is learned from
moments where "up" is known (phone upright in portrait, or the browser having
rotated the page to landscape) and remembered per device.
