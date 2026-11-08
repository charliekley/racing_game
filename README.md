# Tilt Kart

A browser-based, 4-player split-screen kart racer. The **laptop/TV runs the game**
in a browser, and **each player's phone becomes a tilt steering wheel** through a
web page. There's no app to install. All names, art and sounds are original.

> **Status: Milestone 1 of 7.** Phones connect with a room code and QR code, send
> tilt and buttons at 60 Hz, and the TV shows a live readout of every controller.
> Driving arrives in M2.

* [Architecture & folder structure](docs/ARCHITECTURE.md)
* Tech: TypeScript, Vite, Three.js (from M2), PeerJS (WebRTC), Vitest

---

## 1. Running locally

You need [Node.js](https://nodejs.org) 20+.

```bash
npm install
npm run dev
```

Vite prints two addresses, for example:

```
➜  Local:   https://localhost:5173/
➜  Network: https://192.168.1.42:5173/
```

On the laptop, open **https://localhost:5173/host/**. Your browser will warn that
the certificate isn't trusted, because the dev server makes its own (self-signed)
certificate. Click **Advanced → Proceed to localhost**. You'll see a room code
and a QR code. The QR code already points at your laptop's LAN address, not
`localhost`.

**Windows firewall:** the first time you run `npm run dev`, Windows asks whether
Node.js may accept connections. Allow it on **Private networks**, and make sure
your Wi-Fi network profile is set to *Private*. Otherwise phones can't load the page.

If the QR code shows the wrong IP (e.g. a WSL/VirtualBox adapter), open the host
page with `?lan=YOUR_IP`, e.g. `https://localhost:5173/host/?lan=192.168.1.42`,
or start the server with `LAN_IP=192.168.1.42 npm run dev`.

### Useful scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with HTTPS on your LAN, live reload |
| `npm test` | Unit tests (steering math, protocol, slots, …) |
| `npm run typecheck` | TypeScript type check |
| `npm run build` | Production build into `dist/` |
| `npm run tunnel` | Cloudflare quick tunnel (see below) |

---

## 2. Testing on phones over HTTPS

Phones only allow motion sensors on HTTPS pages, which is why the dev server uses HTTPS.
The phone and laptop must be on the **same Wi-Fi**.

### iPhone (Safari)

1. Open the Camera app and point it at the QR code on the TV, then tap the link.
2. Safari says **"This Connection Is Not Private"**. Tap **Show Details →
   visit this website → Visit Website**. This is only your own laptop's
   self-signed certificate, and you do it once per server start.
3. Enter your name, pick a color, tap **JOIN**.
4. iOS asks to allow **Motion & Orientation** access. Tap **Allow**. If you tap
   *Cancel* by mistake, close the tab completely, scan again, and allow it.
5. Turn the phone sideways. Hold it like a steering wheel and tap **READY**.
   That also sets "straight ahead".
6. Tips: turn off Rotation Lock in Control Center. Low Power Mode may stop the
   screen-awake feature from working.
   iOS has no vibration API for web pages, so iPhones don't buzz. That's expected.

### Android (Chrome)

Same as above. At the certificate warning, tap **Advanced → Proceed**. Android
doesn't ask for motion permission. The controller goes fullscreen and vibrates on
events.

### Fallback: Cloudflare quick tunnel (valid HTTPS, no warnings)

Use this if the self-signed route fails, or if your Wi-Fi isolates devices from
each other (guest/campus networks):

```bash
npm run dev           # terminal 1
npm run tunnel        # terminal 2 (downloads cloudflared via npx the first time)
```

The tunnel prints a URL like `https://random-words.trycloudflare.com`. Open
**`https://random-words.trycloudflare.com/host/`** on the laptop. The QR code
then uses the tunnel URL, so phones get a real certificate. If `npm run tunnel`
fails on your machine, install cloudflared directly (`winget install
Cloudflare.cloudflared`) and run `cloudflared tunnel --url https://localhost:5173
--no-tls-verify`. Live reload may not work through the tunnel; refresh manually.

---

## 3. Deploying to GitHub Pages

1. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Push to `main`. The workflow in `.github/workflows/deploy.yml` runs the tests,
   builds with the base path `/racing_game/`, and publishes.
3. Play at **https://charliekley.github.io/racing_game/host/**. That page is
   real HTTPS, so phones show no certificate warnings.

The game data still flows phone ↔ laptop directly over your Wi-Fi. GitHub only
serves the files.

---

## 4. How to play (controls)

### Phone (hold sideways like a wheel)

| Control | Action |
|---|---|
| Tilt / rotate the phone | Steer (45° = full lock by default) |
| **GAS** (right, bottom) | Accelerate (hold) |
| **DRIFT** (right, top) | Hop / drift (hold) |
| **BRAKE** (left, bottom) | Brake / reverse (hold) |
| **ITEM** (left, top) | Tap to use, hold to drag behind you |
| Quick flick/shake | Trick when airborne |
| ⚙ | Settings: name, color, sensitivity, full-lock angle, invert, recenter |
| ping chip (top left) | Toggle debug overlay |

You can slide your thumb between GAS and DRIFT without lifting it.

### Keyboard / gamepad on the host (for testing without phones)

| | Player "WASD" (press **1** to add) | Player "Arrows" (press **2** to add) | Gamepad (press **A/Start** to join) |
|---|---|---|---|
| Steer | A / D | ← / → | Left stick |
| Gas | W | ↑ | A or RT |
| Brake | S | ↓ | B or LT |
| Drift | Space | Right Shift | RB or X |
| Item / *ready in lobby* | E | Enter | LB or Y |
| Trick | R | / | D-pad up |

Press the same number again to remove a keyboard player. The **`** key toggles
the debug readouts on the TV.

---

## 5. Tuning

* **Phone steering feel:** `DEFAULT_STEERING` in
  [`src/controller/steering.ts`](src/controller/steering.ts) covers deadzone, full-lock
  angle, response curve and smoothing. Players can also change sensitivity, full-lock angle
  and invert on their phone.
* **Flick/trick sensitivity:** `DEFAULT_TRICK` in [`src/controller/trick.ts`](src/controller/trick.ts).
* **Kart handling, drift, items:** `src/sim/config.ts` (added in M2). All
  driving numbers will live in that one file.

---

## 6. Milestone 1 test checklist

1. `npm run dev`, then open `https://localhost:5173/host/` on the laptop. Check that
   the status says **Online** and a room code + QR code appear.
2. Press **1**. A "Keys WASD" player appears. Hold W/A/D/Space/E and watch the
   GAS/DRIFT/ITEM pills and the steering bar react. Press **E** to toggle Ready.
3. Scan the QR code with your iPhone and follow the steps in section 2. The TV
   should show your name in the next slot within a couple of seconds.
4. Tilt the phone: the steering bar on the TV and the little wheel on the phone
   should follow smoothly. Center = level wheel. Full bar ≈ 45°.
5. Press several buttons at once (GAS + DRIFT + ITEM). All three should light on the TV.
6. Check the stats line: **rate ≈ 60 Hz**, **lost ≈ 0%**, **ping** in single or
   low double digits on home Wi-Fi.
7. Click **Buzz phone** (Android vibrates) and **Test item** (the phone shows a
   spinning roulette, then a star, then empty again).
8. Lock the phone for 5 s. The TV shows *Disconnected*. Unlock it and the phone
   reconnects to the **same slot** by itself. Reloading the page and tapping JOIN
   again also gets the same slot back.
9. Press READY on every phone and the keyboard players. The green
   "Everyone is ready" banner appears.

---

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| Phone can't load the page | Same Wi-Fi? Windows firewall allowed Node on Private networks? Try the tunnel. |
| Stuck on "Connecting…" / "No game found" | Is the TV page open and *Online*? Check the code. Refresh the TV page (it keeps the same code). |
| High ping (100 ms+) | Your network probably blocks device-to-device traffic, so data is relayed through a TURN server. Try a home network or a phone hotspot. |
| Steering reversed | ⚙ → *Invert steering*, then tell me which phone/OS so I can fix the detection. |
| Steering center is off | Hold the wheel level and tap ⚙ → *Recenter* (or toggle READY). |
| No motion on iPhone | You probably denied permission. Close the tab, rescan, tap Allow. |
