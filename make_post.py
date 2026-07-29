#!/usr/bin/env python3
"""
LUMIS daily post generator.
Renders one gold-on-black card (1080x1920) and wraps it in a silent MP4
so it can be published as an Instagram Reel via the Graph API.

Outputs: out/post.png, out/post.mp4, out/caption.txt
"""
import os, math, random, subprocess, datetime, pathlib
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).parent
OUT = ROOT / "out"
OUT.mkdir(exist_ok=True)

Wf, Hf, SS = 1080, 1920, 2
W, H = Wf * SS, Hf * SS
GOLD = (201, 168, 76)
STARW = (232, 224, 205)
BLACK = (0, 0, 10)
DURATION = 7  # seconds

SB = "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf"
SI = "/usr/share/fonts/truetype/liberation/LiberationSerif-Italic.ttf"
CJK = "/usr/share/fonts/opentype/noto/NotoSerifCJK-Light.ttc"


def tc_index(path):
    for i in range(8):
        try:
            if "TC" in ImageFont.truetype(path, 20, index=i).getname()[0]:
                return i
        except Exception:
            break
    return 0


def pick_line():
    """Pick today's line by day-of-year; wraps around forever."""
    raw = [l.strip() for l in (ROOT / "lines.txt").read_text(encoding="utf-8").splitlines()]
    lines = [l for l in raw if l and not l.startswith("#")]
    if not lines:
        raise SystemExit("lines.txt is empty")
    idx = datetime.date.today().toordinal() % len(lines)
    return lines[idx].split("|")


def render(parts):
    img = Image.new("RGBA", (W, H), BLACK + (255,))
    d = ImageDraw.Draw(img)
    tc = tc_index(CJK)

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

    # starfield (kept clear of the text band)
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

    # centre the block vertically no matter how many lines
    n = len(parts)
    gap = 125
    start = 945 - (n - 1) * gap / 2
    for i, part in enumerate(parts):
        T(part, CJK, tc, 60, (start + i * gap) * SS, 4, 248)

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
        "-vf", "fade=t=in:st=0:d=0.6,fade=t=out:st=%.1f:d=0.6,format=yuv420p" % (DURATION - 0.7),
        "-r", "30", "-c:v", "libx264", "-crf", "20", "-preset", "medium",
        "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart",
        str(mp4),
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    return mp4


def main():
    parts = pick_line()
    png = render(parts)
    mp4 = to_video(png)
    caption = parts[-1].replace("，", "，").strip()
    # one-line caption, no hashtags
    caption = "".join(parts).replace("|", "")
    (OUT / "caption.txt").write_text(caption, encoding="utf-8")
    print("PNG:", png)
    print("MP4:", mp4, mp4.stat().st_size, "bytes")
    print("CAPTION:", caption)


if __name__ == "__main__":
    main()
