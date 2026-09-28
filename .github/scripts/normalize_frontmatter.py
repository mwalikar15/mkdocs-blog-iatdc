"""
normalize_frontmatter.py
========================
Run by GitHub Actions after Decap CMS commits a new/edited post.

Decap CMS stores flat fields (date_created, hide_navigation, hide_toc, title)
but MkDocs Material blog plugin expects nested YAML:

    date:
      created: 2026-06-18
    hide:
      - navigation
      - toc

This script converts the flat CMS output into the correct MkDocs format.
"""

import os
import re
import yaml

POSTS_DIR = "docs/posts"


def normalize(path: str) -> bool:
    """Read a markdown file, normalize its frontmatter, and write it back.

    Returns True if the file was modified, False otherwise.
    """
    with open(path, encoding="utf-8") as f:
        content = f.read()

    # Match the YAML frontmatter block (--- ... ---)
    match = re.match(r"^---\n(.*?)\n---\n(.*)", content, re.DOTALL)
    if not match:
        print(f"  [skip] No frontmatter found: {path}")
        return False

    fm_raw, body = match.group(1), match.group(2)
    fm = yaml.safe_load(fm_raw)

    modified = False

    # ── 1. Normalize date ──────────────────────────────────────────────
    if "date_created" in fm and "date" not in fm:
        fm["date"] = {"created": str(fm.pop("date_created"))}
        modified = True
    elif "date_created" in fm:
        fm.pop("date_created")  # Already have nested date, just remove flat key
        modified = True

    # ── 2. Normalize hide flags ────────────────────────────────────────
    hide = []
    if fm.pop("hide_navigation", None):
        hide.append("navigation")
    if fm.pop("hide_toc", None):
        hide.append("toc")

    if hide:
        fm["hide"] = hide
        modified = True
    elif "hide_navigation" in fm or "hide_toc" in fm:
        modified = True  # Keys were removed even if False

    # ── 3. Remove 'title' field (MkDocs uses H1 from body) ────────────
    if "title" in fm:
        fm.pop("title")
        modified = True

    if not modified:
        print(f"  [ok] Already normalized: {os.path.basename(path)}")
        return False

    # Write normalized frontmatter back
    new_fm = yaml.dump(fm, default_flow_style=False, allow_unicode=True, sort_keys=False)
    new_content = f"---\n{new_fm}---\n{body}"

    with open(path, "w", encoding="utf-8") as f:
        f.write(new_content)

    print(f"  [fixed] {os.path.basename(path)}")
    return True


def main():
    if not os.path.isdir(POSTS_DIR):
        print(f"Posts directory not found: {POSTS_DIR}")
        return

    changed = 0
    for fname in sorted(os.listdir(POSTS_DIR)):
        if fname.endswith(".md"):
            if normalize(os.path.join(POSTS_DIR, fname)):
                changed += 1

    print(f"\nNormalization complete. {changed} file(s) updated.")


if __name__ == "__main__":
    main()
