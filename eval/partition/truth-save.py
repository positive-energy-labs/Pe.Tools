"""Save capture-truth.cs output as one truth file per view.

    python eval/partition/truth-save.py <pea output json> <project> [<fixture root>]

Finds the {"views": [...]} object anywhere in the pea envelope and writes
<root>/<project>/truth/<level>.json for each view. Root defaults to PE_PRIVATE_FIXTURES or .private/fixtures.
"""
import json
import os
import sys
from pathlib import Path


def find_views(node):
    if isinstance(node, dict):
        if isinstance(node.get("views"), list):
            return node["views"]
        for v in node.values():
            found = find_views(v)
            if found is not None:
                return found
    if isinstance(node, list):
        for v in node:
            found = find_views(v)
            if found is not None:
                return found
    return None


def main(raw, project, root=None):
    root = Path(root or os.environ.get("PE_PRIVATE_FIXTURES") or Path(__file__).resolve().parents[2] / ".private" / "fixtures")
    views = find_views(json.loads(Path(raw).read_text(encoding="utf-8-sig")))
    if not views:
        raise SystemExit("no views in the capture; is a plan view named 'Rooms Truth - <level>' with regions on it?")
    for view in views:
        out = root / project / "truth" / f"{view['level']}.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(view, indent=1))
        print(out, len(view["rooms"]), "rooms")


if __name__ == "__main__":
    main(*sys.argv[1:])
