#!/usr/bin/env python3
"""
LUMIS Threads publisher.

Posts the same daily card to Threads. Runs AFTER publish.py, and reuses the
public Supabase URL that publish.py already created (written to out/video_url.txt).

Threads is a separate API from Instagram: different host, different token.

Env vars:
  THREADS_ACCESS_TOKEN   token with threads_basic + threads_content_publish
  THREADS_USER_ID        optional; defaults to "me"
"""
import os, sys, time, json, pathlib
import urllib.request, urllib.parse, urllib.error

ROOT = pathlib.Path(__file__).parent
OUT = ROOT / "out"
GRAPH = "https://graph.threads.net/v1.0"
MAX_TEXT = 500          # Threads' character limit


def http(url, data=None, method=None, timeout=180):
    body = urllib.parse.urlencode(data).encode() if isinstance(data, dict) else data
    req = urllib.request.Request(url, data=body, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw.strip().startswith(("{", "[")) else raw
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code} calling {url.split('?')[0]}\n{e.read().decode()}")
    except urllib.error.URLError as e:
        sys.exit(f"Network error calling {url.split('?')[0]}: {e.reason}")


def main():
    token = os.environ.get("THREADS_ACCESS_TOKEN")
    if not token:
        print("THREADS_ACCESS_TOKEN not set - skipping Threads (Instagram already posted).")
        return
    target = os.environ.get("THREADS_USER_ID") or "me"

    url_file = OUT / "video_url.txt"
    cap_file = OUT / "caption.txt"
    caption = cap_file.read_text(encoding="utf-8").strip() if cap_file.exists() else ""
    caption = caption[:MAX_TEXT]

    params = {"text": caption, "access_token": token}
    if url_file.exists():
        video_url = url_file.read_text(encoding="utf-8").strip()
        params["media_type"] = "VIDEO"
        params["video_url"] = video_url
        print("Threads: posting video", video_url)
    else:
        params["media_type"] = "TEXT"
        print("Threads: no video URL found, posting text only")

    # 1. create container
    res = http(f"{GRAPH}/{target}/threads", data=params, method="POST")
    cid = res["id"]
    print("Threads container:", cid)

    # 2. video containers need processing time; text is instant
    if params["media_type"] == "VIDEO":
        for attempt in range(40):
            time.sleep(15)
            st = http(f"{GRAPH}/{cid}?fields=status,error_message&access_token={token}")
            status = st.get("status")
            print(f"  [{attempt + 1}] {status}")
            if status == "FINISHED":
                break
            if status in ("ERROR", "EXPIRED"):
                sys.exit(f"Threads processing failed: {st}")
        else:
            sys.exit("Timed out waiting for Threads processing")
    else:
        time.sleep(5)

    # 3. publish
    out = http(
        f"{GRAPH}/{target}/threads_publish",
        data={"creation_id": cid, "access_token": token},
        method="POST",
    )
    print("THREADS PUBLISHED:", out)


if __name__ == "__main__":
    main()
