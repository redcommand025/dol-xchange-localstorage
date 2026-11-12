#!/usr/bin/env python3
"""Fetch real audio for Git LFS pointer files, and guard against publishing pointers.

audio/** is stored in Git LFS upstream. Without git-lfs a checkout has 131-byte pointer files
("version https://git-lfs.github.com/spec/v1 ..."), and GitHub Pages serves LFS-tracked files as
pointers too, so the game's audio silently fails to decode.

  lfs-audio.py fetch <src_audio_dir> <dest_audio_dir> [--endpoint URL]
      For every file in src (pointer or real), write the real bytes to dest, checking SHA-256 and
      size against the pointer. Pointers are resolved via the LFS batch API (public, read-only).
      Files already present in dest with the right hash are not downloaded again.
  lfs-audio.py check <audio_dir>
      Exit 1 if any file is still an LFS pointer (or is empty).

Default endpoint: the upstream repo, https://gitgud.io/Akoz/dol-xchange.git/info/lfs
"""
import argparse
import concurrent.futures as cf
import hashlib
import json
import os
import shutil
import sys
import urllib.request

POINTER_MAGIC = b"version https://git-lfs"
DEFAULT_ENDPOINT = "https://gitgud.io/Akoz/dol-xchange.git/info/lfs"


def walk(root):
    for dirpath, _, files in os.walk(root):
        for name in files:
            path = os.path.join(dirpath, name)
            yield path, os.path.relpath(path, root)


def parse_pointer(data):
    if not data.startswith(POINTER_MAGIC):
        return None
    fields = dict(line.split(" ", 1) for line in data.decode("utf-8").strip().splitlines() if " " in line)
    return fields["oid"].split(":", 1)[1], int(fields["size"])


def batch(endpoint, objects):
    body = json.dumps({"operation": "download", "transfers": ["basic"], "objects": [{"oid": o, "size": s} for o, s in objects]}).encode()
    req = urllib.request.Request(
        endpoint.rstrip("/") + "/objects/batch",
        data=body,
        headers={"Accept": "application/vnd.git-lfs+json", "Content-Type": "application/vnd.git-lfs+json"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return {o["oid"]: o for o in json.load(resp)["objects"]}


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(src, dest, endpoint):
    pointers, copied = [], 0
    for path, rel in walk(src):
        with open(path, "rb") as fh:
            data = fh.read()
        out = os.path.join(dest, rel)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        ptr = parse_pointer(data)
        if ptr is None:
            if os.path.abspath(path) != os.path.abspath(out):
                shutil.copyfile(path, out)
            copied += 1
        else:
            pointers.append((rel, out, ptr[0], ptr[1]))

    def already_ok(item):
        _, out, oid, size = item
        return os.path.exists(out) and os.path.getsize(out) == size and sha256_file(out) == oid

    todo = [p for p in pointers if not already_ok(p)]
    actions = {}
    for i in range(0, len(todo), 100):
        actions.update(batch(endpoint, [(oid, size) for _, _, oid, size in todo[i : i + 100]]))

    def download(item):
        rel, out, oid, size = item
        obj = actions.get(oid) or {}
        dl = (obj.get("actions") or {}).get("download")
        if not dl:
            return rel, f"no download action ({obj.get('error')})"
        try:
            req = urllib.request.Request(dl["href"], headers=dl.get("header") or {})
            with urllib.request.urlopen(req, timeout=300) as resp:
                data = resp.read()
        except Exception as ex:  # noqa: BLE001
            return rel, str(ex)
        if len(data) != size or hashlib.sha256(data).hexdigest() != oid:
            return rel, "size/hash mismatch"
        tmp = out + ".part"
        with open(tmp, "wb") as fh:
            fh.write(data)
        os.replace(tmp, out)
        return rel, None

    with cf.ThreadPoolExecutor(8) as pool:
        failures = [(rel, err) for rel, err in pool.map(download, todo) if err]
    for rel, err in failures:
        print(f"FAILED {rel}: {err}", file=sys.stderr)
    print(f"audio: {len(pointers)} LFS pointers ({len(pointers) - len(todo)} already present, {len(todo) - len(failures)} downloaded), {copied} plain files copied")
    return 1 if failures else 0


def check(root):
    bad = []
    count = 0
    for path, rel in walk(root):
        count += 1
        with open(path, "rb") as fh:
            head = fh.read(len(POINTER_MAGIC))
        if not head or head.startswith(POINTER_MAGIC):
            bad.append(rel)
    for rel in bad:
        print(f"LFS pointer or empty file: {rel}", file=sys.stderr)
    if bad:
        print(f"Refusing to publish: {len(bad)} of {count} files are LFS pointers or empty.", file=sys.stderr)
        return 1
    if count == 0:
        print("Refusing to publish: no audio files found.", file=sys.stderr)
        return 1
    print(f"check: {count} files, no LFS pointers")
    return 0


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fetch")
    f.add_argument("src")
    f.add_argument("dest")
    f.add_argument("--endpoint", default=os.environ.get("LFS_ENDPOINT", DEFAULT_ENDPOINT))
    c = sub.add_parser("check")
    c.add_argument("dir")
    args = ap.parse_args(argv)
    if args.cmd == "fetch":
        return fetch(args.src, args.dest, args.endpoint) or check(args.dest)
    return check(args.dir)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
