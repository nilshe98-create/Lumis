#!/usr/bin/env python3
"""
LUMIS health check - runs after every post.

Watches the two things that will silently kill this system:
  1. Access tokens expiring (~60 days)
  2. The line bank running out

When something needs attention it opens a GitHub Issue, which GitHub
emails to you. No action needed until you get that email.

Env vars (provided automatically by GitHub Actions):
  GITHUB_TOKEN, GITHUB_REPOSITORY
"""
import os, sys, json, pathlib, datetime
import urllib.request, urllib.error

ROOT = pathlib.Path(__file__).parent

TOKEN_LIFETIME_DAYS = 60
TOKEN_WARN_DAYS = 14      # shout when under 2 weeks left
BANK_WARN_REMAINING = 15  # shout when under ~2 weeks of lines left


def issued_date():
    """Date the tokens were generated, from token_issued.txt (YYYY-MM-DD)."""
    f = ROOT / "token_issued.txt"
    if not f.exists():
        return None
    try:
        return datetime.date.fromisoformat(f.read_text(encoding="utf-8").strip())
    except ValueError:
        return None


def bank_status():
    from content_loader import load
    lines = [i["body"][0][:40] for i in load()]
    used_f = ROOT / "used.txt"
    used = []
    if used_f.exists():
        used = [l.strip() for l in used_f.read_text(encoding="utf-8").splitlines() if l.strip()]
    return len(lines), len([l for l in lines if l not in used])


def open_issue(title, body):
    repo = os.environ.get("GITHUB_REPOSITORY")
    token = os.environ.get("GITHUB_TOKEN")
    if not (repo and token):
        print("(no GitHub credentials - printing warning only)")
        print(title)
        return
    # Don't spam: skip if an open issue with this title already exists
    try:
        req = urllib.request.Request(
            f"https://api.github.com/repos/{repo}/issues?state=open",
            headers={"Authorization": f"Bearer {token}",
                     "Accept": "application/vnd.github+json"})
        with urllib.request.urlopen(req, timeout=30) as r:
            for it in json.loads(r.read().decode()):
                if it.get("title") == title:
                    print(f"Issue already open: {title}")
                    return
    except Exception as e:
        print("(could not list issues:", e, ")")

    data = json.dumps({"title": title, "body": body}).encode()
    req = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/issues", data=data, method="POST",
        headers={"Authorization": f"Bearer {token}",
                 "Accept": "application/vnd.github+json",
                 "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            print("OPENED ISSUE:", json.loads(r.read().decode()).get("html_url"))
    except urllib.error.HTTPError as e:
        print("Could not open issue:", e.code, e.read().decode()[:200])


def main():
    total, remaining = bank_status()
    print(f"HEALTH | bank: {remaining}/{total} posts left (~{remaining} days)")

    issued = issued_date()
    if issued:
        days_left = TOKEN_LIFETIME_DAYS - (datetime.date.today() - issued).days
        expires = issued + datetime.timedelta(days=TOKEN_LIFETIME_DAYS)
        print(f"HEALTH | tokens: {days_left} days left (expire ~{expires})")
        if days_left <= TOKEN_WARN_DAYS:
            open_issue(
                "LUMIS: Instagram + Threads tokens expiring soon",
                f"The access tokens expire around **{expires}** "
                f"({days_left} days left).\n\n"
                "When they expire, posting stops silently.\n\n"
                "**To fix (5 minutes):**\n"
                "1. developers.facebook.com/apps -> Lumis autopost\n"
                "2. Instagram use case -> Generate access tokens -> regenerate\n"
                "3. Threads use case -> regenerate\n"
                "4. Update the `IG_ACCESS_TOKEN` and `THREADS_ACCESS_TOKEN` secrets\n"
                "5. Update `token_issued.txt` to today's date\n")
    else:
        print("HEALTH | tokens: no token_issued.txt - add one to track expiry")

    if remaining <= BANK_WARN_REMAINING:
        open_issue(
            "LUMIS: line bank running low",
            f"Only **{remaining}** unused posts left out of {total}.\n\n"
            "When it runs out the system restarts the cycle and begins repeating.\n\n"
            "**To fix:** add more posts to `content.txt` (one block per post).\n")


if __name__ == "__main__":
    main()
