#!/usr/bin/env python3
"""
LUMIS adaptive card renderer.

There are no fixed templates. Each content item declares which parts it has,
and the layout is computed from that - so a 1-line quote, a 6-line story and a
glyph+footer teaching card all come out balanced without separate templates.

Optional parts per item: glyph, ring, title, body (any number of lines),
footer pairs, note, swatch colour.
"""
import math, random, glob, pathlib
from PIL import Image, ImageDraw, ImageFont

Wf, Hf, SS = 1080, 1350, 2
W, H = Wf * SS, Hf * SS
GOLD = (201, 168, 76)
STARW = (232, 224, 205)
BLACK = (0, 0, 10)

MARGIN_TOP = 300 * SS      # below the LUMIS wordmark
MARGIN_BOT = 1180 * SS     # above the url
SAFE_W = 900 * SS          # text must fit inside this


def _find(pats, fallback=None):
    for p in pats:
        hits = sorted(glob.glob(p, recursive=True))
        if hits:
            return hits[0]
    return fallback


CJK = _find(["/usr/share/fonts/**/NotoSerifCJK-Light.ttc",
             "/usr/share/fonts/**/NotoSerifCJK-Regular.ttc",
             "/usr/share/fonts/**/NotoSerifCJK*.ttc",
             "/usr/share/fonts/**/NotoSansCJK*.ttc"])
SERIF_B = _find(["/usr/share/fonts/**/LiberationSerif-Bold.ttf",
                 "/usr/share/fonts/**/DejaVuSerif-Bold.ttf"])
SERIF_I = _find(["/usr/share/fonts/**/LiberationSerif-Italic.ttf",
                 "/usr/share/fonts/**/LiberationSerif-Regular.ttf"])
# only these carry real zodiac / planet glyphs
SYM = _find(["/usr/share/fonts/**/FreeSerif.ttf",
             "/usr/share/fonts/**/DejaVuSans.ttf"])


def _tc(path):
    for i in range(10):
        try:
            if "TC" in ImageFont.truetype(path, 20, index=i).getname()[0]:
                return i
        except Exception:
            break
    return 0


TC = _tc(CJK)
# No colour swatches: the card stays strictly gold-on-black. Colours are named in text.


class Card:
    def __init__(self, seed=0):
        self.img = Image.new("RGBA", (W, H), BLACK + (255,))
        self.d = ImageDraw.Draw(self.img)
        self.seed = seed
        self.occupied = []

    # ---------- primitives ----------
    def text(self, s, font_path, size, cy, track=4, alpha=245, idx=0, cx=None, color=GOLD):
        f = ImageFont.truetype(font_path, int(size * SS), index=idx)
        ws = [f.getbbox(c)[2] - f.getbbox(c)[0] for c in s]
        total = sum(ws) + track * SS * (len(s) - 1)
        x = (cx if cx is not None else W / 2) - total / 2
        for c, w in zip(s, ws):
            bb = f.getbbox(c)
            self.d.text((x - bb[0], cy - (bb[3] + bb[1]) / 2), c, font=f, fill=color + (alpha,))
            x += w + track * SS
        return total

    def measure(self, s, font_path, size, track=4, idx=0):
        f = ImageFont.truetype(font_path, int(size * SS), index=idx)
        ws = [f.getbbox(c)[2] - f.getbbox(c)[0] for c in s]
        return sum(ws) + track * SS * (len(s) - 1)

    def rule(self, cy, half=70, alpha=110):
        self.d.rectangle([W / 2 - half * SS, cy, W / 2 + half * SS, cy + 2], fill=GOLD + (alpha,))

    def sparkle(self, cx, cy, o, inr, alpha=210):
        pts = []
        for k in range(8):
            an = math.radians(k * 45)
            r = o if k % 2 == 0 else inr
            pts.append((cx + r * math.sin(an), cy - r * math.cos(an)))
        self.d.polygon(pts, fill=GOLD + (alpha,))

    def crescent(self, cx, cy, R, frac=0.45):
        self.d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=GOLD + (255,))
        off = (1 - frac) * 1.9 * R
        self.d.ellipse([cx - R + off, cy - R, cx + R + off, cy + R], fill=BLACK + (255,))

    def stars(self, n=14):
        random.seed(self.seed)
        placed = 0
        tries = 0
        while placed < n and tries < 400:
            tries += 1
            x = random.randint(70 * SS, 1010 * SS)
            y = random.randint(110 * SS, 1290 * SS)
            if any(a - 30 * SS < y < b + 30 * SS for a, b in self.occupied):
                continue
            r = random.choice([1.6, 2.2, 2.8]) * SS
            col = GOLD if random.random() < 0.7 else STARW
            self.d.ellipse([x - r, y - r, x + r, y + r], fill=col + (random.randint(45, 118),))
            placed += 1

    def save(self, path):
        img = self.img.resize((Wf, Hf), Image.LANCZOS)
        out = Image.new("RGB", (Wf, Hf), BLACK)
        out.paste(img, (0, 0), img)
        out.save(path, "PNG")
        return path


def fit_size(card, lines, base, track, min_size=30):
    """Shrink body text until the longest line fits the safe width."""
    size = base
    while size > min_size:
        if max(card.measure(l, CJK, size, track, TC) for l in lines) <= SAFE_W:
            return size
        size -= 2
    return min_size


def render(item, path, seed=None):
    """item: dict with optional keys glyph, ring, title, body[], footer[], note, swatch, moon"""
    body = item.get("body", [])
    card = Card(seed if seed is not None else abs(hash(tuple(body))) % 99999)

    # ---- decide sizes from the content itself ----
    n = len(body)
    base = 52 if n <= 2 else 48 if n == 3 else 44 if n <= 5 else 38
    track = 4 if n <= 5 else 3
    size = fit_size(card, body, base, track) if body else base
    line_gap = size * 1.85 * SS

    # ---- measure the whole stack so it can be centred as a group ----
    blocks = []
    if item.get("glyph"):
        gsz = item.get("glyph_size", 108)
        blocks.append(("glyph", (gsz * 2.0 if item.get("ring") else gsz * 1.35) * SS))
    if item.get("moon"):
        blocks.append(("moon", 150 * SS))
    if item.get("title"):
        blocks.append(("title", 78 * SS))
        blocks.append(("rule", 56 * SS))
    if body:
        blocks.append(("body", line_gap * n))
    if item.get("footer"):
        blocks.append(("footer", 168 * SS))
    if item.get("note"):
        blocks.append(("note", 84 * SS))

    total = sum(h for _, h in blocks)
    avail = MARGIN_BOT - MARGIN_TOP
    y = MARGIN_TOP + max(0, (avail - total) / 2)
    card.occupied.append((y - 20 * SS, y + total + 20 * SS))

    # ---- draw ----
    for kind, h in blocks:
        cy = y + h / 2
        if kind == "glyph":
            if item.get("ring"):
                R = h / 2 - 6 * SS
                card.d.ellipse([W / 2 - R, cy - R, W / 2 + R, cy + R],
                               outline=GOLD + (85,), width=2 * SS)
            card.text(item["glyph"], SYM, item.get("glyph_size", 108), cy, 0, 255)
        elif kind == "moon":
            card.crescent(W / 2, cy, 62 * SS, item.get("moon_frac", 0.45))
        elif kind == "title":
            card.text(item["title"], CJK, 42, cy, 10, 250, TC)
        elif kind == "rule":
            card.rule(cy)
        elif kind == "body":
            for i, line in enumerate(body):
                card.text(line, CJK, size, y + line_gap * (i + 0.5), track, 245, TC)
        elif kind == "footer":
            f = item["footer"]                     # [(label, value), ...]
            cols = len(f)
            if cols == 2:
                card.d.rectangle([W / 2 - 1, cy - 55 * SS, W / 2 + 1, cy + 55 * SS],
                                 fill=GOLD + (55,))
            for i, (label, value) in enumerate(f):
                cx = W / 2 + (i - (cols - 1) / 2) * 300 * SS
                card.text(label, CJK, 27, cy - 44 * SS, 8, 150, TC, cx=cx)
                card.text(value, CJK, 40, cy + 24 * SS, 6, 240, TC, cx=cx)
        elif kind == "note":
            card.text(item["note"], CJK, 29, cy, 4, 150, TC)
        y += h

    # ---- fixed furniture ----
    card.text("LUMIS", SERIF_B, 32, 150 * SS, 14, 168)
    if item.get("kicker"):
        card.text(item["kicker"], CJK, 27, 208 * SS, 10, 140, TC)
    card.text("lumisstar.com", SERIF_I, 29, 1240 * SS, 6, 150)
    card.occupied += [(120 * SS, 230 * SS), (1210 * SS, 1270 * SS)]
    card.stars(item.get("stars", 14))
    return card.save(path)
