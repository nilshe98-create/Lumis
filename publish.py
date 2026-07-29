#!/usr/bin/env python3
"""
LUMIS auto-publisher (Instagram only - never posts to Facebook).

1. Uploads out/post.mp4 to Supabase Storage (public bucket) -> public URL
2. Creates an Instagram REELS container from that URL
3. Polls until Instagram finishes processing
4. Publishes it

Env vars (all set as GitHub Actions secrets):
  SUPABASE_URL           https://xxxx.supabase.co
  SUPABASE_SERVICE_KEY   the sb_secret_... key
  SUPABASE_BUCKET        lumis-reels   (must be PUBLIC)
  IG_ACCESS_TOKEN        Instagram token
  IG_USER_ID             optional; defaults to "me"
"""
import os, sys, time, json, pathlib, datetime
import urllib.request, urllib.parse, urllib.error

ROOT = pathlib.Path(__file__).parent
OUT = ROOT / "out"

# Instagram API with Instagram Login lives on graph.instagram.com
GRAPH = "https://graph.instagram.com/v23.0"


def env(name, default=None):
    v = os.environ.get(name) or default
    if not v:
        sys.exit(f"Missing env var: {name}")
    return v


def http(url, data=None, method=None, headers=None, timeout=180):
    body = None
    if isinstance(data, dict):
        body = urllib.parse.urlencode(data).encode()
    elif isinstance(data, bytes):
        body = data
    req = urllib.request.Request(url, data=body, method=method)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw.strip().startswith(("{", "[")) else raw
    except urllib.error.HTTPError as e:
        detail = e.read().decode()
        sys.exit(f"HTTP {e.code} calling {url.split('?')[0]}\n{detail}")
    except urllib.error.URLError as e:
        sys.exit(f"Network error calling {url.split('?')[0]}: {e.reason}")


def upload(mp4):
    """Push the video to Supabase Storage and return its public URL."""
    base = env("SUPABASE_URL").rstrip("/")
    key = env("SUPABASE_SERVICE_KEY")
    bucket = env("SUPABASE_BUCKET")
    name = f"reel-{datetime.date.today().isoformat()}-{int(time.time())}.mp4"

    http(
        f"{base}/storage/v1/object/{bucket}/{name}",
        data=mp4.read_bytes(),
        method="POST",
        headers={
            "Authorization": f"Bearer {key}",
            "apikey": key,              # required by the new sb_secret_ keys
            "Content-Type": "video/mp4",
            "x-upsert": "true",
        },
    )
    public = f"{base}/storage/v1/object/public/{bucket}/{name}"
    print("Uploaded:", public)

    # Instagram must be able to download this anonymously - check before proceeding
    try:
        req = urllib.request.Request(public, method="HEAD")
        with urllib.request.urlopen(req, timeout=60) as r:
            print(f"Public check: HTTP {r.status}, "
                  f"type={r.headers.get('Content-Type')}, "
                  f"size={r.headers.get('Content-Length')}")
    except Exception as e:
        sys.exit(f"Uploaded file is NOT publicly readable: {e}\n"
                 f"Make sure the '{bucket}' bucket is set to PUBLIC in Supabase.")
    return public


def publish(video_url, caption):
    token = env("IG_ACCESS_TOKEN")
    # "me" is what the Graph API Explorer test proved works for this token.
    # A numeric ID from the dashboard can belong to a different ID space and 400s.
    target = os.environ.get("IG_TARGET") or "me"

    # 1. create the Reel container
    res = http(
        f"{GRAPH}/{target}/media",
        data={
            "media_type": "REELS",
            "video_url": video_url,
            "caption": caption,
            "share_to_feed": "true",   # shows in the IG grid - NOT Facebook
            "access_token": token,
        },
        method="POST",
    )
    cid = res["id"]
    print("Container:", cid)

    # 2. wait for Instagram to download + transcode
    for attempt in range(40):          # ~10 minutes max
        time.sleep(15)
        st = http(f"{GRAPH}/{cid}?fields=status_code,status&access_token={token}")
        code = st.get("status_code")
        print(f"  [{attempt + 1}] {code}")
        if code == "FINISHED":
            break
        if code == "ERROR":
            sys.exit(f"Processing failed: {st}")
    else:
        sys.exit("Timed out waiting for processing")

    # 3. publish
    out = http(
        f"{GRAPH}/{target}/media_publish",
        data={"creation_id": cid, "access_token": token},
        method="POST",
    )
    print("PUBLISHED:", out)
    return out


def main():
    mp4 = OUT / "post.mp4"
    cap = OUT / "caption.txt"
    if not mp4.exists():
        sys.exit("out/post.mp4 not found - run make_post.py first")
    caption = cap.read_text(encoding="utf-8").strip() if cap.exists() else ""
    print("Caption:", caption)
    publish(upload(mp4), caption)


if __name__ == "__main__":
    main()
