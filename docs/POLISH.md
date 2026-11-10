# Polish pass: contract

Goal (from the user): make Tilt Kart **fun and polished**, with graphics at about
"Mario Kart Wii" level (smooth, rounded, colourful, lit; **not low-poly**), sound (M7),
and characters with different classes plus a picker on the phone. Everything stays
original and procedural: no model/image/sound files, no borrowed names or designs.

Several agents work in parallel, each on its own branch. To avoid merge conflicts,
**only edit the files you own** (below). If you must touch another file, keep the edit
to a few lines, and say so in your final report.

## Rules for everyone

* `npx tsc --noEmit`, `npx vitest run`, `npx vite build` must pass. Bots must still finish every track.
* 60 fps target with 4 viewports on a laptop GPU. The `QualitySettings` presets (High/Medium/Low,
  `src/render/scene.ts`) must keep working; expensive things must switch off on Low.
* The sim (`src/sim/**`) stays pure TypeScript: no DOM, no Three.js, deterministic.
* On-screen text stays minimal (countdown, FINAL LAP, FINISH, "HIT NAME!" toasts, position/lap/time HUD).
* Clean, commented TypeScript; explain web/3D concepts briefly (the user is a mechanical engineering student, newer to web dev).
* Commit on your branch; never push or merge. End commit messages with
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
* Browser check: `NO_SSL=1 npx vite --port <your port> --strictPort` in the background,
  `http://localhost:<port>/host/?drive=1` (1 player + bots; `?drive=4` for split-screen, `?track=N`,
  `?give=<item>`). `window.__game` is a dev hook. Stop the server when done.

## Shared data (already on main)

`src/shared/characters.ts`: `CHARACTERS` (8 drivers: weight class, stat points, `look`),
`KART_BODIES` (4 bodies, same order as `KART_STYLES`), `Loadout { character, kart }`,
`sanitizeLoadout`, `loadoutStats`. Indices go over the network; only ever append.

`buildKartModel(colorHex, style = 0, character = DEFAULT_LOADOUT.character)` in
`src/render/kartModel.ts`: `character` is an index into `CHARACTERS` (the driver's look).
`new KartView(scene, colorHex, loadout?)`.

## Work packages and file ownership

| Package | Owns | Notes |
|---|---|---|
| **audio** | `src/audio/**` (new) | Thin wiring only in `src/host/game.ts` / `src/host/main.ts` |
| **classes** | `src/sim/classes.ts` (new), `src/sim/kart.ts`, `collision.ts`, `world.ts`, `autopilot.ts`, `src/shared/protocol.ts`, `src/host/playerSlots.ts`, `playerManager.ts`, `lobbyView.ts`, `src/controller/**` | Loadout over the network, per-kart physics, phone picker |
| **kart-models** | `src/render/kartModel.ts`, `kartView.ts`, `src/dev/kartPreview.ts` | Smooth karts + 8 drivers |
| **render-pipeline** | `src/render/scene.ts`, `textures.ts`, `src/render/post/**` (new) | Lighting, tone mapping, materials, post effects; small render-loop edits in `game.ts` |
| **environment** | `src/render/scenery.ts`, `terrainView.ts`, `trackView.ts`, `branchView.ts`, `rampView.ts` | Smooth scenery, road/terrain/water look |
| **game-feel** | `src/render/effects.ts`, `chaseCamera.ts`, `itemMeshes.ts`, `cannonView.ts`, `src/host/viewHud.ts`, `inkOverlay.ts`, host CSS/HTML | Particles, camera, HUD, results |

`src/host/game.ts` is shared: add your wiring in small, clearly commented blocks.

## Status

(kept up to date by the integrator)

* **classes**: done on branch `claude/classes-33d9bb`. Per-kart physics (`src/sim/classes.ts`: `kartConfigFor`, `botLoadoutFor`), `World.startRace(slots, laps, loadouts)` / `world.configOf(slot)`, optional `loadout` in `hello`/`profile`/`welcome`/`LobbyPlayerInfo`, lobby card names, keyboard/gamepad pickers, phone picker (`src/controller/picker.ts`, `portrait.ts`). Small edits outside the owned files: `src/sim/config.ts` (`KartConfig` type widened, `mass` added), `src/sim/items/items.ts` (`configOf` hook for spin-out), `src/host/game.ts` (loadouts to the world and `KartView`), `src/host/input/localInput.ts` (lobby keys).
* **Wave 1 merged on main**: audio (`src/audio/**`), classes, kart-models (`src/render/kart/**`; karts and drivers use `MeshStandardMaterial`/`MeshPhysicalMaterial`).
* **render-pipeline** (branch `polish/render-pipeline`): done.
  * `src/render/scene.ts`: ACES tone mapping + sRGB output; per-track lighting **moods** (`theme.mood`: `day | dusk | evening | bright | snow | night`, optional field in `TrackDef.theme`, see `LOOKS`); `lookFor(theme)`; sky dome with gradient, HDR sun disc, drifting clouds, stars/aurora; sky rendered into a PMREM cube as `scene.environment` (`applyTheme(scene, theme, renderer, envSize)` regenerates it); texel-snapped sun shadows with scaled bias (`followWithSun`); new `QualitySettings` fields `post, bloomLevels, msaa, shadowPerView, envSize`.
  * `src/render/post/pipeline.ts`: `RenderPipeline` (`beginFrame`, `renderView(scene, camera, x, y, w, h)`, `endFrame`): all viewports go into one HDR MSAA target, then bloom (bright-pass + mip pyramid), colour grade, tone mapping, per-viewport vignette run once. Low quality = no post, direct to canvas.
  * **For other packages (glow):** bloom keys on linear brightness above the mood's `bloomThreshold` (about 0.85 to 1.15). Basic/emissive materials only reach 1.0, so for flames, headlights, item glows, lava use colours/emissive intensity above 1 (e.g. `color.multiplyScalar(3)` or `emissiveIntensity: 3`) to bloom.
  * **For other packages (materials):** standard (and Lambert/Phong) materials get image-based light automatically from `scene.environment`; strength is `scene.environmentIntensity` (set by the mood).
  * `src/render/textures.ts` (existing exports unchanged; `roadTexture`, `grassTexture`, `curbTexture`, `dirtTexture` are now higher resolution and cached, each call still returns its own Texture object sharing one image). New: `SurfaceMaps` type and `asphaltMaps()`, `grassMaps(base)`, `dirtMaps()`, `snowMaps()`, `rockMaps()`, `metalMaps()`, `concreteMaps()`, `kerbMaps()` returning `{ map, normalMap, roughnessMap }` for `new MeshStandardMaterial({ ...asphaltMaps(), roughness: 1 })`; set `.repeat` on all three.
* **Wave 2 merged on main**: render-pipeline, game-feel (`src/render/fx/**`, `resultsView.ts`, `trackPreview.ts`, HUD/lobby/results CSS), environment (`src/render/env/**`).
* **Measured after wave 2** (integrator, `?drive=4&track=0`, Medium, 1024x768 canvas, Intel Iris Plus integrated GPU, stepping `__game.frame(1/60)` 60 times then `gl.readPixels`): **25 ms per frame**, 815 draw calls and 1.74 M triangles per frame (all 4 views plus shadow passes), about 19 ms of CPU time inside `pipeline.renderView`. Target: 60 fps (under about 14 ms) on this GPU with 4 viewports.
* **perf** (branch `polish/perf`): done. Measured on the Intel Iris Plus laptop (1024x768, 4-way split, Medium): 25-33 ms per frame before, about 12.5-14 ms now on all four tracks (table in the branch report). What changed:
  * **Pipeline** (`render/post/pipeline.ts`): the expensive part was MSAA on a half-float target (it was resolved once per viewport, depth included). Now `QualitySettings.msaa` is 4 only on High; Medium and Low use **FXAA** (`fxaa: true`: composite into an 8-bit picture with hand-written ACES + sRGB, then a 9-tap FXAA pass to the canvas). `resolveDepthBuffer = false` everywhere. The canvas itself is no longer multisampled and Low now also goes through the pipeline (no bloom). Bloom can start at quarter size (`bloomShift`). `compileAsync()` precompiles shaders.
  * **Presets** (`render/scene.ts`): new fields `fxaa, bloomShift, shadowRadius, shadowSplitScale, lodScale`. High = as before (4x MSAA, 2048 shadows, 6 bloom levels). Medium = FXAA, 1024 shadow map (640 in 3-4 views, 38 m box per view), 3 bloom levels from quarter size, 70% ground detail, scenery LOD distances x0.7 (x0.75 more in 4-way), cheaper ground/sky shaders, coarser terrain grid, mid-detail karts. Low = no shadows/clouds, 0.75 render scale, FXAA, no bloom, low-detail karts.
  * **Adaptive quality** (`render/adaptive.ts`, wired in `host/game.ts`): measures real frame time (ignores the first 1.2 s after a race/preset change and gaps over 250 ms), lowers a dynamic render scale between 1.0 and 0.6, raises it again after 5 calm seconds (never above a ceiling it learned), and after 5 s stuck at 0.6 asks `main.ts` to step the preset DOWN (never up). The step-down is remembered in `tiltkart.autoQuality`; a manual choice with Q (`tiltkart.quality`) always wins. First-run default comes from the GPU name (`render/gpuTier.ts`: Iris/UHD/Xe -> Medium, old Intel HD/software -> Low, NVIDIA/RX/Apple M -> High). `?quality=low|medium|high` in the address overrides everything (testing).
  * **Terrain** (`render/env/tiles.ts`, `terrainView.ts`): the ground and the rock walls are cut into 300 m / 200 m tiles that share vertex buffers, so Three.js culls the ones you cannot see (the single huge mesh was drawn whole for every view). Rock walls no longer cast shadows (they hang into the void).
  * **Karts** (`kartModel.ts`, `kart/geo.ts`, `kartView.ts`): new detail levels `mid`/`low`/`far` (tiny parts such as wheel nuts are dropped on cheap builds), and `KartModel.setLod(tier)` swaps geometry/materials per viewport: the kart a camera follows is full detail, others drop to reduced/far sooner in split-screen (`Game.applyKartLods`). Reduced karts only cast body + torso shadows.
  * **Shadows**: scenery chunks cast through an invisible copy of their cheap model (`ChunkLod.shadowProxy`) instead of the detailed one; per-view shadow box radius and map size come from the preset.
  * **Misc**: item boxes are skipped beyond 70 m (4-way) and lose their glow shell when not close; fewer mountain triangles on Medium/Low; cheaper cloud shader (`CHEAP_SKY`) and ground noise (`envQuality.cheap`); no per-frame allocations left in `Game.frame`/`RenderPipeline.renderView`; shaders for the three item objects are compiled during the countdown (`Game.warmUp`).
  * Not done / ideas: merging the 12 meshes of a far kart into one draw call, decimated far terrain tiles, instancing for scenery props, hardware-timer based adaptive quality (it only sees frame time).
* **Wave 3 (running)**: performance, gameplay.
* **gameplay** (branch `polish/gameplay`): done. `src/sim/style.ts` (slipstream + style combo; events `slipCharge {progress}`, `slipBoost`, `combo`), `src/sim/bots.ts` (`BotPack`/`Bot`: easy/normal/hard, class personalities, drifting, tricks, item logic, dodging, stuck recovery, `rubberBand`), hit protection (`KartState.invulnTime`, `KART.hitInvulnTime`), race events `perfectStart` / `startBoost.perfect` / `photoFinish` (the host stores `game.photoFinish` but does not use it), feel tuning in `src/sim/config.ts` (air steer 0.25 to 0.4, drift steer threshold 0.25 to 0.18, drift charge rate 0.9 to 1.0, wall speed loss 0.45 to 0.35, off-road accel 0.8 to 0.85). Lobby: **D** cycles bot difficulty (BOTS chip, `tiltkart.botDifficulty`). New sounds `slipStart`, `slipBoost`, `combo`, `perfect`; `GameFx.windStreaks` / `slipBoost` hooks. Tunables: `SLIPSTREAM`, `COMBO`, `START`, `BOTS` in `src/sim/config.ts`.
