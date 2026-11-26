#!/usr/bin/env bash
#
# Subset GNU Unifont for the bot and the dashboard.
#
# Unifont is only the fallback behind IBM VGA 8x16: it draws whatever CP437 lacks (accents, arrows,
# kana, kanji, user names). The full OTFs are 11 MB, so this keeps Latin, Greek, Cyrillic, symbols,
# kana, fullwidth forms, the kanji of JIS X 0208, the hanzi of GB 2312, the hangul of KS X 1001 and the
# mathematical alphanumerics fancy Discord names use. Everything else renders as a missing glyph.
#
# Usage: scripts/subset-fonts.sh <dir with the full Unifont.otf and UnifontUpper.otf>
#   (the full set lives in the haiiro workspace under themes/haiiro-fonts/)
# Writes src/core/images/fonts/Unifont*.otf (satori) and src/web/app/fonts/Unifont*.woff2 (dashboard).
# Needs fonttools and brotli: nix shell --impure --expr 'with import <nixpkgs> {}; python3.withPackages (p: [p.fonttools p.brotli])' -c scripts/subset-fonts.sh <dir>

set -euo pipefail
SRC="${1:?usage: scripts/subset-fonts.sh <dir with Unifont.otf and UnifontUpper.otf>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Code points that decode in a legacy CJK standard (kanji, hanzi, hangul), one per line as U+XXXX.
python3 - "$TMP/cjk.txt" <<'PY'
import sys
out = set()
def rows(codec, lead, trail):
    for a in lead:
        for b in trail:
            try:
                ch = bytes([a, b]).decode(codec)
            except UnicodeDecodeError:
                continue
            if len(ch) == 1 and ord(ch) >= 0x2E80:
                out.add(ord(ch))
rows("shift_jis", range(0x81, 0xEF), list(range(0x40, 0x7F)) + list(range(0x80, 0xFD)))  # JIS X 0208
rows("gb2312", range(0xB0, 0xF8), range(0xA1, 0xFF))                                      # GB 2312 hanzi
rows("euc_kr", range(0xB0, 0xC9), range(0xA1, 0xFF))                                      # KS X 1001 hangul
open(sys.argv[1], "w").write(",".join("U+%04X" % c for c in sorted(out)))
PY

BMP="U+0020-007E,U+00A0-024F,U+0250-02AF,U+0370-03FF,U+0400-052F,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2150-218F,U+2190-23FF,U+2400-243F,U+2500-27BF,U+2900-297F,U+2B00-2BFF,U+3000-303F,U+3040-30FF,U+FE30-FE4F,U+FF00-FFEF"
UPPER="U+1D400-1D7FF,U+1F100-1F1FF"

sub() { # <font> <unicodes> <out> [flavor]
  pyftsubset "$1" --unicodes="$2" --output-file="$3" --layout-features='*' --no-hinting ${4:+--flavor="$4"}
}

CJK="$(cat "$TMP/cjk.txt")"
sub "$SRC/Unifont.otf" "$BMP,$CJK" "$ROOT/src/core/images/fonts/Unifont.otf"
sub "$SRC/UnifontUpper.otf" "$UPPER" "$ROOT/src/core/images/fonts/UnifontUpper.otf"
sub "$SRC/Unifont.otf" "$BMP,$CJK" "$ROOT/src/web/app/fonts/Unifont.woff2" woff2
sub "$SRC/UnifontUpper.otf" "$UPPER" "$ROOT/src/web/app/fonts/UnifontUpper.woff2" woff2
ls -l "$ROOT"/src/core/images/fonts/Unifont*.otf "$ROOT"/src/web/app/fonts/Unifont*.woff2
