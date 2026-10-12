"""Write cities/<slug>/theme.json: the game's names and texts, the narrator's voice lines, and the
prompts for splash art and music — all filled in with the place's real landmarks and streets.

theme.json is meant to be edited (by you or the agent): translate the texts, sharpen the jokes,
change the title. `python3 wasteland.py theme <slug>` only writes it when missing (or with --reset),
then refreshes the game pack. Text fields may use {Name} and {NAME}.
"""
from __future__ import annotations

import argparse
import json

from common import city_dir, load_place, say, write_json

VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb'


def default_theme(place, city):
    name = place['name']
    lms = [l['name'] for l in city.get('landmarks', []) if l['kind'] not in ('yes',)][:8]
    streets = city.get('streets', [])[:8]
    country = place['display_name'].split(',')[-1].strip() if place.get('display_name') else ''
    lm1 = lms[0] if lms else f'the old streets of {name}'
    lm2 = lms[1] if len(lms) > 1 else lm1
    st1 = streets[0] if streets else 'the main street'
    return {
        '_help': 'Edit freely, then run: python3 wasteland.py theme <slug>  (texts) · voices <slug>  (ElevenLabs) · build <slug> --only pack',
        'name': name,
        'language': 'en',
        'title_top': name.upper(),
        'title_bottom': 'WASTELAND',
        'page_title': f'{name} Wasteland · Battlecars',
        'room': name.upper().replace(' ', '')[:16],
        '_map_labels_help': 'Extra tactical-map labels, shown first: a landmark/place name from facts, or {"name": …, "lat": …, "lon": …}.',
        'map_labels': [],
        '_bonus_vehicles_help': 'Extra cars in the garage: [{"id": "epa", "model": "volvo740", "name": …, "number": …, "description": …, '
                                '"paint": "#7d1416", "rear_window": "text on the rear window (| = new line)", "plate": "ABC 123", "dice": "#hex", "led": "#hex"}]. '
                                'Its own radio: python3 wasteland.py music <slug> --vehicle <id> --add song.mp3.',
        'bonus_vehicles': [],
        'text': {
            'eyebrow': 'THE STREETS ARE YOURS. KEEP THEM.',
            'tagline': 'Same streets. New rules.',
            'intro': f'Take an armored machine into the streets of {name}.<br>Hunt the raiders. Scavenge the wrecks. Make it home.',
            'win_eyebrow': f'{name.upper()} IS YOURS',
            'start_roam': f'DRIVE {name.upper()}',
            'explore': f'EXPLORE {name.upper()}',
            'loading': f'Loading {name}…',
            'ready': f'{name} is ready',
            'map_title': f'{name.upper()} / TACTICAL MAP',
            'description': f'Armored cars. Real {name} streets. An open-world browser combat game.',
        },
        'voice': {
            'voice_id': VOICE_ID,
            'model': 'eleven_v3',
            '_lines_help': 'Audio tags like [gravelly] [pause] [urgent] steer delivery. intro and win should name the place; '
                           'wave, critical, repair and wrecked are optional (the game has generic ones).',
            'lines': {
                'intro': f'[gravelly] The streets of {name} used to belong to everyone. [pause] Now they belong to whoever makes it home. '
                         f'Stay moving, watch your armor, and bring back the scrap.',
                'win': f'[excited] You made it. The last raider is burning, and {name} is yours for one more night. Bring that engine home.',
                'wave': f'[urgent] Raider engines near {lm1}. They are coming through the streets. Keep your gun hot and your escape route open.',
            },
        },
        'splash_prompt': (
            f'Cinematic post-apocalyptic game key art. An armored muscle car with a steel ram plow, riveted graphite armor, exposed V8 '
            f'supercharger and roof-mounted twin machine guns on a street in {name}, {country}, at golden dusk, with {lm2} recognisable in the '
            f'hazy background and the town\'s real architecture around it. Dust, rust and oil, warm orange sunlight, charcoal shadows, '
            f'desaturated amber. Front three-quarter street-level view; car on the right third, dark calm negative space on the left for '
            f'the HTML title. Wide 16:9 landscape. No people, no text, no logos, no watermark. Realistic game key art.'),
        'music': [
            {'title': f'{name} — Dust Run', 'style': 'Instrumental desert-industrial chase music, 132 BPM. Distorted bass, detuned guitar riffs, '
             'hammered oil-drum percussion, metallic hits, gritty analog pulses and dark brass. Dusty, tense, relentless. Kick and bass from beat '
             'one; no intro, no vocals. Driving combat groove, sparse breaks, loopable end.'},
        ],
        'facts': {'country': country, 'region': place.get('region', ''), 'landmarks': lms, 'streets': streets,
                  'center': place['center'], 'size_m': place['size_m']},
    }


def main(argv=None):
    ap = argparse.ArgumentParser(prog='wasteland.py theme')
    ap.add_argument('slug')
    ap.add_argument('--reset', action='store_true')
    args = ap.parse_args(argv)
    folder = city_dir(args.slug)
    path = folder / 'theme.json'
    if path.exists() and not args.reset:
        say(f'Keeping cities/{args.slug}/theme.json (use --reset to start over).')
    else:
        city = json.loads((folder / 'city.json').read_text()) if (folder / 'city.json').exists() else {}
        write_json(path, default_theme(load_place(args.slug), city))
        say(f'Wrote cities/{args.slug}/theme.json — edit it to change titles, texts, voice lines and prompts.')
    import make_pack
    make_pack.main([args.slug])


if __name__ == '__main__':
    main()
