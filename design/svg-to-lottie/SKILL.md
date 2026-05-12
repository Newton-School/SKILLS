---
name: svg-to-lottie
description: Convert an SVG into a working Lottie/Bodymovin JSON animation based on a plain-English brief. Use this skill whenever the user gives you an SVG (paste, file, or inline markup) plus any description of how it should move, OR mentions "Lottie", ".lottie", "Bodymovin", "dotLottie", "animate this SVG", "make this SVG move", "convert to Lottie". Trigger this even if the user just says something like "animate this" with an SVG attached. Output is a valid .json file that plays in lottie-web, dotLottie, LottieFiles, or any standard Lottie player.
---

# SVG → Lottie JSON

The user is a designer who already builds Lottie in After Effects or Rive. They want the same output without leaving the chat. Get this right or don't ship it — broken JSON wastes their time.

## The cardinal rule

**Never transcribe SVG path data inline.** SVG `M/L/C/Q/A/Z` commands must be normalized to absolute cubic beziers with tangent offsets relative to each vertex — the math fails in subtle ways when done by hand, and a single wrong sign produces a mangled icon. Always run `scripts/svg_to_lottie_paths.py` to convert paths.

For the same reason, don't write the final Lottie JSON as a giant inline string. **Write a Python builder script** that uses the converter + emits the JSON. This is non-negotiable for any SVG with more than ~6 vertices or any compound path.

## Workflow

### 1. Read the inputs carefully

- Read the SVG: count `<path>` elements, count subpaths per path (each `M` after the first starts a new subpath), note `viewBox`, `fill`, `fill-rule`, `stroke`.
- Read the brief: extract every distinct motion verb. "Pops in with bounce, handle tilts, cone pulses, waves emanate, glow flickers, shakes" = **6 separate animations**, possibly on different parts.

### 2. Structure check (this is where the skill saves the user from a bad output)

Match the brief's parts to the SVG's parts:

- Brief mentions **the icon as a whole** ("pops in", "shakes", "fades") → animate at the layer level. ✓ works on any SVG.
- Brief mentions **specific parts** ("handle tilts while cone pulses") → those parts must exist as **separate `<path>` elements or separate subpaths you can split out**. If the SVG is one compound path with `evenodd` cutouts, sub-parts cannot be animated independently — say so explicitly and offer:
  - Option A: animate the whole icon as one + add complementary layers (waves, glow). This is usually what designers actually want.
  - Option B: ask the user to provide a layered SVG (Figma → Export with named groups).

Don't silently drop parts of the brief. State which parts of the animation are achievable and which need restructuring.

### 3. Plan phases

A typical product micro-interaction has 2–3 phases, not one flat timeline:

- **Entry** (0 → ~24 frames at 60fps): pop-in, fade-in, slide-in. Settles to rest pose.
- **Loop** (entry-end → comp-end): idle pulse, shake, waves, glow flicker. Plays repeatedly.
- **Exit** (optional): only if the user specifies an outro.

Decide framerate (60 default for UI), total duration (1.5–2.5s for loops), and entry duration (~0.4s) before writing keyframes.

### 4. Identify complementary elements

Briefs like "announcement effect", "celebration", "loading", "success" usually need elements that **aren't in the source SVG**:

- **Sound waves / pulses** → 2–4 concentric circle/arc shapes, each: scale 40% → 180%, opacity 70 → 0, staggered.
- **Glow** → soft circle behind the icon, low opacity (~40%), animate opacity for flicker.
- **Sparkles / particles** → small shapes at offset positions, stagger their fade-ins.
- **Backdrop ring** → a static or slowly-rotating ring around the icon.

These can be either separate layers OR additional groups inside one layer. See architecture choice next.

### 4a. Choose architecture: multi-group vs multi-layer

Lottie has two ways to compose multiple animated elements:

**Pattern A — Single layer, multiple groups** (what AE/svg2lottie exporters produce, idiomatic for "elements emerging from a center"):
```
Layer (transform: identity)
├── Group 1 (transform: animated — outermost ring)
├── Group 2 (transform: animated — middle ring)
├── Group 3 (transform: animated — inner ring)
└── Group 4 (transform: animated — main icon)
```
Path data in **absolute comp coordinates**. Each group animates its own scale/position/opacity. Smaller file, fewer layer-level overheads.

**Pattern B — Multi-layer** (each element is its own layer):
```
Comp
├── Layer 1 (icon, animated transform)
├── Layer 2 (ring 1, animated transform)
├── Layer 3 (glow, animated transform)
└── ...
```
Use when layers need: (a) masks, (b) different blend modes, (c) different `ip`/`op` clipping windows, or (d) per-layer effects.

**Default to Pattern A** for icon + rings + glow setups. Switch to Pattern B only when you need the per-layer features above.

### 5. Build via script

In a working directory of your choice (e.g. `./<animation-name>/` relative to the current workspace, or `/home/claude/<animation-name>/` in the claude.ai sandbox):

```
scripts/svg_to_lottie_paths.py    ← copy from this skill, don't rewrite
build.py                            ← your builder script
```

The builder script:
1. Imports `svg_path_to_lottie_shapes` from the converter.
2. Parses the SVG (use `xml.etree.ElementTree`).
3. Computes path bounding box → centers anchor on the icon's visual center.
4. Builds keyframe arrays for each animated property using the patterns in `references/patterns.md`.
5. Assembles the full Lottie dict and dumps to JSON.
6. Runs the validation checklist (see step 6).

A reference template lives at `scripts/build_template.py` — start from it.

### 6. Validate

After dumping the JSON, the builder must verify:

- [ ] `op > ip > 0`
- [ ] All layer `ind` values are unique
- [ ] Every animated property (`"a": 1`) has keyframes sorted by `t` with **strictly increasing** time values (no duplicates)
- [ ] Last keyframe in every animation has **no `i`/`o` tangent fields** — just `{"t":..., "s":...}`
- [ ] Every group's shape `it` array ends with a `tr` transform
- [ ] Path `i`, `o`, `v` arrays have equal length within each shape
- [ ] Colors are normalized to 0–1 floats, not 0–255
- [ ] No `NaN` or `Infinity` values

If any check fails, fix and re-run. Don't ship a broken file.

**Optional but recommended visual check:** render the converted path back to SVG/PNG using the formula in `scripts/svg_to_lottie_paths.py` (vertex + tangent offset → cubic-bezier `C` command). If the rendered path doesn't visually match the source SVG, the conversion is broken.

### 7. Deliver

Save the JSON to a path appropriate for the environment:

- **Claude Code (default):** write to the current working directory as `<descriptive-name>.json` (kebab-case) and tell the user the file path.
- **claude.ai sandbox:** write to `/mnt/user-data/outputs/<descriptive-name>.json` and call `present_files`.

Then in one sentence, say what you built and how to test:

> "1.5s loop @ 60fps: bouncy pop-in entry, then continuous cone pulse, 3 staggered sound waves, glow flicker, and subtle shake. Drop into lottiefiles.com/preview to play."

Don't over-explain. The user already knows Lottie.

## Lottie JSON anatomy (just the essentials)

```json
{
  "v": "5.7.4",
  "fr": 60,
  "ip": 0,
  "op": 90,
  "w": 512, "h": 512,
  "nm": "name",
  "ddd": 0,
  "assets": [],
  "layers": []
}
```

A shape layer (`ty: 4`):

```json
{
  "ddd": 0, "ind": 1, "ty": 4, "nm": "icon", "sr": 1,
  "ks": {
    "o": {"a": 0, "k": 100},
    "r": {"a": 0, "k": 0},
    "p": {"a": 0, "k": [256, 256, 0]},
    "a": {"a": 0, "k": [0, 0, 0]},
    "s": {"a": 0, "k": [100, 100, 100]}
  },
  "ao": 0,
  "shapes": [...],
  "ip": 0, "op": 90, "st": 0, "bm": 0
}
```

Property animation: `{"a": 1, "k": [<keyframes>]}` where each keyframe (except the last) is `{"t": frame, "s": [value], "i": {"x":[..],"y":[..]}, "o": {"x":[..],"y":[..]}}`. The last keyframe is just `{"t": frame, "s": [value]}` — no tangents.

Shape primitives: `gr` (group), `sh` (path), `rc`, `el`, `sr`, `fl` (fill), `st` (stroke), `gf` (gradient fill), `tm` (trim path — used for stroke draw-on), `tr` (transform — must be last in the group's `it` array).

Fill rule on `fl`: `r: 1` = nonzero (default), `r: 2` = evenodd (preserves cutouts in compound paths).

## Easing presets

Tangent values for common curves (use as `i` and `o` on keyframes):

| Curve | Use for | `o` (out) | `i` (in on next kf) |
|---|---|---|---|
| Linear | Mechanical, shake | `{x:[0],y:[0]}` | `{x:[1],y:[1]}` |
| Ease-out | Default for entry | `{x:[0.16],y:[1]}` | `{x:[0.3],y:[1]}` |
| Ease-in | Exit, emphasis | `{x:[0.42],y:[0]}` | `{x:[1],y:[1]}` |
| Ease-in-out | Loops, pulses | `{x:[0.42],y:[0]}` | `{x:[0.58],y:[1]}` |
| **Ease-out-back** (overshoot) | Pop-ins, bouncy entrance | `{x:[0.34],y:[1.55]}` | `{x:[0.65],y:[1]}` |

**Bounce is achievable two ways**, both valid:

1. **Ease-out-back tangent** (preferred for simple overshoot) — single transition with `y:[1.55]` (>1) makes the curve overshoot then settle. Two keyframes total. This is what AE/svg2lottie exporters produce.
2. **Multi-keyframe overshoot** — explicit keyframes at 0% → 115% → 92% → 103% → 100%. Use this when you want fine control over the bounce profile (multiple bounces, asymmetric rebound, etc.).

For a typical pop-in, use ease-out-back. Reach for multi-keyframe only when the design needs custom rhythm.

## Reference files

Always read these before building anything non-trivial:

- **`references/patterns.md`** — keyframe recipes for: bouncy pop-in, shake, sound waves, glow flicker, draw-on stroke, mask reveals, path morph, shape pulse. Concrete frame numbers and value sequences. **Read this before writing any animation.**
- **`references/lottie-gotchas.md`** — the bugs that bite: vertex count mismatches in morphs, anchor point math, keyframe time uniqueness, evenodd cutouts, player compatibility limits.
- **`scripts/svg_to_lottie_paths.py`** — the path converter. **Don't rewrite this.** Copy it next to your builder and import from it.
- **`scripts/build_template.py`** — starting point for a builder script. Adapt the structure rather than starting blank.

## When to push back

The user is a designer who knows the medium. A short honest "Lottie can't do this well" beats a hacky output:

- Heavy raster effects (motion blur, complex blends) → suggest video or rasterized AE export.
- Procedural / generative motion → suggest Rive or canvas/WebGL.
- Per-part animation on a monolithic SVG path → request a layered SVG.
- Animations >5s with >50 layers → suggest video, the file size will hurt.
