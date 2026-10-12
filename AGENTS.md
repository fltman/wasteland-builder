# Wasteland Builder — guide for coding agents (Codex, Claude Code, …)

This repository turns any real place into a playable Mad Max-style battle-car browser game:
OpenStreetMap → an editable Blender city → streamed web tiles → the game in `game/`, themed with the
town's name, splash art, narrator lines and music. Users mostly just say *"build Visby"* (often in
Swedish: *"bygg Visby"*); you run the tools, judge the results and keep them informed.
Answer in the user's language.

## Which skill when

| The user wants … | Skill (`.agents/skills/`, also `.claude/skills/`) |
|---|---|
| a game of a place / a new city variant / to continue one | `build-wasteland` |
| a street, area or building to look more like reality | `refine-city` |
| splash screen / key art | `imagegen` |
| narrator lines naming the town, a different voice, sound effects | `elevenlabs` |
| a soundtrack / theme song | `suno-music` |
| the game online, multiplayer server (Vultr etc.) | `deploy-arena` |

## Commands (`python3 wasteland.py …`, stdlib only)

`doctor` (install/check everything) · `make "<place>"` (new + build + play) · `new "<place>" [--size small|medium|large|<m>] [--pick N] [--center lat,lon]`
· `build <slug> [--from STEP | --only a,b] [--refresh]` with steps `fetch terrain prepare textures blender export tiles pack splash`
· `rebuild <slug>` · `play <slug> [--open]` (dev server :5220, run in background) · `list` · `status <slug>`
· `theme <slug>` · `voices <slug>` · `music <slug> [--vehicle <id>] --add f.mp3 --title …` · `buildings <slug> --street … | --near … [--json]`
· `render <slug> [cameras | street:x,y,heading] [--street … | --near …]`
· `survey <slug> plan [--street … | --near …] --out DIR` then `survey <slug> compare DIR` (Street View vs model, ids labelled)
· `seed <slug> --ids … [--force] [--unsurveyed]` (housekit starter scripts from overrides notes) · `publish <slug> [--arena wss://…]`

## Layout

```
wasteland.py            CLI; runs pipeline scripts in .venv, Blender headless and Node
pipeline/               place.py (Nominatim) · fetch_osm.py (OSM API + Overpass) · fetch_terrain.py (Lantmäteriet / Copernicus heights)
                        · prepare_city.py (Shapely: all geometry
                        decisions → city.json) · make_textures.py (procedural PBR, cache/textures) · make_pack.py (map.json,
                        config.json, media copy) · theme.py · voices.py · buildings.py · style.json (palettes, heights, surfaces)
pipeline/blender/       build_city.py (city.json → city.blend) · citylib.py (materials, mesh builder, props, custom-building API)
                        export_tiles.py · render_splash.py · render_views.py
pipeline/web/tiles.mjs  gltf-transform: meshopt tiles + WebP material library
game/                   the Three.js game (see game/README.md); public/city → cities/<slug>/pack (symlink)
game/server, game/deploy  WebSocket relay for Online Arena + VPS installer
cities/<slug>/          per city (git-ignored): place.json, osm.json, terrain.json, city.json, city.blend, build/, pack/ (what the game loads)
                        and the editable sources: theme.json, overrides.json, custom/<id>.py, media/, refinements.md
docs/                   images, custom-building-example.py
```

Edit **sources**, never generated files: `theme.json`, `overrides.json`, `custom/*.py`, `media/` and
`pipeline/style.json`; then `rebuild` / `build --only pack`. `city.json`, `pack/`, `build/` and
`city.blend` are regenerated. (A user may still hand-edit `city.blend` in Blender and run
`build --from export`; warn them that `blender`/`rebuild` overwrites it.)

## Conventions and facts

- Coordinates: metres, local plane centred on the place. Pipeline/Blender: x east, y north, z up.
  Game: three.js x east, y up, z south (map point = `[x, -y]`); heading 0 = north, counter-clockwise.
  `render` camera specs use compass headings (clockwise).
- Terrain: in Sweden Lantmäteriet's 1 m ground model (Markhöjdmodell via STAC, CC BY 4.0) when .env has
  LANTMATERIET_USER/PASSWORD (a free Geotorget account with access to "Markhöjdmodell Nedladdning");
  otherwise the Copernicus GLO-30 surface model (AWS, free, no key), cleaned of buildings and trees
  with the OSM footprints and forests. Heights are metres over the flat city's ground level
  (0 = 1.2 m above the main water). Ground layers, kerbs and rails follow it vertex by vertex; buildings
  move as one piece by `base` and get a concrete foundation down to `base_min`. The game gets a coarse
  copy in map.json `terrain` (`network.heightAt`). `"defaults": {"terrain": false}` in overrides.json
  builds a city flat; `"terrain_scale"` exaggerates or flattens it. Keep the terrain attribution
  (Lantmäteriet CC BY 4.0 / Copernicus); make_pack.py adds it to the pack.
- Objects carry `wb_tile` (`base` = always loaded ground/water/curbs, `c<i>_<j>` = 60 m streamed tiles).
  The game swaps tile materials for `materials.glb` entries by exact name (tiles.mjs keeps unique names).
- Facade textures are one window bay × one storey; their alpha is a tint mask (wall = tinted per
  building through `extras.tint`, frames/glass = untinted). The game injects this in `src/city.js`.
- Bonus cars: theme.json `bonus_vehicles` (e.g. `{"id":"epa","model":"volvo740","paint":…,"rear_window":…}`)
  are built by `pipeline/blender/build_bonus_car.py` into `build/vehicles/<id>.glb` in the pack step and get
  their own garage button; songs added with `music <slug> --vehicle <id>` play while that car is chosen.
  Material names: "lamp" glows, "clean" skips grime, "paint" crumples, "speaker LED" pulses with the bass.
- Meshes named `*Furniture*` become breakable props in the game; material names containing
  glass/wood/metal choose collision sounds. Keep these names when adding things.
- Blender ≥ 4.2 (tested 5.2). In Eevee a world volume renders black — use a volume box for haze.
- Data sources: OSM API `/map` (primary, fast), Overpass mirrors (completion/backup), Nominatim
  (search), Lantmäteriet STAC / Copernicus DEM (terrain). Be polite: one download per city, reuse `osm.json`. OSM data is ODbL — keep attribution.
- Secrets only in `.env` (git-ignored); never print or commit keys. Ask before paid generations
  (images, voices, music) and before any action on the user's servers, DNS or accounts.

## Verify your work

- `python3 wasteland.py selftest` — offline pipeline test on synthetic OSM data + `npm test` in `game/`
  (with a city installed the game tests also check its real tiles, spawn and routes).
- `python3 wasteland.py render <slug>` and look at the images; `play` and check in a browser
  (title, splash, "<Name> is ready", a run starts on a street).
- Pipeline changes: rebuild a small test city (`python3 wasteland.py make "Ystad" --size small --no-play`).

## Origin

Extracted from two projects by Anders Bjarby: *kalmar-kvarnholmen* (a hand-refined Blender/OSM model of
Kalmar) and *Kalmar Wasteland* (the game). The generic generator here is new code inspired by
kvarnholmen's builders; refinement rounds mirror its pass-by-pass workflow.
