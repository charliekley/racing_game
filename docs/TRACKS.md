# Track overhaul: design contract

Read this before touching anything track-related. Several people (agents) work on
different pieces **in parallel**, so each piece has an owner, a set of files, and an
agreed interface. The data format is `TrackDef` in `src/track/types.ts` (fields marked
"v2" are the new, optional ones).

## Goals

1. **Real elevation**: hills, climbs, descents, bridges, overpasses (a road can cross over another).
2. **Drops**: cliff edges, chasms and bridge edges you can fall off. Falling = the carrier drone respawns you at your last checkpoint (this already exists for water gaps).
3. **Solid scenery**: trees, houses, rocks, grandstands etc. must collide (bounce, lose some speed) like the fences do.
4. **Cannons**: launch you along an arc to another part of the track (a shortcut that is also a thrill).
5. **Shortcuts**: branch roads that rejoin the main road, with fair checkpoint credit.
6. **Jump variety**: kickers, crests, double kickers, chasm jumps, chains of jumps, not one lonely ramp.
7. **Creative tracks**: each with a distinct identity, using all of the above.
8. **Maps** (TV minimap and phone map) that make sense with elevation, crossings, shortcuts, cannons.

Everything must stay original (no Nintendo names/characters/layout copies) and procedural (no model or image files).

## How the world is modelled

* The **main route** is a closed Catmull-Rom loop through `points` (`[x, z]` or `[x, z, height]`). Start/finish is at point 0. Distances along it are `s` (metres).
* `Track` (`src/sim/track.ts`) turns the def into samples (centerline every ~2 m with heading, curvature, bank, width, walls). It also implements `Ground`: `sample(x, z, hint?) => { height, surface, index } | null`. **`null` means "no ground here"**: the kart falls.
* The **terrain** (new) is a height field around the road: natural hills (`TerrainDef`) blended into the road level near the road (so the road never floats or gets buried). Bridge sections are excluded from that blending: under a bridge the ground is the natural terrain. Karts driving on the terrain are on the `'offroad'` surface.
* **Cliffs** remove the ground beyond `edge` on a side for a stretch (`sample` returns `null` there). **Void gaps** (`ramps[].gapKind: 'void'`) remove the road for `gap` metres after a ramp.
* **Falling**: the world respawns a kart that is more than **5 m below the road surface at its nearest track point**, or below an absolute floor of -40 m (replacing the old absolute `KART.respawnFallY`). The respawn point logic (last checkpoint, carrier drone) already exists in `src/sim/world.ts`.
* **Overpasses**: where two parts of the road cross, they must differ in height by at least **7 m** at the crossing. `Track.project(x, z, hint)` uses the kart's last track index as a hint so a kart stays on "its" level.
* **Scenery** is planned by a pure function (placements with positions, sizes, collider shapes) that both the renderer and the simulation consume, so what you see is what you hit.
* **Cannons** capture a kart at the mouth, fly it along a parabola to the target (no control, invulnerable), land it with a short boost, and credit it with the skipped checkpoints via `Race.grantProgress(slot, targetS)` (already implemented).
* **Shortcuts** are secondary roads with their own samples; a kart on a branch has an `s` mapped onto the main route between the junctions, so ranking and lap logic keep working. Passing a branch credits the skipped checkpoints.

## Interfaces each piece will expose (names are fixed so others can build on them)

| Piece | Sim API (`src/sim/…`) | Render API (`src/render/…`) |
|---|---|---|
| Terrain, bridges, cliffs, falling | `track.terrain.height(x, z): number`, `track.bridges: {s0,s1}[]`, `track.cliffs: {s0,s1,side,edge}[]`; `Track.sample` returns `null` over voids | `TerrainView` (height-field mesh, cliff faces, bridge pillars) used by `TrackView` |
| Scenery colliders | `planScenery(track): SceneryPlan` (pure, `src/track/sceneryPlan.ts`), `Colliders` (`src/sim/colliders.ts`) with `collideKart(kart)` | `scenery.ts` builds meshes from the plan |
| Cannons | `track.cannons: ResolvedCannon[]` (mouth `{x,y,z,heading,s}`, landing `{x,y,z,s}`, `flightTime`, `apex`), kart `flight` state, events `cannonFire`/`cannonLand` | `CannonView` (barrel, smoke, kart-in-flight look) |
| Shortcuts | `track.routes: RouteLine[]` (`{ kind: 'main' \| 'shortcut'; surface; points: {x,y,z}[] }`), `track.onRoute(kart)` | route-aware road meshes |
| Jumps | `ramps[]` shapes via `track.rampHeight(s)` (+ lateral where needed) | ramp meshes per shape |
| Maps | uses `track.routes`, `track.bridges`, `track.cliffs`, `track.cannons` | `src/render/minimap.ts`, `src/controller/phoneMap.ts` |

## File ownership (to avoid merge conflicts)

* **Terrain agent**: `src/sim/terrain.ts` (new), `src/sim/track.ts` (surfaceAt/sample/project/terrain parts), `src/render/terrainView.ts` (new), the terrain-plane and road-height parts of `src/render/trackView.ts`, the falling rule in `src/sim/world.ts` (`needsRespawn`), geometry tests in `src/sim/track.test.ts` (crossing rule above).
* **Colliders agent**: `src/render/scenery.ts` (refactor into plan + meshes), `src/track/sceneryPlan.ts` (new), `src/sim/colliders.ts` (new), one hook in `src/sim/world.ts`/`collision.ts`.
* **Cannon agent**: `src/sim/cannon.ts` (new), `src/render/cannonView.ts` (new), flight state in `src/sim/kart.ts`, a hook in `src/sim/world.ts`, cannon parts of `src/host/game.ts` (small).
* Later waves own: shortcuts (`src/sim/track.ts` routes + `src/sim/race.ts`), jumps (ramp code), maps (`minimap.ts`, `phoneMap.ts`, `protocol.ts` track message), and track files in `src/track/tracks/`.
* Anyone may add new files freely. Keep edits to shared files **small, local and well commented**, and don't reformat code you don't own.

## Rules every change must keep

* `npx tsc --noEmit`, `npm test` and `npm run build` pass. Add tests for new logic. The simulation stays pure TypeScript (no Three.js/DOM in `src/sim/` or `src/track/`).
* Performance: 4 split-screen viewports at 60 fps. Merge geometry, instance repeated objects, cheap Lambert materials.
* Existing tracks must keep working (new fields are optional) until the final wave replaces them.
* Original names/art only.

## Planned tracks (wave 2 builds them; they replace Meadow Ring, Sunscorch Canyon, Maple Bay)

1. **Ember Peaks** (volcanic ridge, dusk): climb a switchback to a caldera rim, ridge road with cliffs, a **cannon across the crater** as a shortcut, a chasm jump with a boost pad before it, lava-glow theme.
2. **Dockside Loop** (harbor, evening): a **figure-8 with a bridge overpass**, container-stack and warehouse scenery (solid), water gaps and a chained set of small jumps along the quay, a dirt shortcut behind the warehouses.
3. **Cloud Garden** (sky islands, bright): roads on separate islands joined by **bridges, cannons and big void jumps**, lots of drop-offs, tight loops, a high-risk cannon that skips a whole island.
4. **Switchback Summit** (alpine snow): hairpin climb, long fast downhill with a double kicker, a frozen-lake dirt shortcut, tree-lined (solid) forest section, a ski-jump finale.

Each track must be 1.2–2.0 km, include at least one signature feature from the list above, bots must be able to finish it, and the track geometry tests must pass.

## Terrain, bridges, cliffs, voids: what is implemented (terrain agent)

* `track.terrain` (`src/sim/terrain.ts`): `height(x, z)`, `natural(x, z)`, `roadWeight(dist)`, `roadDistance(x, z)`, `enabled`. Active when the def has `terrain` or `bridges`; otherwise the old flat behaviour is kept exactly.
* `track.bridges`, `track.cliffs`, `track.gaps[].kind` (`'water' | 'void'`), `track.onBridge(s)`, `track.cliffEdgeAt(s, side)` (side -1 = left, +1 = right; Infinity = no cliff), `track.isVoid(p)`, `Track.groundLevel(y, bank, halfWidth, d, offroadWidth)`.
* Cliff `edge` is clamped to the off-road strip's outer edge (road half-width + `offroadWidth`); the last 6 m at each end of a cliff widen back to it. Walls on a cliff side stand AT the edge (guard rail), in the view and in `wallsAt`.
* Falling rule: `world.ts` `FALL_BELOW_ROAD` (5 m below the road at the nearest track point) and `FALL_FLOOR_Y` (-40 m).
* Overpasses: the "never too close to itself" test skips pairs whose heights differ by >= 7 m.
* `src/render/terrainView.ts` builds the ground mesh, cliff/chasm faces, bridge decks and pillars. `src/track/tracks/_terrainTest.ts` is a dev-only figure-8 with a climb, bridge, cliff ridge and void jump (not in `TRACKS`).

## Status

**Wave 1 is merged** (terrain, solid scenery, cannons). What exists now, with real names:

* `track.terrain.height(x, z)`, `track.bridges`, `track.cliffs`, `Track.sample` returning `null` over cliffs/void gaps; relative falling rule in `world.ts` (5 m below the road at the nearest track point, or below -40 m); `ramps[].gapKind: 'void'`.
* `planScenery(track)` (`src/track/sceneryPlan.ts`, pure, stands on `track.terrain`), `Colliders` (`src/sim/colliders.ts`) used by `World`; shots are stopped by solid scenery.
* `track.cannons: ResolvedCannon[]`, kart `flight` state, events `cannonFire` / `cannonLand`, `CannonView`, bots can use cannons; `Race.grantProgress(slot, toS)`.
* `ChaseCamera.update(..., groundAt)` keeps the camera above hills.
* `track.routes: RouteLine[]` (`src/sim/routes.ts`): the shared shape maps draw from. Currently only the main loop; the shortcut code adds branches (`kind: 'shortcut'`).
* Dev-only test tracks `_terrainTest.ts` and `_cannonTest.ts` (not in `TRACKS`).

**Wave 2** (parallel): shortcuts/routes (DONE, see "Shortcuts: what is implemented"; owns the route and branch code in `track.ts`, `race.ts`, `routes.ts`), jump variety (owns ramp shapes: `rampHeight`/ramp meshes), maps (owns `minimap.ts`, `phoneMap.ts`, the `track` protocol message).
**Wave 3 is merged**: `TRACKS` = Ember Peaks, Dockside Loop, Cloud Garden, Switchback Summit. Sunscorch Canyon and Maple Bay are deleted; Meadow Ring lives on as the dev-only flat baseline `_meadowRing.ts` used by tests. Track-added extras: `scenery.blocks` (hand-placed solid container stacks / warehouses, Dockside Loop) and `scenery.openSky` (no horizon hills, Cloud Garden).

**Dev-only tracks**: `DEV_TRACKS` in `src/track/index.ts` (Meadow Ring, Terrain/Cannon/Shortcut/Jump Test). They are never in the lobby; in the dev server open one with `?track=Jump%20Test` etc. The 4-bots-finish test runs on every lobby and dev track.

## Shortcuts: what is implemented (shortcuts agent)

* `TrackDef.shortcuts[]` (`from`, `to`, `points`, `width`, optional branch-local `walls`; `surface` is ignored: every shortcut is a dirt path). Code: `src/sim/shortcuts.ts` (path building, projection), `src/render/branchView.ts` (dirt mesh + fork marker), dev-only test track `src/track/tracks/_shortcutTest.ts` with `src/sim/shortcuts.test.ts`.
* **The main road is never modified by a shortcut** (same samples, kerbs, height, bank and terrain as without it). A shortcut is only a dirt path draped on the terrain: no tarmac, no embankment, no kicker.
* `track.branches: Branch[]` (route ids 1, 2, ...; route 0 = main loop). A branch has its own evenly spaced `samples` (`sample.s` is the MAPPED main-route distance). It starts on the main road's outer edge (just outside the kerb, `startSide`), leaves at `JOIN_ANGLE_DEG` (14 deg) and runs straight for 16 m, follows your control points (`[x, z]`; heights are ignored), then arrives the same way and ends on the main road's edge (`endSide`) at ground level. Shipped-track rule: keep the points so the path hugs the road for a while at each end (a hook near the end looks bad), and keep the natural ground near both junctions within ~15 m of the road level (Switchback Summit has a raised terrain bench round the lake for this).
* **Height:** the natural ground (terrain without the path), lightly smoothed (+/- 6 m) and limited to `MAX_GRADE` (18 %). The terrain is then nudged toward that level under the path (`PathField` in shortcuts.ts, `Terrain.setPaths`, `grooveWeight`): full strength within 60 % of the half width, easing out over 6 m, and never on or beside the main road's strip. Ground on a branch is simply `terrain.height` (surface `'offroad'`, so dirt slows like grass).
* **Hint / index convention:** `Projection` has `route` and `index`; `index = route * 2^20 + sampleIndex` (equals the plain sample index on the main road). Store `projection.index` (not `.i`) as a kart's `trackIndex`; `.i` indexes `track.sampleOf(route, i)`.
* `Projection.s` for a kart on a branch is mapped linearly onto the main route between the junctions, so ranking and the checkpoint rule work unchanged. Driving across the grass earns nothing.
* **Swapping roads:** a kart on the main road's tarmac or kerb is always on route 0. Within `JUNCTION_ZONE` samples of a fork, once it is off the kerb and closer to the path's centerline, it swaps to the branch; on a branch it swaps back as soon as it is on the main tarmac/kerb (or clearly closer to the main road at the same level). No teleport, no special end.
* Rendering: the dirt is one transparent mesh, `DIRT_LIFT` above the terrain, with soft edges (vertex alpha), fading in/out over 5 m at its ends and hidden over the main road. The fork marker (chevron sign + cones) stands on the verge beside the main road before the opening.
* Walls: `wallsAt(i, route)` / `sampleOf(route, i)`; `collideWalls` and the shot bounce use them. Branches have no cliffs, ramps, gaps or boost pads.
* `track.routes` = main line + one `kind: 'shortcut'` `RouteLine` per branch (open polyline, ~8 m points, with y).
* Bots: `BotStyle.shortcutBias` says which slots LIKE shortcuts (slots 0 and 2 > 0.5; tests and the plain autopilot take them every time), but a `BotPack` bot only uses it
  while it is LAGGING (see "Bots and shortcuts"); `track.sampleAhead(route, i, k)` follows a branch back onto the main road.
* Scenery planning keeps clear of branch roads (`distToTrack`).

## Jumps (jump agent): what is implemented

* `ramps[].shape`: `'kicker'` (default, unchanged), `'hump'` (cosine mound, no lip: karts leave the ground over the crest above ~21 m/s), `'double'` (two kickers, `length` is the total). `ramps[].landing` (default true when there is a gap): a 10 m apron after the gap, raised up to 1.2 m at the gap edge and sloping to 0.
* `src/sim/jumps.ts`: `shapeHeight`, `jumpClearance(ramp, speed)` (ballistic, uses `KART.gravity`), `minClearSpeed(ramp)`. Rule of thumb: kicker height 2.2 / length 10 clears a 10 m gap at 20 m/s; 12 m at ~22 m/s.
* `Track.rampHeight(s)` takes the max over all ramps (chains of touching humps are fine); `Track.ramps[]` now has `shape`, `gap`, `landHeight`.
* `kart.ts`: crest launch (`KART.crestMinRise`, `crestLaunchDecel`): a rising grounded kart whose ground bends away faster than ~1.3 g leaves the ground.
* `autopilot.ts`: flat out through ramps of every shape; simple unstick (reverse out when pinned beside the road).
* `src/render/rampView.ts`: all ramp meshes (merged, one mesh per colour). Dev track: `src/track/tracks/_jumpTest.ts` (not in `TRACKS`).

## Maps (maps agent)

* `src/shared/mapDraw.ts` draws both maps (TV `Minimap`, phone `PhoneMap`): height-shaded roads, shortcut branches (thinner; dashed brown when dirt), overpass gaps (`findCrossings`), bridges, cliff ticks, water/void gap notches, cannon icon + dotted arc + target ring, start line, dots. Static layers are cached offscreen (`MapCache`).
* `src/sim/mapData.ts` `mapDataFromTrack(track)` builds the compact `MapData` from `track.routes/bridges/cliffs/gaps/cannons` (≤120 points per route, 0.1 m rounding, ~2–4 KB JSON).
* Protocol: `{ t: 'track', pts, w, map?: MapData }` (`map` optional; phones fall back to `pts`).
* A new track needs nothing special: put roads in `track.routes` (shortcuts: `kind: 'shortcut'`, `surface`) and the maps pick them up.

## Wave 4: twistier layouts + track gimmicks (hazards)

Feedback after play-testing: tracks had long boring straights, and each track needs a
signature moving part / unique risk. Already on main before this wave:

* **Fork markers** (`branchView.ts` `buildForkMarker`): a small chevron sign at the split and a row of cones. No text.
* **Skipped checkpoints** (`race.ts`): a forward jump in `s` of <= `SKIP_CREDIT_DISTANCE` (30 m) past a checkpoint is credited; a bigger one, held for `OFF_COURSE_SECONDS` (0.3 s), raises the race event `offCourse` and `World` carries the kart back to its last checkpoint (it emits a normal `respawn`). Test: `src/sim/cutting.test.ts`.
* **No cutting between parallel legs**: separate legs that run side by side (switchbacks, hairpin pairs) with walls on the facing sides, a cliff/drop, or >= 7 m of height. Keep the walls off hairpin apexes and exits (bots and class balance suffer otherwise).

### Layout rules (enforced by `src/track/layout.test.ts`, every track in `TRACKS`)

Measured on `track.samples` (`curvature` in 1/m, `spacing` m):

| Rule | Limit |
|---|---|
| Length | 1200 to 2000 m |
| "Straight" = a run of samples with \|curvature\| < 1/250 | every straight <= 100 m; at most ONE up to 150 m (a set-up straight for a jump, cannon or slipstream fight) |
| Curved share (\|curvature\| >= 1/250) | >= 70 % of the lap |
| Total turning, sum of \|curvature\| x spacing | >= 1260 degrees per lap |
| Tight corners (separate runs with radius < 60 m) | >= 8 |
| Height range of the main road | >= 12 m |

Before this wave (curved %, longest straight, turning, tight corners): Ember 61 % / 284 m / 957 deg / 10, Dockside 63 / 188 / 639 / 4, Cloud 61 / 382 / 999 / 12, Switchback 58 / 150 / 1008 / 7.
Vocabulary: S-bends, chicanes, hairpins, long sweepers, decreasing-radius corners, blind crests (a hump or height change right before a corner), dips. Keep every existing feature (cannons, shortcuts, bridges, overpasses with >= 7 m, jumps, cliffs, boost pads). Bots must finish on every difficulty; all existing tests must pass (class balance included).

### Hazards: the contract

A hazard is a moving object or timed danger on a track. **Its state is a pure function of the race clock** (`race.time`, s, negative during the countdown): no random numbers, no state carried between ticks. So sim, renderer (interpolated time) and bots agree, and replays are exact.

**Data**: `src/track/hazardTypes.ts` (new) and `TrackDef.hazards?: HazardDef[]` in `types.ts`. Every def has `kind`, `period` (s), `phase` (s, default 0) and a position in control-point units. Agents may add optional fields to their own kind.

| kind | Track | What it does | Telegraph (before it hits) |
|---|---|---|---|
| `geyser` | Ember Peaks | Lava geyser at `at` + `offset` (lateral -1..1), radius ~3 m, erupts ~1.2 s each `period`. Hit = spin-out + small upward pop. Several, staggered, so a free lane always exists. | ~1.5 s: glowing crack, sparks, rumble, steam |
| `drawbridge` | Dockside Loop | Bridge over water `from`..`to`, two leaves. Cycle: down, rising, up, lowering. Rising/up, each leaf is a kicker: at speed you jump the opening, too slow and you drop into the water (normal respawn). | bell + flashing lights ~2 s before it moves |
| `gust` | Cloud Garden | Wind on `from`..`to` pushes karts sideways (`dir`, `strength` m/s²) ~1.5 s each `period`, at exposed edges and bridges. | ~1.5 s: wind streaks + rising whistle |
| `roller` | Switchback Summit | Snowballs roll across the road (moving sphere collider on a path at `at`, from beyond one road edge to beyond the other) once per `period`. Hit = spin-out. | rumble + snow puffs up the slope ~1.5 s before |

**Sim API** (`src/sim/hazards/`, new, pure TS):

```ts
export type HazardPhase = 'idle' | 'warn' | 'active';
export interface HazardPose { phase: HazardPhase; t: number /* 0..1 within the phase */; [k: string]: unknown /* kind data */ }
export interface Hazard {
  readonly id: number;            // index in def.hazards
  readonly kind: HazardDef['kind'];
  readonly s: number;             // main-route distance (m), for bots, audio and maps
  pose(time: number): HazardPose; // PURE
  /** Apply to one kart this tick. Respect invulnTime, respawnTime and flight. */
  affect(k: KartState, time: number, dt: number, c: KartConfig): 'hit' | 'push' | null;
  /** Ground override (drawbridge): a height, null = no ground (fall), undefined = not mine. */
  groundAt?(x: number, z: number, time: number): number | null | undefined;
  /** 0..1 danger for a kart at main-route distance s, lateral offset d, `ahead` seconds from now (bots). */
  danger(s: number, d: number, time: number, ahead: number): number;
}
export class HazardSystem {
  constructor(track: Track);   // one Hazard per def, via a registry kind -> factory
  readonly list: Hazard[];
  step(time: number, karts: Map<number, KartState>, configOf: (slot: number) => KartConfig): HazardEvent[];
  wrapGround(g: Ground): Ground; // applies groundAt; World passes this to stepKart
  dangerAhead(k: KartState, track: Track, time: number): { brake: number; steer: number }; // bot advice
}
export type HazardEvent =
  | { kind: 'hazardWarn'; hazard: number; type: HazardDef['kind']; near: number[] } // near = slots within 150 m
  | { kind: 'hazardFire'; hazard: number; type: HazardDef['kind']; near: number[] }
  | { kind: 'hazardHit'; slot: number; hazard: number; type: HazardDef['kind'] };
```

* `World.hazards: HazardSystem | null` (built in `startRace`; null when the track has none). `tick` calls `step(race.time, ...)` after kart physics, adds the events to `WorldEvent`, and gives kart physics `wrapGround(ground)`.
* **Bots** (`bots.ts`) use `world.hazards?.dangerAhead(...)` to lift, brake or steer away; on hard they mostly avoid hazards. Bots must still finish every track on every difficulty.
* **Render** (`src/render/hazards/`, new): `HazardViews.update(time)` called from `game.ts` with the interpolated race time, one view file per kind. Warnings visible in all 4 viewports without HUD text (light, particles, motion). Cheap on Low quality.
* **Audio**: sound ids `hazardWarn`, `geyser`, `bridgeBell`, `bridgeMove`, `gust`, `roller`, `hazardHit` (synth recipes in `synth.ts`, mapping in `mapping.ts`): play only when a human slot is in `near`, or when the human is the one hit.
* **Tests**: pose is periodic and pure; hits and misses where expected; a kart parked in a geyser/roller path is hit once per cycle (invuln respected); bots finish every track with hazards on every difficulty.

### Hazards + Ember Peaks: what is implemented (hazards agent)

* **Data**: `src/track/hazardTypes.ts` (`GeyserDef`, `DrawbridgeDef`, `GustDef`, `RollerDef`, union `HazardDef`), `TrackDef.hazards`.
* **Sim** (`src/sim/hazards/`): `types.ts` (`Hazard`, `HazardPose`, `HazardEvent`, `BotAdvice`), `cycle.ts` (`cyclePose`: idle, warn, active; the cycle always ENDS with the dangerous part, `phase` slides it), `geyser.ts`, `registry.ts` (kind -> factory; `drawbridge`, `gust`, `roller` throw "not built yet" only when a track uses them; replace the `notBuilt(...)` entry with a factory), `system.ts` (`HazardSystem`). Add a kind: write a class implementing `Hazard`, one line in the registry, one view file in `src/render/hazards/`.
* **World** (`world.ts`): `world.hazards` (null without hazards), `step(race.time, ...)` right after kart physics (not during the countdown), `wrapGround` handed to `stepKart`, `HazardEvent`s are `WorldEvent`s.
* **Bots** (`bots.ts`): `dangerAhead(k, track, time, lane)` returns `steer` (sideways shift in metres, + = right, from the kart's current position) and `brake` (0..1). The bot moves its line (smoothed) or lifts / brakes when every lane is blocked. Easy bots react at 75 %, hard at 100 %.
* **Geyser**: hit radius = radius + 0.9 m, only while `active`, `spinOut` + `vel.y = 7` pop; invulnTime / starTime / respawn / cannon flight protect; karts more than 4 m above or 3 m below it are safe (overpasses).
* **Render** (`src/render/hazards/`): `HazardViews.update(time, focus)`, `geyserView.ts` (instanced scorch, crack, light halo, lava column with HDR colour; `geyserLook` is the pure animation curve). `game.ts` calls it with `race.time - (1 - alpha) * SIM_DT`.
* **Audio**: ids `hazardWarn, geyser, bridgeBell, bridgeMove, gust, roller, hazardHit`; `hazardSound(type, fire)` in `mapping.ts` picks the sound per kind; warn/fire play only if a human slot is in `near`; `hazardHit` only for the human who was hit.
* **Ember Peaks** (`emberPeaks.ts`): points are built from a named `route` list (`at('name')` gives the control-point position). Measured: 1958 m, 77 % curved, longest straight 126 m (the chasm run-up), 1584 degrees of turning, 28 tight corners (R < 60 m, minimum radius about 18 m), height range 31 m. Five slalom pairs of geysers (period 7 s, staggered phases), walls on the facing sides of the parallel legs, cannon, ridge cliffs, chasm and boost pads kept.

### Roller (Switchback Summit): what is implemented

* **Sim** (`src/sim/hazards/roller.ts`): a ball starts on the slope side (`from`; -1 on Switchback, the north slope), accelerates down (`d = 6t + t^2`), crosses the road along its sideways line (about 1.3 s over the 14 m road) and bursts 5 m past the far edge. `warn` = 1.5 s before it reaches the road edge, `active` = crossing + burst. Radius 1.5 m growing 25 %. Hit = `spinOut` plus a 7 m/s shove along the ball's direction; respects invuln, Nova, respawn, flight and height. `danger` samples the ball at arrival time +-0.3 s, so bots shift lane or lift.
* **View** (`src/render/hazards/rollerView.ts`): instanced lumpy snowball (vertex-coloured, rolls by the sim's `roll` angle), shadow blob, snow puffs, sparkles, burst; 2 draw calls on every quality, particles scaled by quality.
* **Track**: four balls (period 9 s, phases 0/2.3/4.6/6.8 s; 8 s made normal-bot class balance fail by 0.0003) at points 59.9, 61.0, 62.1, 63.2. The old hill feature never reached the road (the road is a 40 m embankment), so it was replaced by two hills that rise to the north of points 59-64. Points 64-72 have no slope. Tests: `src/sim/hazards/roller.test.ts`.

### Drawbridge (Dockside Loop) and wind gusts (Cloud Garden): what is implemented
* **Drawbridge** (`sim/hazards/drawbridge.ts`, `render/hazards/drawbridgeView.ts`, `DrawbridgeDef` has optional `gap`, `lift`, `warn`, `rise`, `hold`, `lower`). Dockside points 57 to 60, period 24 s (down about 14 s, bell and lights 2 s, rising 2 s, up 4 s, lowering 2 s). `Track` adds the 12 m opening as a static water gap for every drawbridge (so the road mesh and minimap show it); `groundAt` fills it with the flat road while down and makes two kicker wedges (tip 3.8 m, reach 25 m down to 19 m up, i.e. the leaves "roll back") with `null` between the tips. A kart needs about 26 m/s to clear it (`clearSpeed()`; top speed 28, boost pad 37). A kart that falls short is bounced off the far leaf's end face (`affect`, one `hazardHit`) instead of being snapped up onto it, then falls and respawns. The old kicker at 57.5 is gone.
* **Gust** (`sim/hazards/gust.ts`, `gustView.ts`): three gusts on Cloud Garden's exposed bridges (11.2-14.9 dir +1 period 9, 49.2-53.8 dir -1 period 10, 85.1-89.9 dir +1 period 11), warn 1.5 s, active 1.5 s, strength 42 m/s^2 (an unsteered kart drifts about 5 m: fine from the middle, over the edge from the downwind half; steering into the wind cancels it). Push is applied in `affect` to karts on the stretch at the same level.
* **Bots**: `Hazard` got optional `halfLength` (bots see the whole stretch) and `botCommits(speed, boosting)`; the drawbridge waits (lift, then brake) unless the kart is fast or boosting, gusts mark the downwind half as blocked so bots move upwind.
* **Views**: bridge = two road-textured leaves with striped tips, four towers with gantries, sliding counterweights, amber then red HDR lamps flashing alternately. Gust = instanced wind streaks (fewer on Low) and windsocks on poles at both ends of the stretch.
* Tests: `drawbridge.test.ts`, `gust.test.ts`; bots finishing is covered for every track in `bots.test.ts`.

### Who owns what (wave 4)

| Agent | Owns |
|---|---|
| **hazards + Ember** | `src/sim/hazards/**`, `src/track/hazardTypes.ts`, the `hazards` field in `types.ts`, hooks in `world.ts` and `bots.ts`, `src/render/hazards/**`, wiring in `src/host/game.ts`, all hazard sounds in `src/audio/**`, Ember Peaks redesign + geysers (`emberPeaks.ts`, `emberPeaks.test.ts`). Built `geyser`. |
| **layouts** | Redesign of `docksideLoop.ts`, `cloudGarden.ts`, `switchbackSummit.ts` (+ their tests), new `src/track/layout.test.ts`. Leaves room for the gimmicks: Dockside a 40-60 m straight water crossing with a set-up straight before it (drawbridge); Cloud 2-3 exposed bridges/edges (gusts); Switchback a downhill stretch with open slope on one side (rollers). |
| later: **dockside + cloud gimmicks** | `drawbridge` and `gust` kinds (sim + view files), those two track files |
| later: **switchback gimmick** | `roller` kind (sim + view file), `switchbackSummit.ts` |

### Mandatory cannons (Ember Peaks, Cloud Garden)

* `CannonDef.mandatory: true`: the cannon is not a shortcut but the only way on. `Track` adds a `Gap` of `kind: 'sky'` from `mouth.s + CANNON.padAhead` (7 m, the launch pad) to `landing.s - CANNON.landBehind` (10 m, the landing platform). `track.inSkyGap(s)`; `inGap` is true too, so respawns never land in it. In the gap `Track.sample` is `null` (no ground beside the road either, up to the off-road strip + 1 m); the road mesh and rails are left out, the terrain is NOT cut or blended toward the road there (a crater with lava, or open sky). The main-route control points across the gap are only a straight line.
* Capture (`onLaunchPad` in `sim/cannon.ts`): a LINE across the road and the off-road strip (`captureHalfWidth`), from 1.5 m before the mouth to the end of the pad. Speed, spinning and hopping do not matter, so every kart is fired. A kart that gets past it (outside the strip, in the gap) falls and respawns before the pad by the normal rule. Walls funnel the last stretch into the pad. Bots need nothing special (no shortcutBias). Landing credit is the existing `grantProgress`.
* View: `cannonView.ts` adds a launch gate (pylons, crossbar, glowing line) and full-width chevrons for a mandatory cannon. Maps: the sky gap is not a notch and the main line is an OPEN polyline from the landing round to the pad (`mapData.ts`); the cannon arc shows the flight.
* Layout rules (`layoutStats.ts`) leave the sky gap out of straights, curved share, turning and tight corners (length still counts it).
* **Ember Peaks**: the road ends at a pad on the south rim; 173 m of air (flight 4.4 s, apex 16 m) over the crater (deepened to -62 m, lava lake about 35 m below) to the north rim. The rim ridge is gone; cliffs now line the far-rim sweep, geysers moved to the far slope. Hairpin 2 was moved east (shorter climb) so slow classes still finish within the 20 s grace now that everybody uses the cannon. 1.7 km, 75 % curved.
* **Cloud Garden**: island D ends at a pad; 177 m of sky (flight 4.6 s) to island E. The old second void jump and bridge-3 numbers moved (bridge 3 is now points 78 to 83). Tests: `src/sim/mandatoryCannon.test.ts`.

## Autumn Speedway (5th track, the showcase): what is implemented

An original **treetop course**: wooden branch roads and plank walkways through a forest of giant autumn trees,
a rope bridge, a spiral round the biggest trunk, a jump between two crowns and one long steep plunge back to
the forest floor. 3 laps, about 1.45 km (trimmed twice: 1.73 km / ~64 s per normal-bot lap before the second trim, now about 53-55 s, so 3 laps take a
person about 2:30-2:40: the Mossy Hollow run is shorter, the spiral is ONE turn of radius 30 m with the crown at 66 m (the deck carries straight on west over
the road that fed the spiral), and the plunge is one diagonal branch of about 230 m). Lobby index 4 (`?track=4`), 5th race of the Grand Prix.

### Layout (`src/track/tracks/autumnSpeedway.ts`, north = +z)

| # | Section | Height | What happens |
|---|---|---|---|
| 1 | Mossy Hollow | 3-5 m | start on the floor, S-bends (min radius 16 m), an acorn beetle |
| 2 | Root Ramp | 5 -> 28 m | S-shaped climb onto the first branch (~14 %) |
| 3 | Branch road | 28-31 m | winding plank road, the ROPE BRIDGE (sags, no rails, three springy rope humps to trick off), a tight hairpin round the Lantern Oak (lanterns), an S-bend west |
| 4 | The Spiral | 28 -> 66 m | one turn clockwise round the Great Trunk (radius 30 m, trunk radius 14.5 m), ~20 % all the way up |
| 5 | Crown deck + jump | 66 m | boost pad, kicker, 12 m void gap to the neighbouring crown (the deck heads west, directly above the road that fed the spiral) |
| 6 | The Plunge | 65 -> 10 m | a crest, then one winding diagonal branch dropping ~55 m at up to ~33 % |
| 7 | Acorn Hollow | 3-9 m | S-bends on the floor, two acorn beetles, the ROOT RIDGE SHORTCUT |

The spiral and the hairpin are exact circle arcs (`arc()` helper); important points are named (`at('spiral')`).
The lap is 3 laps x ~1.45 km: bots (normal, 4 on the road) lap in about 53-55 s (the bot test bounds: 1.3 to 1.6 km).
Everything above the floor is a `bridge` (natural forest floor underneath; fall off = respawn by the usual rule).
Walls (wooden guard rails) line the high road except the rope bridge. The spiral's turns pass over each other
40+ m apart (the >= 7 m rule).

### Slopes

`layoutStats()` now also reports `maxClimb`, `maxDrop` (steepest grade over 10 m, ramps excluded), `meanGrade`
and `steepShare` (share of the lap steeper than 8 %).

| Track | max climb | max drop | mean grade | share > 8 % |
|---|---|---|---|---|
| Ember Peaks | 19.5 % (the short ramp up to the cannon pad) | 8.7 % | 3.4 % | 7 % |
| Dockside Loop | 5.4 % | 6.0 % | 1.5 % | 0 % |
| Cloud Garden | 4.2 % | 4.8 % | 1.9 % | 0 % |
| Switchback Summit | 7.2 % | 8.9 % | 4.4 % | 3 % |
| **Autumn Speedway** | **~25 %** (spiral) | **~34 %** (plunge) | **~10 %** | **~39 %** |

Why this is fine for the physics: slopes do not change kart speed in this game (no gravity along the road), the
ground snap (`KART.groundSnap` 0.35 m per tick) keeps a kart on a 34 % drop even at boost speed (37 m/s moves
0.62 m per tick, so it drops 0.21 m per tick), and the hump at the top of the plunge is the only place that
launches karts (crest rule). Bots finish every difficulty with no falls; the chase camera keeps its clearance
(`groundAt`). Steeper than ~40 % would start to throw karts off convex bends at boost speed.

### Set pieces and data added for it (all optional, other tracks unchanged)

* `scenery.treetop` (`TreetopDef`, `types.ts`): `giantTrees` (`GiantTreeDef`: x, z, radius, height, crown,
  `lanterns`), `forest` (count + seed: extra giants scattered by the planner, clear of every road), `leafPiles`.
  Giant trunks are SOLID: `planScenery` adds a circle collider (radius, full height) and reserves the ground.
* `BridgeDef.look: 'rope'`: drawn as a rope bridge (posts, sagging ropes, hangers) and it has NO piers
  (`sim/bridgePillars.ts` skips it: what you see is what you hit).
* New hazard kind **`beetle`** (`sim/hazards/beetle.ts`, `render/hazards/beetleView.ts`, test `beetle.test.ts`):
  an original "acorn beetle" (glossy chestnut body, scaly acorn-cap shell with a stalk, big eyes, curly antennae)
  marches back and forth across the road, `lat = span * sin(2 pi t / period)` (pure function of the race clock).
  Touching it bounces the kart back hard (inward velocity reversed + a shove), NO spin-out; Nova drives through;
  bots read `danger()`. Three beetles, period 9 s, staggered. It has no sound of its own yet (audio mapping
  falls back to the generic hazard hit).
* **Root ridge shortcut**: a 6 m wide dirt path along a narrow terrain ridge (a chain of small steep mounds in
  `terrain.features`, hollows either side) across Acorn Hollow; 0.69 x the road it skips (dirt is 0.72 x speed,
  so it pays off with a boost, and it is risky: the ground drops 4-11 m within 6 m of the path; fall and you
  respawn). Bark roots line both edges (`buildShortcutRoots`).
* Rendering (`src/render/env/treetop.ts`): giant trees (bark lathe with ridges and moss, roots, limbs and lumpy
  crowns in red/orange/gold, kept out of the road space by `RoadSpace`), branch logs under the plank roads,
  trunk brackets where a road hugs a trunk, rope bridges, lanterns, leaf piles, root curbs, falling leaves (one
  instanced draw call animated in the vertex shader by `ENV_TIME`; a third of them on Low), the plank road
  texture, and the hazy forest backdrop (`forestBackdropGeo`, used by `scenery.ts` instead of mountains).
  `trackView.ts` / `terrainView.ts` / `rampView.ts` switch to wood only when `scenery.treetop` is set: plank road,
  wooden edge beams instead of kerbs, plank parapets with log posts instead of jersey barriers, log piers, wooden
  deck sides, plank-built ramps, no rock walls under a gap in a branch road.
* Lighting: new mood `'autumn'` (`scene.ts`): low golden sun, warm haze, stronger saturation and bloom.
* Lobby preview card: `trackShot.ts` frames the spiral round the Great Trunk.
* Map message: very long bridges are thinned to 80 points (`sim/mapData.ts`), so the phone map stays small.
* Music: its own tune (`audio/songs.ts`, E dorian, 134 bpm).

### Tests

`autumnSpeedway.test.ts`: length, features, steepest track (steeper than every other track), spiral levels
>= 7 m apart and clear of the trunk, the ridge shortcut is short and really a ridge, bots of every difficulty
finish 3 laps with fewer than 3 respawns. Plus the generic ones (layout, track, 12-kart grid, bots, maps,
scenery plan, class balance).

## Mushroom Valley (6th track): what is implemented

An original **mountain trail over misty gorges**. Giant mushrooms rise out of the chasms: **orange caps are
trampolines** (touch one and you are thrown along a big floaty arc), **green caps are solid ground** (platforms and
bridges). Lobby index 5 (`?track=5`), 6th and last race of the Grand Prix. 3 laps, 1.60 km (trimmed twice, the second time by ~10 %: the long road home after the cave is gone, see "The cliff"), normal bots lap in
about 55-58 s, so 3 laps take a person about 2:45; climbs up to 15 % (the switchback legs), descents up to 11 % (the cliff's gap is not driven), height range ~41 m.

### Layout (`src/track/tracks/mushroomValley.ts`, anticlockwise-ish lap, start line at the foot of the mountain)

The route is written with a small **turtle** (`line(len, dy)`, `turn(r, deg, dy)`, `wiggle`, `mark(name)`): every bend is an
exact circle arc, so the turning radius is known (>= 28 m everywhere: the bots never brake for a bend, which keeps the three
weight classes within the balance limits), and the mountain is re-shaped by changing a few numbers. The last turn's radius is
computed so that the lap closes exactly (the file throws if it cannot). Caps and shortcuts are placed with `local(name, ds,
lat)` ("so many metres along the road from a named point, so many metres to the right"), which follows the road round its bends.

| # | Section | Height | What happens |
|---|---|---|---|
| 1 | Foothills | 30-32 m | start line, three bends, boost pad |
| 2 | Switchbacks | 32-72 m | three hairpins (r 30) up the east face, legs of 34 m and 14-15 % between them, the fence on the outside of every bend |
| 3 | **Sky Leap** | 72 -> 69 m | the ridge turns north-west (`RIDGE_TILT`, 28 degrees), a boost pad, then a 50 m gorge with ONE huge orange cap (r 11): a single 1.8 s bounce, apex 10 m, lands on the far road |
| 4 | **Stepping Stones** | 71 -> 69 m | the ridge winds on; a 62 m gorge crossed on a snaking path of five green caps (r 9.5) |
| 5 | **Twin Spans** (choice 1) | 67 -> 64 m | down the west face to an 84 m gorge. Main road: seven overlapping green caps. Shortcut (left, `shortcuts[0]`): three orange caps held over a pit, hop, hop, land |
| 6 | **The cave** (choice 2) | 63 -> 61 m | a long bend into a glowing cave; 126 m chasm with an S-bend inside. Main road: nine green caps. Shortcut (right, `shortcuts[1]`): four orange caps (hops of 40 m, 1.4 s) |
| 7 | **The cliff** | 57 -> 30 m | out of the cave a left bend swings the road back towards the start line, an S-curve, a boost pad, and a LIP: one huge orange cap (r 11, 2.1 s in the air, apex ~6 m) throws every kart over a 54 m gap and down 21 m onto the road below, which runs a short way to a last right bend that closes the lap 34 m before the start line |

The lap is a compact loop (about 340 x 520 m): the ridge leaves the crest to the north-west so the west face (Twin Spans, the cave) starts high
and its foot is close to the start line (a due-west ridge put the cave's exit 310 m south of the line and needed a 460 m road home). The way
home is solved in code: a first left bend whose angle is the smallest one that leaves the last bend a radius of at least `MIN_HOME_R`, then a straight
(run-up, cliff, landing) and the last right bend, with the straight's length and the bend's radius solved so the lap closes exactly (the file throws if not).

**The cliff and entry speed**: the cliff cap's aim point is deep inside the landing (`CLIFF_LEN + 32` m past the lip), so a kart that carries a
shortfall (entering slower than 20 m/s) still lands on the road, and one entering at up to 40 m/s (a boosted top speed) lands on the target.
The gap's control points drop 21 m, far more steeply than any road: `layoutStats` leaves every grade window that touches a gap out of the slope figures.

Item rows come every ~124 m (`TrackDef.itemRowSpacing` 130 m, default 260 m for other tracks, 13 rows; the test wants a row within 170 m before and after every chasm),
and there are five chasms now (three gorges, the cave and the cliff).

### Fun rules of thumb

* Bounces are **big and floaty**: the arc of a hop is chosen by `CapDef.air` (time in the air) so the apex is 5-10 m; a trick in
  the air pays out the usual boost on landing. The orange shortcut hops are flown at about 42 m/s (`SHORTCUT_SPEED`, flat 2-4 m arcs) on a
  full-speed hard-packed branch (`ShortcutDef.surface: 'road'`), so flown well (and tricked) the orange route is about 1.0 s (Twin Spans) /
  0.9 s (cave) quicker than the green crossing (a bot flying it; `airControl.test.ts`), and slower when flown badly.
* Two **risk / reward** choices every lap (Twin Spans and the cave) plus the two forced leaps (Sky Leap, the cliff) and the green bridge
  (Stepping Stones). **Entry speed is forgiven** (`BOUNCE.fastFree` 12 / `slowFree` 8 m/s, see bouncers.ts): a straight, centred kart at
  20, 28, 32 or 38 m/s lands every orange chain (Twin Spans, the cave) and the Sky Leap with no input at all (`airControl.test.ts`); the skill is lining up
  sideways (off-centre or angled entries still miss), not crawling in or lifting off the gas. (An error that is carried from one hop of a chain to the next is not
  forgiven again.) Bots take the shortcuts only when they lag, see "Bots and shortcuts" below.
* The first cap of a shortcut is only about 20 m from the road's edge, so a bot (or a player) has to commit at the fork.

### The two shortcuts and the cave routes

* **Main road**: green caps, drive straight across; edges drop away.
* **Shortcuts** (`shortcuts[]`): a dirt path that leaves the main road before the chasm, runs beside it and rejoins after it.
  Its middle is HELD at the chasm's height (`ShortcutDef.hold: true`: the third number of each `[x, z, height]` point), far
  above the pit (negative terrain features under the path), and the orange caps are the only ground there; the last cap throws
  you onto the dirt past the pit. Both routes give race progress (the branch maps onto the main road's `s`), minimap lines and
  seeker/rocket paths exactly as the Autumn Speedway shortcut does.

### Bouncy caps (sim: `src/sim/bouncers.ts`, test `bouncers.test.ts`)

A cap is `CapDef` (`types.ts`): a circle (centre, `radius`, top height) with `kind: 'orange' | 'green'`. In the world:
`Bouncers.wrapGround` makes every cap ground (`max(base ground, cap surface)`, surface 'road'), and `Bouncers.step` runs right
after kart physics each tick.

* **Domed surface**: the cap is highest in the middle (`y`) and sinks by `CAP_DROOP` (6 %) of its radius at the rim:
  `height(r) = y - 0.06 r^2 / radius`. The renderer draws the same dome. Overlapping caps: the highest surface wins.
* **Touch rule**: the kart is inside the disc, no more than `BOUNCE.touchAbove` (0.15 m) above the surface and no more than
  `touchBelow` (0.6 m) below it, and grounded or falling.
* **Arc** (`bounceArc`): from the kart's own position to the cap's target (the next cap, or a point on the far road / dirt):
  time in the air `T` = `CapDef.air` if given, else `clamp(distance / 25 m/s, 1.3 s, 2.1 s)`; horizontal speed `D / T`, launch
  speed `vy = (dy + g T^2 / 2) / T`. Apex limit in the tests: 11 m; speed limit 32 m/s.
* **Air control, no guidance (since the skill pass)**: the arc is aimed at the target, but the kart keeps part of how it arrived:
  launch velocity = ideal + `carryLateral` 0.9 (sideways / angle error) and `carryForward` 0.8 (too slow / too fast vs `refSpeed` 28 m/s, or vs
  the previous hop's ideal velocity on a chain) of the entry error (each capped at `carryMax` 14 m/s), and `keepOffset` 0.5 of the offset from the
  cap's centre. In the air steering pushes the kart sideways (`airLateralAccel` 24 m/s^2, capped at 12 m/s) and gas / brake nudge it forward / back
  (8 m/s^2, cap 7 m/s); `World.tick` feeds `stepKart` zero steering during a flight so only this applies. A good entry lands without input; a bad
  angle, off-centre or slow entry drifts off the 8-8.5 m cap and into the abyss unless corrected. Bots fly with `Bouncers.pilot` (predicts the landing
  and steers / pedals; easy bots aim 1.5 m to one side). Old rule, for reference: heading and speed were forced at the target every tick. The kart's "which road am I on" hint
  (`trackIndex`) is refreshed every tick of the flight (over a chasm nothing else updates it; on a 60 m flight it would
  otherwise fall behind the road search window and the landing would be looked up on the wrong part of the road).
* **Tricks**: the bounce sets `trickable`, so the normal trick in the air pays out the usual boost on landing.
* **Event**: `{ kind: 'bounce', slot, cap }` (audio `bounce` = a springy "boing"; a short double buzz on the phone, `HAPTICS.bounce`).
* `TrackDef.chasms` = a void gap in the MAIN road with no ramp (`track.ts` adds it to `gaps`). `TrackDef.itemRowSpacing`
  (optional) sets the metres between item-box rows.

### Look (`src/render/env/mushroom.ts`, gated by `scenery.mushroom`)

* **Road**: a packed-earth **mountain trail** (`trailTexture`: tan earth, two wheel ruts, small stones, no lane lines), rough
  stone edges (`rockMaps`), a low stone wall topped with wooden posts and two ropes as the barrier (`STONE_WALL_PROFILE`);
  the verges under the cave's roof are dark rock. All of that is `if (mushroom)` in `trackView.ts`; the other tracks keep
  asphalt, kerbs and jersey walls.
* **Caps**: big domed caps (radius 8-11 m), a thick rolled rim, a bowl-shaped underside with radial gill stripes, round cream
  spots (little discs lying on the dome), thick stalks with a ruffled skirt ring that fade into the mist. Green caps and ALL
  stalks are merged into static meshes (one per ~150 m of road, so the far ones are culled); the orange caps are ONE instanced
  mesh, each with its own matrix: when a kart is thrown off one it squashes and rings back (`wobbleScale`: squash 34 %,
  2.7 Hz; render-only, driven from `TrackView.updateKarts`). **Orange caps have a glowing yellow-orange rim** (a second
  instanced mesh with HDR colours that pulses): bouncy = glowing, solid = plain green.
* **Mist**: four soft cloud layers (a tiling canvas texture, no files) under every gorge and the cave pit: one merged mesh.
  The clouds **drift**: a per-layer `drift` attribute and three lines of GLSL (`onBeforeCompile`) scroll the texture
  coordinates by `drift x time`, each layer its own direction and speed; the quad's own edges fade out.
* **Cave**: a dark rock vault over the cave stretch (darker inside, grassy hill outside), the terrain and the road verges under
  it are painted dark rock (`caveFootprint`), ~110 stalactites (instanced cones), glowing mushrooms on the roof and standing
  beside the road, and soft additive **light pools** in teal/violet/pink on the floor (no real lights: cheap).
* **Gorge walls**: `TerrainView` draws the gorge walls with a rock-coloured top edge and tapers the wall bumps to zero at the
  corners (`WallSink.wall(..., taper)`), so two walls meet exactly (a bump pushed along two directions used to leave a thin
  pale slit at the corner). No hot-air balloons on this track (`extras.ts`).
* **Mountain**: the terrain is a sum of bumps fitted to the road (`massif()` in the track file: one bump per ~30 m of road, its
  height solved so that the natural ground lies 2 m below the road), a broad foothill under the whole course and a ring of
  peaks (`FOOTHILLS`). There are no `cliffs` (a cliff cuts the ground away on a whole side, in a wedge reaching to the
  horizon): the mountain's own steep flanks fall away outside the rope-fence walls. The pits under the shortcuts and the cave
  are negative bumps (`pit()`); the gorge walls come from `chasms`.
* Perf (Low quality, `renderer.info`, one frame): 100-205 draw calls, 195-290 k triangles (Autumn Speedway: see the report).

### Tests

`mushroomValley.test.ts`: length and slopes (climb up to 20 %, a height range over 40 m), a real mountain road (>= 8 tight corners),
four chasms with the right caps in each, every arc's apex (<= 11 m, one over 8 m) and speed, landing on solid ground at the
height the arc was worked out for, caps 6-12 m wide inside the corridor, two choices per lap (both shortcuts really driven, same
time within 7 %, lap 55-80 s, no respawns), item rows either side of every crossing, bots of every difficulty finish 3 laps and
really bounce, 12 hard bots too. `bouncers.test.ts`: arc maths, crossing at every speed, off-centre and angled entries, guided
flights, tricks, solid green caps, no bounce from below, caps are ground.

### Mushroom Valley: open gorges (valleys)

The gorges used to be slots cut through one wide massif. Now the terrain def carries `valleys`, `valleyFloor`, `valleyKeep` and `ceiling`
(`src/track/types.ts`, built in `Track.setupValleys/setupCeiling`, applied in `Terrain.natural`): beside every gorge the natural ground
is carved down to the cloud sea (flanks ~10 m wide, out to 95 m, easing out by 150 m, along-road fade 40-45 m), the road segments inside
the chasm are left out of the road blend, so the course is a ridge between broad abysses and the caps stand on stalks over open air. The
cave hill is a mesa: only the ground outside the shell (44 m left / 74 m right of the road) is carved. `ceiling` stops lone spires
(ground may rise at most 6 m + 0.45 m per metre beyond 20 m above the nearest road); `valleyKeep` discs hold the pillars under the Twin
Spans shortcut ledges. The renderer draws no side walls along an open gap (only the ends).

### Mushroom Valley: flush bridges, clear branch gaps, descent (skill pass)

* **Green bridges are the road**: a green cap's ground is exactly the main road's own height line (centre line + banking, `Bouncers.groundTop`),
  so the first / last cap meets the road with no step (a 3 cm step already trips the kart's crest-launch rule); the drawn cap is flatter
  (`GREEN_DROOP` 1.2 %) and tilted with the road (`Cap.gx / gz`, sheared in `mushroom.ts`). `airControl.test.ts` drives every green bridge at 20 and
  30 m/s: at most 2 ticks off the ground, never more than 0.3 m above the surface.
* **Branch gaps**: the trail fences stop `BRANCH_GAP` (1.6 control points) short of each end of both orange branches (render and collision both
  come from `walls`). `src/sim/gateways.ts` lays out two stone pillars with orange mushroom caps across each path end plus an orange-capped arrow
  signpost before each fork (render in `branchView.ts`, solid circles in `sceneryPlan.ts`). The cave vault was centred on the wrong side of the
  road (`offset` is in the track's lateral axis, opposite to `local()`): it is now centred between the road and the orange route (valley `inner`
  swapped to match), so the orange route runs under the arch with clear openings at both ends.
* **Descent** (replaced by the cliff, see layout section 7): the 360 m of S-bends after the cave and the long final straight are gone.

### Bots and shortcuts (all tracks)

Shortcuts and optional routes are mainly for the player. A bot (`Bot.drive` in `bots.ts`) takes an optional shortcut / second route only while `isLagging`:
it is in the back half of the field (3 or more racers), or more than its own `lagGap` (45 to 115 m, seeded per bot) behind the leader, or more than 0.6 x that behind the
best human. Otherwise it stays on the main road (`shortcutBias` 0). Easy bots never leave the main road (they are not `skillful`); the decision is re-taken only away from
junctions, so a bot never changes its mind half way into a fork. Mandatory routes (mandatory cannons, Sky Leap and the cliff cap) are not shortcuts and every bot takes
them. Rainbow Route's high line is an ordinary branch: the main ribbon is the default and only a lagging bot takes the high line.
Tests: `bots.test.ts` ("bots and shortcuts"): alone / in front, a normal or hard bot spends 0 ticks on a shortcut; held back 16 s a hard bot takes them and gets round; easy never.
Exceptions (Palm Plaza): the escalator forks and an `alternate` branch (`ShortcutDef.alternate`: a second route of about the same time, the mall's lower level) are not shortcuts: `BotStyle.branchChoice` decides them per bot (`pickEscalator`, `pickAlternate`; see the Palm Plaza section).

## Rainbow Route (7th track): what is implemented

An original **ribbon road in space**: a wide, translucent, pastel-rainbow road floating high above a planet, with only a few rainbow rails
(fall off the edge = void = the usual respawn). Lobby index 6 (`?track=6`), 7th and last race of the Grand Prix. 3 laps, 1.69 km
(1.59 km driven: the star tunnel flies you over 100 m of sky). Normal bots lap in about 55 to 57 s (hard 52, easy 65), so a race is
about 3 minutes. Width 18 m everywhere (the fork's branch too), every bend has a radius of 28 m or more (arcs of 42 to 70 m; the track-wide
curvature minimum is about 29 m). Heights: 72 m at the start, down to 37 m at the wave road, up to 66 m at the tunnel mouth and 103 m after the
tunnel, then down to 72 m again (range 64 m, steepest climb 13.8 %, steepest drop 13.9 %).

### Layout (`src/track/tracks/rainbowRoute.ts`, written with the shared turtle `src/track/turtle.ts`; anticlockwise, north = +z)

| # | Section | Height | What happens |
|---|---|---|---|
| 1 | Launch run | 72 -> 60 m | boost pads on the grid, an S, a diving `esses1` (rail on its middle swing), then a kicker over a 9 m gap with a straight run-out |
| 2 | The fork (a Y) | 59 -> 56 m | one ribbon splits at a glowing divider post into two ribbons of 18 m with a void of up to 15 m between them, and merges again at a second post. The MAIN ribbon bulges 20 m to the right and keeps the three pads and an arch; the HIGH line (a `deck` branch) stays left, is a few metres shorter and up to 2.2 m higher, with no pads. A star arch stands over each arm. |
| 3 | East curl | 56 -> 39 m | a wide half-pipe through 180 degrees in two quarters, strongly banked (up to 20 degrees), a rail on the outside; it drops 17 m |
| 4 | Wave road | 39 m (lowest) | five trick bumps (`hump` ramps, 0.8 m) on a long easy S: no tight bend and no pad here, because karts fly the bumps at full speed |
| 5 | Climb | 40 -> 66 m | one big S-bend up (14 % at the steepest) with a rail on its middle swing, then the funnel into the tunnel |
| 6 | Star tunnel | 66 -> 103 m | the ribbon ends at a launch pad (a MANDATORY cannon, flight 2.0 s, 100 m of sky); rings and sparkles along the flight; you land on the high ribbon **37 m up** and the second kicker follows 14 m later |
| 7 | High ribbon | 103 -> 75 m | a kicker over a 9 m gap, a straight run-out, an S and a steep S-bend down (the lap's 14 % descent), then the long banked sky sweep (a U-turn, an S and a gentle S) back to the grid |

The tunnel is the only way back up: the lap closes in height because everything after it runs downhill to the grid. 15 boost pads (10 with a
star-ring arch), 14 rows of item boxes (`itemRowSpacing` 120 m).

### How it works (and what other tracks do not see)

All additions are optional and gated, other tracks are unchanged:

* `scenery.rainbow` (`RainbowDef`, `types.ts`): turns off the terrain mesh, the road/kerb/verge/barrier meshes, the fork's dirt look and the
  scenery, and draws `src/render/env/rainbow.ts` instead (`RainbowView`, built last by `trackView.ts`): the translucent ribbon
  (one shader: rainbow gradient, scrolling shimmer, glitter, dashed centre line, glowing edge lines; `depthWrite` off, `renderOrder` -10 so
  item boxes still sort over it) with an additive halo, rainbow rails where the def has `walls` (a translucent rainbow gradient wall whose hue drifts along the road, a glowing top line and a rainbow bar on top: six stretches on the sharpest corners, about 17 % of the lap, with colliders like any wall), the boost-pad arches
  (`boostPads[].arch`: a half ring and seven stars; it stands ON the deck and arches over it, nothing below the road), the **fork's markers**
  (a tall glowing divider post at the split and at the merge, a star arch over each arm), the **star tunnel** (translucent tube, rings, 140 orbiting sparkles along the cannon's
  flight path; `cannonView.ts` leaves out its barrel, funnel and steel gate there) and the space backdrop (a canvas-textured planet with an
  atmosphere rim, 2600 stars that follow the camera, drifting dust, a sun flare). `rampView.ts` draws glowing candy-coloured ramps.
* Mood `'space'` (`scene.ts`): violet sky with the dome's aurora, no fog, soft bloom. Music: its own tune `rainbow` (F lydian, 150 bpm).
* The ground ends at the road's edge: `cliffs` on both sides all round the lap (`edge` 10.8 m, also along the fork: the branch is a deck with ground of its own). The terrain exists
  only because a shortcut needs it.
* `ShortcutDef.deck: true` (`shortcuts.ts`, `track.ts`): a branch with its own height line (control-point heights, smoothed) and its own
  ground (its width; nothing beside it, so you fall off like the main ribbon). No dirt, no terrain shaping. Progress, bots, the maps and
  the Seeker use the normal branch system. A deck is the second arm of a Y: it starts ON the main centre line (`DECK_JOIN_ANGLE_DEG` 9 degrees,
  not at the edge) and ends on it, the two ribbons overlap for the first and last ~40 m, and a kart steps onto it within `DECK_JUNCTION_ZONE`
  (48) samples (the autopilot keeps steering for a branch it likes for 90 m after the split on a deck). The main route must veer away from the
  branch in between (here: right 20 degrees, a straight, back); the branch's control points are written in the split's own frame.
* `mapData.ts` leaves the all-round cliff off the maps (it would only double the road outline).
* Heights are smoothed after the turtle writes them (28 m triangular average, in two parts that never mix across the star tunnel's gap):
  a rising kart whose ground bends away fast leaves the ground (crest launch), so a +4 % grade step at 38 m/s is a ramp.
* Checkpoints: 11, spaced 154 m. None lies on a ramp, in a jump gap or within 50 m before one (a respawn needs a run-up), and the second
  jump respawns before the tunnel.
* The Seeker: the star tunnel's flight is shorter than the shot's trip across the gap, so the target must land before the shot gets there
  (`flightTime` 2.0 s over 100 m). Keep that rule when changing `TUNNEL_GAP`.

### Jumps and the star tunnel: landing at every speed

A kicker's flight grows with the square of the speed, so a high ramp over a long gap that a slow kart only just clears would throw a boosted kart
30 m past the apron, off the end of a straight and into the void. Both gaps are therefore short (9 m) over low ramps (1.4 m, 10 m long) with a
straight 40+ m run-out: at 20 m/s a kart lands on the apron, at 44 m/s (boosted, plus an item) 16 m past the gap, still on the straight road
(the old 14 m gap over a 2.4 m ramp followed by a curve did that only up to 28 m/s). The star tunnel is not ballistic: a captured kart is
carried along ONE authored arc and set down on the same spot (to the centimetre) whatever it entered with, always with the same boost, so the
second kicker 14 m after the landing is always taken at the same ~28-30 m/s. The tests fly every ramp and the tunnel from 20, 26, 28, 38 (boosted) and 44 m/s
without steering and demand ground under the landing, a landing within 20 m of the gap's end and no fall.

### The bots on this track (`TrackDef.botTuning`, `sim/autopilot.ts`, `sim/bots.ts`)

Why they were "insanely good" (normal bot 31.3 s per km of lap against 33.3 to 37.2 on the other six tracks, easy 33.4 against 39 to 44, hard
29.8 against 31.4 to 33.6): a wide road of gentle bends never made them lift, they hit every one of the 15 pads dead centre (about 52 % of the lap
boosted, against 11 to 26 % elsewhere), did a trick boost off every bump and kicker (16 per lap, 4 to 13 elsewhere) and never fell where people do.
`botTuning` (all optional, only this track sets it) holds them back: `pace` 0.97 (a multiplier on the straight-line target), `cornerCurvature`
0.022 (they lift for every bend of 45 m or less), `wander` 4.5 m (the racing line sways slowly across the road, skill-scaled: easy 1.6x, normal 0.8x,
hard 0.5x, never closer than 3 m to the edge and off around every ramp, the cannon and the fork, so they miss about as many pads as a person),
`trickScale` 0.5 (half the tricks) and `noDrift` (the rails stand on the S-bends, and a drift from there would carry a bot off the rail-less ribbon).
Result (normal bot, one lap, slots 0 to 3): easy 65 s, normal 55 to 61 s (33.7 s/km on average), hard 52 to 54 s (31.5 s/km).

### Tests

`rainbowRoute.test.ts`: length 1.4 to 1.8 km, radius >= 28 m, width 17 to 19 m, the set pieces, pads and arches, item rows, grades between 10 and 20 %
and a height range over 55 m, the lap closing in height, rails (5 to 20 % of the lap, with colliders), the void beside the ribbon and beside the
deck, the Y fork (starts and ends on the main line, one unbroken void of 10 m or more over 65+ m, equal widths, higher and shorter, pads only on
the main ribbon, projection onto the branch and back), every jump from 20 to 44 m/s and the tunnel from 20 to 44 m/s landing on the road, normal bot
laps of 50 to 62 s at 32.5 to 38 s per km, 4 bots of every difficulty finish 3 laps with at most 2 respawns each. `rainbowArch.test.ts`: no part of the boost-pad arch is below the
deck. `sceneryPlan.test.ts` expects no trees on this track; `mapData.test.ts` expects no cliffs on its maps.
Plus all the generic ones (layout, grid of 12, bots of every difficulty, 12 racers, class balance, Rocket/Seeker, cannons).

## Palm Plaza (8th track): what is implemented

An original, bright, modern **two-storey shopping mall** with palm trees. Lobby index 7 (`?track=7`), 8th and last race of the Grand Prix.
3 laps, 1.60 km; every bend has a radius of 28 m or more (main road and every deck lane); flat floors (no banking). A normal bot laps alone in
about 50-51 s (4 normal bots: 52-58 s per lap in a race), so 3 laps take a person about 2:30-2:45. Music: its own tune `plaza` (Bb major, 104 bpm).
Everything (stores, signs, posters, the guide robot) is made up for this game.

Rework after play-testing ("the store shortcut is dumb, you clip a wall", "add escalators going up at the start", "the cars never
bothered me", "the second half is flat and boring"): the store shortcut is gone; a level choice (gallery or atrium floor, with a leap
off the ledge), an entrance escalator pair going up, a spiral ramp, and traffic that drives ALONG the road on the parking deck.

### Layout (`src/track/tracks/palmPlaza.ts`, turtle-written, `closeTo` closes the lap; careful: +x is on a driver's LEFT when facing +z)

| # | Section | Height | What happens |
|---|---|---|---|
| 1 | Plaza + entrance escalators | 0 -> 13 m | the grid on the entrance plaza, then a Y split into two escalator lanes 78 m long going UP (~17 %) through the mall's front: the main road and `shortcuts[0]` (a walled `deck` mirrored across the fork's axis). Their own timetable (`phase` 12 s); no robot, direction lights and signs only |
| 2 | Sky Gallery | 13 m | an S along the upper floor (glass railings, shops, palms, boost pads) |
| 3 | The atrium split (level choice) | 13 -> 0 m | UPPER (main road): on along the gallery (3 boost pads), a bend, then DOWN the second escalator pair (main + `shortcuts[1]`, the guide robot between them). LOWER (`shortcuts[2]`, a 20 m wide `deck`, `alternate`): turns off the gallery's inside, runs up a 1.7 m kicker to the gallery's EDGE and drops 13 m onto the atrium floor (its height line falls in 2 m: `deckSmooth: 1`), then down the atrium floor past palm islands and back in. Times: upper 10-12 s with a helping belt, 15-19 s against; lower 12.5-14 s |
| 4 | Garden atrium | 0 m | the fountain (a 1.4 m kicker at its rim, a 24 m pool, a row of 4 item boxes floating 2.2 m over it), S-bends with 3 grass patches (`TrackDef.grassPatches`) |
| 5 | The spiral | 0 -> 13 m | a helix of radius 38 m, 330 degrees, round a teal sculpture column; its exit passes 13 m over its own entry and leaves the building |
| 6 | Parking deck | 13 m | outside, S-bends, the traffic (below), parked cars, garage gates |
| 7 | Deck ramp + home | 13 -> 0 m | S-bends down the ramp, a bend and a gentle S onto the plaza and the grid |

Walls: glass railings almost everywhere. At every Y fork the inner side of the main road stays OPEN for 52-56 m after the split and before
the merge (`forkWalls`): a kart steps from the main road onto a deck only once it is off the main road's kerb (`projectWithBranches`). The
deck's parapets have short gaps where the cars come out of / go into their garage gates (`deckWalls`).

### The ledge (lower route)

* Any speed lands on the atrium floor: at walking pace the kart rolls off the lip and drops; flat out (34 m/s) it flies ~45 m and the deck
  runs straight for 30 m past the lip first. Leaving the kicker rising (> 3 m/s up) makes the jump trickable: a trick pays the usual boost on
  landing (`kart.ts`). Walls on both sides of the whole raised part and the landing (they stand at any height).
* Look: the raised part has its own slab with faces down to the floor, a ledge face at the lip with a yellow edge; the drop itself is a
  steep tiled chute (the deck ribbon follows the height line).

### Escalators (`sim/hazards/escalator.ts`, kind `'escalator'`, view `render/hazards/escalatorView.ts`)

* Two pairs: the entrance (up, `mascot: false`) and the down pair. Each: the main road between `from`..`to` and the deck branch `branch`
  between the samples nearest `branchFrom`/`branchTo`. `Escalator.rising` says which way the road goes; the signs show up / down chevrons
  accordingly.
* Belt: a kart on the ground on a moving part is carried along the lane by `ESCALATOR_SPEED` = 8.5 m/s (a displacement; the kart's own speed is
  untouched): with the traffic ~ +30 %, against ~ -30 %. Measured over the 78 m (gas only): with 2.15 s, stopped 2.80 s, against 4.02 s.
  Respawning, flying and Rocket karts are not carried. Never a hit.
* Timetable (`ESCALATOR_SCHEDULE`, pure function of the race clock, 61 s cycle, `phase` per pair): `[main, branch, seconds]` = [1,-1,13]
  [-1,1,13] [0,0,6] [-1,1,9] [1,-1,11] [0,0,5] [1,-1,4]. Belts ramp over 1 s. `warn` 2.5 s before a change (chime, the robot waves).
* Guide robot (down pair only): halfway between the lane middles, points at the lane that runs with the traffic, shrugs when both stop,
  waves before a change, its head follows the nearest kart.
* Bots (`bots.ts` `pickEscalator`, per pair): easy: the current state 150 m before the fork, ignored 30 % of the time; normal: 100 m before;
  hard: 70 m before, `Escalator.bestLane` (average belt speed over its own ride). Over a 3-lap race of 4 bots: hard ride the helping lane
  95 % of the time, normal 67 %, easy 69 % (rides where both lanes differ).

### Level choice for bots (`ShortcutDef.alternate`, `bots.ts` `pickAlternate`)

An `alternate` branch is not a shortcut (the lagging rule does not apply): decided once per approach, 120 m before the fork. Hard: takes the
lower level when the down escalators will not help (`bestLane` = -1), else stays up and rides the helping lane; normal: every other lap
(half of them on odd laps); easy: one bot in three. Generic changes for it: `BotStyle.branchChoice` covers every escalator pair and the
alternate; `railAim` (Seeker / Hunter / Rocket rails) follows a target onto a deck branch up to 60 m past the junction (a deck's Y arms
overlap that long).

### Deck traffic (`sim/hazards/car.ts`, kind `'car'`, view `render/hazards/carView.ts`)

* A car stretch (`CarDef`: `from`..`to` on the main road, `dir` +1 with the race / -1 against it, `sides`, `speed` 12 m/s, `cars`, `period`):
  each car comes out of a garage gate beside the road (`GATE` 18 m from the gate at 15.5 m to its half), drives the stretch on ONE half of
  the road (`lane` 4.2 m from the centre; the other half, 8+ m wide, stays free), changes sides at the part boundaries (indicators on for
  `INDICATE` 30 m first, swing over `SWING` 16 m) and goes into the gate at the end; hidden in the garages for the rest of its period.
  Pure function of the clock. Two stretches: 2 oncoming cars (right half, period 9 s), then 2 slow cars going your way that move from the
  left half to the right one (period 11 s).
* A car is a 4.4 x 2.0 m box: touching it FLIPS the kart (`spinOut`, +7.5 m/s up, a 7 m/s shove the car's way, a barrel roll in the view).
  Nova karts pass, a kart still invulnerable is only pushed out.
* Bots: `Hazard.dangerFor(s, speed, d, time)` (new, optional): where will each car be when the kart reaches it (closing speed = kart speed
  minus the car's speed along the race)? `HazardSystem.dangerAhead` uses it instead of `danger` when present. Car hits over a 3-lap race of
  4 bots: 0 at every difficulty (they steer round).

### Look (`render/env/mall.ts`, `mallShell.ts`, `mallStyle.ts`, gated by `scenery.mall` = `MallDef`; `trackView.ts` switches when `isMall`)

* **Plan** (`track/mallPlan.ts` `planMallShell`, pure, shared by the renderer and the tests): the building's WALLS along the footprint
  polygon `MallDef.building`, with an opening wherever a road (main or branch) passes through (its width / sin(angle) + 2 m, open to 9 m above
  the road); the upper-floor SLAB and the parking DECK spans per main sample, as wide as possible (30 m) but never over a road of another
  level (the atrium stays open above every ground-floor road and round the escalators) and never through the wall.
* **Shell** (`mallShell.ts`): wall bands (ground-floor shop zone, slab band, upper shop zone, glass clerestory), the mall's name over every
  gate, glass roof over the footprint (one transparent mesh + instanced beams), sunbeams.
* Floors: tiled ground, upper slabs (plan spans), the spiral's helical slab with a fascia and slim pillars where nothing passes below, the
  sculpture column (teal, gold rings, palm planter), the lower route's raised start and ledge, the deck (asphalt with bays, parapets and
  hedges, walls to the ground), the ramp. Static ribbons are merged into one mesh per material (draw calls).
* Shops, columns, planters and string lights only where a floor is (slab spans), inside the building and with nothing of another level in
  the way; palms (solid, from the plan) stand on their road's floor; palm islands along the lower route.
* Cars (`carView.ts`): 3 body meshes, instanced wheels, head/tail lights, and blinking amber indicators.
Perf (headless, 1 viewport, `renderer.info`, Low): 56-145 draw calls / 109-172 k triangles.

### Tests

`palmPlaza.test.ts`: length and radius (main road and every deck lane); the entrance pair goes up (no robot), the down pair down (robot),
both pairs parallel and equal length, their timetables out of step; the lower route is wider, starts at 13 m, has a kicker and a 13 m drop
within 8 m, and is 70-110 % of the main road's span; a kart lands on the atrium floor from the ledge at 6, 18, 27 and 34 m/s and a trick
pays a boost; the spiral climbs a floor over > 300 degrees; **nothing clips a road**: every road's cross-section crosses the building's
walls only inside an opening tall enough, no road runs under an upper slab or the deck, no solid prop stands on any road at its level;
grass patches are offroad, the floating row of 4 boxes; escalator timetable, belt travel, the ride is ~30 % faster / slower, carrying rules,
the mascot; deck traffic: cars on one half of the road (pure function of the clock), indicators, never both halves blocked, hit = flip,
Nova passes, bots see a car on its half only; bots of every difficulty finish 3 laps with at most 1 respawn, hard bots ride the helping
escalator >= 85 % (more than easy), normal bots use both levels, hard bots hit cars no more than easy, a normal bot laps in 48-58 s.
`sceneryPlan.test.ts`: palms and parked cars instead of trees; on the mall, things stand on their road's floor (not the supplied ground).
