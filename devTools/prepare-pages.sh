#!/usr/bin/env bash
# Assemble a GitHub Pages-ready copy of the compiled game:
#   devTools/prepare-pages.sh <output-dir> [compiled.html]
# Copies index.html + img/ img2/ style.css LICENSE and the selectable image packs
# (imagepacks/au, aumasc, mysterious; tracked files only), fetches the real audio for
# the Git LFS pointers in audio/ (hash-checked), and refuses to finish if any audio file is still an
# LFS pointer. Run ./compile.sh first. Do not put the output under Git LFS: Pages serves pointers.
set -euo pipefail
cd "$(dirname "$0")/.."
out="${1:?usage: devTools/prepare-pages.sh <output-dir> [compiled.html]}"
html="${2:-Degrees of Lewdity.html}"
[ -f "$html" ] || { echo "Compiled HTML not found: $html (run ./compile.sh)" >&2; exit 1; }
grep -q "Storage fallback for devices with no storage" "$html" || { echo "Compiled HTML lacks the localStorage stand-in (devTools/head.html)" >&2; exit 1; }
mkdir -p "$out"
# image packs the game can select (Options > Images); keep in sync with devTools/generate-imagepack-manifest.cjs
packs="imagepacks/au imagepacks/aumasc imagepacks/mysterious"
rm -rf "$out/imagepacks"
git archive HEAD img img2 style.css LICENSE $packs | tar -x -C "$out"
cp -L "$html" "$out/index.html"
touch "$out/.nojekyll"
if [ -f "$out/.gitattributes" ] && grep -q "filter=lfs" "$out/.gitattributes"; then
	echo "Refusing to publish: $out/.gitattributes routes files to Git LFS" >&2
	exit 1
fi
python3 devTools/lfs-audio.py fetch audio "$out/audio"
python3 devTools/lfs-audio.py check "$out/audio"
for p in $packs; do python3 devTools/lfs-audio.py check "$out/$p" >/dev/null || { echo "Refusing to publish: $p contains LFS pointers or empty files" >&2; exit 1; }; done
size=$(du -sm --exclude=.git "$out" | cut -f1)
echo "Pages copy size: ${size} MB"
if [ "$size" -ge 1000 ]; then echo "Refusing to publish: ${size} MB exceeds the 1 GB GitHub Pages limit" >&2; exit 1; fi
echo "Pages copy ready: $out"
