# Tilt Kart

A browser-based, 4-player split-screen kart racer. The **laptop/TV runs the game**
in a browser, and **each player's phone becomes a tilt steering wheel** through a
web page. There's no app to install. All names, art and sounds are original.

> **Status: Milestone 6 of 7.** Item boxes and eight items are in (see "Items"). Drifting with blue/orange mini-turbos, ramp
> tricks, a water jump and a respawn drone are in. Phones connect with a room code + QR code and
> act as tilt steering wheels. 1–4 players race in **split-screen** (full /
> top-bottom / quadrants, with a track map in the spare quadrant for 3 players),
> each with their own chase camera and HUD. 3-2-1-GO countdown with a rocket
> start, 3 laps on one of six tracks and results. Computer drivers fill the grid up to 4, 8 or 12 karts. Audio and polish arrive in M7.

* [Architecture & folder structure](docs/ARCHITECTURE.md)
* Tech: TypeScript, Vite, Three.js (from M2), PeerJS (WebRTC), Vitest

---

## Sound

All audio is generated in code with the Web Audio API (no sound files). It lives in `src/audio/`:
engine loops per kart, about 35 one-shot effects, a looping tune per track (plus lobby and results),
and a master limiter so four karts never clip. Browsers only allow sound after you interact, so it
starts on your first key press or click.

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
3. Tap **JOIN** (the room code is already filled in from the QR code).
4. iOS asks to allow **Motion & Orientation** access. Tap **Allow**. If you tap
   *Cancel* by mistake, close the tab completely, scan again, and allow it.
5. A one-time popup asks you to **turn on Rotation Lock** (Control Center → the
   lock icon). Do it and tap **Got it**. Then hold the phone sideways like a
   steering wheel. The controller turns itself to match the first time, then
   **locks that layout** for the session: buttons never move, and steering
   can't be thrown off by the screen rotating mid-turn.
6. Go through the pre-race screens (see *Characters and karts* below), holding the wheel level when you lock in your kart. During the 3-2-1 countdown the
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
get Peels and Ricochets and never the strongest ones). You can only hold one
at a time. On the phone the item's icon appears in the **ITEM button** itself.

| Item | What it does |
|---|---|
| **Dash** (single or pack of 3) | Instant speed boost. The pack gives three boosts, one per tap. |
| **Peel** (internal id `slick`) | A 3-D fruit peel that lies on the road (it follows banking, hills and ramps) and spins out whoever drives over it (jumping over it is safe). **Tap** to drop it behind you. **Hold** ITEM to drag it behind you as a shield: it blocks shots from behind. Release to drop it. |
| **Ricochet** | A fast shot that bounces off walls a few times. **Tap** to fire forward, or hold **BRAKE** while you let go to fire **backward**. Hold ITEM to drag it behind you first. |
| **Seeker** | A homing shot that **follows the road** to the racer directly ahead of you (round corners and hairpins, and over jumps, ravines and cannon gaps through the air), then homes in when it is close. If you're in the lead it follows the road and hits whoever it meets. |
| **Nova** | 7 s of invincibility: faster, ignores grass, immune to hits, and bumping a rival spins them out. |
| **Jumble** | Sprays ink on the **two racers just ahead of you**: their steering is flipped left/right for 4.5 s and an ink splat covers part of a human's screen. Computer drivers have to re-learn the controls (they veer, over-correct, wobble and lift; easy bots suffer most, hard bots least) and can run wide. **Rare, and only for karts well behind** (nothing in the front half of the field); Nova blocks it. |
| **Storm** (lightning) | A dark cloud and a bolt strike **every racer ahead of you at once**: they drop their item, spin out and shrink to a tiny size (slower, lighter, easy to bump into barriers). The one furthest back grows back first (almost at once), the leader last (about 10 s): a great equaliser. A full-size kart that drives over a tiny one flattens it. Rockets and Nova karts are immune; karts behind you are not affected. **Rare, and only for karts well back.** |
| **Rocket** | Your kart becomes a rocket: a glowing capsule that is driven **automatically** along the track at very high speed for 7 s (steering is taken over, it follows the road over jumps, ravines and cannons). It is invincible, nothing can hit it and it knocks other karts aside (they spin out). At the end you get a small boost and a short grace. **Only for karts far back, never for the leaders.** |

Getting hit spins you out for about 1.3 s: no steering, most of your speed and
any boost lost, and Android buzzes. A hit while dragging an item loses it (a
dragged Peel stays on the road). The TV only shows "HIT NAME!" for whoever got
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

### Race modes

The first player's phone (P1, or the next player if P1 leaves) gets a **forced pop-up** when it joins and every time the game returns to the menu: pick the mode, then the track (Grand Prix needs none). It has no close button; it goes away when the choice is made, when the TV (mouse) picks a mode or track instead, or when someone else becomes the menu owner (who then gets it). Other phones say "<name> is choosing...", and phones' READY does not start the race meanwhile (clicking the TV still can). In Loser picks the last-place player gets the same pop-up for the track. Track cards are small pictures of the real 3D course (`src/render/trackShot.ts`, rendered one at a time in the background and cached, about 4-6 KB each); the TV lobby shows the same picture.

**Finishing a race**: everyone keeps racing until the second-to-last kart crosses the line; the last kart is then placed last automatically (DNF). Safety net: if nobody finishes for 45 s (`STRAGGLER_TIMEOUT_SECONDS` in `src/sim/race.ts`), the karts still racing are placed by distance.

**Points** (Grand Prix and Loser picks; `POINTS_TABLES` in `src/host/series.ts`): every place scores except last. 4 racers **10 / 6 / 3 / 0**, 8 racers **10 / 8 / 6 / 5 / 4 / 2 / 1 / 0**, 12 racers **12 / 10 / 9 / 8 / 7 / 6 / 5 / 4 / 3 / 2 / 1 / 0**. Bots score too and are in the standings. Ties: more wins, then more 2nd places..., then the last race, then slot number.

**Crowns**: 👑N next to a name = race wins this session (any mode, bots included; `src/shared/wins.ts`). Shown on the TV (results, standings, podium, selection quadrants, race HUD) and on the phones. A new room starts everyone at zero.

**After a race** (`src/host/postRace.ts` describes it; clocks in `src/host/postRaceFlow.ts`): the scoreboard flips in (last place first, points count up).
* **Single race**: the top three stand on a 3D podium and are revealed 3rd, 2nd, 1st with their pick animation. Then everybody goes **back to the lobby**: P1's phone gets the mode / track pop-up again, everybody keeps their driver and kart but is **not ready**: each phone offers **READY** or **CHANGE CHARACTER**, and the TV shows NOT READY until they tap READY. (Same after a Grand Prix or Loser-picks series ends.)
* **Grand Prix**: all tracks in order; results + standings, then the next race starts by itself after 10 s (no ready step). After the last race: the final standings next to the 3D podium, then back to the menu.
* **Loser picks**: after each race the last-place *human* picks the next track on their phone while the others choose READY / CHANGE CHARACTER; the race starts when the track is picked and everyone is ready. P1 taps STOP for the final podium.
* **Knockout** (not offered any more; the dev address `?mode=knockout` still starts it): one longer race (5 laps on these tracks). When the first kart finishes lap 2, 3, ... the kart in last place is knocked out: the carrier drone lifts it away and its view greys out with its final place. With 8 or 12 racers several karts go out per lap (2 / 3, so the race stays at 5 / 6 laps; `knockoutsPerLap` in `src/sim/knockout.ts`). The last kart standing wins; places follow the reverse knockout order and the results list the lap each kart went out on. No points. Rules are pure logic in `src/sim/knockout.ts` (decided from race state, so the sim stays deterministic). 
### The lobby on the laptop / TV

Everything is mouse-clickable; players only use their phones.

* The **gear button** (top right, with a summary like "4 racers · Normal bots") opens **Settings**: **Racers** (4 / 8 / 12 karts on the grid; bots fill the rest), **Bot difficulty** (Easy / Normal / Hard), **Graphics** (High / Medium / Low, see Performance below) and **Sound** (on / off). All are remembered on this computer (`?racers=12` and `?quality=low` override for testing).
* Mode and track can be clicked too (the track arrows, the mode pills).
* The small **X** on a player's quadrant removes that player: their slot frees up, their phone says "Removed from the game" with a **JOIN AGAIN** button, and it does not reconnect by itself.
* Bots are only fill-ins for the grid (there is no way to add one as a player). They are named after their character ("Pip", "Rex"), preferring characters nobody picked; with more bots than characters a repeat gets a number ("Pip 2"). The same name shows on the HUD, results, standings, podium and phones. Fill-in bots have no screen and get colours nobody else has.
* Silent development shortcuts: **G** / **Enter** start now, **Q** / **D** / **N** cycle graphics / bot difficulty / racers, **T** and **Left/Right** pick the track, **Up/Down** the mode, **Esc** goes back to the lobby, **`** toggles the debug readouts, **M** mutes.

Shortcuts for testing (these still use the keyboard: **A/D** steer, **W** gas, **S** brake, **Space** drift, **E** item, **R** trick): **`/host/?drive`** skips the lobby and races immediately; **`/host/?drive=4`** adds 3 computer drivers with their own views, for instant 4-way split-screen (`=2`, `=3` work too); `?track=5`, `?mode=gp` / `?mode=loser`, `?racers=12`, `?selectdemo=4` (fake players walking the pick screens).

### Advanced driving

* **Slipstream.** Tuck in 3 to 14 m behind another kart, roughly in its line, at speed. Pale wind streaks
  appear and a charge builds; after about 1.5 s you are slingshot forward with a short boost (whoosh). Leave
  the wake and the charge drains twice as fast. Bots draft you and you can draft them.
* **Style combo.** Land a ramp trick, release a mini-turbo and fire a slipstream boost within 6 s of each other
  (any order) and a COMBO! pops up with a bonus second of boost.
* **Perfect start.** Press gas within 0.3 s of GO for a longer rocket start and a PERFECT START! banner;
  within 0.8 s still gives a normal rocket start, and holding it from the beginning floods the engine.
* **Hit protection.** After a spin-out you cannot be hit again for about 1.6 s, so nobody gets chain-hit.
* **Bot difficulty** (Settings on the TV). *Easy* bots skip drifts, shortcuts and cannons, make mistakes and
  use items lazily. *Normal* bots drift long corners, do tricks, use items sensibly and take the shortcuts they
  like. *Hard* bots are fast and clean: well-timed rocket starts, drift everything, use every shortcut. Each bot
  drives its character's class (light bots drift eagerly, heavy bots bully), and bots gently rubber-band against
  the best human: up to 6% slower when far ahead, up to 4% quicker when far behind. All numbers are in
  `src/sim/config.ts` (`SLIPSTREAM`, `COMBO`, `START`, `BOTS`) and `src/sim/bots.ts`.

### Characters and karts

Before every race each player goes through four full-screen steps (P1's mode / track pop-up comes first):

1. **Name**: type a name (remembered; there is no colour choice any more, colour comes from the character).
2. **Character**: arrows, swipe or tap a thumbnail to browse the 12 drivers (weight class, stat bars); the TV shows
   the highlighted one live. **THIS ONE** confirms.
3. **Kart**: the same for the 4 kart bodies; the stat bars change with the body. **LET'S GO** confirms.
4. **Ready**: waiting screen that lists who is still choosing. **BACK** changes your picks until the race starts.
   The race starts when every human is ready.

After a race everyone keeps their picks but is not ready: the phone shows **READY** and **CHANGE CHARACTER** (back to the character step).
The host checks every step (`PlayerSlots.select`, `parseSelect` in `src/shared/protocol.ts`) and publishes each player's
stage and highlight to the `SelectionHub` (`src/host/selectionHub.ts`) that the TV display reads.

Each driver has stat points from 1 to 5, the kart body adds or subtracts a few, and
`src/sim/classes.ts` turns the points into real physics numbers. **3 points = the original kart exactly.**

| Stat | What it changes | 1 point | 3 points | 5 points |
|---|---|---|---|---|
| Speed | top speed | 27.3 m/s (-2.5%) | 28 m/s | 28.7 m/s (+2.5%) |
| Accel | acceleration | -25% | 18 m/s² | +25% |
| Handling | turn rate and grip | -15% | 1x | +15% |
| Weight | mass in bumps; light karts also lose more speed when hit by an item | 0.6 | 1.0 | 1.4 |
| Drift | mini-turbo charge time | +20% | 1x | -20% |
| Off-road | speed kept on grass and dirt | 62% | 72% | 85% |

| Class | Drivers | Style |
|---|---|---|
| Light | Pip (chick), Mochi (cat), Fizz (frog), Chip (penguin) | quick to accelerate, nimble, easily shoved |
| Medium | Juno (astronaut), Bolt (robot), Sable (fox), Otto (owl) | all-rounders |
| Heavy | Bruno (bear), Rex (dino), Rocco (rhino), Mabel (elephant) | highest top speed, slow to pick up, shove others aside |

12 drivers so a full 12-kart grid can have a different one in every kart. Every character has its own kart
palette (body, trim, accent, wheels); `src/host/selectLayout.test.ts` checks that every pair differs clearly in colour
(CIE76 delta E). New in this set: **Chip** (glides: handling 5), **Otto** (fast but wide: speed 4, drift 2),
**Rocco** (charges: quick for a heavy, weight 5) and **Mabel** (steady: weight 5, off-road 4).

Kart bodies: **Sprinter** (balanced), **Mudlark** (off-road, heavy, slower), **Comet** (fast, wide turns),
**Splash** (quick and slidey, light). Balance check: a lone bot's lap time for light, medium and heavy
drivers is within about 3.5% on every track (`src/sim/classes.test.ts`), so no class simply wins;
the real differences show up in corners, drifts, grass and bumps.

### Performance

The TV draws the whole scene once per player each frame, so 4 players means 4
renders. To keep 60 fps: shadows are computed once per frame and shared,
all scenery (trees, rocks, houses, grandstands, mountains…) is merged into a
handful of meshes (about 5 draw calls for the whole landscape), and materials
are cheap. If the frame rate (top-right in debug mode) drops below 60, open Settings and lower Graphics.
**Medium** (default) renders at 1 pixel per screen pixel
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
* **Tracks:** [`src/track/tracks/`](src/track/tracks/) (Ember Peaks, Dockside Loop, Cloud Garden, Switchback Summit, Autumn Speedway, Mushroom Valley;
  files starting with `_` are dev-only test tracks, see [`docs/TRACKS.md`](docs/TRACKS.md)).
  A track is a list of control points plus walls, ramps and boost pads placed
  "between point 10 and 11" style. To add one, copy that file, change the
  points, and add it to [`src/track/index.ts`](src/track/index.ts). `npm test`
  checks every track automatically: it can't pass too close to itself, has no
  corner tighter than 15 m, and the grid is on the road.

---

## 6. Milestone 6 test checklist

1. **Practice mode:** open `/host/?drive=2&give=nova` (or `dash`, `slick` (the Peel),
   `ricochet`, `seeker`, `jumble`, `storm`, `rocket`, `random`). Everyone has an endless supply of that item
   so you can try it without hunting boxes. The icon shows in the box at the top
   of each player's view. Use **E** (the keyboard player's ITEM key).
2. **Boxes:** in a normal race (`/host/?drive=2`), look for rows of three rainbow
   "?" cubes on the road. Drive into one: the item box icon spins through the
   items for ~1.6 s and then shows your item. The cube vanishes and comes back
   after 5 s. Driving through a box while holding an item does nothing.
3. **Dash:** tap E: instant boost, with flames. A pack of three shows "x3".
4. **Peel:** tap E to drop a banana-style peel behind you; a bot (or you, circling
   back) that drives over it spins around and loses speed. Hold E: the peel
   drags behind your kart; release to drop it. Try firing a Ricochet at it.
5. **Ricochet / Seeker:** tap E to fire. Ricochet bounces off the tire walls;
   hold **S** (brake) when you let go of E to fire backward. A Seeker curves
   toward the kart ahead of you.
6. **Nova:** the kart glows and shimmers; you ignore grass, and anyone you touch
   spins out; shots and slicks just vanish when they hit you.
7. **Phones:** the roulette animates on the phone, then the item's icon shows in
   the middle (with ×3 for a Dash pack). Tap ITEM (left side, top button) to use
   it. Android buzzes when you get an item, use one, or get hit. The lobby's **Test item** button cycles every icon on a phone.
8. Computer drivers use items too: watch for them dropping peels, firing shots, and the back markers using Rockets and Storms.

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
4. Real lobby flow: open `/host/` and have 2–4 phones join.
   The hint line counts players; when everyone is ready the race starts.
5. Check the frame rate: press **`** to show the fps counter top-right. With 4
   views on your laptop it should stay near 60; if not, Esc → Settings → Graphics → Low and
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
2. Scan the QR code with your iPhone and follow the steps in section 2. The TV
   should show your name in the first slot within a couple of seconds. (Click the X on a
   quadrant to remove a player; the phone shows JOIN AGAIN.)
3. (Keyboard players no longer exist; use `/host/?drive` to drive with WASD.)
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
9. Press READY on every phone. The green
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
