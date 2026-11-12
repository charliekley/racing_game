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

* `TrackDef.shortcuts[]` (`from`, `to`, `points`, `width`, `surface`, plus optional branch-local `walls`). Code: `src/sim/shortcuts.ts` (branch building, projection), `src/render/branchView.ts` (meshes + the "SHORTCUT" gate), dev-only test track `src/track/tracks/_shortcutTest.ts` with `src/sim/shortcuts.test.ts`.
* `track.branches: Branch[]` (route ids 1, 2, …; route 0 = main loop). A branch has its own evenly spaced `samples` (same `TrackSample` shape; `sample.s` is the MAPPED main-route distance), starts/ends exactly on the main centerline with the main tangent, and blends width/bank with the main road over 24 m at each end.
* **Hint / index convention:** `Projection` now has `route` and `index`; `index = route * 2^20 + sampleIndex` (equals the plain sample index on the main road). Store `projection.index` (not `.i`) as a kart's `trackIndex`; `.i` indexes `track.sampleOf(route, i)`. `Track.sample()` already returns this `index`.
* `Projection.s` for a kart on a branch is mapped linearly onto the main route between the junctions, so ranking and the checkpoint rule work unchanged: driving the branch passes the skipped checkpoints in order. Driving across the grass earns nothing (a branch only counts when the kart is on its road or off-road strip).
* The projection swaps roads only where they are joined (near the junctions; a branch swaps back to the main road wherever the main road runs alongside at the same level), so at an under/overpass the hint decides. Keep crossings >= 3 m apart in height (the usual >= 7 m rule) and not within ~50 m of a junction.
* Ground: a `'dirt'` branch is `'offroad'` for speed (its first/last 12 m are tarmac). Terrain blends toward branch roads too (`withBranchField`); branch stretches >= 5 m above the main road are left out of the blend.
* Walls: `wallsAt(i, route)` / `sampleOf(route, i)`; `collideWalls` and the shot bounce use them. Branches have no cliffs, ramps, gaps or boost pads (yet).
* `track.routes` = main line + one `kind: 'shortcut'` `RouteLine` per branch (open polyline, ~8 m points, with y).
* Bots: `BotStyle.shortcutBias` (slots 0 and 2 > 0.5 take every shortcut); `track.sampleAhead(route, i, k)` follows a branch back onto the main road.
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
