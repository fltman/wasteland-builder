#!/usr/bin/env python3
"""Wasteland Builder — turn any place on Earth into a Mad Max battle-car game.

    python3 wasteland.py doctor                    check and install everything (run once)
    python3 wasteland.py make "Visby"              the whole thing: find, build and play
    python3 wasteland.py new "Visby" [--size …]    find the place, write cities/<slug>/place.json
    python3 wasteland.py build visby               OSM → Blender city → web tiles → game pack
    python3 wasteland.py play visby                start the game at http://localhost:5220
    python3 wasteland.py list | status <slug>
    python3 wasteland.py theme <slug>              write/refresh theme.json (title, texts, voice lines, prompts)
    python3 wasteland.py voices <slug>             ElevenLabs voice lines from theme.json
    python3 wasteland.py music <slug> --add f.mp3  add a (Suno) track to the city's radio
    python3 wasteland.py buildings <slug> --street "Strandgatan"   list houses to refine (Street View links)
    python3 wasteland.py rebuild <slug>            rebuild after overrides.json / custom/*.py changes
    python3 wasteland.py survey <slug> plan        Street View viewpoints for houses not checked yet (then: compare DIR)
    python3 wasteland.py seed <slug> --ids …       housekit starter scripts from the overrides notes
    python3 wasteland.py render <slug> [...]       review images from Blender
    python3 wasteland.py publish <slug> [--arena wss://…]   static website in game/dist/
    python3 wasteland.py selftest                  offline pipeline tests + game tests

Only the Python standard library is needed to run this file; heavier work runs in .venv, Blender and Node.
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PIPE = ROOT / 'pipeline'
CITIES = ROOT / 'cities'
GAME = ROOT / 'game'
VENV = ROOT / '.venv'
WIN = platform.system() == 'Windows'
VPY = VENV / ('Scripts/python.exe' if WIN else 'bin/python')
STEPS = ['fetch', 'terrain', 'prepare', 'textures', 'blender', 'export', 'tiles', 'pack', 'splash']
MIN_BLENDER = (4, 2)

B, D, G, Y, R, X = ('\033[1m', '\033[2m', '\033[32m', '\033[33m', '\033[31m', '\033[0m') if sys.stdout.isatty() and not WIN else ('',) * 6


def say(msg=''):
    print(msg, flush=True)


def head(msg):
    say(f'\n{B}▸ {msg}{X}')


def die(msg, hint=None):
    say(f'{R}✗ {msg}{X}')
    if hint:
        say(f'  {hint}')
    sys.exit(1)


def load_env():
    """Read KEY=value lines from .env (API keys stay local; never printed)."""
    path = ROOT / '.env'
    if path.exists():
        for line in path.read_text().splitlines():
            m = re.match(r'\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$', line)
            if m and not line.lstrip().startswith('#') and m.group(1) not in os.environ:
                os.environ[m.group(1)] = m.group(2).strip().strip('"\'')


def run(cmd, cwd=ROOT, env=None, quiet_filter=None):
    cmd = [str(c) for c in cmd]
    if quiet_filter is None:
        r = subprocess.run(cmd, cwd=cwd, env={**os.environ, **(env or {})})
        if r.returncode:
            die(f'Command failed ({r.returncode}): {" ".join(cmd[:4])} …')
        return
    # Blender is chatty: show only our own progress lines, keep the full log for errors.
    p = subprocess.Popen(cmd, cwd=cwd, env={**os.environ, **(env or {})}, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors='replace')
    log = []
    for line in p.stdout:
        log.append(line)
        if quiet_filter(line):
            print('  ' + line.rstrip(), flush=True)
    if p.wait():
        tail = ''.join(log[-40:])
        die(f'Command failed: {" ".join(cmd[:4])} …', 'Last output:\n' + tail)


def py(script, *args):
    if not VPY.exists():
        die('The Python environment is missing.', 'Run: python3 wasteland.py doctor')
    run([VPY, PIPE / script, *args], cwd=PIPE)


# ------------------------------------------------------------------------------------------ tools
def find_blender():
    cands = [os.environ.get('BLENDER')]
    if platform.system() == 'Darwin':
        cands += ['/Applications/Blender.app/Contents/MacOS/Blender', str(Path.home() / 'Applications/Blender.app/Contents/MacOS/Blender')]
    elif WIN:
        for base in (os.environ.get('ProgramFiles', r'C:\Program Files'), os.environ.get('LOCALAPPDATA', '')):
            cands += sorted((Path(base) / 'Blender Foundation').glob('Blender*/blender.exe'), reverse=True) if base else []
    cands += [shutil.which('blender'), '/snap/bin/blender', '/usr/bin/blender']
    for c in cands:
        if c and Path(c).exists():
            return str(c)
    return None


def blender_version(exe):
    try:
        out = subprocess.run([exe, '--version'], capture_output=True, text=True, timeout=120).stdout
        m = re.search(r'Blender (\d+)\.(\d+)', out)
        return (int(m.group(1)), int(m.group(2))) if m else None
    except Exception:
        return None


def blender(*args):
    exe = find_blender()
    if not exe:
        die('Blender was not found.', 'Install Blender 4.2 or newer from https://www.blender.org/download/ (or set BLENDER=/path/to/blender).')
    run([exe, *args], quiet_filter=lambda l: 'Not freed' not in l and (l.startswith(('[build]', 'EXPORT_TILES_OK', 'BUILD_CITY_OK', 'SPLASH_OK', 'RENDERED', 'Error', 'Traceback')) or 'Error:' in l))


def node_ok():
    n = shutil.which('node')
    if not n:
        return None
    try:
        v = subprocess.run([n, '--version'], capture_output=True, text=True).stdout.strip().lstrip('v')
        return tuple(int(x) for x in v.split('.')[:2])
    except Exception:
        return None


def npm(*args, cwd):
    exe = shutil.which('npm') or die('npm was not found.', 'Install Node.js 20 or newer from https://nodejs.org/')
    run([exe, *args], cwd=cwd)


# ------------------------------------------------------------------------------------------ doctor
def cmd_doctor(a):
    ok = True
    head('Python')
    if sys.version_info < (3, 10):
        die(f'Python {platform.python_version()} is too old.', 'Install Python 3.10 or newer from https://www.python.org/downloads/')
    say(f'  {G}✓{X} Python {platform.python_version()}')
    if not VPY.exists():
        say('  creating .venv …')
        run([sys.executable, '-m', 'venv', VENV])
    stamp = VENV / '.requirements'
    req = (ROOT / 'requirements.txt').read_text()
    if not stamp.exists() or stamp.read_text() != req:
        say('  installing Python packages (shapely, numpy, pillow, elevenlabs …)')
        run([VPY, '-m', 'pip', 'install', '-q', '--disable-pip-version-check', '-r', ROOT / 'requirements.txt'])
        stamp.write_text(req)
    say(f'  {G}✓{X} .venv with geometry packages')

    head('Node.js')
    v = node_ok()
    if not v or v < (20, 0):
        ok = False
        say(f'  {R}✗{X} Node.js 20+ is needed (found {".".join(map(str, v)) if v else "none"}). Install from https://nodejs.org/')
    else:
        say(f'  {G}✓{X} Node {".".join(map(str, v))}')
        for folder in (GAME, PIPE / 'web'):
            if not (folder / 'node_modules').exists():
                say(f'  installing packages in {folder.relative_to(ROOT)} …')
                npm('ci' if (folder / 'package-lock.json').exists() else 'install', '--no-audit', '--no-fund', cwd=folder)
        say(f'  {G}✓{X} game and tile tools installed')

    head('Blender')
    exe = find_blender()
    ver = blender_version(exe) if exe else None
    if not exe or not ver:
        ok = False
        say(f'  {R}✗{X} Blender not found. Install 4.2 or newer: https://www.blender.org/download/  (or set BLENDER=/path/to/blender)')
    elif ver < MIN_BLENDER:
        ok = False
        say(f'  {R}✗{X} Blender {ver[0]}.{ver[1]} is too old; 4.2 or newer is needed.')
    else:
        say(f'  {G}✓{X} Blender {ver[0]}.{ver[1]} ({exe})')

    head('Textures')
    if VPY.exists():
        py('make_textures.py')

    head('Skills for Claude Code and Codex')
    link = ROOT / '.claude/skills'
    if link.is_symlink() or (link.exists() and (link / 'build-wasteland/SKILL.md').exists()):
        say(f'  {G}✓{X} .agents/skills (Codex) and .claude/skills (Claude Code)')
    else:
        try:
            link.parent.mkdir(exist_ok=True)
            if link.exists():
                shutil.rmtree(link)
            link.symlink_to(Path('..') / '.agents' / 'skills', target_is_directory=True)
        except OSError:
            shutil.copytree(ROOT / '.agents/skills', link)
        say(f'  {G}✓{X} linked .claude/skills → .agents/skills')

    head('Optional services (.env)')
    load_env()
    for key, use in (('ELEVENLABS_API_KEY', 'voice lines that say your city\'s name'),
                     ('OPENAI_API_KEY', 'splash art from the imagegen script (Codex can draw without a key)'),
                     ('OPENROUTER_API_KEY', 'alternative splash art via Gemini (Claude Code)'),
                     ('LANTMATERIET_USER', 'Swedish cities: 1 m terrain from Lantmäteriet (free Geotorget account)')):
        say(f'  {G + "✓" + X if os.environ.get(key) else D + "–" + X} {key:20} {use}')
    say(f'  {D}–{X} Suno: no key; the agent uses suno.com in your browser (or add any mp3 with "music --add")')

    free = shutil.disk_usage(ROOT).free / 1e9
    say(f'\n  Disk: {free:.0f} GB free (a city needs ~0.3–1 GB while building)')
    if ok:
        say(f'\n{G}{B}Ready.{X} Try:  python3 wasteland.py make "Visby"')
    else:
        say(f'\n{Y}Fix the items marked ✗ and run doctor again.{X}')
        sys.exit(1)


# ------------------------------------------------------------------------------------------ cities
def slug_of(name):
    if name and (CITIES / name / 'place.json').exists():
        return name
    if name:
        from_name = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
        if (CITIES / from_name / 'place.json').exists():
            return from_name
    known = sorted(p.parent.name for p in CITIES.glob('*/place.json'))
    if not name and len(known) == 1:
        return known[0]
    die(f'Unknown city "{name or ""}".', f'Known: {", ".join(known) or "none yet"}. Create one with: python3 wasteland.py new "<place>"')


def status(slug):
    p = CITIES / slug / 'status.json'
    return json.loads(p.read_text()) if p.exists() else {}


def mark(slug, step, **info):
    path = CITIES / slug / 'status.json'
    st = json.loads(path.read_text()) if path.exists() else {}
    st[step] = {**st.get(step, {}), 'done': time.strftime('%Y-%m-%d %H:%M:%S'), **info}
    path.write_text(json.dumps(st, indent=2, ensure_ascii=False))


def cmd_new(a):
    args = [a.query, '--size', str(a.size), '--pick', str(a.pick)]
    if a.center:
        args += ['--center', a.center]
    if a.slug:
        args += ['--slug', a.slug]
    if a.name:
        args += ['--name', a.name]
    py('place.py', *args)


def build_bonus_vehicles(slug):
    """Blender-build the models of theme.json "bonus_vehicles" into build/vehicles/ (only when their look changed)."""
    folder = CITIES / slug
    theme = json.loads((folder / 'theme.json').read_text()) if (folder / 'theme.json').exists() else {}
    for v in theme.get('bonus_vehicles') or []:
        vid = re.sub(r'[^a-z0-9-]', '', str(v.get('id', '')).lower())
        if not vid or v.get('model') != 'volvo740':
            continue
        out = folder / 'build' / 'vehicles'
        out.mkdir(parents=True, exist_ok=True)
        look = {k: v.get(k) for k in ('model', 'paint', 'rear_window', 'plate', 'dice', 'led', 'speaker_led', 'rims')}
        script = PIPE / 'blender/build_bonus_car.py'
        look['_builder'] = int(script.stat().st_mtime)
        spec = out / f'{vid}.json'
        if (out / f'{vid}.glb').exists() and spec.exists() and json.loads(spec.read_text()) == look:
            continue
        spec.write_text(json.dumps(look, ensure_ascii=False))
        say(f'  building the bonus vehicle {vid} ({v.get("model")})')
        blender('-b', '--factory-startup', '--python-exit-code', '1', '--python', script, '--', spec, out / f'{vid}.glb', out / f'{vid}.png')


def cmd_build(a):
    slug = slug_of(a.slug)
    folder = CITIES / slug
    steps = STEPS
    if a.only:
        steps = [s.strip() for s in a.only.split(',')]
    elif a.start:
        steps = STEPS[STEPS.index(a.start):]
    t0 = time.time()
    for step in steps:
        t = time.time()
        head(f'{step}')
        if step == 'fetch':
            py('fetch_osm.py', slug, *(['--force'] if a.refresh else []))
        elif step == 'terrain':
            load_env()                       # LANTMATERIET_* for Sweden's 1 m ground model
            py('fetch_terrain.py', slug, *(['--force'] if a.refresh else []))
        elif step == 'prepare':
            py('prepare_city.py', slug)
        elif step == 'textures':
            py('make_textures.py')
        elif step == 'blender':
            blender('-b', '--factory-startup', '--python-exit-code', '1', '--python', PIPE / 'blender/build_city.py', '--', slug)
        elif step == 'export':
            raw = folder / 'build/raw'
            shutil.rmtree(raw, ignore_errors=True)
            blender('-b', folder / 'city.blend', '--python-exit-code', '1', '--python', PIPE / 'blender/export_tiles.py', '--', raw)
        elif step == 'tiles':
            run([shutil.which('node') or 'node', PIPE / 'web/tiles.mjs', folder / 'build/raw', folder / 'pack/tiles'])
        elif step == 'pack':
            build_bonus_vehicles(slug)
            py('make_pack.py', slug)
        elif step == 'splash':
            media = folder / 'media'
            if any((media / f'splash.{e}').exists() for e in ('jpg', 'png', 'webp')) and not a.force_splash:
                say('  custom splash in media/ — keeping it (render the default anyway with --force-splash)')
            else:
                blender('-b', folder / 'city.blend', '--python-exit-code', '1', '--python', PIPE / 'blender/render_splash.py', '--', slug)
            py('make_pack.py', slug)
        else:
            die(f'Unknown step {step}', f'Steps: {", ".join(STEPS)}')
        mark(slug, step, seconds=round(time.time() - t))
        say(f'  {D}{time.time() - t:.0f} s{X}')
    say(f'\n{G}{B}Done in {time.time() - t0:.0f} s.{X}  Play:  python3 wasteland.py play {slug}')


def cmd_rebuild(a):
    a.start, a.only, a.refresh = 'prepare', None, False
    cmd_build(a)


def link_city(slug):
    pack = CITIES / slug / 'pack'
    if not (pack / 'config.json').exists() or not (pack / 'tiles/tiles.json').exists():
        die(f'{slug} is not built yet.', f'Run: python3 wasteland.py build {slug}')
    target = GAME / 'public/city'
    if target.is_symlink() or target.is_file():
        target.unlink()
    elif target.exists():
        shutil.rmtree(target)
    try:
        target.symlink_to(Path('..') / '..' / 'cities' / slug / 'pack', target_is_directory=True)
    except OSError:  # Windows without developer mode: copy instead
        shutil.copytree(pack, target)
    (GAME / 'public/city-slug.txt').write_text(slug)


def cmd_play(a):
    slug = slug_of(a.slug)
    link_city(slug)
    if not (GAME / 'node_modules').exists():
        die('Game packages are missing.', 'Run: python3 wasteland.py doctor')
    url = 'http://localhost:5220/'
    say(f'{G}{B}{slug} is installed in the game.{X}  Open {url}  (Ctrl+C stops the server)')
    if a.no_serve:
        return
    if a.open:
        webbrowser.open(url)
    npm('run', 'dev', cwd=GAME)


def cmd_list(a):
    rows = []
    for p in sorted(CITIES.glob('*/place.json')):
        place = json.loads(p.read_text())
        st = status(p.parent.name)
        done = [s for s in STEPS if s in st]
        rows.append((p.parent.name, place['display_name'][:60], f'{place["size_m"]} m', 'ready' if 'pack' in st else (done[-1] if done else 'new')))
    if not rows:
        say('No cities yet. Try: python3 wasteland.py make "Visby"')
    for r in rows:
        say(f'  {B}{r[0]:16}{X} {r[2]:>7}  {r[3]:8}  {D}{r[1]}{X}')
    cur = GAME / 'public/city-slug.txt'
    if cur.exists():
        say(f'\n  installed in the game: {cur.read_text().strip()}')


def cmd_status(a):
    slug = slug_of(a.slug)
    st = status(slug)
    place = json.loads((CITIES / slug / 'place.json').read_text())
    say(f'{B}{place["name"]}{X}  {place["display_name"]}  ({place["size_m"]} m)')
    for s in STEPS[:-1]:
        info = st.get(s)
        say(f'  {G + "✓" + X if info else D + "·" + X} {s:9} {D}{info.get("done", "") if info else ""}{X}')
    city = CITIES / slug
    for label, path in (('theme.json', city / 'theme.json'), ('overrides.json', city / 'overrides.json'), ('custom buildings', city / 'custom'),
                        ('splash art', city / 'media/splash.jpg'), ('voice lines', city / 'media/voice-intro.mp3'), ('own music', city / 'media/music')):
        say(f'  {G + "✓" + X if path.exists() else D + "–" + X} {label}')


def cmd_make(a):
    """new + build + (optional) play — the one-command path."""
    cmd_new(a)
    known = sorted(CITIES.glob('*/place.json'), key=lambda p: p.stat().st_mtime)
    slug = a.slug or known[-1].parent.name
    ns = argparse.Namespace(slug=slug, only=None, start=None, refresh=False, force_splash=False)
    cmd_build(ns)
    if not a.no_play:
        cmd_play(argparse.Namespace(slug=slug, open=True, no_serve=False))


def cmd_theme(a):
    slug = slug_of(a.slug)
    py('theme.py', slug, *(['--reset'] if a.reset else []))


def cmd_voices(a):
    slug = slug_of(a.slug)
    load_env()
    if not os.environ.get('ELEVENLABS_API_KEY'):
        die('ELEVENLABS_API_KEY is not set.', 'Add it to .env (see .env.example) — or skip: the game has generic voice lines.')
    py('voices.py', slug, *(['--force'] if a.force else []), *(['--only', a.only] if a.only else []))
    py('make_pack.py', slug)


def cmd_music(a):
    slug = slug_of(a.slug)
    # --vehicle <id>: the radio of a bonus vehicle (plays while that car is chosen).
    music = CITIES / slug / ('media/vehicles/' + re.sub(r'[^a-z0-9-]', '', a.vehicle.lower()) + '/music' if a.vehicle else 'media/music')
    music.mkdir(parents=True, exist_ok=True)
    meta_path = music / 'music.json'
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {'tracks': []}
    if a.add:
        src = Path(a.add).expanduser()
        if not src.exists():
            die(f'{src} does not exist.')
        name = re.sub(r'[^a-z0-9]+', '-', (a.title or src.stem).lower()).strip('-') + src.suffix.lower()
        shutil.copy2(src, music / name)
        meta['tracks'] = [t for t in meta['tracks'] if t['file'] != name] + [{'file': name, 'title': a.title or src.stem, 'source': a.source or '', 'generator': a.generator or ''}]
        meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False))
        say(f'{G}✓{X} added {name}')
    if a.clear:
        shutil.rmtree(music)
        say('removed the city\'s own music (the default soundtrack plays)')
    for t in meta.get('tracks', []) if not a.clear else []:
        say(f'  ♪ {t["title"]}  {D}{t["file"]}{X}')
    build_bonus_vehicles(slug)
    py('make_pack.py', slug)


def cmd_buildings(a):
    slug = slug_of(a.slug)
    args = [slug]
    for k in ('street', 'near', 'radius', 'id', 'name', 'limit'):
        v = getattr(a, k)
        if v is not None:
            args += [f'--{k}', str(v)]
    if a.json:
        args.append('--json')
    py('buildings.py', *args)


def cmd_render(a):
    slug = slug_of(a.slug)
    out = CITIES / slug / 'renders'
    specs = list(a.views)
    if a.street or a.near:
        r = subprocess.run([VPY, PIPE / 'buildings.py', slug, '--views', *(['--street', a.street] if a.street else ['--near', a.near])],
                           cwd=PIPE, capture_output=True, text=True)
        if r.returncode:
            die(r.stderr.strip() or r.stdout.strip())
        specs += r.stdout.split()
    blender('-b', CITIES / slug / 'city.blend', '--python-exit-code', '1', '--python', PIPE / 'blender/render_views.py', '--', out, *specs)
    say(f'Images in {out.relative_to(ROOT)}/')


def cmd_survey(a):
    slug = slug_of(a.slug)
    if a.action == 'plan':
        args = [slug, 'plan', '--max', str(a.max)]
        for k in ('street', 'near', 'out'):
            if getattr(a, k):
                args += [f'--{k}', getattr(a, k)]
        if a.unsurveyed:
            args.append('--unsurveyed')
        py('survey.py', *args)
        return
    d = Path(a.dir).resolve() if a.dir else CITIES / slug / 'survey'
    py('survey.py', slug, 'views', d)
    blender('-b', CITIES / slug / 'city.blend', '--python-exit-code', '1', '--python', PIPE / 'blender/render_survey.py', '--',
            d / 'views.json', d / 'render')
    py('survey.py', slug, 'sheets', d)


def cmd_seed(a):
    slug = slug_of(a.slug)
    args = [slug] + (['--ids', a.ids] if a.ids else []) + (['--force'] if a.force else []) + (['--unsurveyed'] if a.unsurveyed else [])
    py('housekit_seed.py', *args)


def cmd_publish(a):
    slug = slug_of(a.slug)
    link_city(slug)
    env = {'ARENA_URL': a.arena} if a.arena else {}
    npm('run', 'build', cwd=GAME) if not env else run([shutil.which('npm'), 'run', 'build'], cwd=GAME, env=env)
    dist_city = GAME / 'dist/city'
    if dist_city.is_symlink():
        dist_city.unlink()
        shutil.copytree(CITIES / slug / 'pack', dist_city)
    size = sum(f.stat().st_size for f in (GAME / 'dist').rglob('*') if f.is_file()) / 1e6
    say(f'{G}{B}Website ready:{X} game/dist/ ({size:.0f} MB). Upload its contents to any web host.')
    say('Online arena: ' + (f'uses {a.arena}' if a.arena else 'off. See game/deploy/README.md to run a relay on a small VPS.'))


def cmd_selftest(a):
    head('Pipeline (offline, synthetic OSM data)')
    run([VPY, '-m', 'unittest', 'discover', '-s', ROOT / 'tests'])
    head('Game')
    npm('test', cwd=GAME)
    say(f'{G}{B}All tests passed.{X}')


def main():
    ap = argparse.ArgumentParser(prog='wasteland.py', description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('doctor', help='check and install everything').set_defaults(fn=cmd_doctor)
    for name, fn, hlp in (('new', cmd_new, 'find a place and create cities/<slug>/'), ('make', cmd_make, 'new + build + play')):
        p = sub.add_parser(name, help=hlp)
        p.add_argument('query')
        p.add_argument('--size', default='medium', help='small (600 m), medium (1000 m), large (1600 m) or metres')
        p.add_argument('--pick', type=int, default=1)
        p.add_argument('--center')
        p.add_argument('--slug')
        p.add_argument('--name')
        if name == 'make':
            p.add_argument('--no-play', action='store_true')
        p.set_defaults(fn=fn)
    p = sub.add_parser('build', help='run the pipeline')
    p.add_argument('slug', nargs='?')
    p.add_argument('--from', dest='start', choices=STEPS)
    p.add_argument('--only', help='comma separated steps: ' + ','.join(STEPS))
    p.add_argument('--refresh', action='store_true', help='download OSM data and terrain again')
    p.add_argument('--force-splash', action='store_true')
    p.set_defaults(fn=cmd_build)
    p = sub.add_parser('rebuild', help='prepare → … → pack (after overrides or custom buildings)')
    p.add_argument('slug', nargs='?')
    p.add_argument('--force-splash', action='store_true')
    p.set_defaults(fn=cmd_rebuild)
    p = sub.add_parser('play', help='install a city in the game and start it')
    p.add_argument('slug', nargs='?')
    p.add_argument('--open', action='store_true', help='open the browser')
    p.add_argument('--no-serve', action='store_true', help='only install the city')
    p.set_defaults(fn=cmd_play)
    sub.add_parser('list').set_defaults(fn=cmd_list)
    sub.add_parser('selftest', help='offline pipeline tests + game tests').set_defaults(fn=cmd_selftest)
    p = sub.add_parser('status')
    p.add_argument('slug', nargs='?')
    p.set_defaults(fn=cmd_status)
    p = sub.add_parser('theme', help='write theme.json (names, texts, voice lines, art and music prompts)')
    p.add_argument('slug', nargs='?')
    p.add_argument('--reset', action='store_true')
    p.set_defaults(fn=cmd_theme)
    p = sub.add_parser('voices', help='generate voice lines with ElevenLabs')
    p.add_argument('slug', nargs='?')
    p.add_argument('--force', action='store_true')
    p.add_argument('--only', help='comma separated line names')
    p.set_defaults(fn=cmd_voices)
    p = sub.add_parser('music', help="manage the city's radio")
    p.add_argument('slug', nargs='?')
    p.add_argument('--add', help='mp3 file to add')
    p.add_argument('--title')
    p.add_argument('--source', help='e.g. the suno.com song URL')
    p.add_argument('--generator', help='e.g. Suno v5')
    p.add_argument('--clear', action='store_true')
    p.add_argument('--vehicle', help='a bonus vehicle id: its own radio (theme.json bonus_vehicles)')
    p.set_defaults(fn=cmd_music)
    p = sub.add_parser('buildings', help='list buildings for refinement')
    p.add_argument('slug', nargs='?')
    p.add_argument('--street')
    p.add_argument('--near', help='"lat,lon" or a landmark name')
    p.add_argument('--radius', type=float)
    p.add_argument('--id')
    p.add_argument('--name')
    p.add_argument('--limit', type=int)
    p.add_argument('--json', action='store_true')
    p.set_defaults(fn=cmd_buildings)
    p = sub.add_parser('render', help='review images (cities/<slug>/renders/)')
    p.add_argument('slug', nargs='?')
    p.add_argument('views', nargs='*', help='camera names or street:x,y,heading')
    p.add_argument('--street')
    p.add_argument('--near')
    p.set_defaults(fn=cmd_render)
    p = sub.add_parser('survey', help='Street View rounds: plan viewpoints, then compare frames with the model')
    p.add_argument('slug', nargs='?')
    p.add_argument('action', choices=['plan', 'compare'])
    p.add_argument('dir', nargs='?', help='compare: the folder with plan.json and the frames (default cities/<slug>/survey)')
    p.add_argument('--street')
    p.add_argument('--near', help='"lat,lon" or a landmark name')
    p.add_argument('--unsurveyed', action='store_true')
    p.add_argument('--max', type=int, default=40)
    p.add_argument('--out', help='plan: where plan.json goes (keep Street View frames outside the repository)')
    p.set_defaults(fn=cmd_survey)
    p = sub.add_parser('seed', help='housekit starter scripts (custom/<id>.py) from overrides.json notes')
    p.add_argument('slug', nargs='?')
    p.add_argument('--ids', help='comma separated building ids')
    p.add_argument('--force', action='store_true', help='replace untouched starter scripts (hand-edited ones are kept)')
    p.add_argument('--unsurveyed', action='store_true', help='also every other house, from its generated look')
    p.set_defaults(fn=cmd_seed)
    p = sub.add_parser('publish', help='build the static website (game/dist/)')
    p.add_argument('slug', nargs='?')
    p.add_argument('--arena', help='wss:// URL of your arena relay')
    p.set_defaults(fn=cmd_publish)
    a = ap.parse_args()
    load_env()
    a.fn(a)


if __name__ == '__main__':
    main()
