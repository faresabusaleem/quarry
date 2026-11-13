"""Build Quarry's brand SVGs: the Facet icon (normal, reversed, small), the outlined
wordmark and the icon + wordmark lockups. docs/brand.md describes the rules these follow.

The wordmark is set in Instrument Sans (SIL OFL 1.1) at weight 600 with -0.03em tracking,
shaped with HarfBuzz so the font's kerning applies, and written out as outlines so it
renders the same everywhere without the font installed.

    uv run --with fonttools --with uharfbuzz python scripts/brand/build_brand.py \
        --font path/to/InstrumentSans[wdth,wght].ttf
"""

from __future__ import annotations

import argparse
import io
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

OUT = Path(__file__).resolve().parents[2] / "web" / "public" / "brand"

CHALK = "#F4F4F1"
GRAPHITE = "#16181B"
MINERAL = "#0F7A55"
MINERAL_LIGHT = "#4FC795"

HEX = "60,12 102,36 102,84 60,108 18,84 18,36"
FACET = "60,12 102,36 60,60"
LINES = [(18, 36), (60, 108), (102, 84)]
TRACKING = -0.03
WEIGHT = 600


def icon_group(body: str, facet: str, lines: str | None) -> str:
    parts = [
        f'<polygon points="{HEX}" fill="{body}"/>',
        f'<polygon points="{FACET}" fill="{facet}"/>',
    ]
    if lines:
        d = " ".join(f"M60 60L{x} {y}" for x, y in LINES)
        parts.append(f'<path d="{d}" stroke="{lines}" stroke-width="3" fill="none"/>')
    return "".join(parts)


def svg(view_box: str, body: str, title: str, width: float | None = None) -> str:
    size = f' width="{width:g}"' if width else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view_box}"{size} role="img">'
        f"<title>{title}</title>{body}</svg>\n"
    )


def wordmark(font_path: Path) -> tuple[str, dict[str, float]]:
    """Outlined 'quarry' in font units (y up flipped to SVG y down), plus metrics."""
    vf = TTFont(font_path)
    font = instantiateVariableFont(vf, {"wght": WEIGHT, "wdth": 100})
    buf = io.BytesIO()
    font.save(buf)
    upem = font["head"].unitsPerEm
    cap = font["OS/2"].sCapHeight
    xh = font["OS/2"].sxHeight

    face = hb.Face(buf.getvalue())
    hfont = hb.Font(face)
    hbuf = hb.Buffer()
    hbuf.add_str("quarry")
    hbuf.guess_segment_properties()
    hb.shape(hfont, hbuf, {"kern": True, "liga": False})

    glyph_set = font.getGlyphSet()
    order = font.getGlyphOrder()
    pen = SVGPathPen(glyph_set)
    x = 0.0
    track = TRACKING * upem
    infos, positions = hbuf.glyph_infos, hbuf.glyph_positions
    for i, (info, pos) in enumerate(zip(infos, positions, strict=True)):
        name = order[info.codepoint]
        # Flip y: font units grow upwards, SVG downwards. Baseline at y = 0.
        tp = TransformPen(pen, (1, 0, 0, -1, x + pos.x_offset, -pos.y_offset))
        glyph_set[name].draw(tp)
        x += pos.x_advance + (track if i < len(infos) - 1 else 0)
    # Measure the ink box for tight placement.
    from fontTools.pens.boundsPen import BoundsPen

    bp = BoundsPen(glyph_set)
    x = 0.0
    for i, (info, pos) in enumerate(zip(infos, positions, strict=True)):
        tp = TransformPen(bp, (1, 0, 0, -1, x + pos.x_offset, -pos.y_offset))
        glyph_set[order[info.codepoint]].draw(tp)
        x += pos.x_advance + (track if i < len(infos) - 1 else 0)
    xmin, ymin, xmax, ymax = bp.bounds  # in flipped space: ymin is the top (negative)
    return pen.getCommands(), {
        "upem": upem,
        "cap": cap,
        "xheight": xh,
        "xmin": xmin,
        "xmax": xmax,
        "top": ymin,
        "bottom": ymax,
    }


def lockup(path: str, m: dict[str, float], body: str, facet: str, lines: str, text: str) -> str:
    """Icon left, wordmark right. The visible stone is 1.6 x the cap height, centred on the
    x-height band of the lowercase wordmark, with a gap of 0.35 x the stone height."""
    stone_h = 1.6 * m["cap"]
    scale = stone_h / 96  # the hexagon is 96 units tall inside its 120 box
    stone_w = 84 * scale
    gap = 0.35 * stone_h
    centre_y = -m["xheight"] / 2  # middle of the x-height band, baseline at 0
    # Hexagon spans x 18..102, y 12..108 in icon units; place its box so the ink is tight.
    ix = -18 * scale
    iy = centre_y - 60 * scale
    text_x = stone_w + gap - m["xmin"]
    top = min(iy + 12 * scale, m["top"])
    bottom = max(iy + 108 * scale, m["bottom"])
    width = text_x + m["xmax"]
    pad = 0.0
    vb = f"{-pad:.1f} {top - pad:.1f} {width + 2 * pad:.1f} {bottom - top + 2 * pad:.1f}"
    group = (
        f'<g transform="translate({ix:.2f} {iy:.2f}) scale({scale:.4f})">'
        f"{icon_group(body, facet, lines)}</g>"
        f'<path transform="translate({text_x:.2f} 0)" d="{path}" fill="{text}"/>'
    )
    return svg(vb, group, "Quarry")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--font", type=Path, required=True)
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)

    files = {
        "icon.svg": svg("0 0 120 120", icon_group(GRAPHITE, MINERAL, CHALK), "Quarry"),
        "icon-reversed.svg": svg(
            "0 0 120 120", icon_group(CHALK, MINERAL_LIGHT, GRAPHITE), "Quarry"
        ),
        # 32 px and below: no facet lines, only the stone and its bright facet.
        "icon-small.svg": svg("0 0 120 120", icon_group(GRAPHITE, MINERAL, None), "Quarry"),
        "icon-small-reversed.svg": svg(
            "0 0 120 120", icon_group(CHALK, MINERAL_LIGHT, None), "Quarry"
        ),
        # App icon / favicon: reversed stone on a Graphite square with ~22% corners.
        "app-icon.svg": svg(
            "0 0 120 120",
            f'<rect width="120" height="120" rx="26.4" fill="{GRAPHITE}"/>'
            f'<g transform="translate(60 60) scale(0.72) translate(-60 -60)">'
            f"{icon_group(CHALK, MINERAL_LIGHT, GRAPHITE)}</g>",
            "Quarry",
        ),
        "app-icon-small.svg": svg(
            "0 0 120 120",
            f'<rect width="120" height="120" rx="26.4" fill="{GRAPHITE}"/>'
            f'<g transform="translate(60 60) scale(0.78) translate(-60 -60)">'
            f"{icon_group(CHALK, MINERAL_LIGHT, None)}</g>",
            "Quarry",
        ),
    }
    path, metrics = wordmark(args.font)
    files["wordmark.svg"] = svg(
        f"{metrics['xmin']:.1f} {metrics['top']:.1f} "
        f"{metrics['xmax'] - metrics['xmin']:.1f} {metrics['bottom'] - metrics['top']:.1f}",
        f'<path d="{path}" fill="{GRAPHITE}"/>',
        "quarry",
    )
    files["logo.svg"] = lockup(path, metrics, GRAPHITE, MINERAL, CHALK, GRAPHITE)
    files["logo-reversed.svg"] = lockup(path, metrics, CHALK, MINERAL_LIGHT, GRAPHITE, CHALK)
    for name, text in files.items():
        (OUT / name).write_text(text)
        print(f"wrote web/public/brand/{name} ({len(text):,} bytes)")
    print({k: round(v, 1) for k, v in metrics.items()})


if __name__ == "__main__":
    main()
