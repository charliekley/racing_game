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
