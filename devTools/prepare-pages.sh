#!/usr/bin/env bash
# Assemble a GitHub Pages-ready copy of the compiled game:
#   devTools/prepare-pages.sh <output-dir> [compiled.html]
# Copies index.html + img/ img2/ style.css LICENSE (tracked files only), fetches the real audio for
# the Git LFS pointers in audio/ (hash-checked), and refuses to finish if any audio file is still an
# LFS pointer. Run ./compile.sh first. Do not put the output under Git LFS: Pages serves pointers.
set -euo pipefail
cd "$(dirname "$0")/.."
out="${1:?usage: devTools/prepare-pages.sh <output-dir> [compiled.html]}"
html="${2:-Degrees of Lewdity.html}"
[ -f "$html" ] || { echo "Compiled HTML not found: $html (run ./compile.sh)" >&2; exit 1; }
grep -q "Storage fallback: localStorage/sessionStorage/indexedDB" "$html" || { echo "Compiled HTML lacks the storage fallback" >&2; exit 1; }
mkdir -p "$out"
git archive HEAD img img2 style.css LICENSE | tar -x -C "$out"
cp -L "$html" "$out/index.html"
touch "$out/.nojekyll"
if [ -f "$out/.gitattributes" ] && grep -q "filter=lfs" "$out/.gitattributes"; then
	echo "Refusing to publish: $out/.gitattributes routes files to Git LFS" >&2
	exit 1
fi
python3 devTools/lfs-audio.py fetch audio "$out/audio"
python3 devTools/lfs-audio.py check "$out/audio"
echo "Pages copy ready: $out"
