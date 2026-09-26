"""Fill a kit template's data block from a JSON file, so a page is regenerated from real artifacts, never hand-typed.

usage: python build.py <template.html> <data.json> <out.html>

- Shape check, fail fast: the JSON must carry every top-level key the template's fixture carries, and every list item must
  carry the keys that every fixture item of that list carries.
- Provenance: meta.source defaults to the JSON path and meta.builtAt is stamped. meta.standIn defaults to false; set it true
  (with meta.replaces) yourself when any part is invented. The page draws the two differently.
- Any "href" or "img" string naming a local image file (relative to the JSON) is inlined as a data: URI, so out.html stays one file.
Write the JSON with a small extractor beside the real artifacts; `.artifacts/poc-feedback/src/build.py` is the worked example.
"""
import base64, datetime, json, mimetypes, os, re, sys

BLOCK = re.compile(r'(<script type="application/json" id="data">)(.*?)(</script>)', re.S)


def die(msg):
    sys.exit("build.py: " + msg)


def shape(fix, data, where="data"):
    if isinstance(fix, dict):
        if not isinstance(data, dict):
            die(f"{where} should be an object like the fixture's")
        for key in fix:
            if key == "meta":
                continue
            if key not in data:
                die(f"{where} lacks '{key}' (the template reads it; see the fixture block in the template)")
            shape(fix[key], data[key], f"{where}.{key}")
    elif isinstance(fix, list) and fix and all(isinstance(x, dict) for x in fix):
        if not isinstance(data, list):
            die(f"{where} should be a list")
        need = set.intersection(*(set(x) for x in fix))
        for i, item in enumerate(data):
            miss = need - set(item) if isinstance(item, dict) else need
            if miss:
                die(f"{where}[{i}] lacks {sorted(miss)}")


def inline(node, base):
    if isinstance(node, dict):
        for key, v in node.items():
            if key in ("href", "img") and isinstance(v, str) and not re.match(r"^(data:|https?:)", v):
                path = os.path.join(base, v)
                if not os.path.isfile(path):
                    die(f"image '{v}' not found beside the JSON ({path})")
                mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
                node[key] = f"data:{mime};base64," + base64.b64encode(open(path, "rb").read()).decode()
            else:
                inline(v, base)
    elif isinstance(node, list):
        for v in node:
            inline(v, base)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) != 4:
        die("usage: python build.py <template.html> <data.json> <out.html>")
    tpl, src, out = sys.argv[1:]
    page = open(tpl, encoding="utf-8").read()
    blocks = BLOCK.findall(page)
    if len(blocks) != 1:
        die(f"{tpl} has {len(blocks)} data blocks; a kit template has exactly one")
    data = json.load(open(src, encoding="utf-8-sig"))
    shape(json.loads(blocks[0][1]), data)
    meta = data.setdefault("meta", {})
    meta.setdefault("standIn", False)
    meta.setdefault("source", os.path.relpath(src, os.path.dirname(os.path.abspath(out))).replace("\\", "/"))
    meta["builtAt"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    inline(data, os.path.dirname(os.path.abspath(src)))
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")   # no </script> can close the block early
    page = BLOCK.sub(lambda m: m.group(1) + "\n" + text + "\n" + m.group(3), page, count=1)
    open(out, "w", encoding="utf-8").write(page)
    print(f"wrote {out} · {len(page) // 1024} KB · {'stand-in' if meta['standIn'] else 'real'} data from {meta['source']}")


if __name__ == "__main__":
    main()
