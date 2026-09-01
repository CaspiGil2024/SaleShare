#!/usr/bin/env python3
"""One-off scripted pass: append a matching dark: Tailwind variant next
to every common light-mode utility class across the page/component
files that don't have any dark styling yet (Sidebar.jsx, App.jsx,
ThemeProvider.jsx were hand-done separately and are excluded here so
this never double-touches them).

Not AST-based — plain regex over the raw source text, since Tailwind
classes only ever appear as whitespace-delimited tokens inside quoted
strings (className="...", or inside template-literal class strings),
so a token-boundary regex is sufficient and much simpler than parsing
JSX.

Two boundary rules matter, both enforced by compile_rule():
  - Right boundary (?![\\w/]): a light key must not match as a PREFIX of
    a longer/different class — bg-blue-50 must not match inside
    bg-blue-500, and bg-white must not match inside the intentionally
    theme-independent bg-white/20 (translucent overlay on a colored
    gradient, not page chrome).
  - Left boundary: a BARE rule (no variant prefix in its own key, e.g.
    "bg-slate-50") must not match when it's actually part of a
    hover:/disabled:/focus:/placeholder:-prefixed token in the source —
    those get their OWN dedicated rule with a correctly paired
    dark:hover:/dark:disabled:/etc. variant instead. Without this, e.g.
    "hover:bg-slate-50" would incorrectly gain an unconditional
    "dark:bg-slate-800" (always-on, not hover-only) IN ADDITION to the
    correct "dark:hover:bg-slate-700" from the dedicated hover rule.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "src"

EXCLUDE = {
    ROOT / "components" / "Sidebar.jsx",
}

BLOCKED_PREFIXES = ["hover:", "disabled:", "focus:", "placeholder:", "dark:"]

# (light class key exactly as it appears in source, dark class to append)
RULES = [
    # ---- neutral chrome: cards, panels, text, borders ----
    ("bg-white", "dark:bg-slate-800"),
    ("bg-slate-50", "dark:bg-slate-800"),
    ("bg-slate-100", "dark:bg-slate-700"),
    ("bg-slate-200", "dark:bg-slate-600"),
    ("text-slate-900", "dark:text-slate-50"),
    ("text-slate-800", "dark:text-slate-100"),
    ("text-slate-700", "dark:text-slate-200"),
    ("text-slate-600", "dark:text-slate-300"),
    ("text-slate-500", "dark:text-slate-400"),
    ("text-slate-400", "dark:text-slate-500"),
    ("text-slate-300", "dark:text-slate-600"),
    ("border-slate-300", "dark:border-slate-600"),
    ("border-slate-200", "dark:border-slate-700"),
    ("border-slate-100", "dark:border-slate-800"),
    ("border-slate-50", "dark:border-slate-800"),
    ("divide-slate-50", "dark:divide-slate-800"),
    ("divide-slate-100", "dark:divide-slate-800"),
    ("focus:ring-blue-500", "dark:focus:ring-blue-400"),
    ("focus:ring-amber-500", "dark:focus:ring-amber-400"),
    ("placeholder:text-slate-400", "dark:placeholder:text-slate-500"),
    # ---- hover states (dedicated — see module docstring) ----
    ("hover:bg-white", "dark:hover:bg-slate-700"),
    ("hover:bg-slate-50", "dark:hover:bg-slate-700"),
    ("hover:bg-slate-100", "dark:hover:bg-slate-700"),
    ("hover:bg-slate-200", "dark:hover:bg-slate-600"),
    ("hover:text-slate-600", "dark:hover:text-slate-300"),
    ("hover:text-slate-700", "dark:hover:text-slate-200"),
    ("hover:text-slate-800", "dark:hover:text-slate-100"),
    ("hover:text-slate-900", "dark:hover:text-slate-50"),
]

# Colored "-50/-100 bg + 400..900 text" badge/alert pattern — same
# treatment for every color family actually used in the app. Solid
# filled buttons (bg-{c}-600/700 + text-white) and disabled: states are
# deliberately NOT touched — they already read fine unchanged on a dark
# background (same reasoning as CoinBalanceBadge's white/NN overlays).
COLORS = ["blue", "rose", "emerald", "green", "amber", "indigo", "orange", "red", "yellow"]
for c in COLORS:
    RULES += [
        (f"bg-{c}-50", f"dark:bg-{c}-950"),
        (f"bg-{c}-100", f"dark:bg-{c}-900"),
        (f"border-{c}-100", f"dark:border-{c}-900"),
        (f"border-{c}-200", f"dark:border-{c}-800"),
        (f"text-{c}-400", f"dark:text-{c}-400"),
        (f"text-{c}-500", f"dark:text-{c}-400"),
        (f"text-{c}-600", f"dark:text-{c}-300"),
        (f"text-{c}-700", f"dark:text-{c}-300"),
        (f"text-{c}-800", f"dark:text-{c}-300"),
        (f"text-{c}-900", f"dark:text-{c}-300"),
        (f"hover:bg-{c}-50", f"dark:hover:bg-{c}-900"),
        (f"hover:text-{c}-600", f"dark:hover:text-{c}-300"),
        (f"hover:text-{c}-700", f"dark:hover:text-{c}-300"),
        (f"hover:text-{c}-800", f"dark:hover:text-{c}-300"),
    ]


def compile_rule(light: str):
    escaped = re.escape(light)
    is_bare = not any(light.startswith(p) for p in BLOCKED_PREFIXES)
    left = "".join(f"(?<!{re.escape(p)})" for p in BLOCKED_PREFIXES) if is_bare else ""
    return re.compile(left + escaped + r"(?![\w/])")


COMPILED_RULES = [(compile_rule(light), dark) for light, dark in RULES]


def process_file(path: Path) -> int:
    text = path.read_text(encoding="utf-8")
    total_added = 0

    for pattern, dark in COMPILED_RULES:
        pieces = []
        last_end = 0
        for m in pattern.finditer(text):
            start, end = m.span()
            if start < last_end:
                continue  # overlapped an earlier replacement in this same rule's pass
            following = text[end : end + len(dark) + 1]
            if following == " " + dark:
                continue  # already present (idempotent re-run)
            pieces.append(text[last_end:end])
            pieces.append(" " + dark)
            last_end = end
            total_added += 1
        pieces.append(text[last_end:])
        text = "".join(pieces)

    if total_added:
        path.write_text(text, encoding="utf-8")
    return total_added


def main():
    files = sorted(p for p in ROOT.rglob("*.jsx") if p not in EXCLUDE)
    grand_total = 0
    changed_files = 0
    for f in files:
        added = process_file(f)
        if added:
            grand_total += added
            changed_files += 1
            print(f"{f.relative_to(ROOT.parent)}: +{added}")
    print(f"\n{changed_files} files changed, {grand_total} dark: variants added.")


if __name__ == "__main__":
    main()
