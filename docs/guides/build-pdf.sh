#!/usr/bin/env bash
# Build a plugin manual PDF: Markdown -> HTML -> headless Chrome (A4, Noto Sans CJK SC).
#
# Usage: docs/guides/build-pdf.sh <manual.md> <output.pdf> [font-size]
#   e.g. docs/guides/build-pdf.sh docs/guides/character-system.md /workspace/out/RBQ角色系统手册.pdf 10.5pt
#
# Screenshots: write 【截图：<id>】 in the Markdown. If img/<id>.png (or .jpg/.webp) exists next to
# the .md file (i.e. docs/guides/img/), it is embedded; otherwise a dashed placeholder box is printed.
# Plain Markdown images ![alt](img/foo.png) also resolve relative to the .md file's directory.
#
# Needs: python3 + markdown (pip install markdown), google-chrome or chromium, fonts-noto-cjk.
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <manual.md> <output.pdf> [font-size, default 10.5pt]" >&2
  exit 1
fi
SRC="$(realpath "$1")"
OUT="$(realpath -m "$2")"
SIZE="${3:-10.5pt}"
SRC_DIR="$(dirname "$SRC")"
CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "google-chrome/chromium not found" >&2; exit 1; }

HTML="$(mktemp --suffix=.html)"
trap 'rm -f "$HTML"' EXIT

python3 - "$SRC" "$HTML" "$SIZE" "$SRC_DIR" <<'PY'
import html, os, re, sys, markdown
src, out, size, base = sys.argv[1:5]
text = open(src, encoding='utf-8').read()

def shot(m):
    sid = m.group(1).strip()
    for ext in ('png', 'jpg', 'jpeg', 'webp'):
        rel = f'img/{sid}.{ext}'
        if os.path.exists(os.path.join(base, rel)):
            return f'<figure class="shot"><img src="{html.escape(rel)}" alt="{html.escape(sid)}"></figure>'
    return f'<div class="shot-missing">【截图：{html.escape(sid)}】</div>'

# Several placeholders on one line become a row of figures.
text = re.sub(r'【截图：([^】]+)】', shot, text)
body = markdown.markdown(text, extensions=['tables', 'md_in_html'])
css = f"""@page{{size:A4;margin:14mm 16mm}}
body{{font-family:'Noto Sans CJK SC',sans-serif;font-size:{size};line-height:1.55;color:#222}}
h1{{font-size:1.6em;margin:0 0 .3em;color:#6b2fb3;break-after:avoid}}
h1:nth-of-type(n+3){{break-before:page}}  /* doc title + part 1 share page 1; later parts start a new page */
h2{{font-size:1.2em;margin:.9em 0 .3em;border-bottom:2px solid #e3d5f5;padding-bottom:2px;color:#6b2fb3;break-after:avoid}}
h3{{font-size:1.05em;margin:.8em 0 .2em}} p{{margin:.3em 0}} ul,ol{{margin:.2em 0;padding-left:1.5em}} li{{margin:.1em 0}}
blockquote{{margin:.4em 0;padding:.3em .8em;background:#f6f1fc;border-left:4px solid #a77bdc;color:#444}}
code{{font-family:'Noto Sans Mono CJK SC',monospace;font-size:.9em;background:#f2f2f2;padding:0 3px}}
table{{border-collapse:collapse;width:100%;font-size:.92em}} td,th{{border:1px solid #ccc;padding:3px 6px}} hr{{border:0;border-top:1px solid #ddd}}
figure.shot{{display:inline-block;margin:.4em .4em .4em 0;max-width:100%;break-inside:avoid}}
figure.shot img{{max-width:100%;max-height:85mm;border:1px solid #ddd;border-radius:4px}}
.shot-missing{{display:inline-block;margin:.3em .4em .3em 0;padding:.25em .8em;border:1px dashed #a77bdc;border-radius:4px;color:#7a5aa8;background:#faf7fe;font-size:.9em}}"""
base_href = 'file://' + base.rstrip('/') + '/'
open(out, 'w', encoding='utf-8').write(
    f"<!DOCTYPE html><html lang='zh-CN'><head><meta charset='utf-8'><base href='{base_href}'>"
    f"<style>{css}</style></head><body>{body}</body></html>")
PY

mkdir -p "$(dirname "$OUT")"
"$CHROME" --headless=new --no-sandbox --disable-gpu --no-pdf-header-footer \
  --allow-file-access-from-files --print-to-pdf="$OUT" "file://$HTML" 2>/dev/null
if command -v pdfinfo >/dev/null; then
  echo "$OUT: $(pdfinfo "$OUT" | awk '/^Pages:/{print $2}') pages"
else
  echo "$OUT written"
fi
