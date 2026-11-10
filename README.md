# Tilt Kart

A browser-based, 4-player split-screen kart racer. The **laptop/TV runs the game**
in a browser, and **each player's phone becomes a tilt steering wheel** through a
web page. There's no app to install. All names, art and sounds are original.

> **Status: Milestone 6 of 7.** Item boxes and five items are in (see "Items"). Drifting with blue/orange mini-turbos, ramp
> tricks, a water jump and a respawn drone are in. Phones connect with a room code + QR code and
> act as tilt steering wheels. 1–4 players race in **split-screen** (full /
> top-bottom / quadrants, with a track map in the spare quadrant for 3 players),
> each with their own chase camera and HUD. 3-2-1-GO countdown with a rocket
> start, 3 laps on one of four tracks, results and "race again". Computer drivers can
> fill empty slots. Audio and polish arrive in M7.

* [Architecture & folder structure](docs/ARCHITECTURE.md)
* Tech: TypeScript, Vite, Three.js (from M2), PeerJS (WebRTC), Vitest

---

## Sound

All audio is generated in code with the Web Audio API (no sound files). It lives in `src/audio/`:
engine loops per kart, about 35 one-shot effects, a looping tune per track (plus lobby and results),
and a master limiter so four karts never clip. Browsers only allow sound after you interact, so it
starts on your first key press, click or gamepad button.

* **M** mutes (remembered on this computer), **[** and **]** lower/raise the music volume.
* Which sound plays for which game event: `src/audio/mapping.ts`. The sounds themselves: `synth.ts`.
  The tunes (key, tempo, notes as text patterns): `songs.ts`.
* **Replace a sound with a real recording:** put the file (mp3, ogg or wav) in `public/sounds/`, then list it in
  `src/audio/samples.ts`, for example `boostPad: 'sounds/boost.mp3'`. If it loads it is played instead of the
  synth, otherwise the synth is used. The names you can use are the `SOUND_IDS` list in `mapping.ts`.

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
5. A one-time popup asks you to **turn on Rotation Lock** (Control Center → the
   lock icon). Do it and tap **Got it**. Then hold the phone sideways like a
   steering wheel. The controller turns itself to match the first time, then
   **locks that layout** for the session: buttons never move, and steering
   can't be thrown off by the screen rotating mid-turn.
6. Tap **READY** while holding the wheel level. During the 3-2-1 countdown the
   phone keeps re-centering itself, so however you're holding it at GO is
   "straight ahead" (even if you just picked it up). In a race, the **⟲** button
   in the phone's top bar recenters instantly.
7. Tips: Low Power Mode may stop the screen-awake feature from working. If the
   controller ever shows upside down, tap ⚙ → **Flip 180°** (it remembers).
   iOS has no vibration API for web pages, so iPhones don't buzz. That's expected.

### Android (Chrome)

Same as above. At the certificate warning, tap **Advanced → Proceed**. Android
doesn't ask for motion permission. The controller goes fullscreen and vibrates on
events. Auto-rotate off (portrait locked) is recommended here too.

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
| **GAS** (right, bottom, big) | Accelerate (hold) |
| **BRAKE** (right, top) | Brake / reverse (hold) |
| **DRIFT** (left, bottom, big) | Hop; hold while steering to drift (see below). Glows blue/orange with your drift charge |
| **ITEM** (left, top) | Tap to use; hold to drag the item behind you, release to fire (see Items) |
| Quick flick/shake | Trick when airborne off a ramp → boost on landing |
| ⚙ | Settings: name, color, sensitivity, full-lock angle, invert, flip 180°, recenter |
| ⟲ (top bar) | Recenter the wheel (also happens automatically during the countdown) |
| ping chip (top left) | Toggle debug overlay |
| Middle of the screen | Position, lap, and a track map with every kart's dot (yours is bigger) |

You can slide your thumb between GAS and BRAKE without lifting it.

**Items:** drive through the rainbow **item boxes** (rows of three; they come back
5 s later). A roulette spins for about 1.6 s on the phone and the TV, then you
get an item. **The further back you are, the better your items** (leaders mostly
get Slicks and Ricochets and never the strongest ones). You can only hold one
at a time. On the phone the item's icon appears in the **ITEM button** itself.

| Item | What it does |
|---|---|
| **Dash** (single or pack of 3) | Instant speed boost. The pack gives three boosts, one per tap. |
| **Slick** | An oil slick that spins out whoever drives over it (jumping over it is safe). **Tap** to drop it behind you. **Hold** ITEM to drag it behind you as a shield: it blocks shots from behind. Release to drop it. |
| **Ricochet** | A fast shot that bounces off walls a few times. **Tap** to fire forward, or hold **BRAKE** while you let go to fire **backward**. Hold ITEM to drag it behind you first. |
| **Seeker** | A homing shot that chases the racer directly ahead of you. If you're in the lead it just flies straight. |
| **Nova** | 7 s of invincibility: faster, ignores grass, immune to hits, and bumping a rival spins them out. |
| **Jumble** | Sprays ink on **everyone ahead of you**: their steering is flipped left/right for 7 s and an ink splat covers part of their screen. You can't get it in the lead; Nova blocks it. |

Getting hit spins you out for about 1.3 s: no steering, most of your speed and
any boost lost, and Android buzzes. A hit while dragging an item loses it (a
dragged Slick stays on the road). The TV only shows "HIT NAME!" for whoever got
you; other feedback is visual (icons, the spin, effects) or a phone buzz rather
than words.

**Drifting:** tap DRIFT to hop. If you're steering when you land (and keep
holding DRIFT), you go into a drift in that direction. The kart slides with its
nose pointing into the corner. Tilt **into** the drift to tighten it (and charge
faster), **out** of it to widen it. Sparks turn **blue**, then **orange**;
**let go of DRIFT** for a mini-turbo (orange lasts twice as long). Drifting on
grass charges at half speed.

**Tricks:** when you fly off a ramp, flick the phone (or press the trick key)
while in the air: "TRICK!" and a boost when you land. Many jumps clear
a water gap or a chasm: hit it too slowly and you fall in, and a little yellow
carrier drone lowers you back at your last checkpoint. The drone also comes if
you wander far off the course.

**Racing:** hold GAS just as the countdown hits **1** for a **rocket start**.
Holding it from the very beginning floods the engine. Laps only count if you
pass every checkpoint in order, so shortcuts across the grass don't work. Hit
the orange arrow pads for a boost and take the yellow ramp for some air.

### Keyboard / gamepad on the host (for testing without phones)

| | Player "WASD" (press **1** to add) | Player "Arrows" (press **2** to add) | Gamepad (press **A/Start** to join) |
|---|---|---|---|
| Steer | A / D | ← / → | Left stick |
| Gas | W | ↑ | A or RT |
| Brake | S | ↓ | B or LT |
| Drift | Space | Right Shift | RB or X |
| Item / *ready in lobby* | E | Enter | LB or Y |
| Trick | R | / | D-pad up |

Press the same number again to remove a keyboard player. **B** adds a computer
driver (always ready; remove it with its Remove button). **G** starts the race
right away without waiting for everyone to be ready. **Q** cycles the graphics
quality (High / Medium / Low – see Performance below). **T** picks the track
(Ember Peaks / Dockside Loop / Cloud Garden / Switchback Summit; remembered, and `?track=2` in the
URL overrides it). The **`** key toggles
the debug readouts on the TV.

While racing, **Esc** returns to the lobby. On the results screen: **Enter**
(or everyone tapping RACE AGAIN on their phones) starts another race.

Shortcuts for testing: **`/host/?drive`** skips the lobby and races immediately
with WASD; **`/host/?drive=4`** does the same with 3 computer drivers, for
instant 4-way split-screen (`=2`, `=3` work too).

### Performance

The TV draws the whole scene once per player each frame, so 4 players means 4
renders. To keep 60 fps: shadows are computed once per frame and shared,
all scenery (trees, rocks, houses, grandstands, mountains…) is merged into a
handful of meshes (about 5 draw calls for the whole landscape), and materials
are cheap. If the frame rate (top-right in debug mode) drops below 60, press
**Q** in the lobby: **Medium** (default) renders at 1 pixel per screen pixel
with shadows and 70% of the grass/flower detail, **Low** turns shadows and
clouds off, keeps 35% of the ground detail and renders at 75% resolution,
**High** uses full Retina/4K resolution, sharper shadows and all detail.

The scenery adapts to a track's `theme` colors: from the grass color it picks a
"biome" (meadow, autumn, desert or snow) that decides tree types, foliage,
rocks, houses and the distant mountains (see `biomeFor` in
`src/render/scenery.ts`). The sky gradient, fog and ambient light come from
`theme.sky` / `theme.horizon`.

---

## 5. Tuning

* **Phone steering feel:** `DEFAULT_STEERING` in
  [`src/controller/steering.ts`](src/controller/steering.ts) covers deadzone, full-lock
  angle, response curve and smoothing. Players can also change sensitivity, full-lock angle
  and invert on their phone.
* **Flick/trick sensitivity:** `DEFAULT_TRICK` in [`src/controller/trick.ts`](src/controller/trick.ts).
* **Kart handling and camera:** [`src/sim/config.ts`](src/sim/config.ts) – top
  speed, acceleration curve, braking, reverse, turn rates at low/high speed,
  grip, off-road penalties, boosts (pads, rocket start), **drift** (hop height,
  turn tightness, slide grip, charge rates, blue/orange thresholds, mini-turbo
  lengths), **tricks and respawn**, spin-out and Nova (`KART`), wall/kart bounce,
  gravity, plus chase-camera distance/lag/FOV. The `ITEMS` block in the same
  file has everything about items: box respawn, tap/hold timing, shot speeds, bounce
  count, slick size, boost lengths.
* **Item odds:** [`src/sim/items/odds.ts`](src/sim/items/odds.ts). Two weight
  tables (leader and last place) that every position interpolates between. Save the file and the dev server reloads.
* **Race rules:** countdown length, rocket-start window, finish grace period in
  [`src/sim/race.ts`](src/sim/race.ts).
* **Tracks:** [`src/track/tracks/`](src/track/tracks/) (Ember Peaks, Dockside Loop, Cloud Garden, Switchback Summit;
  files starting with `_` are dev-only test tracks, see [`docs/TRACKS.md`](docs/TRACKS.md)).
  A track is a list of control points plus walls, ramps and boost pads placed
  "between point 10 and 11" style. To add one, copy that file, change the
  points, and add it to [`src/track/index.ts`](src/track/index.ts). `npm test`
  checks every track automatically: it can't pass too close to itself, has no
  corner tighter than 15 m, and the grid is on the road.

---

## 6. Milestone 6 test checklist

1. **Practice mode:** open `/host/?drive=2&give=nova` (or `dash`, `slick`,
   `ricochet`, `seeker`, `random`). Everyone has an endless supply of that item
   so you can try it without hunting boxes. The icon shows in the box at the top
   of each player's view. Use **E** (the keyboard player's ITEM key).
2. **Boxes:** in a normal race (`/host/?drive=2`), look for rows of three rainbow
   "?" cubes on the road. Drive into one: the item box icon spins through the five
   items for ~1.6 s and then shows your item. The cube vanishes and comes back
   after 5 s. Driving through a box while holding an item does nothing.
3. **Dash:** tap E: instant boost, with flames. A pack of three shows "x3".
4. **Slick:** tap E to drop an oil puddle behind you; a bot (or you, circling
   back) that drives over it spins around and loses speed. Hold E: the puddle
   drags behind your kart; release to drop it. Try firing a Ricochet at it.
5. **Ricochet / Seeker:** tap E to fire. Ricochet bounces off the tire walls;
   hold **S** (brake) when you let go of E to fire backward. A Seeker curves
   toward the kart ahead of you.
6. **Nova:** the kart glows and shimmers; you ignore grass, and anyone you touch
   spins out; shots and slicks just vanish when they hit you.
7. **Phones:** the roulette animates on the phone, then the item's icon shows in
   the middle (with ×3 for a Dash pack). Tap ITEM (left side, top button) to use
   it. Android buzzes when you get an item, use one, or get hit. The lobby's **Test item** button cycles every icon on a phone.
8. Computer drivers use items too: watch for them dropping slicks and firing shots.

## 7. Milestone 5 test checklist

1. `/host/?drive`, wait for GO. Hold W and A (or D) and **press Space**: the kart
   hops and lands in a drift, sliding with the nose turned in. White dust while
   charging, then blue sparks, then orange. Release Space: flames from the
   exhausts and a speed burst (orange lasts longer).
2. While drifting, compare holding the steer key toward the corner vs letting
   go/steering out: tight vs wide arc. Pressing Space without steering = just a hop.
3. With the phone: hold DRIFT and tilt; the DRIFT button glows white → blue →
   orange to match, and Android buzzes on each new color and on the mini-turbo.
4. The jump near the end of the lap now has water after it. Take it at speed and
   press **R** (or flick the phone) in the air: "TRICK!" and a boost on landing.
   Take it slowly: you drop into the water and the yellow drone lowers you back
   onto the road a little earlier in the lap. Laps still count correctly.
5. Drive far out into the fields: after ~2.5 s the drone brings you back.
6. Bump other karts (`?drive=4`): you bounce off each other without stopping.

## 8. Milestone 4 test checklist

1. Open `/host/?drive=4`: four views in quadrants, each with its own position,
   lap, time, speed, item box and a colored "P2 Bot 1" tag. You
   drive the top-left one with WASD; the bots race too.
2. `/host/?drive=3`: three views + an overview map in the bottom-right quadrant
   with a dot per kart. `/host/?drive=2`: top/bottom split.
3. Per-player messages: rocket start / LAP 2 / FINAL LAP / FINISH only appear in
   *that* player's view; the countdown and GO appear in all of them. The view
   glows orange at the edges while that player is boosting, and the camera
   widens its field of view.
4. Real lobby flow: open `/host/`, have 2–4 phones join (and/or press 1, 2, B).
   The hint line counts players; when everyone is ready (bots always are) the
   race starts – or press G to start right away.
5. Check the frame rate: press **`** to show the fps counter top-right. With 4
   views on your laptop it should stay near 60; if not, Esc → Q → Low and
   compare.

## 9. Milestone 3 test checklist

1. Open `/host/?drive` (or the GitHub Pages link with `?drive`). You're on the
   grid at the start line under a checkered gantry, and **3-2-1-GO!** counts down.
2. **Rocket start:** press W when the **1** appears and hold it. You should see
   "ROCKET START!" and shoot off. Holding W from the start shows "Too early!" and
   the kart sputters briefly.
3. Drive a lap. Look for: the road banks in the corners (the kart tilts), tire
   walls on the outside of the big sweep and both sides of the S-bend (you bounce
   and lose some speed, never stop dead), an orange boost pad right after the
   start and another after the S-bend, and the yellow jump ramp near the end.
4. Top-left shows your position, top-right **LAP x/3** and the race time.
   "LAP 2" / "FINAL LAP!" flash as you cross the line.
5. Try cutting across the grass: the lap does not count until you go back and
   pass the missed part.
6. With phones: everyone joins and readies, then all karts line up. Phones show
   position and lap, and Android buzzes on walls, boosts, laps and finish.
7. After 3 laps (or 20 s after the winner), the results screen lists places,
   times and best laps. Everyone taps **RACE AGAIN** on their phone (or press
   Enter) to restart. **Esc** goes back to the lobby.

---

## 10. Milestone 2 test checklist

1. `npm run dev`, open `https://localhost:5173/host/?drive`. You're in a green
   kart on the start straight. W = gas, S = brake/reverse, A/D = steer.
2. Look for: ~100 km/h top speed after ~4 s; the kart can't turn while stopped;
   turns are tight at low speed and wider at top speed; driving onto the grass
   slows you to ~72 km/h *gradually* (no sudden stop); S while stopped reverses,
   and steering flips like a real car when reversing.
3. Now the phone: open `/host/` (no `?drive`), join with your iPhone (rotation
   lock ON), hold it sideways, tap READY. After 1.5 s everyone is on the track.
4. Steer by tilting. Things to judge and tell me about: is 45° to full lock
   comfortable? Is it twitchy around center (raise the deadzone/curve) or laggy
   (lower `smoothingMs`)? Oversteer the phone way past 45° – the kart should just
   stay at full lock, never snap the other way.
5. Try the ⚙ sensitivity / full-lock sliders mid-drive; changes apply instantly.
6. Press **C** to cycle the camera between karts, **Esc** to go back to the lobby.

## 11. Milestone 1 test checklist

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

## 12. Troubleshooting

| Symptom | Fix |
|---|---|
| Phone can't load the page | Same Wi-Fi? Windows firewall allowed Node on Private networks? Try the tunnel. |
| Stuck on "Connecting…" / "No game found" | Is the TV page open and *Online*? Check the code. Refresh the TV page (it keeps the same code). |
| High ping (100 ms+) | Your network probably blocks device-to-device traffic, so data is relayed through a TURN server. Try a home network or a phone hotspot. |
| Steering reversed | ⚙ → *Invert steering*, then tell me which phone/OS so I can fix the detection. |
| Controller upside down | ⚙ → *Flip 180°* (remembered on that phone). |
| Steering center is off | Hold the wheel level and tap ⚙ → *Recenter* (or toggle READY). |
| No motion on iPhone | You probably denied permission. Close the tab, rescan, tap Allow. |
