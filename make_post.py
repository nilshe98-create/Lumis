#!/usr/bin/env python3
"""
LUMIS daily post generator.

Picks a post from content.txt that has never gone out before, renders it with the
adaptive card engine, and wraps it in a silent MP4 so it can be published as a Reel.

Rules:
  - never repeats a post (used.txt)
  - never runs the same TYPE two days in a row, so the grid stays varied

Outputs: out/post.png, out/post.mp4, out/caption.txt
"""
import sys, random, subprocess, pathlib, datetime
from content_loader import load
from render_card import render

ROOT = pathlib.Path(__file__).parent
OUT = ROOT / "out"; OUT.mkdir(exist_ok=True)
USED = ROOT / "used.txt"
DURATION = 6


def key_of(item):
    return item["body"][0][:40]


def pick():
    items = load()
    if not items:
        sys.exit("content.txt is empty")

    used = []
    if USED.exists():
        used = [l.strip() for l in USED.read_text(encoding="utf-8").splitlines() if l.strip()]
    used_set = set(used)

    remaining = [i for i in items if key_of(i) not in used_set]
    if not remaining:
        print(f"NOTE: all {len(items)} posts used - starting a fresh cycle. Add more to content.txt.")
        USED.write_text("", encoding="utf-8")
        used, used_set, remaining = [], set(), items

    # avoid repeating yesterday's type when there's an alternative
    last_type = None
    if used:
        for i in items:
            if key_of(i) == used[-1]:
                last_type = i.get("type"); break
    varied = [i for i in remaining if i.get("type") != last_type]
    pool = varied or remaining

    random.seed()
    choice = random.choice(pool)

    with USED.open("a", encoding="utf-8") as f:
        f.write(key_of(choice) + "\n")

    print(f"Bank: {len(items)} posts | used: {len(used)} | remaining after this: {len(remaining) - 1}")
    print(f"Type: {choice.get('type')} (yesterday was {last_type})")
    return choice


def to_video(png):
    mp4 = OUT / "post.mp4"
    cmd = ["ffmpeg", "-y",
           "-loop", "1", "-t", str(DURATION), "-i", str(png),
           "-f", "lavfi", "-t", str(DURATION), "-i", "anullsrc=r=44100:cl=stereo",
           "-vf", "format=yuv420p",          # no fade: frame 0 is the finished card
           "-r", "30", "-c:v", "libx264", "-crf", "18", "-preset", "medium",
           "-tune", "stillimage", "-g", "30",
           "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart",
           str(mp4)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit("ffmpeg failed:\n" + r.stderr[-2000:])
    return mp4


def caption_for(item):
    """One line, no hashtags. Prefer the note (it teaches); else the last body line."""
    if item.get("note"):
        return item["note"].rstrip("。") + "。"
    return item["body"][-1]


def main():
    item = pick()
    print("Post:", " / ".join(item["body"])[:70])
    png = render(item, str(OUT / "post.png"))
    mp4 = to_video(png)
    cap = caption_for(item)
    (OUT / "caption.txt").write_text(cap, encoding="utf-8")
    print("PNG:", png)
    print("MP4:", mp4, pathlib.Path(mp4).stat().st_size, "bytes")
    print("CAPTION:", cap)


if __name__ == "__main__":
    main()
