"""
svg_to_lottie_paths.py — convert SVG path data to Lottie cubic-bezier format.

This is the missing piece. SVG path commands (M/L/C/Q/A/Z + relative variants)
must be normalized to absolute cubic beziers, then expressed as Lottie's
{i, o, v, c} structure where i and o are tangent OFFSETS relative to v.

Usage:
    from svg_to_lottie_paths import svg_path_to_lottie_shapes
    shapes = svg_path_to_lottie_shapes("M10 10 C ...")
    # returns a list of dicts, one per subpath (compound paths split)
"""

import math

from svgpathtools import parse_path, Line, CubicBezier, QuadraticBezier, Arc


def _to_cubic(seg):
    """Convert any SVG segment to a CubicBezier (control1, control2, end)."""
    if isinstance(seg, CubicBezier):
        return (seg.start, seg.control1, seg.control2, seg.end)
    if isinstance(seg, Line):
        # Line as cubic: control points coincide with endpoints (zero tangents).
        return (seg.start, seg.start, seg.end, seg.end)
    if isinstance(seg, QuadraticBezier):
        # Quadratic to cubic: c1 = start + 2/3 (q - start), c2 = end + 2/3 (q - end)
        c1 = seg.start + (2 / 3) * (seg.control - seg.start)
        c2 = seg.end + (2 / 3) * (seg.control - seg.end)
        return (seg.start, c1, c2, seg.end)
    if isinstance(seg, Arc):
        # Approximate arc by sampling — splits arc into multiple cubics.
        # We'll handle this caller-side.
        raise NotImplementedError("Arc — handle via subdivision in caller")
    raise ValueError(f"Unknown segment type: {type(seg)}")


def _arc_to_cubics(arc, max_angle_deg=90):
    """Approximate an SVG arc as a series of cubic beziers, ≤90° each.

    Handles elliptical arcs correctly (rx ≠ ry) by sampling the parametric
    tangent (-rx·sinθ, ry·cosθ) at each sub-arc endpoint — the per-axis
    radii are encoded in the tangent vector, so scaling by the unitless
    α = (4/3)·tan(Δ/4) factor yields the correct cubic control offsets.
    Also honors arc.rotation.
    """
    rx, ry = arc.radius.real, arc.radius.imag
    rot = math.radians(arc.rotation)
    cos_rot, sin_rot = math.cos(rot), math.sin(rot)
    cx, cy = arc.center.real, arc.center.imag

    n = max(1, int(math.ceil(abs(arc.delta) / max_angle_deg)))
    sub_delta_deg = arc.delta / n
    sub_delta_rad = math.radians(sub_delta_deg)
    alpha = (4 / 3) * math.tan(sub_delta_rad / 4)

    def ellipse_point(theta_rad):
        x = rx * math.cos(theta_rad)
        y = ry * math.sin(theta_rad)
        return complex(cx + x * cos_rot - y * sin_rot,
                       cy + x * sin_rot + y * cos_rot)

    def ellipse_tangent(theta_rad):
        # d/dθ (rx cosθ, ry sinθ) = (-rx sinθ, ry cosθ)
        tx = -rx * math.sin(theta_rad)
        ty = ry * math.cos(theta_rad)
        return complex(tx * cos_rot - ty * sin_rot,
                       tx * sin_rot + ty * cos_rot)

    cubics = []
    for k in range(n):
        theta1 = math.radians(arc.theta + k * sub_delta_deg)
        theta2 = math.radians(arc.theta + (k + 1) * sub_delta_deg)
        p0 = ellipse_point(theta1)
        p3 = ellipse_point(theta2)
        c1 = p0 + alpha * ellipse_tangent(theta1)
        c2 = p3 - alpha * ellipse_tangent(theta2)
        cubics.append((p0, c1, c2, p3))
    return cubics


def _split_into_subpaths(path):
    """Split a Path into continuous subpaths. Returns list of (segments, closed_bool).

    Uses svgpathtools' canonical Path.continuous_subpaths() for robust
    splitting (handles edge cases like a moveto that lands on the previous
    endpoint, which a simple endpoint-distance heuristic gets wrong).
    """
    result = []
    for sub in path.continuous_subpaths():
        segments = list(sub)
        if not segments:
            continue
        closed = abs(segments[-1].end - segments[0].start) < 1e-3
        result.append((segments, closed))
    return result


def svg_path_to_lottie_shapes(d_attr):
    """
    Convert an SVG path's `d` attribute to a list of Lottie path shape dicts.

    Returns a list because compound paths split into multiple shapes
    (Lottie cannot represent disconnected subpaths in one shape).

    Each returned dict is the `ks.k` value for a Lottie `sh` shape:
        {"i": [[x,y], ...], "o": [[x,y], ...], "v": [[x,y], ...], "c": bool}
    """
    path = parse_path(d_attr)
    subpaths = _split_into_subpaths(path)

    shapes = []
    for segments, closed in subpaths:
        # Convert all segments to cubic bezier tuples (start, c1, c2, end)
        cubics = []
        for seg in segments:
            if isinstance(seg, Arc):
                cubics.extend(_arc_to_cubics(seg))
            else:
                cubics.append(_to_cubic(seg))

        if not cubics:
            continue

        # Build vertex list from endpoints. Adjacent cubics share endpoints,
        # so we keep one vertex per join.
        vertices = [cubics[0][0]]
        out_tangents = []
        in_tangents = []

        for i, (p0, c1, c2, p3) in enumerate(cubics):
            # Out tangent leaving the current vertex (control point relative to vertex)
            out_tangents.append(c1 - p0)
            # In tangent arriving at the next vertex
            in_tangents.append(c2 - p3)
            # Add the next vertex (skipped on last iteration if path is closed and
            # final point equals first — Lottie expects closed paths to NOT
            # repeat the first vertex)
            is_last = i == len(cubics) - 1
            if is_last and closed and abs(p3 - vertices[0]) < 1e-3:
                # Don't append duplicate; the closing tangent is already captured
                # but we need to fix up the in_tangent of the FIRST vertex.
                pass
            else:
                vertices.append(p3)

        # If closed, in_tangents/out_tangents must align with vertices count.
        # Lottie convention: for N vertices, we have N in-tangents and N out-tangents.
        # The first vertex's in-tangent comes from the LAST segment (closing).
        # The last vertex's out-tangent goes to... nothing if open, or to first vertex if closed.
        if closed:
            # Rotate: first vertex's in-tangent is the in_tangent of the last cubic
            # that closes back to it.
            first_in = in_tangents.pop()  # was for vertex[0] (closing)
            in_tangents.insert(0, first_in)
            # out_tangents already correct: out_tangents[i] is from vertices[i]
        else:
            # Open path: pad with zero tangents at the ends
            in_tangents.insert(0, complex(0, 0))
            out_tangents.append(complex(0, 0))

        # Fail loud on length mismatch — silent truncation hides real bugs
        # in the converter that would otherwise surface as subtly broken icons.
        assert len(vertices) == len(in_tangents) == len(out_tangents), (
            f"vertex/tangent length mismatch: "
            f"v={len(vertices)} i={len(in_tangents)} o={len(out_tangents)}"
        )

        shape = {
            "i": [[t.real, t.imag] for t in in_tangents],
            "o": [[t.real, t.imag] for t in out_tangents],
            "v": [[v.real, v.imag] for v in vertices],
            "c": closed,
        }
        shapes.append(shape)

    return shapes


if __name__ == "__main__":
    # Quick self-test
    d = "M10 10 C 20 10, 30 20, 30 30 L 30 50 L 10 50 Z"
    shapes = svg_path_to_lottie_shapes(d)
    import json
    print(json.dumps(shapes, indent=2))
    print(f"\n{len(shapes)} subpath(s)")
    for i, s in enumerate(shapes):
        print(f"  Subpath {i}: {len(s['v'])} vertices, closed={s['c']}")
