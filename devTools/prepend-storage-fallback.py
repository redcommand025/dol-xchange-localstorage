#!/usr/bin/env python3
"""Insert the storage-fallback script from head.html immediately after <head>.

SugarCube's libraries live in the compiled <head> and read localStorage /
indexedDB while that tag evaluates. Tweego --head content is appended near
</head>, which is too late, so the same fallback must also be prepended.
"""
from pathlib import Path
import sys

MARKER = "Storage fallback: localStorage/sessionStorage/indexedDB"


def extract_script(head_html: str) -> str:
    start = head_html.find("<script>")
    end = head_html.find("</script>")
    if start < 0 or end < 0 or end < start:
        raise SystemExit("devTools/head.html is missing the storage fallback <script>")
    script = head_html[start : end + len("</script>")]
    if MARKER not in script:
        raise SystemExit("devTools/head.html script is not the storage fallback")
    return script


def prepend(html: str, script: str) -> str:
    head_idx = html.find("<head>")
    if head_idx < 0:
        head_idx = html.find("<head ")
        if head_idx < 0:
            raise SystemExit("compiled HTML has no <head>")
        gt = html.find(">", head_idx)
        if gt < 0:
            raise SystemExit("compiled HTML has a malformed <head>")
        insert_at = gt + 1
    else:
        insert_at = head_idx + len("<head>")

    window = html[insert_at : insert_at + len(script) + 80]
    if MARKER in window:
        return html
    return html[:insert_at] + "\n" + script + "\n" + html[insert_at:]


def main(argv):
    if len(argv) < 2:
        raise SystemExit("usage: prepend-storage-fallback.py <compiled.html>")
    html_path = Path(argv[1])
    head_path = Path(argv[2]) if len(argv) > 2 else Path(__file__).resolve().parent / "head.html"
    script = extract_script(head_path.read_text(encoding="utf-8"))
    original = html_path.read_text(encoding="utf-8")
    updated = prepend(original, script)
    if updated != original:
        html_path.write_text(updated, encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv)
