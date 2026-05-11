# Lottie Gotchas

The bugs that consistently break Lottie output. Check this list before declaring an animation done.

---

## Path / shape gotchas

**Vertex count mismatch in path morph.** Lottie interpolates vertices index-by-index. If keyframe A has 4 vertices and keyframe B has 6, the player produces garbage or crashes. Always pad the simpler shape with collinear vertices to match the more complex one.

**Compound paths cannot be one shape.** SVG `<path>` with multiple `M` commands describes a compound shape. Lottie's `sh` cannot hold disconnected subpaths — split into multiple `sh` shapes inside the same group, then use `r: 2` (evenodd) on the fill to handle cutouts.

**`Z` close command does not add a vertex.** The closing curve is described by setting `c: true` and the final vertex's `out` tangent + first vertex's `in` tangent. Don't add a duplicate of the first vertex at the end.

**SVG transforms on `<g>` get lost.** Either flatten coordinates into the path data before conversion, or convert to a Lottie group transform (`tr`). The `svg_to_lottie_paths.py` converter does NOT handle `<g transform="...">` — apply transforms first.

**Tangents are offsets, not absolute points.** In Lottie path data, `i[k]` and `o[k]` are vectors **relative to** `v[k]`. SVG cubic beziers use absolute control points. The conversion is `i[k] = c2 - p3` and `o[k] = c1 - p0` where `p0, c1, c2, p3` are the cubic bezier's four absolute points. Get the sign wrong → curve flips.

**Y-axis is NOT flipped between SVG and Lottie.** Both use top-left origin, y-down. Common false memory says you need to flip y — you don't.

---

## Keyframe gotchas

**Last keyframe must have NO tangents.** `{"t": frame, "s": [value]}` only — no `i`, no `o`. Adding tangents to the terminal keyframe causes some players to misinterpret duration or crash.

**Keyframe times must be strictly increasing.** No two keyframes on the same property can share a `t` value. If you generate keyframes in a loop and a cycle's end coincides with the next cycle's start, leave a 1-frame gap.

**Frames are integers.** If your timing math gives `0.7s * 60fps = 42`, fine. If it gives `41.6`, round explicitly — non-integer frames break some players.

**Multi-dim values use arrays of tangents.** For 1D properties (opacity, rotation), `s` is `[value]` and `i.x`, `i.y` are 1-element arrays. For 2D/3D (position, scale, color), `s` has multiple elements; `i.x` and `i.y` can stay as 1-element arrays (all dims share the curve) or match the dim count for per-axis curves.

**Cubic bezier easing with `y > 1` IS valid — it produces overshoot.** Don't clamp easing tangent y-values to [0, 1]. AE Bodymovin and svg2lottie exporters routinely use `y: 1.55` or higher to bake "ease-out-back" overshoot into a single 2-keyframe transition. Multi-keyframe overshoot patterns (0→115→92→100) are an alternative, not the only way.

**Rotation in degrees, opacity 0–100, color 0–1.** Easy to mix up. Rotation is **degrees** not radians. Opacity is 0–100 not 0–1. Colors are 0–1 floats not 0–255 ints.

---

## Layer gotchas

**Anchor point is in path-local coords, not world.** To scale a shape from its visual center, set `ks.a` to the shape's bbox center (in path-local space) AND adjust `ks.p` to compensate. Easier path: pre-translate the path data so the visual center sits at `[0, 0]`, then anchor stays at `[0, 0]` and position is just where you want the icon in the comp.

**Layer `ind` must be unique.** Duplicates → undefined behavior in some players.

**Layer `ip`/`op` clip the layer within the comp's `ip`/`op`.** A layer with `ip: 30, op: 60` in a 90-frame comp only renders during frames 30–60. Use this to time entrances/exits.

**Layer order is z-order — index 0 is on TOP.** Reversed from what you'd guess. Background layers come last in the array.

**3D layer flag (`ddd: 1`) breaks compatibility.** Most web Lottie renderers don't support 3D properly. Always use `ddd: 0` unless you specifically need 3D.

---

## Group / shape stack gotchas

**Group `tr` transform must be the LAST item in `it`.** Lottie processes shapes in order; misplaced `tr` produces wrong rendering or no rendering.

**`tm` (trim path) must be after the `sh` (path) but before `st`/`fl` (stroke/fill).** Wrong order → trim has no visual effect or trims wrong shape.

**Multiple fills/strokes stack.** If you put `fl` then `st` then another `fl`, the second fill overwrites the stroke. Order matters; usually `sh → fl → st → tr` is what you want.

---

## Mask gotchas

**Masks affect ALL shapes on the layer.** If a layer has multiple shapes and you only want to mask one, split into separate layers.

**First mask must be `mode: "a"` (add).** Subtract/intersect/difference need an additive mask above them in the array to define the base region.

**Mask path coords are layer-local.** Same coordinate space as the layer's shapes, not the composition.

**Animating mask paths follows path-morph rules.** Vertex count must match across keyframes.

---

## Color gotchas

**Hex `#FF8800` → `[1.0, 0.533, 0.0, 1.0]`.** Normalize each channel by 255. Alpha is the 4th value.

**`fill="none"` in SVG means NO fill shape.** Don't auto-add `fl` if the source had none. Same for `stroke="none"`.

**Gradient encoding is non-obvious.** Linear gradient (`gf`) and radial gradient store color stops as a flat array `[pos, r, g, b, pos, r, g, b, ...]` — not as objects. If you need gradients, look up an existing example to copy the format exactly.

---

## Output / file gotchas

**`.json` IS Lottie. `.lottie` is the dotLottie zip format.** Plain JSON works in lottie-web, dotLottie players, LottieFiles, all the standard tools. Only build `.lottie` (zip with manifest) when explicitly requested.

**File size scales fast.** Each keyframe is JSON overhead. A 10-layer animation with 50 keyframes per layer is already chunky. For long animations (>5s) or high-layer-count (>30) consider video instead.

**Player compatibility hierarchy:**
- **lottie-web** (most common, web): conservative — sticks to shapes, basic transforms, masks, trim paths. Avoid expressions, complex effects, text-on-path.
- **dotLottie / Skottie** (newer web, Android): broader support including some expressions.
- **lottie-react / LottieView (RN)**: matches lottie-web feature set.
- **AE-exported with Bodymovin** (the source of truth): most features work but expressions and effects often need manual cleanup.

When in doubt, target lottie-web's feature set. It's the most widely deployed.

---

## Sanity check before shipping

Run through these manually if your validator doesn't:

1. Open the JSON file — is it valid JSON?
2. `op > ip > 0`?
3. All `ind` values unique?
4. Last keyframe of every animation: only `t` and `s` keys?
5. Every keyframe array sorted by `t` with strictly increasing values?
6. Every group's `it` ends with `tr`?
7. Path arrays `i`, `o`, `v` same length within each shape?
8. Render the converted paths back to SVG/PNG — does it look like the source?
9. Open in lottiefiles.com/preview — does it play?

Steps 8 and 9 catch the things validators miss.
