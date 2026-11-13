# /// script
# requires-python = ">=3.11"
# dependencies = ["python-pptx==1.0.2"]
# ///
"""Writes src/levels/slides-index.json: for every lecture deck of the course,
the title of each slide, in order.

    uv run tools/gen-slides-index.py [path to the course repo] [--full FILE] [--check]

The course repo (SE-423---Class-Material) is expected next to this one by
default. Slide N of a deck (counting from 1, hidden slides included) is the
section `#sN` of the deck's published HTML page and page N of its PDF.

--full FILE  also writes titles plus the first 200 characters of each slide's
             text to FILE (to help choose a slide for a level; not committed).
--check      downloads every deck's published HTML page and reports slides
             whose title differs from the local deck (the published site may
             be behind or ahead of the checkout).
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import urllib.request
from pathlib import Path

from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE, PP_PLACEHOLDER

DECKS = [
    "L1", "L2", "L3", "L4", "L5", "L6-7", "L8-9", "L10", "L11", "L12", "L13", "L14",
    "L15", "L16", "L17", "L18", "L19", "L20-21", "L22-23", "L24-25",
]  # fmt: skip
SITE = "https://marius-juston.github.io/SE-423---Class-Material/Lectures/Slides"
HERE = Path(__file__).resolve().parent.parent


def squash(text: str) -> str:
    """For comparing titles: the HTML page drops the line breaks inside a title."""
    return re.sub(r"\s+", "", text).casefold()


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("\x0b", " ")).strip()


def walk(shapes):
    """Every shape, including those inside groups (some title placeholders are grouped)."""
    for shape in shapes:
        yield shape
        if shape.shape_type == MSO_SHAPE_TYPE.GROUP:
            yield from walk(shape.shapes)


def is_title(shape) -> bool:
    return shape.is_placeholder and shape.placeholder_format.type in (PP_PLACEHOLDER.TITLE, PP_PLACEHOLDER.CENTER_TITLE)


def read_deck(path: Path) -> list[dict[str, str]]:
    slides = []
    for slide in Presentation(str(path)).slides:
        shapes = list(walk(slide.shapes))
        title_shape = next((s for s in shapes if is_title(s)), None)
        title = clean(title_shape.text_frame.text) if title_shape is not None else ""
        parts = []
        for shape in shapes:
            if shape is title_shape or not shape.has_text_frame:
                continue
            text = clean(shape.text_frame.text)
            if text:
                parts.append(text)
        slides.append({"title": title, "text": " | ".join(parts)[:200]})
    return slides


def published_titles(deck: str) -> list[str]:
    request = urllib.request.Request(f"{SITE}/{deck}.html", headers={"User-Agent": "slides-index"})
    with urllib.request.urlopen(request, timeout=30) as reply:
        page = reply.read().decode("utf-8")
    titles = []
    for n, head in re.findall(r"<section id='s(\d+)'[^>]*>\s*<h2[^>]*>(.*?)</h2>", page, flags=re.DOTALL):
        text = clean(html.unescape(re.sub(r"<[^>]+>", "", head)))
        # The page writes "Slide 12: Title".
        titles.append((int(n), re.sub(r"^(Slide\s+)?\d+\s*[:.]\s*", "", text)))
    return [t for _, t in sorted(titles)]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("course", nargs="?", default=str(HERE.parent / "SE-423---Class-Material"))
    parser.add_argument("--full", help="also write titles and slide text to this file")
    parser.add_argument("--check", action="store_true", help="compare titles with the published HTML pages")
    args = parser.parse_args()

    slides_dir = Path(args.course) / "Lectures" / "Slides"
    if not slides_dir.is_dir():
        print(f"No Lectures/Slides folder in {args.course}", file=sys.stderr)
        return 2

    full = {deck: read_deck(slides_dir / f"{deck}.pptx") for deck in DECKS}
    index = {deck: [s["title"] for s in slides] for deck, slides in full.items()}
    out = HERE / "src" / "levels" / "slides-index.json"
    lines = [f"  {json.dumps(deck)}: {json.dumps(titles, ensure_ascii=False)}" for deck, titles in index.items()]
    out.write_text("{\n" + ",\n".join(lines) + "\n}\n", encoding="utf-8")
    print(f"{out.relative_to(HERE)}: {len(index)} decks, {sum(len(t) for t in index.values())} slides")

    if args.full:
        Path(args.full).write_text(json.dumps(full, ensure_ascii=False, indent=1), encoding="utf-8")

    status = 0
    if args.check:
        for deck, titles in index.items():
            live = published_titles(deck)
            if len(live) != len(titles):
                print(f"{deck}: {len(titles)} slides locally, {len(live)} published")
                status = 1
            differ = [n + 1 for n, (a, b) in enumerate(zip(titles, live)) if squash(a) != squash(b)]
            if differ:
                print(f"{deck}: titles differ on slides {differ[:12]}{' ...' if len(differ) > 12 else ''}")
                status = 1
        print("published pages match" if status == 0 else "published pages differ: see above")
    return status


if __name__ == "__main__":
    sys.exit(main())
