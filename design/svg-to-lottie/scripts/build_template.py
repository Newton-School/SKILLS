"""
build_template.py — starting point for SVG-to-Lottie animation builders.

Uses the IDIOMATIC pattern: single layer with multiple groups, each group
has its own animated transform. Path data lives in absolute comp coordinates
and the "scale-from-comp-center" trick avoids any anchor point math.

This is what AE Bodymovin and svg2lottie exporters produce.

Copy this file next to svg_to_lottie_paths.py, then fill in:
1. SVG path and animation parameters (CONFIG block)
2. Per-group keyframes — see references/patterns.md
3. Any complementary groups (rings, glow) — examples below

Then run:
    python3 build.py
"""

import json
import os
import xml.etree.ElementTree as ET
from svg_to_lottie_paths import svg_path_to_lottie_shapes


# ─── 1. CONFIG ────────────────────────────────────────────────────────────────
SVG_PATH = "/mnt/user-data/uploads/your-icon.svg"
OUT_NAME = "animation-name"  # kebab-case, no extension

FR = 60
TOTAL = 110             # total frames; duration = TOTAL/FR seconds
COMP_W, COMP_H = 500, 500


# ─── 2. EASING PRESETS ────────────────────────────────────────────────────────
EASE_OUT      = {"o": {"x": [0.16], "y": [1]},   "i": {"x": [0.3],  "y": [1]}}
EASE_IN       = {"o": {"x": [0.42], "y": [0]},   "i": {"x": [1],    "y": [1]}}
EASE_IN_OUT   = {"o": {"x": [0.42], "y": [0]},   "i": {"x": [0.58], "y": [1]}}
LINEAR        = {"o": {"x": [0.5],  "y": [0.5]}, "i": {"x": [0.5],  "y": [0.5]}}
EASE_OUT_BACK = {"o": {"x": [0.34], "y": [1.55]}, "i": {"x": [0.65], "y": [1]}}  # bouncy overshoot


def kf(t, s, ease=None):
    out = {"t": t, "s": s}
    if ease:
        out["i"] = ease["i"]
        out["o"] = ease["o"]
    return out


def kf_final(t, s):
    return {"t": t, "s": s}


def hex_to_rgba(hex_str, alpha=1.0):
    h = hex_str.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return [int(h[0:2], 16) / 255, int(h[2:4], 16) / 255,
            int(h[4:6], 16) / 255, alpha]


# ─── 3. PARSE SVG → ABSOLUTE COMP COORDINATES ─────────────────────────────────
tree = ET.parse(SVG_PATH)
root = tree.getroot()
ns = {"svg": "http://www.w3.org/2000/svg"}
vb = list(map(float, root.attrib["viewBox"].split()))
VB_W, VB_H = vb[2], vb[3]

# Scale icon to fit a chosen fraction of the comp
ICON_FILL = 0.5  # icon takes 50% of comp width
SCALE = (COMP_W * ICON_FILL) / VB_W
COMP_CX, COMP_CY = COMP_W / 2, COMP_H / 2
ICON_W, ICON_H = VB_W * SCALE, VB_H * SCALE
OFFSET_X = COMP_CX - ICON_W / 2
OFFSET_Y = COMP_CY - ICON_H / 2


def absolute_path(shape):
    """Transform converted SVG path into absolute comp coordinates."""
    return {
        "i": [[t[0] * SCALE, t[1] * SCALE] for t in shape["i"]],
        "o": [[t[0] * SCALE, t[1] * SCALE] for t in shape["o"]],
        "v": [[v[0] * SCALE + OFFSET_X, v[1] * SCALE + OFFSET_Y] for v in shape["v"]],
        "c": shape["c"],
    }


paths = root.findall("svg:path", ns)
icon_paths = []  # list of (lottie_path_dict, fill_color, fill_rule_str)
for p in paths:
    d = p.attrib["d"]
    fill = p.attrib.get("fill", "#000000")
    fill_rule = p.attrib.get("fill-rule", "nonzero")
    for s in svg_path_to_lottie_shapes(d):
        icon_paths.append((absolute_path(s), fill, fill_rule))


# ─── 4. GROUP TRANSFORM HELPERS ──────────────────────────────────────────────
def reveal_tr(start_frame, end_frame, ease=None):
    """
    Animated group transform — reveals from comp center via scale + position.
    Path data must be in absolute comp coords for this to look like
    "grow from center".

    At start: scale=0, position=COMP_CENTER → all vertices collapse to center.
    At end:   scale=100, position=[0,0]   → vertices at authored positions.
    """
    if ease is None:
        ease = EASE_OUT_BACK
    return {
        "ty": "tr",
        "a": {"a": 0, "k": [0, 0]},
        "p": {"a": 1, "k": [
            kf(start_frame, [COMP_CX, COMP_CY], ease),
            kf_final(end_frame, [0, 0]),
        ]},
        "s": {"a": 1, "k": [
            kf(start_frame, [0, 0], ease),
            kf_final(end_frame, [100, 100]),
        ]},
        "o": {"a": 1, "k": [
            kf(start_frame, [0], ease),
            kf_final(end_frame, [100]),
        ]},
        "r": {"a": 0, "k": 0},
        "sk": {"a": 0, "k": 0},
        "sa": {"a": 0, "k": 0},
    }


# ─── 5. GROUP BUILDERS ────────────────────────────────────────────────────────
def make_icon_group(start, end, ease=None):
    """The main icon group — uses all converted SVG paths."""
    color = hex_to_rgba(icon_paths[0][1]) if icon_paths else [0, 0, 0, 1]
    rule = 2 if any(r == "evenodd" for _, _, r in icon_paths) else 1
    items = [{"ty": "sh", "ks": {"a": 0, "k": p}} for p, _, _ in icon_paths]
    items.append({
        "ty": "fl",
        "c": {"a": 0, "k": color},
        "o": {"a": 0, "k": 100},
        "r": rule,
    })
    items.append(reveal_tr(start, end, ease))
    return {"ty": "gr", "nm": "icon", "it": items}


def make_ring_group(start, end, radius, stroke_width=8, color_hex="#0673F9", ease=None):
    """Concentric ring (ellipse stroke) at comp center."""
    items = [
        {
            "ty": "el",
            "p": {"a": 0, "k": [COMP_CX, COMP_CY]},
            "s": {"a": 0, "k": [radius * 2, radius * 2]},
        },
        {
            "ty": "st",
            "c": {"a": 0, "k": hex_to_rgba(color_hex)},
            "o": {"a": 0, "k": 100},
            "w": {"a": 0, "k": stroke_width},
            "lc": 2,
            "lj": 2,
        },
        reveal_tr(start, end, ease),
    ]
    return {"ty": "gr", "nm": f"ring_r{radius}", "it": items}


# ─── 6. ASSEMBLE GROUPS ───────────────────────────────────────────────────────
# Order in the array = z-order back-to-front.
# Stagger from the reference file: 3-frame intervals between starts,
# durations grow by 12 frames as elements get larger.
groups = [
    make_ring_group(start=9, end=60, radius=170, stroke_width=10),  # back
    make_ring_group(start=6, end=45, radius=130, stroke_width=10),
    make_ring_group(start=3, end=30, radius=90,  stroke_width=10),
    make_icon_group(start=0, end=15),                                # front
]


# ─── 7. ASSEMBLE LAYER + COMP ─────────────────────────────────────────────────
layer = {
    "ddd": 0, "ind": 1, "ty": 4, "nm": "main", "sr": 1,
    "ks": {  # layer transform stays IDENTITY
        "o": {"a": 0, "k": 100},
        "r": {"a": 0, "k": 0},
        "p": {"a": 0, "k": [0, 0, 0]},
        "a": {"a": 0, "k": [0, 0, 0]},
        "s": {"a": 0, "k": [100, 100, 100]},
    },
    "ao": 0,
    "shapes": groups,
    "ip": 0, "op": TOTAL, "st": 0, "bm": 0,
}

lottie = {
    "v": "5.7.4",
    "fr": FR,
    "ip": 0,
    "op": TOTAL,
    "w": COMP_W,
    "h": COMP_H,
    "nm": OUT_NAME,
    "ddd": 0,
    "assets": [],
    "layers": [layer],
}


# ─── 8. VALIDATE ──────────────────────────────────────────────────────────────
def validate(lottie_dict):
    issues = []
    if not (lottie_dict["op"] > lottie_dict["ip"] >= 0):
        issues.append("op must be > ip >= 0")

    inds = [l["ind"] for l in lottie_dict["layers"]]
    if len(set(inds)) != len(inds):
        issues.append(f"duplicate layer ind: {inds}")

    def check_kfs(name, prop_name, prop):
        if prop["a"] != 1:
            return
        kfs = prop["k"]
        if "i" in kfs[-1] or "o" in kfs[-1]:
            issues.append(f"{name}.{prop_name}: last kf has tangents")
        for i in range(len(kfs) - 1):
            if kfs[i]["t"] >= kfs[i + 1]["t"]:
                issues.append(
                    f"{name}.{prop_name}: t not strictly increasing at "
                    f"idx {i} ({kfs[i]['t']} >= {kfs[i+1]['t']})"
                )

    for layer in lottie_dict["layers"]:
        nm = layer["nm"]
        for prop_name, prop in layer["ks"].items():
            check_kfs(f"layer:{nm}", prop_name, prop)
        for shape_group in layer.get("shapes", []):
            if shape_group.get("ty") != "gr":
                continue
            gname = shape_group.get("nm", "?")
            for item in shape_group["it"]:
                if item.get("ty") == "tr":
                    for pn in ["o", "r", "p", "a", "s"]:
                        if pn in item:
                            check_kfs(f"group:{gname}", pn, item[pn])
                elif item.get("ty") == "sh" and item["ks"]["a"] == 0:
                    pd = item["ks"]["k"]
                    if not (len(pd["i"]) == len(pd["o"]) == len(pd["v"])):
                        issues.append(f"group:{gname}: path i/o/v mismatch")
    return issues


issues = validate(lottie)
if issues:
    print("⚠ Validation issues:")
    for i in issues:
        print(f"  ✗ {i}")
    raise SystemExit(1)


# ─── 9. WRITE ─────────────────────────────────────────────────────────────────
out_path = f"/mnt/user-data/outputs/{OUT_NAME}.json"
os.makedirs(os.path.dirname(out_path), exist_ok=True)
with open(out_path, "w") as f:
    json.dump(lottie, f)

size = os.path.getsize(out_path)
print(f"✓ {out_path}")
print(f"  {len(lottie['layers'])} layer(s), "
      f"{sum(len(l['shapes']) for l in lottie['layers'])} groups, "
      f"{lottie['op'] / lottie['fr']:.2f}s @ {lottie['fr']}fps, "
      f"{size:,} bytes")
