"""Owned filesystem fixtures only: python tools/test_acceptance_teardown.py. No runtime contact."""

import os
import platform
import shutil
import sys
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path, PureWindowsPath
from unittest.mock import patch

import acceptance as a


class TeardownTests(unittest.TestCase):
    def setUp(self):
        self.container = Path(tempfile.mkdtemp(prefix="pe-accept-teardown-test-")).resolve()
        self.assertEqual(self.container.parent, Path(tempfile.gettempdir()).resolve())
        self.home = self.container / "Pe.Tools"
        self.home.mkdir()
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.addCleanup(self.clean_fixture)
        self.stack.enter_context(patch.dict(os.environ))
        os.environ.pop("PE_ACCEPT_KEEP_HOME", None)
        self.state = {"home": str(self.home), "lane": "dev", "sessions": [], "revitBefore": []}
        self.stack.enter_context(patch.object(a, "load", return_value=self.state))
        self.stack.enter_context(patch.object(a, "service", return_value=None))
        self.stack.enter_context(patch.object(a, "census"))
        self.stack.enter_context(patch.object(a, "processes", return_value=[]))
        self.stack.enter_context(patch.object(a, "revit_pids", return_value=[]))
        self.stack.enter_context(patch.object(a, "log"))
        for name in ("sdk", "http", "owner_files", "owner_home", "installed_identity"):
            self.stack.enter_context(patch.object(a, name, side_effect=AssertionError("runtime contact: " + name)))

    def clean_fixture(self):
        # Resolve and verify the one root allocated by this test before recursive cleanup.
        target = self.container.resolve()
        self.assertEqual(target, self.container)
        self.assertEqual(target.parent, Path(tempfile.gettempdir()).resolve())
        self.assertTrue(target.name.startswith("pe-accept-teardown-test-"))
        if target.exists():
            shutil.rmtree("\\\\?\\" + str(target) if os.name == "nt" else target)

    def test_short_path(self):
        (self.home / "sentinel").write_text("owned")
        a.teardown("fixture")
        self.assertFalse(self.container.exists())

    def test_resolves_before_removal(self):
        self.state["home"] = str(self.container / "unused" / ".." / "Pe.Tools")
        with patch.object(a.shutil, "rmtree", wraps=shutil.rmtree) as remove:
            a.teardown("fixture")
        target = remove.call_args.args[0]
        self.assertNotIn("..", Path(target).parts)
        self.assertTrue(Path(target).is_absolute())
        self.assertFalse(self.container.exists())

    @unittest.skipUnless(os.name == "nt", "Windows UNC spelling")
    def test_unc_extended_spelling(self):
        # Synthetic path contract only; no network share is contacted.
        temp = PureWindowsPath(r"\\server\share\temp")
        home = temp / "pe-accept-fixture" / "Pe.Tools"
        self.state["home"] = str(home)
        with patch.object(a, "Path") as paths, patch.object(a.shutil, "rmtree") as remove:
            paths.return_value.resolve.side_effect = [home, temp]
            a.teardown("fixture")
        remove.assert_called_once_with(r"\\?\UNC\server\share\temp\pe-accept-fixture")

    @unittest.skipUnless(os.name == "nt", "Windows long-path filesystem behavior")
    def test_long_recording_paths(self):
        history = (self.home / ".local-state/state/recordings" / ("a" * 64) / ("b" * 64)
                   / ("host-source-" + "c" * 64) / "history")
        paths = []
        for family in ("observations", "points", "read-sets"):
            leaf = history / family / ("d" * 64 + ".json")
            self.assertGreater(len(str(leaf)), 260)
            extended = Path("\\\\?\\" + str(leaf))
            extended.parent.mkdir(parents=True, exist_ok=True)
            extended.write_text("owned long path")
            self.assertEqual(extended.read_text(), "owned long path")
            paths.append(len(str(leaf)))
        print(f"real recording paths: {paths} characters", flush=True)
        a.teardown("fixture")
        self.assertFalse(self.container.exists())

    def test_refused_homes(self):
        cases = {
            "installed": (self.home, "installed", False),
            "keep-home": (self.home, "dev", True),
            "arbitrary-home": (self.container / "arbitrary", "dev", False),
            "not-owned-container": (self.container / "other" / "Pe.Tools", "dev", False),
            "outside-system-temp-parent": (self.container / "nested" / "pe-accept-outside" / "Pe.Tools", "dev", False),
        }
        for label, (home, lane, keep) in cases.items():
            with self.subTest(label=label):
                home.mkdir(parents=True, exist_ok=True)
                sentinel = home / "sentinel"
                sentinel.write_text(label)
                self.state.update(home=str(home), lane=lane)
                os.environ["PE_ACCEPT_KEEP_HOME"] = "1" if keep else "0"
                with patch.object(a.shutil, "rmtree", side_effect=AssertionError("refused home removed")):
                    a.teardown("fixture")
                self.assertEqual(sentinel.read_text(), label)

    def test_non_owned_container_at_exact_temp_parent(self):
        home = self.container / "not-owned" / "Pe.Tools"
        home.mkdir(parents=True)
        sentinel = home / "sentinel"
        sentinel.write_text("not owned")
        self.state["home"] = str(home)
        with patch.object(a.tempfile, "gettempdir", return_value=str(self.container)):
            with patch.object(a.shutil, "rmtree", side_effect=AssertionError("unowned container removed")):
                a.teardown("fixture")
        self.assertEqual(sentinel.read_text(), "not owned")

    @unittest.skipUnless(os.name == "nt", "Windows directory junction behavior")
    def test_junction_preserves_external_sentinel(self):
        import _winapi

        # The external target is outside the deletion container but still inside our own fixture.
        external = self.container / "external"
        external.mkdir()
        sentinel = external / "sentinel"
        sentinel.write_text("external survives")
        owned = self.container / "pe-accept-junction"
        home = owned / "Pe.Tools"
        home.mkdir(parents=True)
        junction = home / "external-junction"
        _winapi.CreateJunction(str(external), str(junction))
        self.assertTrue(junction.is_junction())
        self.assertEqual((junction / "sentinel").read_text(), "external survives")
        self.state["home"] = str(home)
        # Simulate a system-temp root within our fixture so the exact-parent guard still runs.
        with patch.object(a.tempfile, "gettempdir", return_value=str(self.container)):
            self.assertEqual(owned.resolve().parent, Path(tempfile.gettempdir()).resolve())
            a.teardown("fixture")
        self.assertFalse(owned.exists())
        self.assertEqual(sentinel.read_text(), "external survives")


if __name__ == "__main__":
    print(f"{platform.platform()}; Python {sys.version}", flush=True)
    unittest.main(verbosity=2)
