#!/usr/bin/env python3
"""Parses content.txt into item dicts for the adaptive renderer."""
import pathlib

ROOT = pathlib.Path(__file__).parent


def load(path=None):
    raw = (pathlib.Path(path) if path else ROOT / "content.txt").read_text(encoding="utf-8")
    items = []
    for block in raw.split("\n\n"):
        lines = [l for l in block.strip().splitlines() if l.strip() and not l.strip().startswith("#")]
        if not lines:
            continue
        item, body, footer = {}, [], []
        for line in lines:
            if ":" not in line:
                continue
            key, _, val = line.partition(":")
            key, val = key.strip().lower(), val.strip()
            if key == "body":
                body.append(val)
            elif key == "footer":
                lab, _, v = val.partition("::")
                footer.append((lab.strip(), v.strip()))
            elif key == "ring":
                item["ring"] = val.lower() in ("yes", "true", "1")
            else:
                item[key] = val
        if body:
            item["body"] = body
        if footer:
            item["footer"] = footer
        if item.get("body"):
            item["id"] = item["body"][0][:24]
            items.append(item)
    return items


if __name__ == "__main__":
    items = load()
    print(f"{len(items)} items")
    from collections import Counter
    print("by type:", dict(Counter(i.get("type", "?") for i in items)))
    print("body-line counts:", sorted(set(len(i["body"]) for i in items)))
