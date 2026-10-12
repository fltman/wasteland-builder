"""Build a city's bonus car: a lowered Volvo 740 "A-traktor" (EPA) → glTF for the game.

    Blender -b --factory-startup --python pipeline/blender/build_bonus_car.py -- spec.json out.glb [preview.png]

spec.json (from theme.json "bonus_vehicles", see make_pack.py):
    {"paint": "#7d1416", "rear_window": "Wasteland High", "plate": "EPA 030", "dice": "#f4f1ea",
     "led": "#ff2a3a", "speaker_led": "#2a9dff", "rims": "#c9a24a"}

The car, in the game's vehicle conventions (Blender X right, Y forward, Z up; the export turns it into
glTF -Z forward, Y up; metres; wheel pivots Wheel_FL/FR/RL/RR spin about X):
- a boxy 740 sedan body lowered to 10 cm ground clearance on polished multi-spoke rims;
- black bumpers, a chin spoiler, side mouldings, the slanted Volvo grille bar, rectangular headlamps;
- wrap-round tail lamps, a red slow-vehicle triangle (LGF) on the boot lid and a number plate;
- a big white vinyl text across the rear window ("|" for a second line);
- an interior seen through the tinted glass: velour seats, a dashboard, red LED strips in the
  footwells and along the dash, fuzzy dice from the mirror, and a parcel shelf full of speakers (two
  subwoofers, two 6x9s) with LED rings (materials named "Interior …", which the game hides in the
  driver's view, where its own cockpit takes over; "speaker LED" pulses with the music);
- extra lights on a bar, wipers, a chrome belt line, double pinstripes, a boot lip spoiler, an aerial,
  twin chrome tailpipes and gold cross-spoke rims with polished lips.
Material names follow the game's rules: "lamp" = emissive and never weathered, "clean" = no wasteland
grime, "paint" = panels that crumple when damaged.
"""
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
spec = json.loads(Path(args[0]).read_text())
out = Path(args[1])
preview = Path(args[2]) if len(args) > 2 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def hex_rgb(value, default):
    value = (value or default).lstrip('#')
    srgb = [int(value[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb)


def material(name, color, metallic=0.0, rough=0.5, emission=0.0, alpha=1.0, clearcoat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metallic
    p.inputs['Roughness'].default_value = rough
    if clearcoat and 'Coat Weight' in p.inputs:
        p.inputs['Coat Weight'].default_value = clearcoat
    if emission:
        p.inputs['Emission Color'].default_value = (*color, 1)
        p.inputs['Emission Strength'].default_value = emission
    if alpha < 1:
        p.inputs['Alpha'].default_value = alpha
        for attr, value in (('surface_render_method', 'BLENDED'), ('blend_method', 'BLEND')):
            if hasattr(m, attr):
                try:
                    setattr(m, attr, value)
                except (TypeError, ValueError):
                    pass
    m.diffuse_color = (*color, alpha)
    m.use_backface_culling = True        # single-sided in glTF: no painted insides in the driver's view
    return m


PAINT = material('EPA clean paint', hex_rgb(spec.get('paint'), '#7d1416'), 0.15, 0.42, clearcoat=0.2)
BLACK = material('EPA clean black trim', (0.012, 0.012, 0.013), 0.1, 0.55)
CHROME = material('EPA clean chrome', (0.85, 0.86, 0.88), 1.0, 0.12)
SILVER = material('EPA clean rim silver', (0.72, 0.73, 0.75), 0.9, 0.28)
RUBBER = material('EPA clean tyre rubber', (0.018, 0.018, 0.02), 0.0, 0.9)
GLASS = material('EPA clean tinted glass', (0.02, 0.025, 0.03), 0.2, 0.05, alpha=0.62)
HEAD = material('EPA headlamp', (1.0, 0.86, 0.62), 0.0, 0.2, emission=3.0)
INDICATOR = material('EPA indicator lamp', (1.0, 0.45, 0.05), 0.0, 0.3, emission=1.2)
TAIL = material('EPA red tail lamp', (0.75, 0.02, 0.02), 0.0, 0.25, emission=2.5)
REVERSE = material('EPA reverse lamp', (0.9, 0.9, 0.85), 0.0, 0.25, emission=0.6)
LGF = material('EPA LGF triangle lamp', (1.0, 0.18, 0.04), 0.0, 0.35, emission=1.6)
LGF_EDGE = material('EPA LGF border lamp', (0.55, 0.01, 0.01), 0.2, 0.25, emission=0.6)
VINYL = material('EPA rear window vinyl lamp', (0.95, 0.95, 0.93), 0.0, 0.4, emission=0.35)
PLATE = material('EPA number plate lamp', (0.93, 0.93, 0.9), 0.0, 0.5, emission=0.25)
PLATE_TEXT = material('EPA number plate text lamp', (0.02, 0.02, 0.02), 0.0, 0.6)
EU_BLUE = material('EPA number plate eu lamp', (0.02, 0.12, 0.55), 0.0, 0.5, emission=0.2)
VELOUR = material('Interior clean velour', (0.05, 0.05, 0.06), 0.0, 0.95)
DASH = material('Interior clean dash plastic', (0.02, 0.02, 0.022), 0.0, 0.7)
LED = material('Interior LED lamp', hex_rgb(spec.get('led'), '#ff2a3a'), 0.0, 0.3, emission=6.0)
DICE = material('Interior clean plush dice', hex_rgb(spec.get('dice'), '#f4f1ea'), 0.0, 1.0)
PIPS = material('Interior clean dice pips', (0.01, 0.01, 0.01), 0.0, 1.0)
GOLD = material('EPA clean gold rim', hex_rgb(spec.get('rims'), '#c9a24a'), 1.0, 0.3)
STRIPE = material('EPA clean pinstripe', (0.9, 0.9, 0.88), 0.0, 0.4)
SPEAKER_LED = material('Interior speaker LED lamp', hex_rgb(spec.get('speaker_led'), '#2a9dff'), 0.0, 0.3, emission=7.0)
CONE = material('Interior clean speaker cone', (0.05, 0.05, 0.055), 0.3, 0.5)
SHELF = material('Interior clean shelf carpet', (0.03, 0.03, 0.035), 0.0, 0.95)

root = bpy.data.objects.new('epa', None)
scene.collection.objects.link(root)
parent = root


def link(o, name, mat, bevel=0.0, smooth=False):
    o.name = name
    o.parent = parent
    if mat is not None:
        o.data.materials.clear()
        o.data.materials.append(mat)
    if bevel:
        mod = o.modifiers.new('bevel', 'BEVEL')
        mod.width, mod.segments, mod.limit_method = bevel, 2, 'ANGLE'
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier=mod.name)
    if smooth and o.type == 'MESH':
        for p in o.data.polygons:
            p.use_smooth = True
    return o


def mesh_obj(name, verts, faces, mat, bevel=0.0):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    return link(o, name, mat, bevel)


def box(name, loc, size, mat, bevel=0.01, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return link(o, name, mat, min(bevel, min(size) * 0.3) if bevel else 0)


def cyl(name, loc, radius, depth, mat, axis='Z', vertices=24, smooth=True):
    rot = {'X': (0, math.pi / 2, 0), 'Y': (math.pi / 2, 0, 0), 'Z': (0, 0, 0)}[axis]
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc, rotation=rot)
    o = bpy.context.object
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    return link(o, name, mat, smooth=smooth)


CABIN_CENTRE = Vector((0, -0.35, 0.85))


def outward(n, point):
    """A face normal turned away from the middle of the cabin."""
    return n if n.dot(Vector(point) - CABIN_CENTRE) >= 0 else -n


def quad(name, pts, mat, offset=0.0):
    """A one-sided panel lifted `offset` off the body, facing outwards."""
    pts = [Vector(p) for p in pts]
    n = outward((pts[1] - pts[0]).cross(pts[3] - pts[0]).normalized(), sum(pts, Vector()) / 4)
    pts = [p + n * offset for p in pts]
    face = (0, 1, 2, 3) if (pts[1] - pts[0]).cross(pts[3] - pts[0]).dot(n) > 0 else (3, 2, 1, 0)
    return mesh_obj(name, pts, [face], mat)


def loft(name, rings, mat, bevel=0.0):
    """Closed body through cross-sections (y, half width, bottom z, top z, top half width)."""
    verts, faces = [], []
    for y, hw, zb, zt, hwt in rings:
        c = 0.05                                                       # chamfered lower and upper corners
        verts += [(-hw + c, y, zb), (hw - c, y, zb), (hw, y, zb + c), (hwt, y, zt - c * 0.6), (hwt - c, y, zt),
                  (-hwt + c, y, zt), (-hwt, y, zt - c * 0.6), (-hw, y, zb + c)]
    k = 8
    faces.append(tuple(range(k))[::-1])
    for i in range(len(rings) - 1):
        for j in range(k):
            a, b = i * k + j, i * k + (j + 1) % k
            faces.append((a, b, b + k, a + k))
    last = (len(rings) - 1) * k
    faces.append(tuple(range(last, last + k)))
    return mesh_obj(name, verts, faces, mat, bevel)


def text(name, body, size, mat, font=None, extrude=0.0015, space_line=1.0):
    curve = bpy.data.curves.new(name, 'FONT')
    curve.body, curve.size, curve.align_x, curve.align_y, curve.extrude = body, size, 'CENTER', 'CENTER', extrude
    curve.space_line = space_line
    if font:
        curve.font = font
    o = bpy.data.objects.new(name, curve)
    scene.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.convert(target='MESH')
    o = bpy.context.object
    o.select_set(False)
    return link(o, name, mat)


def load_font(paths):
    for p in paths:
        if Path(p).exists():
            try:
                return bpy.data.fonts.load(p, check_existing=True)
            except RuntimeError:
                continue
    return None


BOLD = load_font(['/System/Library/Fonts/Supplemental/Arial Black.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
                  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 'C:/Windows/Fonts/ariblk.ttf'])
PLATE_FONT = load_font(['/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'])

# ------------------------------------------------------------------------------------------ body
AXLE, WHEEL_R, TRACK = 1.385, 0.30, 0.765
body = loft('EPA body paint', [
    (2.37, 0.80, 0.33, 0.70, 0.78),
    (2.31, 0.86, 0.17, 0.77, 0.84),
    (1.95, 0.875, 0.15, 0.80, 0.86),
    (0.93, 0.875, 0.14, 0.88, 0.86),
    (-1.60, 0.875, 0.14, 0.92, 0.86),
    (-2.37, 0.86, 0.17, 0.93, 0.85),
    (-2.44, 0.83, 0.30, 0.91, 0.82),
], PAINT, bevel=0.02)
# Wheel arches: cut out of the lowered body, tight over the tyres.
for y in (AXLE, -AXLE):
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=WHEEL_R + 0.045, depth=2.4, location=(0, y, WHEEL_R + 0.005), rotation=(0, math.pi / 2, 0))
    cutter = bpy.context.object
    cutter.data.materials.append(BLACK)                       # the arch liners come out black
    mod = body.modifiers.new('arch', 'BOOLEAN')
    mod.operation, mod.object, mod.solver = 'DIFFERENCE', cutter, 'EXACT'
    if hasattr(mod, 'material_mode'):
        mod.material_mode = 'TRANSFER'
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)

# Greenhouse: windscreen, roof, rear window and the slanted sides (tumblehome).
BF, BR, ZF, ZR, HB = 0.93, -1.60, 0.88, 0.92, 0.82          # base: front/rear y, z, half width
TF, TR, ZT, HT = 0.31, -1.00, 1.33, 0.66                      # roof: front/rear y, z, half width
G = {
    'blf': (-HB, BF, ZF), 'brf': (HB, BF, ZF), 'brr': (HB, BR, ZR), 'blr': (-HB, BR, ZR),
    'tlf': (-HT, TF, ZT), 'trf': (HT, TF, ZT), 'trr': (HT, TR, ZT), 'tlr': (-HT, TR, ZT),
}
names = list(G)
idx = {k: i for i, k in enumerate(names)}
mesh_obj('EPA greenhouse paint', [G[k] for k in names], [     # wound to face outwards (single-sided)
    (idx['tlf'], idx['trf'], idx['brf'], idx['blf']),          # windscreen
    (idx['tlr'], idx['trr'], idx['trf'], idx['tlf']),          # roof
    (idx['trr'], idx['tlr'], idx['blr'], idx['brr']),          # rear window
    (idx['trf'], idx['trr'], idx['brr'], idx['brf']),          # right side
    (idx['tlr'], idx['tlf'], idx['blf'], idx['blr']),          # left side
], PAINT, bevel=0.015)


def on_face(a, b, c, d, u, v):
    """Bilinear point on a quad a(0,0) b(1,0) c(1,1) d(0,1)."""
    a, b, c, d = (Vector(p) for p in (a, b, c, d))
    return (a.lerp(b, u)).lerp(d.lerp(c, u), v)


def panel(name, corners, u0, u1, v0, v1, mat, offset):
    a, b, c, d = corners
    return quad(name, [on_face(a, b, c, d, u0, v0), on_face(a, b, c, d, u1, v0), on_face(a, b, c, d, u1, v1), on_face(a, b, c, d, u0, v1)], mat, offset)


windscreen = (G['blf'], G['brf'], G['trf'], G['tlf'])
rear_window = (G['brr'], G['blr'], G['tlr'], G['trr'])
right_side = (G['brf'], G['brr'], G['trr'], G['trf'])
left_side = (G['blr'], G['blf'], G['tlf'], G['tlr'])
panel('Windscreen glass', windscreen, 0.05, 0.95, 0.06, 0.95, GLASS, 0.006)
panel('Rear window glass', rear_window, 0.06, 0.94, 0.08, 0.93, GLASS, 0.006)
for side in (right_side, left_side):
    flip = side is left_side
    for (u0, u1) in ((0.05, 0.46), (0.53, 0.86)):
        if flip:
            u0, u1 = 1 - u1, 1 - u0
        panel('Side window glass', side, u0, u1, 0.10, 0.90, GLASS, 0.006)
    b0, b1 = (0.46, 0.53) if not flip else (0.47, 0.54)
    panel('B pillar black trim', side, b0, b1, 0.06, 0.95, BLACK, 0.008)
    panel('Window rubber black trim', side, 0.02, 0.98, 0.07, 0.10, BLACK, 0.007)
    panel('Belt line chrome', side, 0.0, 1.0, 0.0, 0.035, CHROME, 0.009)
box('Roof drip rail black trim', (HT + 0.005, (TF + TR) / 2, ZT - 0.01), (0.02, TF - TR + 0.1, 0.025), BLACK, 0.005)
box('Roof drip rail black trim', (-HT - 0.005, (TF + TR) / 2, ZT - 0.01), (0.02, TF - TR + 0.1, 0.025), BLACK, 0.005)

# ------------------------------------------------------------------------------------------ trim
box('Front bumper black trim', (0, 2.42, 0.31), (1.80, 0.17, 0.22), BLACK, 0.04)
box('Chin spoiler black trim', (0, 2.40, 0.15), (1.72, 0.14, 0.08), BLACK, 0.02)
box('Rear bumper black trim', (0, -2.51, 0.32), (1.80, 0.16, 0.22), BLACK, 0.04)
for s in (-1, 1):
    for y0, y1 in ((1.76, 2.30), (-1.0, 1.0), (-2.36, -1.77)):
        box('Side moulding black trim', (s * 0.879, (y0 + y1) / 2, 0.50), (0.014, y1 - y0, 0.065), BLACK, 0.006)
    box('Side skirt black trim', (s * 0.865, 0.0, 0.175), (0.03, 2.0, 0.07), BLACK, 0.01)
    # Panel gaps: doors, bonnet and boot lid.
    for y in (0.98, -0.02, -1.02):
        box('Door gap black trim', (s * 0.877, y, 0.53), (0.006, 0.006, 0.72), BLACK, 0)
    box('Door gap black trim', (s * 0.877, -0.02, 0.165), (0.006, 2.0, 0.006), BLACK, 0)
    box('Door mirror black trim', (s * 0.90, 0.80, 0.95), (0.06, 0.05, 0.04), BLACK, 0.01)
    box('Door mirror paint', (s * 0.95, 0.80, 0.99), (0.11, 0.07, 0.10), PAINT, 0.025)
    box('Door handle black trim', (s * 0.883, 0.25, 0.80), (0.02, 0.16, 0.035), BLACK, 0.005)
    box('Door handle black trim', (s * 0.883, -0.85, 0.82), (0.02, 0.16, 0.035), BLACK, 0.005)
box('Bonnet gap black trim', (0, 0.96, 0.885), (1.62, 0.006, 0.006), BLACK, 0)
for s in (-1, 1):
    # Double pinstripes along the shoulder and wipers resting on the windscreen.
    for z in (0.805, 0.782):
        box('Pinstripe', (s * 0.879, 0.0, z), (0.004, 4.5, 0.007), STRIPE, 0)
    w = box('Wiper black trim', (s * 0.27 - 0.06, 0.88, 0.905), (0.50, 0.018, 0.012), BLACK, 0)
    w.rotation_euler = (0, 0, s * 0.12)
cyl('Aerial black trim', (0.70, -2.05, 1.30), 0.004, 0.75, BLACK, 'Z', 6)
box('Boot lip spoiler black trim', (0, -2.37, 0.955), (1.50, 0.09, 0.03), BLACK, 0.012)
box('Boot gap black trim', (0, -1.63, 0.925), (1.62, 0.006, 0.006), BLACK, 0)

# Front: the grille with the diagonal bar, rectangular headlamps and corner indicators.
FY = 2.375
box('Grille chrome frame', (0, FY, 0.57), (0.66, 0.03, 0.24), CHROME, 0.01)
box('Grille black inside trim', (0, FY + 0.006, 0.57), (0.60, 0.03, 0.19), BLACK, 0.004)
for i in range(11):
    box('Grille chrome slat', (-0.27 + i * 0.054, FY + 0.012, 0.57), (0.012, 0.02, 0.18), CHROME, 0)
bar = box('Volvo diagonal bar chrome', (0, FY + 0.03, 0.57), (0.70, 0.015, 0.035), CHROME, 0.004, rot=(0, math.atan2(0.19, 0.60), 0))
cyl('Volvo iron mark chrome', (0, FY + 0.035, 0.57), 0.045, 0.018, CHROME, 'Y', 24)
for s in (-1, 1):
    box('Headlamp chrome surround', (s * 0.55, FY - 0.004, 0.575), (0.42, 0.03, 0.17), CHROME, 0.006)
    box('Headlamp', (s * 0.55, FY + 0.008, 0.575), (0.39, 0.02, 0.14), HEAD, 0.006)
    box('Front indicator lamp', (s * 0.80, FY - 0.03, 0.575), (0.06, 0.03, 0.14), INDICATOR, 0.004)
    box('Fog lamp', (s * 0.55, 2.505, 0.30), (0.20, 0.02, 0.08), HEAD, 0.004)
    cyl('Extra light chrome', (s * 0.33, 2.56, 0.52), 0.095, 0.09, CHROME, 'Y', 28)
    cyl('Extra light lens', (s * 0.33, 2.607, 0.52), 0.082, 0.008, HEAD, 'Y', 28)
    cyl('Extra light stem black trim', (s * 0.33, 2.53, 0.44), 0.015, 0.08, BLACK, 'Z', 8)
box('Extra light bar black trim', (0, 2.53, 0.415), (0.90, 0.04, 0.025), BLACK, 0.008)

# Rear: wrap-round tail lamps, a black centre panel, the red triangle and the plate.
RY = -2.445
for s in (-1, 1):
    box('Tail lamp', (s * 0.60, RY, 0.73), (0.46, 0.03, 0.20), TAIL, 0.008)
    box('Tail lamp indicator', (s * 0.60, RY - 0.004, 0.655), (0.46, 0.03, 0.05), INDICATOR, 0.004)
    box('Reverse lamp', (s * 0.40, RY - 0.006, 0.79), (0.06, 0.03, 0.07), REVERSE, 0.004)
    box('Tail lamp wrap', (s * 0.835, -2.36, 0.73), (0.03, 0.16, 0.20), TAIL, 0.006)
box('Rear centre black trim', (0, RY + 0.004, 0.73), (0.74, 0.03, 0.20), BLACK, 0.006)
for s in (-1, 1):
    for z in (0.70, 0.745, 0.79):
        box('Tail lamp rib black trim', (s * 0.60, RY - 0.017, z), (0.46, 0.004, 0.006), BLACK, 0)
badge = text('740 GL chrome', '740 GL', 0.05, CHROME, BOLD)
badge.rotation_euler = (math.pi / 2, 0, 0)
badge.location = (0.56, RY - 0.016, 0.87)
volvo = text('VOLVO chrome', 'VOLVO', 0.07, CHROME, BOLD)
volvo.rotation_euler = (math.pi / 2, 0, 0)
volvo.location = (0, RY - 0.018, 0.85)

# The slow-vehicle sign: an equilateral triangle, point up, fluorescent red inside a dark red border.
def triangle(name, side, z_base, y, mat, thickness):
    h = side * math.sqrt(3) / 2
    pts = [(-side / 2, z_base), (side / 2, z_base), (0, z_base + h)]
    verts = [(x, y, z) for x, z in pts] + [(x, y - thickness, z) for x, z in pts]
    faces = [(0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)]
    return mesh_obj(name, verts, faces, mat)


triangle('LGF border', 0.44, 0.465, RY - 0.03, LGF_EDGE, 0.012)
triangle('LGF triangle', 0.33, 0.497, RY - 0.043, LGF, 0.004)

box('Rear number plate', (0, -2.595, 0.33), (0.52, 0.012, 0.11), PLATE, 0.004)
box('Rear plate EU strip', (-0.235, -2.6015, 0.33), (0.045, 0.004, 0.105), EU_BLUE, 0)
plate_text = text('Plate text', spec.get('plate', 'EPA 030'), 0.075, PLATE_TEXT, PLATE_FONT)
plate_text.rotation_euler = (math.pi / 2, 0, 0)
plate_text.location = (0.02, -2.6035, 0.327)
box('Front number plate', (0, 2.515, 0.31), (0.52, 0.012, 0.11), PLATE, 0.004)
front_text = text('Plate text', spec.get('plate', 'EPA 030'), 0.075, PLATE_TEXT, PLATE_FONT)
front_text.rotation_euler = (math.pi / 2, 0, math.pi)
front_text.location = (-0.02, 2.523, 0.307)

# The rear window decal: big white letters across the glass, readable from behind. "|" or a newline
# breaks the text; a long text with spaces is split into two balanced lines.
lines = [part.strip() for part in spec.get('rear_window', '').replace('|', '\n').split('\n') if part.strip()]
if len(lines) == 1 and len(lines[0]) > 14 and ' ' in lines[0]:
    words = lines[0].split()
    cut = min(range(1, len(words)), key=lambda i: abs(len(' '.join(words[:i])) - len(' '.join(words[i:]))))
    lines = [' '.join(words[:cut]), ' '.join(words[cut:])]
if lines:
    a, b, c, d = rear_window
    v = 0.66 if len(lines) == 1 else 0.62
    left, right = on_face(a, b, c, d, 0.08, v), on_face(a, b, c, d, 0.92, v)
    width = (right - left).length * 0.97
    glass_height = (on_face(a, b, c, d, 0.5, 0.93) - on_face(a, b, c, d, 0.5, 0.08)).length
    up = (on_face(a, b, c, d, 0.5, 0.9) - on_face(a, b, c, d, 0.5, 0.4)).normalized()
    normal = outward((Vector(b) - Vector(a)).cross(Vector(d) - Vector(a)).normalized(), on_face(a, b, c, d, 0.5, 0.5))
    decal = text('Rear window decal', '\n'.join(lines), 0.1, VINYL, BOLD, extrude=0.0008, space_line=0.85)
    fit = min(width / max(decal.dimensions.x, 1e-6), glass_height * 0.62 / max(decal.dimensions.y, 1e-6))
    decal.scale = (fit,) * 3
    bpy.context.view_layer.objects.active = decal
    decal.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    decal.select_set(False)
    # Text lies in X–Y facing +Z; a turn about X by `tilt` makes it face back and up like the glass,
    # with +X still to the right of someone standing behind the car.
    tilt = math.atan2(-normal.y, normal.z)
    decal.rotation_euler = (tilt, 0, 0)
    centre = (left + right) / 2 + normal * 0.012
    decal.location = centre
    line = box('Rear window decal underline', (0, 0, 0), (width * 0.92, 0.012, 0.0015), VINYL, 0)
    line.rotation_euler = (tilt, 0, 0)
    line.location = centre - up * (decal.dimensions.y * 0.5 + 0.055)
for x in (-0.50, -0.62):
    cyl('Exhaust tip chrome', (x, -2.55, 0.20), 0.05, 0.18, CHROME, 'Y', 18)
    cyl('Exhaust tip black', (x, -2.64, 0.20), 0.04, 0.01, BLACK, 'Y', 18)

# ------------------------------------------------------------------------------------------ interior (seen through the glass)
box('Interior dash', (0, 0.62, 0.80), (1.56, 0.42, 0.16), DASH, 0.03)
box('Interior floor', (0, -0.35, 0.36), (1.56, 2.2, 0.04), VELOUR, 0)
for x in (-0.38, 0.38):
    box('Interior seat base', (x, -0.05, 0.48), (0.50, 0.52, 0.16), VELOUR, 0.04)
    b = box('Interior seat back', (x, -0.33, 0.83), (0.50, 0.14, 0.62), VELOUR, 0.05)
    b.rotation_euler = (math.radians(-12), 0, 0)
    box('Interior headrest', (x, -0.42, 1.18), (0.26, 0.10, 0.16), VELOUR, 0.03)
box('Interior rear seat', (0, -0.92, 0.50), (1.50, 0.50, 0.18), VELOUR, 0.05)
box('Interior rear seat back', (0, -1.16, 0.78), (1.50, 0.14, 0.46), VELOUR, 0.05)
# The parcel shelf ("hatthyllan"): two subwoofers and two 6x9 speakers facing up, with LED rings.
box('Interior shelf', (0, -1.42, 0.935), (1.52, 0.38, 0.02), SHELF, 0)


def speaker(x, y, radius, oval=1.0):
    z = 0.946
    for name, r, depth, mat, dz in (('Interior speaker surround', radius, 0.025, CONE, 0.0),
                                     ('Interior speaker cone', radius * 0.82, 0.02, CONE, 0.004),
                                     ('Interior speaker cap', radius * 0.28, 0.03, CHROME, 0.01)):
        o = cyl(name, (x, y, z + dz), r, depth, mat, 'Z', 28)
        o.scale = (1, oval, 1)
    for name, r, minor, mat in (('Interior speaker trim', radius * 1.02, 0.008, CHROME), ('Interior speaker LED ring', radius * 1.1, 0.007, SPEAKER_LED)):
        bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=minor, major_segments=36, minor_segments=6, location=(x, y, z + 0.014))
        o = link(bpy.context.object, name, mat, smooth=True)
        o.scale = (1, oval, 1)


for x in (-0.22, 0.22):
    speaker(x, -1.42, 0.145)
for x in (-0.58, 0.58):
    speaker(x, -1.42, 0.12, oval=0.66)
bpy.ops.mesh.primitive_torus_add(major_radius=0.19, minor_radius=0.018, location=(-0.38, 0.40, 0.96), rotation=(math.radians(62), 0, 0))
link(bpy.context.object, 'Interior steering wheel', DASH, smooth=True)
# Red LED strips: along the dash edge, the footwells and under the front seats.
box('Interior LED dash strip', (0, 0.405, 0.735), (1.40, 0.012, 0.012), LED, 0)
for x in (-0.38, 0.38):
    box('Interior LED footwell', (x, 0.42, 0.40), (0.42, 0.012, 0.012), LED, 0)
    box('Interior LED under seat', (x, -0.30, 0.40), (0.40, 0.012, 0.012), LED, 0)
for s in (-1, 1):
    box('Interior LED door strip', (s * 0.80, -0.30, 0.62), (0.012, 1.80, 0.012), LED, 0)
box('Interior LED rear shelf', (0, -1.235, 0.95), (1.40, 0.012, 0.012), SPEAKER_LED, 0)
# Mirror and the fuzzy dice hanging from it.
box('Interior mirror', (0, 0.30, 1.23), (0.22, 0.03, 0.065), DASH, 0.01)
for dx, dz, spin in ((-0.035, 1.10, 0.4), (0.04, 1.07, -0.3)):
    cyl('Interior dice string', (dx, 0.31, (1.20 + dz) / 2 + 0.02), 0.002, 1.20 - dz - 0.02, DASH, 'Z', 4, smooth=False)
    die = box('Interior dice', (dx, 0.31, dz), (0.07, 0.07, 0.07), DICE, 0.022)
    die.rotation_euler = (0.2, 0.3, spin)
    for px, pz in ((-0.016, 0.016), (0.016, -0.016), (0.0, 0.0)):
        p = box('Interior dice pip', (dx + px, 0.274, dz + pz), (0.012, 0.004, 0.012), PIPS, 0)
        p.parent = die
        p.matrix_parent_inverse = die.matrix_world.inverted()

# ------------------------------------------------------------------------------------------ wheels
for side in (-1, 1):
    for front in (True, False):
        y = AXLE if front else -AXLE
        pivot = bpy.data.objects.new(('Wheel_F' if front else 'Wheel_R') + ('L' if side < 0 else 'R'), None)
        scene.collection.objects.link(pivot)
        pivot.parent = root
        pivot.location = (side * TRACK, y, WHEEL_R)
        saved, parent = parent, pivot
        cyl('Low profile tyre', (0, 0, 0), WHEEL_R, 0.205, RUBBER, 'X', 36)
        cyl('Tyre sidewall', (side * 0.104, 0, 0), WHEEL_R - 0.02, 0.006, RUBBER, 'X', 36)
        cyl('Polished rim lip chrome', (side * 0.106, 0, 0), 0.205, 0.012, CHROME, 'X', 36)
        cyl('Rim dish black trim', (side * 0.085, 0, 0), 0.19, 0.02, BLACK, 'X', 36)
        cyl('Rim barrel gold', (side * 0.096, 0, 0), 0.19, 0.004, GOLD, 'X', 36)
        cyl('Rim centre cap chrome', (side * 0.112, 0, 0), 0.05, 0.02, CHROME, 'X', 16)
        for k in range(10):                                   # cross-spoke "BBS" mesh: 10 spokes, two layers
            a = k * math.tau / 10
            for layer, twist in ((0.0, 0.18), (0.006, -0.18)):
                s = box('Rim spoke gold', (side * (0.104 + layer), math.sin(a) * 0.11, math.cos(a) * 0.11), (0.012, 0.022, 0.15), GOLD, 0)
                s.rotation_euler = (-(a + twist), 0, 0)
        for k in range(28):                                   # tread blocks
            a = k * math.tau / 28
            t = box('Tyre tread', (0, math.sin(a) * WHEEL_R, math.cos(a) * WHEEL_R), (0.19, 0.045, 0.02), RUBBER, 0)
            t.rotation_euler = (-a, 0, 0)
        parent = saved

root['salvage_v2'] = True                 # the game must not weld salvage armour onto it
root['vehicle_design_v3'] = True
root['bonus_vehicle'] = 'volvo740'

# ------------------------------------------------------------------------------------------ export
# Materials are single-sided, so every closed part gets its normals turned outwards (open panels are
# wound by hand or by outward()).
for o in scene.objects:
    if o.type != 'MESH':
        continue
    bm = bmesh.new()
    bm.from_mesh(o.data)
    if bm.faces and all(e.is_manifold for e in bm.edges):
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(o.data)
    bm.free()

objects = [o for o in scene.objects]
bpy.ops.object.select_all(action='DESELECT')
for o in objects:
    o.select_set(True)
bpy.context.view_layer.objects.active = root
out.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(out), export_format='GLB', use_selection=True, export_apply=True, export_extras=True, export_yup=True)

if preview:
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
    floor = bpy.context.object
    floor.data.materials.append(material('Studio floor', (0.05, 0.055, 0.06), 0, 0.8))
    cams = []
    for name, loc, target in (('rear', (-3.2, -6.2, 1.6), (0, -1.6, 0.75)), ('front', (4.0, 5.2, 1.5), (0, 0.6, 0.6))):
        cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
        cam.data.lens = 40
        cam.location = loc
        cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        scene.collection.objects.link(cam)
        cams.append(cam)
    for loc, power, size in (((0, 6, 7), 900, 6), ((-6, -4, 4), 700, 5), ((6, -6, 5), 900, 4)):
        light = bpy.data.objects.new('light', bpy.data.lights.new('light', 'AREA'))
        light.data.energy, light.data.size = power, size
        light.location = loc
        light.rotation_euler = (Vector((0, 0, 0.6)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        scene.collection.objects.link(light)
    world = bpy.data.worlds.new('w')
    world.color = (0.32, 0.33, 0.35)
    scene.world = world
    for engine in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    scene.view_settings.view_transform = 'AgX'
    for cam in cams:
        scene.camera = cam
        scene.render.filepath = str(preview.with_name(f'{preview.stem}-{cam.name}{preview.suffix}'))
        bpy.ops.render.render(write_still=True)
print('BONUS_CAR_OK', out, flush=True)
