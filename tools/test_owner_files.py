"""Pure metadata checks: python tools/test_owner_files.py. No SDK or native session commands."""

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import acceptance


class OwnerFilesTests(unittest.TestCase):
    def test_metadata_order_missing_and_duplicate_roots(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "nested").mkdir()
            for i in range(145):
                (root / f"file-{i}").write_bytes(bytes(i % 20))
            (root / "nested" / "child").write_bytes(b"child")
            roots = [tmp, str(root / "missing"), tmp]
            expected = {}
            for top in roots:
                for directory, _, names in os.walk(top):
                    for name in names:
                        path = os.path.join(directory, name)
                        stat = os.stat(path)
                        expected[path] = [stat.st_size, stat.st_mtime_ns]
            self.assertEqual(list(acceptance.owner_files(roots).items()), list(expected.items()))

    def test_fresh_metadata_after_enumeration(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            changed, deleted, refused = [root / name for name in ("changed", "deleted", "refused")]
            for path in (changed, deleted, refused):
                path.write_bytes(b"before")
            original_walk, original_stat = os.walk, os.stat

            def walk(*args, **kwargs):
                for row in original_walk(*args, **kwargs):
                    changed.write_bytes(b"after-is-longer")
                    deleted.unlink()
                    yield row

            def stat(path, *args, **kwargs):
                if str(path) == str(refused):
                    raise PermissionError("fixture per-file refusal")
                return original_stat(path, *args, **kwargs)

            with patch.object(acceptance.os, "walk", walk), patch.object(acceptance.os, "stat", stat):
                actual = acceptance.owner_files([tmp])
            expected = original_stat(changed)
            self.assertEqual(actual, {str(changed): [expected.st_size, expected.st_mtime_ns]})


if __name__ == "__main__":
    unittest.main()
