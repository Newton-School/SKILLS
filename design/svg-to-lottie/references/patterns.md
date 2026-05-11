# Animation Patterns

Concrete keyframe recipes. All frame numbers assume **60fps**. Scale durations proportionally for other framerates.

These are the recipes that the SKILL.md workflow's "step 4 / step 5" rely on. Copy the values, adjust to taste.

---

## 1. Bouncy pop-in (entry)

Two ways to achieve overshoot. Pick based on whether you need fine control.

### Method A — Ease-out-back tangent (preferred for simple overshoot)

A cubic-bezier easing where the y-value exceeds 1 produces overshoot. Two keyframes total.

```python
EASE_OUT_BACK = {"o": {"x": [0.34], "y": [1.55]}, "i": {"x": [0.65], "y": [1]}}

scale_kfs = [
    kf(0,  [0, 0, 100],     EASE_OUT_BACK),
    kf_final(15, [100, 100, 100]),
]
```

The y=1.55 makes the curve push past 1.0 (overshoot) before settling at 1.0. This is `cubic-bezier(0.34, 1.55, 0.65, 1)` — exactly the curve that AE Bodymovin and svg2lottie exporters produce.

Tune the overshoot amount with the y value: `1.3` = subtle, `1.55` = standard, `1.8` = bouncy, `2.0+` = exaggerated.

### Method B — Multi-keyframe overshoot (fine control)

Use when you need: multiple bounces, asymmetric rebound, custom rhythm.

| Frame | Scale | Easing out |
|---|---|---|
| 0 | `[0, 0, 100]` | ease-out |
| 12 | `[115, 115, 100]` | ease-in-out |
| 18 | `[92, 92, 100]` | ease-in-out |
| 22 | `[103, 103, 100]` | ease-in-out |
| 24 | `[100, 100, 100]` | (last — no tangents) |

Total entry: 24 frames (0.4s). For softer pop, dampen overshoot to 110/95/102. For harder pop, push to 125/85/105.

---

## 2. Shake (subtle liveliness)

**Property:** `ks.p` (position).

Tiny jitter around the rest position. Use **linear easing** between keyframes — eased shakes feel mushy.

```python
SHAKE_AMP = 1.5  # pixels — keep small
base = [cx, cy, 0]
shake_kfs = [
    kf(t,    [cx,            cy,            0], LINEAR),
    kf(t+4,  [cx+SHAKE_AMP,  cy-SHAKE_AMP,  0], LINEAR),
    kf(t+8,  [cx-SHAKE_AMP,  cy+SHAKE_AMP,  0], LINEAR),
    kf(t+12, [cx+SHAKE_AMP,  cy+SHAKE_AMP,  0], LINEAR),
    kf(t+18, [cx,            cy,            0], LINEAR),
]
```

For continuous shake during a loop, repeat the pattern. For a one-shot shake at a moment of impact, use 4–6 keyframes total.

---

## 3. Sound waves / radial pulses

**Setup:** Add 2–4 ring layers behind the icon. Each ring is a circle (`el`) with a stroke (`st`), no fill.

**Per-ring animation:** scale up + opacity down, looped, **staggered** between rings.

```python
LOOP_PERIOD = 30  # frames per wave cycle
SNAP_GAP = 1      # 1-frame gap between cycles so keyframes don't overlap

# For ring index i with stagger delay [0, 8, 16] frames:
delay = [0, 8, 16][i]
scale_kfs = [kf(0, [40, 40, 100], LINEAR)]  # invisible pre-entry
op_kfs    = [kf(0, [0],            LINEAR)]

cycle = 0
while True:
    t0 = ENTRY_END + delay + cycle * LOOP_PERIOD
    t1 = t0 + LOOP_PERIOD - SNAP_GAP
    if t0 >= TOTAL: break
    scale_kfs.append(kf(t0, [40, 40, 100], EASE_OUT))
    op_kfs.append(   kf(t0, [70],          EASE_IN_OUT))
    if t1 < TOTAL:
        scale_kfs.append(kf(t1, [180, 180, 100], EASE_OUT))
        op_kfs.append(   kf(t1, [0],             EASE_IN_OUT))
    cycle += 1
```

**Critical:** the next cycle's start (`t0`) must be after the previous cycle's end (`t1`). Use `SNAP_GAP = 1` to ensure no two keyframes share the same `t` — that breaks players.

**Position:** rings emanate from a specific point (e.g., the cone of a megaphone, the bell of a notification). Offset the ring layer's `ks.p` from the icon center.

---

## 4. Glow flicker

**Setup:** A soft circle layer behind the icon. Larger than the icon, semi-transparent.

```python
glow_shape = {
    "ty": "el",
    "p": {"a": 0, "k": [0, 0]},
    "s": {"a": 0, "k": [220, 220]},  # bigger than icon
}
glow_fill = {
    "ty": "fl",
    "c": {"a": 0, "k": [0.4, 0.65, 1.0, 1.0]},
    "o": {"a": 0, "k": 40},  # base translucency
}
```

**Animation:** opacity bobs around a base value, with a quick spike for "flicker".

| Frame | Opacity | Easing |
|---|---|---|
| 0 | 0 | ease-out |
| 24 | 50 | ease-in-out |
| 40 | 70 | ease-in-out |
| 50 | 40 | ease-in-out |
| 53 | 85 | ease-in-out (the flicker spike) |
| 56 | 50 | ease-in-out |
| 70 | 60 | ease-in-out |
| 90 | 50 | (last) |

The "flicker" is the quick 50→85→50 in 6 frames (~100ms). Keep flickers fast or they look like fades.

---

## 5. Draw-on stroke (path reveal)

**Property:** `tm` (trim path) inside the same group as the path.

```json
{
  "ty": "gr",
  "it": [
    { "ty": "sh", "ks": {...path data...} },
    { "ty": "tm",
      "s": {"a": 0, "k": 0},
      "e": {"a": 1, "k": [
        {"t": 0, "s": [0],   "i":{"x":[0.25],"y":[1]}, "o":{"x":[0.5],"y":[0]}},
        {"t": 30, "s": [100]}
      ]},
      "o": {"a": 0, "k": 0},
      "m": 1
    },
    { "ty": "st", "c": {"a": 0, "k": [...]}, "o": {"a": 0, "k": 100}, "w": {"a": 0, "k": 4}, "lc": 2, "lj": 2 },
    { "ty": "tr", ... }
  ]
}
```

`s` = start %, `e` = end %, `o` = offset, `m` = mode (1 = simultaneously). For "erase" effect, animate `s` from 0→100 instead.

**Critical:** `tm` must be inside the group **after** the `sh` and **before** the `st`/`fl`. Wrong order produces no trim or weird visuals.

---

## 6. Mask reveals

A mask lives on the layer (not inside `shapes`):

```json
"masksProperties": [
  {
    "inv": false,
    "mode": "a",
    "pt": {"a": 1, "k": [<path keyframes>]},
    "o": {"a": 0, "k": 100},
    "x": {"a": 0, "k": 0}
  }
]
```

### Wipe reveal (left-to-right rectangle)

Mask is a rectangle that grows. Animate the path's right-side vertices from `x=0` to `x=full_width`.

### Iris reveal (circle expanding from center)

Mask is a 4-vertex circle approximation. Use kappa = `0.5522847498` for the unit-circle bezier handles.

```python
def circle_path(radius):
    k = 0.5522847498 * radius
    return {
        "v": [[radius, 0], [0, radius], [-radius, 0], [0, -radius]],
        "i": [[0, -k], [k, 0], [0, k], [-k, 0]],
        "o": [[0, k], [-k, 0], [0, -k], [k, 0]],
        "c": True
    }

# Animate radius from 0 → max via two path keyframes (vertex counts must match)
```

**Critical for path animation:** keyframe A and keyframe B must have **identical vertex counts**. If you're morphing from a 4-vertex circle to a 12-vertex star, pad the circle to 12 vertices first.

---

## 7. Shape pulse (subtle scale loop)

For things like a "breathing" effect on a button or a cone pulsing:

| Frame | Scale | Easing |
|---|---|---|
| 0 | `[100, 100, 100]` | ease-in-out |
| 30 | `[105, 105, 100]` | ease-in-out |
| 60 | `[100, 100, 100]` | (last, if loop is 60f) |

A 5% pulse over ~1s reads as "alive" without being distracting. 10%+ starts to feel aggressive.

---

## 8. Path morph (shape A → shape B)

**Property:** `sh.ks` — animate the path keyframes themselves.

```json
{
  "ty": "sh",
  "ks": {
    "a": 1,
    "k": [
      {"t": 0,  "s": [<shape A path>], "i":{...}, "o":{...}},
      {"t": 30, "s": [<shape B path>]}
    ]
  }
}
```

**The two shapes must have the same vertex count.** If shape A has 8 vertices and shape B has 12, the player will produce garbage or crash. Solutions:
- Re-author shape A in your design tool with extra (collinear) vertices.
- Add redundant vertices programmatically by interpolating along the existing path.

---

## Choreography

For multi-element entries:

- **Stagger by 4–8 frames.** Don't fire everything at frame 0 — robotic.
- **Lead with the largest element**, follow with smaller ones.
- **Outros reverse the entry order**: smaller elements exit first.
- **Keep total entry under ~500ms.** Longer feels sluggish.

For loops:

- **Loop length 60–120 frames (1–2s).** Shorter feels frantic, longer feels slow.
- **Stagger multiple loops** (e.g., 3 sound waves) so the rhythm has texture instead of pulse-pulse-pulse.
- **Loop should restart cleanly** — first and last keyframe values should match (or the loop should cycle through complete cycles within the comp).

---

## 9. Scale-from-comp-center (no anchor math)

When path data is in absolute comp coordinates and the icon sits roughly at comp center, you can produce a clean "grow from center" effect by animating **scale and position together** — without any anchor point math.

**The trick:**

```python
COMP_CENTER = [comp_w / 2, comp_h / 2]  # e.g., [250, 250]

# In a group transform:
"s": {"a": 1, "k": [
    kf(0,  [0, 0],     EASE_OUT_BACK),
    kf_final(15, [100, 100]),
]},
"p": {"a": 1, "k": [
    kf(0,  COMP_CENTER, EASE_OUT_BACK),
    kf_final(15, [0, 0]),
]},
"o": {"a": 1, "k": [
    kf(0,  [0],   EASE_OUT_BACK),
    kf_final(15, [100]),
]}
```

**Why it works:** with anchor at `[0,0]`, a vertex at `(vx, vy)` renders at `(vx*s + px, vy*s + py)`. At s=0/p=COMP_CENTER, every vertex collapses to comp center. At s=100/p=[0,0], vertices render at their authored positions. The interpolation between these two states IS a "grow from center" animation.

**When to use it:** path data in absolute comp coords, icon centered on comp. Common after running `svg_to_lottie_paths.py` on an SVG that's been scaled to the comp size.

**When NOT to use it:** if the icon is intentionally off-center, the scale will appear to come from the wrong point. In that case, set anchor to the icon's bbox center instead.

---

## 10. Staggered group reveal (single-layer, multi-group entrance)

The idiomatic pattern for "elements emerging in sequence from a center" — what AE Bodymovin and svg2lottie exporters produce.

**Setup:** one shape layer with multiple groups inside it. Each group is one element (icon body, ring 1, ring 2, ring 3). Each group has its own animated `tr` using the scale-from-comp-center trick (#9 above).

**Stagger pattern from a working reference:** innermost element starts first, outermost starts last; bigger elements take **longer** to expand.

| Element | Start frame | End frame | Duration |
|---|---|---|---|
| Inner (icon body) | 0 | 15 | 15f |
| Ring 1 (smallest) | 3 | 30 | 27f |
| Ring 2 | 6 | 45 | 39f |
| Ring 3 (largest) | 9 | 60 | 51f |

3-frame stagger between starts. Each subsequent element takes +12 frames longer. The rhythm reads as a "ripple" rather than synchronized pulse.

**Layer architecture:**
```python
layer = {
    "ty": 4,
    "ks": {  # layer transform stays IDENTITY
        "o": {"a": 0, "k": 100},
        "p": {"a": 0, "k": [0, 0]},
        "a": {"a": 0, "k": [0, 0]},
        "s": {"a": 0, "k": [100, 100]},
        "r": {"a": 0, "k": 0},
    },
    "shapes": [
        make_group("ring_3",  start=9, end=60, paths=[ring_3_path]),
        make_group("ring_2",  start=6, end=45, paths=[ring_2_path]),
        make_group("ring_1",  start=3, end=30, paths=[ring_1_path]),
        make_group("icon",    start=0, end=15, paths=[icon_outer, icon_cutout]),
    ],
    "ip": 0, "op": 110, "st": 0, "bm": 0, "ind": 1,
}
```

**Layer order in the `shapes` array is z-order — first item drawn FIRST (behind).** So put the outermost ring first, icon last. (This is the opposite of layer-level `ind` ordering.)

---

## 11. Compound path cutouts via winding direction

When a single shape has cutouts (like a megaphone body with an inner hole), there are two ways to handle it:

**Method A — Multiple `sh` shapes in one group, fill rule = nonzero (`r: 1`):** The cutout works because the inner subpath is wound in the *opposite* direction from the outer subpath. SVG's `fill-rule="nonzero"` cancels overlapping regions of opposite winding.

```json
{
  "ty": "gr",
  "it": [
    {"ty": "sh", "ks": {...outer path, clockwise...}},
    {"ty": "sh", "ks": {...inner path, counter-clockwise...}},
    {"ty": "fl", "c": {...}, "r": 1, ...},
    {"ty": "tr", ...}
  ]
}
```

This is what AE/svg2lottie exporters produce. The path converter should preserve original winding direction from the SVG.

**Method B — Multiple `sh` shapes, fill rule = evenodd (`r: 2`):** Works regardless of winding direction. SVG's `fill-rule="evenodd"` toggles fill state on every path crossing.

If the source SVG had `fill-rule="evenodd"`, use `r: 2`. Otherwise, use `r: 1` and rely on winding direction. The `svg_to_lottie_paths.py` converter preserves vertex order from the SVG, so this works automatically as long as you set the fill rule to match the source.
