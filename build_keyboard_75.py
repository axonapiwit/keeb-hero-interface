"""
75% high-profile mechanical keyboard, 84 keys — procedural, web-optimised.
Blender 4.x / 5.x.   blender -b -P build_keyboard_75.py

SCENE SCALE: 1 Blender unit = 1 cm.  Board is 31.3 x 12.3 cm.

v3 — the Z-stack refactor.
  Every height below is DERIVED from the one before it. Nothing in the vertical
  stack is an independent magic number, and the case is SOLVED from the stack
  rather than guessed alongside it. Three defects this fixes:
    * case top and bottom did not meet -> visible gap with switches showing
    * keycaps floated entirely above the rim -> not actually high-profile
    * each part was tilted separately -> layers drifted out of register

  The typing angle is now applied ONCE, to the whole assembled board, as the
  final step. An assertion pass at the end fails loudly if the stack breaks.

Original design; a 75% layout and high-profile case are category conventions.
"""

import bpy, bmesh, math, os
from mathutils import Matrix, Vector

# ══════════════════════════════════════════════════════════════════════
#  PLAN DIMENSIONS  (cm)
# ══════════════════════════════════════════════════════════════════════
EXPORT_DIR   = r"c:\personal\keeb-hero-interface\public\assets"
EXPORT_NAME  = "keyboard_75.glb"

CASE_W       = 31.30
CASE_D       = 12.30
ROW_TOTAL_U  = 16.0
ROWS         = 6
WALL         = 0.40     # 4 mm. At 6.2 mm the cavity was shallower than 6 rows
                        # of keys — the field overflowed the case before v4.
KEY_GAP      = 0.16
PLATE_CLEAR  = 0.15     # 1.5 mm per side between plate/PCB and the cavity

TYPING_ANGLE_DEG = 6.0
FRONT_LIP        = 0.55     # chamfer on the front wall of the tub

# ══════════════════════════════════════════════════════════════════════
#  VERTICAL STACK — the single source of truth.
#  Read top-down: each line consumes the line above it.
# ══════════════════════════════════════════════════════════════════════
CASE_FLOOR_T        = 0.30   # tub floor thickness
PCB_STANDOFF        = 0.55   # inner floor -> PCB top
PCB_T               = 0.16
SWITCH_CLIP_DEPTH   = 0.19   # PCB top -> plate top (the switch's clip travel)
PLATE_T             = 0.15
SWITCH_ABOVE_PLATE  = 0.60   # 6 mm of switch body proud of the plate
KEY_TRAVEL          = 0.40   # 4 mm of key travel
RIM_BELOW_MIDTRAVEL = 0.10   # 1 mm: rim sits this far under a half-pressed cap
CASE_JOIN_OVERLAP   = 0.10   # 1 mm — top skirt hangs DOWN over the tub (lip joint)
CASE_JOIN_LIP       = 0.06   # 0.6 mm — tub is inset so the skirt sleeves outside it

POCKET_DEPTH  = 0.15         # 1.5 mm — openings are recessed this far
NUB_INSET     = 0.05         # 0.5 mm — nub face sits below the wall plane
POCKET_MARGIN = 0.15         # 1.5 mm — minimum clear space to any wall edge
USB_SIZE      = (0.90, 0.35) # 9 x 3.5 mm
SLIDER_SIZE   = (0.80, 0.30) # 8 x 3 mm
POCKET_SPACING = 0.50        # 5 mm between neighbouring openings
CLUSTER_INSET  = 0.40        # clear space between the cluster and the rear corner

# keycap height per row (8–11 mm), row 0 = F-row .. row 5 = bottom row
ROW_CAP_H    = [0.88, 1.10, 1.02, 0.94, 0.98, 1.06]
ROW_TILT_DEG = [ 2.0,  6.0,  3.5,  0.0, -3.5, -6.0]

# ── DERIVED — do not hardcode any of these ────────────────────────────
Z_INNER_FLOOR = CASE_FLOOR_T
Z_PCB_TOP     = Z_INNER_FLOOR + PCB_STANDOFF
Z_PCB_BOT     = Z_PCB_TOP - PCB_T
Z_PLATE_TOP   = Z_PCB_TOP + SWITCH_CLIP_DEPTH
Z_PLATE_BOT   = Z_PLATE_TOP - PLATE_T
Z_SWITCH_BOT  = Z_PLATE_BOT                       # housing passes through the plate
Z_SWITCH_TOP  = Z_PLATE_TOP + SWITCH_ABOVE_PLATE
SWITCH_H      = Z_SWITCH_TOP - Z_SWITCH_BOT
Z_KEYCAP_BASE = Z_SWITCH_TOP                      # stem engagement

def z_keycap_top(row):
    return Z_KEYCAP_BASE + ROW_CAP_H[row]

# rim is solved from a half-pressed keycap, per the brief
_MEAN_CAP_H          = sum(ROW_CAP_H) / len(ROW_CAP_H)
Z_KEYCAP_TOP_MIDTRAV = Z_KEYCAP_BASE + _MEAN_CAP_H - KEY_TRAVEL / 2
Z_CASE_RIM           = Z_KEYCAP_TOP_MIDTRAV - RIM_BELOW_MIDTRAVEL

# the split line: just above the plate, so the tub encloses PCB + plate
Z_CASE_SPLIT   = Z_PLATE_TOP + 0.25
Z_TOP_WALL_BOT = Z_CASE_SPLIT - CASE_JOIN_OVERLAP     # top sleeves down over the tub
CASE_TOP_H     = Z_CASE_RIM - Z_TOP_WALL_BOT

# tub is inset so the top skirt sits OUTSIDE it through the overlap band
BOTTOM_OUTER_W = CASE_W - 2 * CASE_JOIN_LIP
BOTTOM_OUTER_D = CASE_D - 2 * CASE_JOIN_LIP
WALL_OUTER_X   = -BOTTOM_OUTER_W / 2          # left wall outer plane

# ── cavity -> plate -> key field. Sizing the key field independently is what
#    pushed the plate edge through the case seam in v3.
CAVITY_W = BOTTOM_OUTER_W - 2 * WALL
CAVITY_D = BOTTOM_OUTER_D - 2 * WALL
PLATE_W  = CAVITY_W - 2 * PLATE_CLEAR
PLATE_D  = CAVITY_D - 2 * PLATE_CLEAR
PCB_W    = PLATE_W - 0.20
PCB_D    = PLATE_D - 0.20

# ── port cluster: exactly three pockets, rear of the left edge ────────
# The usable face is the tub wall between its own bottom edge and the parting
# line (the skirt covers everything above Z_TOP_WALL_BOT). Pockets are centred
# in that band, so none can touch a wall edge or straddle the seam.
BAND_LO  = CASE_FLOOR_T + POCKET_MARGIN
BAND_HI  = Z_TOP_WALL_BOT - POCKET_MARGIN
CTRL_Z   = (BAND_LO + BAND_HI) / 2

_WALL_Y1 = (BOTTOM_OUTER_D - 2 * WALL) / 2            # rear limit of the wall span


def _cluster():
    """Three pockets laid out from the rear corner forward: USB, slider, slider."""
    out, cursor = [], _WALL_Y1 - CLUSTER_INSET
    for name, (ln, ht) in (('usb', USB_SIZE), ('s1', SLIDER_SIZE), ('s2', SLIDER_SIZE)):
        y1 = cursor
        y0 = y1 - ln
        out.append({'name': name, 'y0': y0, 'y1': y1,
                    'z0': CTRL_Z - ht / 2, 'z1': CTRL_Z + ht / 2,
                    'yc': (y0 + y1) / 2, 'len': ln, 'ht': ht})
        cursor = y0 - POCKET_SPACING
    return sorted(out, key=lambda p: p['y0'])


POCKETS = _cluster()

FOOT_W = 2.60
FOOT_T = 0.34

BEVEL_WIDTH = 0.035
BEVEL_SEGS  = 2
BEVEL_ANGLE = math.radians(40)

SWITCH_W  = 1.38
UPPER_FRAC = 0.40            # top housing as a fraction of switch height
STEM_W    = 0.42
STEM_LEN  = 0.75
STEM_H    = 0.34

KEYCAP_TAPER = 0.20
DISH_INSET   = 0.13
DISH_DEPTH   = 0.07

# ══════════════════════════════════════════════════════════════════════
#  KEY LAYOUT — 75%, 84 keys. (width_u, role)
#  role: 'a' alpha | 'm' modifier/F/nav | 'e' Esc
# ══════════════════════════════════════════════════════════════════════
A, N = 'a', 'm'
KEY_LAYOUT = [
    [(1, 'e')] + [(1, N)] * 15,                                    # 16 keys
    [(1, A)] * 13 + [(2, N), (1, N)],                              # 15
    [(1.5, N)] + [(1, A)] * 12 + [(1.5, N), (1, N)],               # 15
    [(1.75, N)] + [(1, A)] * 11 + [(2.25, N), (1, N)],             # 14
    [(2.25, N)] + [(1, A)] * 10 + [(1.75, N), (1, N), (1, N)],     # 14
    [(1.25, N)] * 3 + [(6.25, A)] + [(1, N)] * 6,                  # 10
]
MAT_BY_ROLE = {'a': 0, 'm': 1, 'e': 2}

# key pitch is derived from the PLATE, so the field can never outgrow the cavity
KEY_UNIT    = min(PLATE_W / ROW_TOTAL_U, PLATE_D / ROWS)
KEY_FIELD_W = ROW_TOTAL_U * KEY_UNIT
KEY_FIELD_D = ROWS * KEY_UNIT
TYPING_ANGLE = math.radians(TYPING_ANGLE_DEG)
TILT_PIVOT   = Vector((0.0, -CASE_D / 2, 0.0))     # front bottom edge


# ══════════════════════════════════════════════════════════════════════
#  HELPERS
# ══════════════════════════════════════════════════════════════════════
def purge_kb():
    for ob in [o for o in bpy.data.objects if o.name.startswith("KB_")]:
        bpy.data.objects.remove(ob, do_unlink=True)
    for me in [m for m in bpy.data.meshes if m.users == 0]:
        bpy.data.meshes.remove(me)
    for ma in [m for m in bpy.data.materials if m.name.startswith("KB_Mat_")]:
        bpy.data.materials.remove(ma)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(srgb_to_linear(int(h[i:i+2], 16) / 255.0) for i in (0, 2, 4)) + (1.0,)


def make_material(name, hexc, roughness=0.5, metallic=0.0, transmission=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = hex_rgb(hexc)
    b.inputs["Roughness"].default_value = roughness
    b.inputs["Metallic"].default_value = metallic
    if transmission and "Transmission Weight" in b.inputs:
        b.inputs["Transmission Weight"].default_value = transmission
    return m


def bm_box(bm, w, d, h, center, mat_idx=0, top_shrink=0.0):
    """Box whose BOTTOM face is centred on `center`."""
    cx, cy, cz = center
    bw, bd = w / 2, d / 2
    tw, td = bw - top_shrink, bd - top_shrink
    lo = [bm.verts.new((cx + sx*bw, cy + sy*bd, cz))
          for sx, sy in ((-1,-1), (1,-1), (1,1), (-1,1))]
    hi = [bm.verts.new((cx + sx*tw, cy + sy*td, cz + h))
          for sx, sy in ((-1,-1), (1,-1), (1,1), (-1,1))]
    faces = [bm.faces.new((lo[3], lo[2], lo[1], lo[0])), bm.faces.new(hi)]
    for i in range(4):
        j = (i + 1) % 4
        faces.append(bm.faces.new((lo[i], lo[j], hi[j], hi[i])))
    for f in faces:
        f.material_index = mat_idx
    return faces[1]


def bm_span(bm, x_c, thick, y0, y1, z0, z1, mat_idx=0):
    """Box from explicit spans. bm_box takes a CENTRE; passing an edge to it has
       now caused two separate bugs (a nub through a wall, a shredded side wall),
       so anything positional goes through here instead."""
    if y1 - y0 <= 1e-6 or z1 - z0 <= 1e-6:
        return
    bm_box(bm, thick, y1 - y0, z1 - z0, (x_c, (y0 + y1) / 2, z0), mat_idx)


def bm_to_object(bm, name, materials):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    for m in materials:
        ob.data.materials.append(m)
    bpy.context.collection.objects.link(ob)
    return ob


def finalise(ob, bevel=True):
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    if bevel:
        m = ob.modifiers.new("bev", 'BEVEL')
        m.width = BEVEL_WIDTH; m.segments = BEVEL_SEGS
        m.limit_method = 'ANGLE'; m.angle_limit = BEVEL_ANGLE
        bpy.ops.object.modifier_apply(modifier="bev")
    bpy.ops.object.shade_smooth()
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(35))
    except Exception:
        pass
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')


def key_slots():
    for r, row in enumerate(KEY_LAYOUT):
        cursor = -KEY_FIELD_W / 2
        y = ((ROWS - 1) / 2 - r) * KEY_UNIT
        for width, role in row:
            yield r, cursor + width * KEY_UNIT / 2, y, width, role
            cursor += width * KEY_UNIT


# ══════════════════════════════════════════════════════════════════════
#  PARTS  — all built FLAT. The typing angle is applied once, at the end.
# ══════════════════════════════════════════════════════════════════════
def _left_wall_with_pockets(bm, ow, od, h):
    """Left wall, built as segments that LEAVE the three pocket voids.

    An earlier pass cut these with a boolean. The tub is assembled from
    overlapping, non-manifold boxes, and the EXACT solver resolved that input by
    discarding a shell it could not classify — it silently ate the entire front
    wall. Constructing the voids is deterministic and cannot touch other walls.

    Each window gets its own skin above and below, so pockets may differ in
    height without opening a continuous slot along the edge.
    """
    x_out = -(ow - WALL) / 2                     # centre line of the wall band
    span_y = od - 2 * WALL
    y0, y1 = -span_y / 2, span_y / 2
    z0, z1 = CASE_FLOOR_T, Z_CASE_SPLIT
    inner_t = WALL - POCKET_DEPTH                # unbroken backing behind the openings
    x_inner = x_out + POCKET_DEPTH / 2
    x_skin  = x_out - inner_t / 2

    # inner slab: full height, full depth — the back face of every opening
    bm_box(bm, inner_t, span_y, h, (x_inner, 0, z0))

    # outer skin: one flat plane, interrupted only by the three openings
    cursor = y0
    for p in POCKETS:
        bm_span(bm, x_skin, POCKET_DEPTH, cursor, p['y0'], z0, z1)        # before
        bm_span(bm, x_skin, POCKET_DEPTH, p['y0'], p['y1'], z0, p['z0'])  # under
        bm_span(bm, x_skin, POCKET_DEPTH, p['y0'], p['y1'], p['z1'], z1)  # over
        cursor = p['y1']
    bm_span(bm, x_skin, POCKET_DEPTH, cursor, y1, z0, z1)                 # after


def make_case_bottom(mat):
    """Tub: floor + 4 walls, top edge exactly at Z_CASE_SPLIT on every wall."""
    bm = bmesh.new()
    ow, od = BOTTOM_OUTER_W, BOTTOM_OUTER_D
    h = Z_CASE_SPLIT - CASE_FLOOR_T
    bm_box(bm, ow, od, CASE_FLOOR_T, (0, 0, 0))
    bm_box(bm, ow, WALL, h, (0,  (od - WALL)/2, CASE_FLOOR_T))
    bm_box(bm, WALL, od - 2*WALL, h, ( (ow - WALL)/2, 0, CASE_FLOOR_T))
    _left_wall_with_pockets(bm, ow, od, h)
    # Front wall: FULL height like every other wall — the seam must close all
    # the way round. v4.0 shortened this wall to make the lip and opened a
    # 4.5 mm slot that the brass plate showed straight through.
    fy = -(od - WALL) / 2
    before = set(bm.verts)
    bm_box(bm, ow, WALL, h, (0, fy, CASE_FLOOR_T))
    span = Z_CASE_SPLIT - CASE_FLOOR_T
    for v in set(bm.verts) - before:
        if v.co.y < fy:                       # outer face only
            f = 1.0 - (v.co.z - CASE_FLOOR_T) / span   # 1 at the bottom, 0 at the seam
            v.co.y += FRONT_LIP * max(0.0, f)          # slope the lip toward the user
    ob = bm_to_object(bm, "KB_Case_Bottom", [mat])
    finalise(ob)
    return ob


def make_case_top(mat):
    """High-profile frame. Bottom edge sleeves 0.2 mm down OUTSIDE the tub;
       rim height is solved from the keycap stack, never typed in."""
    bm = bmesh.new()
    ow, od = CASE_W, CASE_D
    inner_d = od - 2 * WALL
    z, h = Z_TOP_WALL_BOT, CASE_TOP_H
    bm_box(bm, ow, WALL, h, (0,  (od - WALL)/2, z))
    bm_box(bm, ow, WALL, h, (0, -(od - WALL)/2, z))
    bm_box(bm, WALL, inner_d, h, ( (ow - WALL)/2, 0, z))
    bm_box(bm, WALL, inner_d, h, (-(ow - WALL)/2, 0, z))
    ob = bm_to_object(bm, "KB_Case_Top", [mat])
    finalise(ob)
    return ob


def make_slab(name, w, d, z_bot, z_top, mat):
    bm = bmesh.new()
    bm_box(bm, w, d, z_top - z_bot, (0, 0, z_bot))
    ob = bm_to_object(bm, name, [mat])
    finalise(ob)
    return ob


def make_side_controls(mat_case, mat_port):
    """Nubs and port insert that live INSIDE the wall pockets. Every outer face
       sits NUB_INSET below the wall plane, so the silhouette stays unbroken."""
    bm = bmesh.new()
    NUB_T = 0.08                             # thin enough to stay inside a 1.5 mm pocket
    x_nub0 = WALL_OUTER_X + NUB_INSET        # nub face, 0.5 mm below the wall plane
    n_slider_faces = 0
    for p in POCKETS:
        if p['name'] == 'usb':
            continue
        bm_span(bm, x_nub0 + NUB_T / 2, NUB_T,
                p['yc'] - p['len'] * 0.275, p['yc'] + p['len'] * 0.275,
                CTRL_Z - p['ht'] * 0.275, CTRL_Z + p['ht'] * 0.275, 0)
        n_slider_faces += 6

    # USB-C connector tongue, seated at the back of its slot
    usb = next(p for p in POCKETS if p['name'] == 'usb')
    x_port = WALL_OUTER_X + POCKET_DEPTH - 0.04
    bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=False, segments=16,
        radius1=usb['ht'] * 0.30, radius2=usb['ht'] * 0.30, depth=0.08,
        matrix=Matrix.Translation((x_port, usb['yc'], CTRL_Z))
               @ Matrix.Rotation(math.radians(90), 4, 'Y'))
    for v in bm.verts:                       # stretch the circle into the oval tongue
        if abs(v.co.x - x_port) < 0.09:
            v.co.y = usb['yc'] + (v.co.y - usb['yc']) * 2.2

    ob = bm_to_object(bm, "KB_SideControls", [mat_case, mat_port])
    for f in ob.data.polygons:
        f.material_index = 0 if f.index < n_slider_faces else 1   # port insert = dark
    finalise(ob)
    return ob


def make_switch_mesh(m_lower, m_upper, m_stem):
    """One master mesh, 3 slots. Height comes from the derived stack."""
    bm = bmesh.new()
    upper_h = SWITCH_H * UPPER_FRAC
    base_h = SWITCH_H - upper_h
    bm_box(bm, SWITCH_W, SWITCH_W, base_h, (0, 0, 0), 0, top_shrink=0.06)
    bm_box(bm, SWITCH_W - 0.14, SWITCH_W - 0.14, upper_h, (0, 0, base_h), 1, top_shrink=0.10)
    bm_box(bm, STEM_W, STEM_LEN, STEM_H, (0, 0, SWITCH_H), 2)
    bm_box(bm, STEM_LEN, STEM_W, STEM_H, (0, 0, SWITCH_H), 2)
    ob = bm_to_object(bm, "KB_Switch_master", [m_lower, m_upper, m_stem])
    finalise(ob)
    mesh = ob.data
    bpy.data.objects.remove(ob, do_unlink=True)
    return mesh


def make_switches(mesh):
    empty = bpy.data.objects.new("KB_Switches_Group", None)
    empty.empty_display_size = 2.0
    bpy.context.collection.objects.link(empty)
    n = 0
    for r, x, y, width, role in key_slots():
        ob = bpy.data.objects.new("KB_Switch_%d_%02d" % (r, n), mesh)
        ob.location = (x, y, Z_SWITCH_BOT)
        bpy.context.collection.objects.link(ob)
        ob.parent = empty
        ob.matrix_parent_inverse = empty.matrix_world.inverted()
        n += 1
    return empty, n


def make_keycap_rows(m_alpha, m_mod, m_esc):
    rows = []
    for r in range(ROWS):
        bm = bmesh.new()
        n = 0
        for rr, x, y, width, role in key_slots():
            if rr != r:
                continue
            idx = MAT_BY_ROLE[role]
            top = bm_box(bm, width*KEY_UNIT - KEY_GAP, KEY_UNIT - KEY_GAP,
                         ROW_CAP_H[r], (x, y, Z_KEYCAP_BASE), idx,
                         top_shrink=KEYCAP_TAPER)
            res = bmesh.ops.inset_individual(bm, faces=[top],
                                             thickness=DISH_INSET, depth=-DISH_DEPTH)
            for f in res["faces"]:
                f.material_index = idx
            n += 1
        ob = bm_to_object(bm, "KB_Keycaps_Row%d" % r, [m_alpha, m_mod, m_esc])
        # sculpted angle pivots on this row's own centre line at mid-cap height,
        # so tilting changes the angle without changing how proud the row sits
        row_y = ((ROWS - 1) / 2 - r) * KEY_UNIT
        P = Matrix.Translation(Vector((0.0, row_y, Z_KEYCAP_BASE + ROW_CAP_H[r]/2)))
        ob.matrix_world = P @ Matrix.Rotation(math.radians(ROW_TILT_DEG[r]), 4, 'X') \
                            @ P.inverted() @ ob.matrix_world
        finalise(ob)
        rows.append((ob, n))
    return rows


# ══════════════════════════════════════════════════════════════════════
#  BUILD  (flat)
# ══════════════════════════════════════════════════════════════════════
purge_kb()

m_case  = make_material("KB_Mat_Case",        "#17181C", 0.50, 0.35)
m_alpha = make_material("KB_Mat_Cap_Alpha",   "#A9ABAD", 0.55)
m_mod   = make_material("KB_Mat_Cap_Mod",     "#4A4C50", 0.55)
m_esc   = make_material("KB_Mat_Cap_Esc",     "#E8500F", 0.48)
m_lower = make_material("KB_Mat_SwitchLower", "#101014", 0.62)
m_upper = make_material("KB_Mat_SwitchUpper", "#C9CED6", 0.14, 0.0, 0.25)
m_stem  = make_material("KB_Mat_Stem",        "#2FA8E0", 0.32)
m_plate = make_material("KB_Mat_Plate",       "#B08D57", 0.35, 0.90)
m_pcb   = make_material("KB_Mat_PCB",         "#14181F", 0.70)
m_port  = make_material("KB_Mat_Port",        "#0A0B0D", 0.45)

make_case_bottom(m_case)
make_case_top(m_case)
make_slab("KB_PCB",   PCB_W,   PCB_D,   Z_PCB_BOT,   Z_PCB_TOP,   m_pcb)
make_slab("KB_Plate", PLATE_W, PLATE_D, Z_PLATE_BOT, Z_PLATE_TOP, m_plate)
switch_mesh = make_switch_mesh(m_lower, m_upper, m_stem)
_, n_switch = make_switches(switch_mesh)
cap_rows = make_keycap_rows(m_alpha, m_mod, m_esc)
make_side_controls(m_case, m_port)

# ══════════════════════════════════════════════════════════════════════
#  TYPING ANGLE — one rotation, whole board, front bottom edge. Final step.
#  Doing this per part is what knocked the layers out of register in v2.
# ══════════════════════════════════════════════════════════════════════
TILT = Matrix.Translation(TILT_PIVOT) @ Matrix.Rotation(TYPING_ANGLE, 4, 'X') \
       @ Matrix.Translation(-TILT_PIVOT)

for ob in bpy.data.objects:
    if ob.name.startswith("KB_") and ob.parent is None:
        ob.matrix_world = TILT @ ob.matrix_world
bpy.context.view_layer.update()

# feet are built AFTER the tilt, in world space, so they reach the ground
def make_feet(mat):
    """Rear feet, built after the tilt.

    Their TOP face is snapped onto the tilted case underside vertex by vertex —
    a flat top under a 6-degree underside touches along one edge and gapes at
    the other, which reads as a foot floating loose. Foot Z is derived from the
    underside plane, never typed in.

    No bevel: the assertion demands the top face sit flush within 0.05 mm, and a
    0.35 mm chamfer would pull it away from the case.
    """
    bm = bmesh.new()
    y = CASE_D / 2 - 1.0
    nominal = (TILT @ Vector((0.0, y, 0.0))).z
    for sx in (-1, 1):
        before = set(bm.verts)
        bm_box(bm, FOOT_W, FOOT_T, nominal, (sx * (CASE_W / 2 - 3.2), y, 0.0))
        for v in set(bm.verts) - before:
            if v.co.z > nominal * 0.5:                 # top face only
                v.co.z = (TILT @ Vector((v.co.x, v.co.y, 0.0))).z
    ob = bm_to_object(bm, "KB_Feet", [mat])
    finalise(ob, bevel=False)
    return ob

make_feet(m_case)
bpy.context.view_layer.update()


# ══════════════════════════════════════════════════════════════════════
#  ASSERTION PASS
# ══════════════════════════════════════════════════════════════════════
INV_TILT = TILT.inverted()

def z_range(name, board_local=True):
    """Z span of an object. board_local un-rotates the typing angle first —
       comparing tilted parts by raw world Z is how you invent phantom bugs."""
    ob = bpy.data.objects.get(name)
    if ob is None or ob.type != 'MESH':
        return None
    M = (INV_TILT @ ob.matrix_world) if board_local else ob.matrix_world
    zs = [(M @ v.co).z for v in ob.data.vertices]
    return min(zs), max(zs)


def switches_z(board_local=True):
    zs = []
    for ob in bpy.data.objects:
        if not ob.name.startswith("KB_Switch_") or ob.type != 'MESH':
            continue
        M = (INV_TILT @ ob.matrix_world) if board_local else ob.matrix_world
        for v in ob.data.vertices:
            zs.append((M @ v.co).z)
    return (min(zs), max(zs)) if zs else None


print("\n" + "═" * 66)
print("SCALE SANITY  (1 unit = 1 cm)")
print("  KEY_UNIT           %.3f cm = %5.2f mm   (MX standard 19.05)" % (KEY_UNIT, KEY_UNIT * 10))
print("  bottom wall face   %.3f → %.3f cm = %5.2f mm tall"
      % (CASE_FLOOR_T, Z_TOP_WALL_BOT, (Z_TOP_WALL_BOT - CASE_FLOOR_T) * 10))
print("  left edge length   %.2f cm = %6.1f mm   (board depth)" % (CASE_D, CASE_D * 10))
print("  long edge length   %.2f cm = %6.1f mm   (board width)" % (CASE_W, CASE_W * 10))
for p in POCKETS:
    print("  pocket %-4s        %5.2f x %4.2f mm   recess %.1f mm"
          % (p['name'], p['len'] * 10, p['ht'] * 10, POCKET_DEPTH * 10))

print("\n" + "═" * 66)
print("DERIVED Z-STACK  (cm, board-local)")
print("  inner floor      %.3f" % Z_INNER_FLOOR)
print("  pcb              %.3f → %.3f" % (Z_PCB_BOT, Z_PCB_TOP))
print("  plate            %.3f → %.3f" % (Z_PLATE_BOT, Z_PLATE_TOP))
print("  switch           %.3f → %.3f   (%.2f mm above plate)"
      % (Z_SWITCH_BOT, Z_SWITCH_TOP, SWITCH_ABOVE_PLATE * 10))
print("  keycap base      %.3f" % Z_KEYCAP_BASE)
print("  keycap tops      %.3f → %.3f   (by row)"
      % (min(z_keycap_top(r) for r in range(ROWS)),
         max(z_keycap_top(r) for r in range(ROWS))))
print("  cap mid-travel   %.3f" % Z_KEYCAP_TOP_MIDTRAV)
print("  CASE RIM         %.3f   (= mid-travel − %.1f mm)"
      % (Z_CASE_RIM, RIM_BELOW_MIDTRAVEL * 10))
print("  case split       %.3f   top wall starts %.3f (%.1f mm overlap)"
      % (Z_CASE_SPLIT, Z_TOP_WALL_BOT, CASE_JOIN_OVERLAP * 10))

print("\nROW WIDTH CHECK   (target %.2fu)" % ROW_TOTAL_U)
ok_layout, total_keys = True, 0
for r, row in enumerate(KEY_LAYOUT):
    w = sum(float(x) for x, _ in row)
    ok = abs(w - ROW_TOTAL_U) < 1e-6
    ok_layout &= ok
    total_keys += len(row)
    print("  row %d: %2d keys  %6.2fu  cap %.2f cm  %s"
          % (r, len(row), w, ROW_CAP_H[r], "OK" if ok else "*** MISMATCH ***"))
print("  total keys %d   switches %d   %s"
      % (total_keys, n_switch, "OK" if total_keys == 84 else "*** expected 84 ***"))

print("\nLAYER Z RANGES   (board-local / world)")
LAYERS = ["KB_Feet", "KB_Case_Bottom", "KB_PCB", "KB_Plate", "KB_Case_Top",
          "KB_SideControls"] + ["KB_Keycaps_Row%d" % r for r in range(ROWS)]
for n in LAYERS:
    l, w = z_range(n), z_range(n, board_local=False)
    if l and w:
        print("  %-18s %6.3f → %6.3f   |  %6.3f → %6.3f" % (n, l[0], l[1], w[0], w[1]))
sw_l, sw_w = switches_z(), switches_z(False)
print("  %-18s %6.3f → %6.3f   |  %6.3f → %6.3f" % ("KB_Switches (84)", sw_l[0], sw_l[1], sw_w[0], sw_w[1]))

print("\nASSERTIONS")
fails = []

# (a) no gap at the case join — checked PER WALL.
#     Measuring the whole object hides a short wall behind the tall ones: v4.0
#     passed this check while the front wall stood 4.5 mm open.
def wall_verts(name, axis, sign):
    """Vertices belonging to one wall, in board-local space."""
    ob = bpy.data.objects[name]
    M = INV_TILT @ ob.matrix_world
    band = WALL * 1.6
    lim = (CASE_W / 2 - band) if axis == 'x' else (CASE_D / 2 - band)
    out = []
    for v in ob.data.vertices:
        p = M @ v.co
        c = p.x if axis == 'x' else p.y
        if (c > lim) if sign > 0 else (c < -lim):
            out.append(p.z)
    return out

for label, axis, sign in (("front", 'y', -1), ("back", 'y', +1),
                          ("left", 'x', -1), ("right", 'x', +1)):
    tub = wall_verts("KB_Case_Bottom", axis, sign)
    skirt = wall_verts("KB_Case_Top", axis, sign)
    if not tub or not skirt:
        continue
    tub_top, skirt_bot = max(tub), min(skirt)
    opening = skirt_bot - tub_top
    if opening > 0:
        fails.append("SEAM OPEN on %s wall: skirt %.3f, tub %.3f (%.2f mm slot)"
                     % (label, skirt_bot, tub_top, opening * 10))
    print("  seam %-6s      skirt_bot %.3f vs tub_top %.3f  ->  %s"
          % (label, skirt_bot, tub_top,
             "FAIL %.2f mm open" % (opening * 10) if opening > 0
             else "sealed, %.1f mm lap" % (-opening * 10)))

# the skirt must also sleeve OUTSIDE the tub, or the lip joint is only vertical
tub_x  = max(abs(v) for v in (BOTTOM_OUTER_W / 2, -BOTTOM_OUTER_W / 2))
skirt_x = CASE_W / 2
if skirt_x <= tub_x:
    fails.append("skirt not outboard of tub: skirt %.3f <= tub %.3f" % (skirt_x, tub_x))
print("  skirt outboard   skirt %.3f vs tub %.3f  ->  %s"
      % (skirt_x, tub_x,
         "FAIL" if skirt_x <= tub_x else "%.1f mm proud" % ((skirt_x - tub_x) * 10)))

# (b) internals must clear the cavity — a plate wider than the cavity is what
#     pushed a gold line through the seam in v3
clear_w = (CAVITY_W - PLATE_W) / 2
clear_d = (CAVITY_D - PLATE_D) / 2
if clear_w <= 0 or clear_d <= 0:
    fails.append("plate exceeds cavity: clearance %.2f / %.2f mm" % (clear_w * 10, clear_d * 10))
print("  plate vs cavity  %.3f wide in %.3f  |  %.3f deep in %.3f  ->  %s"
      % (PLATE_W, CAVITY_W, PLATE_D, CAVITY_D,
         "FAIL" if min(clear_w, clear_d) <= 0
         else "%.1f / %.1f mm clearance" % (clear_w * 10, clear_d * 10)))

# key field must sit on the plate, not hang off it
if KEY_FIELD_W > PLATE_W + 1e-9 or KEY_FIELD_D > PLATE_D + 1e-9:
    fails.append("key field %.3f x %.3f overhangs plate %.3f x %.3f"
                 % (KEY_FIELD_W, KEY_FIELD_D, PLATE_W, PLATE_D))
print("  field vs plate   %.3f x %.3f on %.3f x %.3f  ->  %s"
      % (KEY_FIELD_W, KEY_FIELD_D, PLATE_W, PLATE_D,
         "FAIL overhang" if (KEY_FIELD_W > PLATE_W + 1e-9 or KEY_FIELD_D > PLATE_D + 1e-9)
         else "seated"))

# (c) port cluster: exactly three pockets, all clear of every wall edge
print("  port cluster     %d pockets, band %.3f..%.3f, seam %.3f"
      % (len(POCKETS), BAND_LO, BAND_HI, Z_TOP_WALL_BOT))
if len(POCKETS) != 3:
    fails.append("expected 3 pockets, built %d" % len(POCKETS))
for p in POCKETS:
    clr = {
        'wall bottom': p['z0'] - CASE_FLOOR_T,
        'seam':        Z_TOP_WALL_BOT - p['z1'],
        'rear corner': _WALL_Y1 - p['y1'],
        'front':       p['y0'] + _WALL_Y1,
    }
    worst = min(clr.values())
    if worst < POCKET_MARGIN - 1e-6:
        fails.append("pocket %s only %.2f mm from %s (need %.1f)"
                     % (p['name'], worst * 10,
                        min(clr, key=clr.get), POCKET_MARGIN * 10))
    ratio_short = p['len'] / CASE_D
    ratio_long  = p['len'] / CASE_W
    print("     %-4s %4.1f x %4.1f mm  y %6.1f..%6.1f mm  z %5.1f..%5.1f mm"
          % (p['name'], p['len'] * 10, p['ht'] * 10,
             p['y0'] * 10, p['y1'] * 10, p['z0'] * 10, p['z1'] * 10))
    print("          clearance %.1f mm (%s)   w/edge  short %.3f  long %.3f  ->  %s"
          % (worst * 10, min(clr, key=clr.get), ratio_short, ratio_long,
             "FAIL" if worst < POCKET_MARGIN - 1e-6 else "ok"))

# (c2) the left wall's outer face must be ONE flat plane, broken only by the
#      three openings. Any face pointing -X that is not on that plane is a step,
#      a tray, or a slab — exactly what the reference photos say must not exist.
cb = bpy.data.objects["KB_Case_Bottom"]
Mcb = INV_TILT @ cb.matrix_world
Ncb = Mcb.to_3x3().inverted().transposed()


# A correct wall has exactly TWO depth levels: the outer skin at 0, and the
# backing slab at POCKET_DEPTH showing through the three openings. The backing
# is one long face hidden behind the skin, so it cannot be validated by asking
# whether its centre lies in a window — only its depth matters.
off_plane, on_plane, pocket_floors = [], 0, 0
for f in cb.data.polygons:
    n = (Ncb @ f.normal).normalized()
    if n.x > -0.85:                                # not an outward-left face
        continue
    vs = [Mcb @ cb.data.vertices[i].co for i in f.vertices]
    cx = sum(v.x for v in vs) / len(vs)
    # only the LEFT wall band — the right wall's inner face also points -X
    if not (WALL_OUTER_X - 0.05 <= cx <= WALL_OUTER_X + WALL + 0.05):
        continue
    d = abs(cx - WALL_OUTER_X)
    if d < 0.02:
        on_plane += 1
    elif abs(d - POCKET_DEPTH) < 0.06:
        pocket_floors += 1                         # recess backing: expected
    elif d > BEVEL_WIDTH * 2:                      # ignore chamfer slivers
        off_plane.append(round(d * 10, 2))
if off_plane:
    fails.append("left wall has %d face(s) off the outer plane (mm deep: %s)"
                 % (len(off_plane), sorted(set(off_plane))[:6]))
print("  wall flatness    %d on plane, %d pocket floors, %d stray  ->  %s"
      % (on_plane, pocket_floors, len(off_plane),
         "FAIL extra features %s mm" % sorted(set(off_plane))[:4] if off_plane
         else "single flat plane + %d recesses" % pocket_floors))

# (d) feet must sit flush against the tilted underside, and mirror each other
feet = bpy.data.objects.get("KB_Feet")
if feet:
    pts = [feet.matrix_world @ v.co for v in feet.data.vertices]
    zmax = max(p.z for p in pts)
    tops = [p for p in pts if p.z > zmax - 0.30]
    worst = max(abs((TILT @ Vector((p.x, p.y, 0.0))).z - p.z) for p in tops)
    if worst > 0.005:
        fails.append("foot top stands off the case by %.3f mm" % (worst * 10))
    print("  feet flush       max deviation %.4f mm  ->  %s"
          % (worst * 10, "FAIL" if worst > 0.005 else "flush"))

    left  = sorted(round(-p.x, 4) for p in pts if p.x < 0)
    right = sorted(round(p.x, 4) for p in pts if p.x > 0)
    sym = left == right
    if not sym:
        fails.append("feet are not mirror-symmetric about x=0")
    print("  feet symmetry    %d/%d verts each side  ->  %s"
          % (len(left), len(right), "mirrored" if sym else "FAIL asymmetric"))

# (e) nothing on the side-control cluster may cross the wall's outer plane
sc = bpy.data.objects.get("KB_SideControls")
if sc:
    M = INV_TILT @ sc.matrix_world
    min_x = min((M @ v.co).x for v in sc.data.vertices)
    breach = WALL_OUTER_X - min_x
    if breach > 1e-6:
        fails.append("SideControls protrudes %.2f mm past the wall plane" % (breach * 10))
    print("  side controls    min_x %.3f vs wall plane %.3f  ->  %s"
          % (min_x, WALL_OUTER_X,
             "FAIL protrudes %.2f mm" % (breach * 10) if breach > 1e-6
             else "recessed %.1f mm" % (-breach * 10)))

# (b)/(c) rim must sit BETWEEN every row's cap base and cap top
rim = z_range("KB_Case_Top")[1]
for r in range(ROWS):
    lo, hi = z_range("KB_Keycaps_Row%d" % r)
    swallowed = hi < rim
    floating   = lo > rim
    if swallowed:
        fails.append("Row%d SWALLOWED: cap top %.3f < rim %.3f" % (r, hi, rim))
    if floating:
        fails.append("Row%d FLOATING: cap base %.3f > rim %.3f" % (r, lo, rim))
    print("  Row%d  base %.3f  top %.3f  rim %.3f  ->  %s"
          % (r, lo, hi, rim,
             "FAIL swallowed" if swallowed else
             "FAIL floating"  if floating   else
             "%.1f mm of cap shows" % ((hi - rim) * 10)))

print()
if fails:
    print("  *** %d ASSERTION FAILURE(S) ***" % len(fails))
    for f in fails:
        print("      - " + f)
else:
    print("  all assertions passed")

meshes = [ob.data for ob in bpy.data.objects if ob.name.startswith("KB_") and ob.type == 'MESH']
for me in meshes:
    me.calc_loop_triangles()
print("\n  unique meshes %d   drawn triangles %s"
      % (len({m.name for m in meshes}), format(sum(len(m.loop_triangles) for m in meshes), ",")))
print("  case %.1f x %.1f cm   key unit %.3f cm   typing angle %.1f deg"
      % (CASE_W, CASE_D, KEY_UNIT, TYPING_ANGLE_DEG))

# ══════════════════════════════════════════════════════════════════════
os.makedirs(EXPORT_DIR, exist_ok=True)
out = os.path.join(EXPORT_DIR, EXPORT_NAME)
bpy.ops.object.select_all(action='DESELECT')
for ob in bpy.data.objects:
    if ob.name.startswith("KB_"):
        ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True,
                          export_apply=True, export_yup=True, export_cameras=False,
                          export_lights=False, export_animations=False,
                          export_draco_mesh_compression_enable=False)
print("\n  exported -> %s  (%d KB)" % (out, os.path.getsize(out) // 1024))
print("═" * 66 + "\n")
