#!/usr/bin/env python3
"""
LUMIS daily post generator.
Renders one gold-on-black card (1080x1920) and wraps it in a silent MP4
so it can be published as an Instagram Reel via the Graph API.

Outputs: out/post.png, out/post.mp4, out/caption.txt
"""
import os, sys, math, random, glob, subprocess, datetime, pathlib
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).parent
OUT = ROOT / "out"
OUT.mkdir(exist_ok=True)

Wf, Hf, SS = 1080, 1920, 2
W, H = Wf * SS, Hf * SS
GOLD = (201, 168, 76)
STARW = (232, 224, 205)
BLACK = (0, 0, 10)
DURATION = 6   # short hold; every frame is identical so looping is seamless


# ---------------------------------------------------------------- fonts
def find_font(patterns, label):
    """Return the first font file that actually exists on this machine."""
    for pat in patterns:
        hits = sorted(glob.glob(pat, recursive=True))
        if hits:
            return hits[0]
    found = sorted(glob.glob("/usr/share/fonts/**/*.tt[fc]", recursive=True))[:25]
    sys.exit(
        f"ERROR: no {label} font found.\nTried: {patterns}\n"
        f"Fonts present on this machine:\n  " + "\n  ".join(found)
    )


# Chinese: prefer lighter weights, fall back to whatever exists
CJK = find_font(
    [
        "/usr/share/fonts/**/NotoSerifCJK-Light.ttc",
        "/usr/share/fonts/**/NotoSerifCJK-Regular.ttc",
        "/usr/share/fonts/**/NotoSerifCJK*.ttc",
        "/usr/share/fonts/**/NotoSerifCJK*.otf",
        "/usr/share/fonts/**/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/**/NotoSansCJK*.ttc",
    ],
    "Chinese (CJK)",
)

# Latin serif for the LUMIS wordmark
SB = find_font(
    [
        "/usr/share/fonts/**/LiberationSerif-Bold.ttf",
        "/usr/share/fonts/**/DejaVuSerif-Bold.ttf",
        "/usr/share/fonts/**/FreeSerifBold.ttf",
        "/usr/share/fonts/**/*Serif*Bold*.ttf",
    ],
    "Latin serif bold",
)
SI = find_font(
    [
        "/usr/share/fonts/**/LiberationSerif-Italic.ttf",
        "/usr/share/fonts/**/DejaVuSerif-Italic.ttf",
        "/usr/share/fonts/**/FreeSerifItalic.ttf",
        "/usr/share/fonts/**/LiberationSerif-Regular.ttf",
        "/usr/share/fonts/**/*Serif*.ttf",
    ],
    "Latin serif italic",
)


def tc_index(path):
    """Find the Traditional Chinese face inside a .ttc collection."""
    for i in range(10):
        try:
            if "TC" in ImageFont.truetype(path, 20, index=i).getname()[0]:
                return i
        except Exception:
            break
    return 0


TC = tc_index(CJK)
print(f"Fonts -> CJK: {CJK} (face {TC})\n         serif: {SB}")


# ---------------------------------------------------------------- content
USED = ROOT / "used.txt"


def pick_line():
    """Pick a line that has never been posted before. Never repeats."""
    raw = [l.strip() for l in (ROOT / "lines.txt").read_text(encoding="utf-8").splitlines()]
    lines = [l for l in raw if l and not l.startswith("#")]
    if not lines:
        sys.exit("lines.txt is empty")

    used = []
    if USED.exists():
        used = [l.strip() for l in USED.read_text(encoding="utf-8").splitlines() if l.strip()]

    remaining = [l for l in lines if l not in used]
    if not remaining:
        # Whole bank exhausted - start a fresh cycle rather than posting nothing.
        print(f"NOTE: all {len(lines)} lines used. Starting a new cycle - add more to lines.txt.")
        USED.write_text("", encoding="utf-8")
        remaining = lines
        used = []

    random.seed()                      # genuinely random, not date-seeded
    choice = random.choice(remaining)

    # Mark it used immediately so a re-run today picks a different line.
    with USED.open("a", encoding="utf-8") as f:
        f.write(choice + "\n")

    print(f"Bank: {len(lines)} lines | used: {len(used)} | remaining after this: {len(remaining) - 1}")
    return choice.split("|")


def render(parts):
    img = Image.new("RGBA", (W, H), BLACK + (255,))
    d = ImageDraw.Draw(img)

    def T(text, path, idx, size, cy, track, alpha):
        f = ImageFont.truetype(path, int(size * SS), index=idx)
        ws = [f.getbbox(c)[2] - f.getbbox(c)[0] for c in text]
        total = sum(ws) + track * SS * (len(text) - 1)
        x = W / 2 - total / 2
        for c, w in zip(text, ws):
            bb = f.getbbox(c)
            d.text((x - bb[0], cy - (bb[3] + bb[1]) / 2), c, font=f, fill=GOLD + (alpha,))
            x += w + track * SS

    def spark(cx, cy, o, inr, a):
        pts = []
        for k in range(8):
            an = math.radians(k * 45)
            r = o if k % 2 == 0 else inr
            pts.append((cx + r * math.sin(an), cy - r * math.cos(an)))
        d.polygon(pts, fill=GOLD + (a,))

    random.seed(datetime.date.today().toordinal())
    for _ in range(16):
        x = random.randint(90 * SS, 990 * SS)
        y = random.randint(160 * SS, 1780 * SS)
        if 680 * SS < y < 1180 * SS:
            continue
        r = random.choice([1.6, 2.2, 2.8]) * SS
        col = GOLD if random.random() < 0.7 else STARW
        d.ellipse([x - r, y - r, x + r, y + r], fill=col + (random.randint(45, 120),))

    T("LUMIS", SB, 0, 38, 340 * SS, 14, 190)

    n = len(parts)
    gap = 125
    start = 945 - (n - 1) * gap / 2
    for i, part in enumerate(parts):
        T(part, CJK, TC, 60, (start + i * gap) * SS, 4, 248)

    spark(W / 2, (start + (n - 1) * gap + 165) * SS, 15 * SS, 3.2 * SS, 215)
    T("lumisstar.com", SI, 0, 30, 1620 * SS, 6, 150)

    img = img.resize((Wf, Hf), Image.LANCZOS)
    flat = Image.new("RGB", (Wf, Hf), BLACK)
    flat.paste(img, (0, 0), img)
    png = OUT / "post.png"
    flat.save(png, "PNG")
    return png


def to_video(png):
    """Wrap the still into a silent H.264 MP4 that Instagram accepts as a Reel."""
    mp4 = OUT / "post.mp4"
    cmd = [
        "ffmpeg", "-y",
        "-loop", "1", "-t", str(DURATION), "-i", str(png),
        "-f", "lavfi", "-t", str(DURATION), "-i", "anullsrc=r=44100:cl=stereo",
        # No fade-in: frame 0 IS the finished card, so the Reel cover is never black.
        "-vf", "format=yuv420p",
        "-r", "30", "-c:v", "libx264", "-crf", "18", "-preset", "medium",
        "-tune", "stillimage",   # x264 tuning for static content - cleaner, no shimmer
        "-g", "30",              # regular keyframes so the loop point stays crisp
        "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart",
        str(mp4),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit("ffmpeg failed:\n" + r.stderr[-2000:])
    return mp4


def main():
    parts = pick_line()
    print("Line:", " / ".join(parts))
    png = render(parts)
    mp4 = to_video(png)
    caption = "".join(parts)
    (OUT / "caption.txt").write_text(caption, encoding="utf-8")
    print("PNG:", png)
    print("MP4:", mp4, mp4.stat().st_size, "bytes")
    print("CAPTION:", caption)


if __name__ == "__main__":
    main()
