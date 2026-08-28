"""The cross-language dash coupling, proved.

`visual-law.json` owns the semantic dashRole; `base.css` owns the only numeric pattern. Before
the 2026-08-28 ruling the law carried its own `dash: [6, 4]` while the web surface had moved to
`--dash-reference`, so the same zone boundary was drawn two ways. This test is the thing that
fails if that drift comes back.
"""

import importlib.util
import json
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ZONE_SCRIPT = HERE / "render-zone-promotion.py"
ROOT = HERE.parents[1]
LAW_PATH = ROOT / "source/pe-tools/apps/web/src/runs/visual-law.json"
BASE_CSS_PATH = ROOT / "source/pe-tools/apps/web/src/base.css"


def load_renderer():
    spec = importlib.util.spec_from_file_location("zone_renderer_dash", ZONE_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class DashRoleCoupling(unittest.TestCase):
    def setUp(self):
        self.renderer = load_renderer()
        self.law = json.loads(LAW_PATH.read_text(encoding="utf-8"))

    def test_law_names_a_role_and_never_a_pattern(self):
        stroke = self.law["zone"]["stroke"]
        self.assertIn("dashRole", stroke)
        self.assertNotIn("dash", stroke, "base.css owns the numeric pattern, not the visual law")
        self.assertIsInstance(stroke["dashRole"], str)

    def test_role_resolves_against_base_css(self):
        role = self.law["zone"]["stroke"]["dashRole"]
        pattern = self.renderer.dash_pattern(role)
        self.assertTrue(pattern)
        self.assertTrue(all(value >= 0 for value in pattern))
        # The value the renderer resolved is the value base.css declares — no local copy.
        declared = f"--dash-{role}:"
        css = BASE_CSS_PATH.read_text(encoding="utf-8")
        line = next(one for one in css.splitlines() if declared in one)
        expected = tuple(float(v) for v in line.split(":", 1)[1].strip().rstrip(";").split())
        self.assertEqual(pattern, expected)

    def test_zone_dash_is_the_resolved_role(self):
        role = self.law["zone"]["stroke"]["dashRole"]
        self.assertEqual(self.renderer.ZONE_DASH, self.renderer.dash_pattern(role))

    def test_unknown_role_fails_fast(self):
        with self.assertRaises(SystemExit):
            self.renderer.dash_pattern("no-such-role")


if __name__ == "__main__":
    unittest.main()
