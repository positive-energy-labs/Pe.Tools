"""The cross-language dash coupling, proved.

`visual-law.json` owns the semantic dashRole; `base.css` owns the only numeric pattern. Before
the 2026-08-28 ruling the law carried its own `dash: [6, 4]` while the web surface had moved to
`--dash-reference`, so the same zone boundary was drawn two ways. This test is the thing that
fails if that drift comes back.
"""

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

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

    def write_css(self, declaration):
        handle = tempfile.NamedTemporaryFile("w", suffix=".css", delete=False, encoding="utf-8")
        handle.write(f":root {{\n  {declaration}\n}}\n")
        handle.close()
        self.addCleanup(Path(handle.name).unlink)
        return Path(handle.name)

    def test_non_positive_pattern_fails_fast(self):
        # A zero-length segment leaves the dash walker unable to advance — reject it at the
        # resolver rather than hang the render.
        for declaration in ("--dash-probe: 0 0;", "--dash-probe: 4 0;", "--dash-probe: -2 3;"):
            with self.subTest(declaration=declaration):
                with self.assertRaises(SystemExit):
                    self.renderer.dash_pattern("probe", self.write_css(declaration))

    def test_non_numeric_pattern_fails_fast(self):
        with self.assertRaises(SystemExit):
            self.renderer.dash_pattern("probe", self.write_css("--dash-probe: solid;"))

    def test_four_value_reference_renders_broken(self):
        """The whole point of the role: `reference` is on-off-on-off, and the old two-value
        walker raised on it. It must draw, and it must not draw solid."""
        pattern = self.renderer.dash_pattern("reference")
        self.assertEqual(len(pattern), 4)

        # A real zone loop, not a two-point path: `_draw_dashed` closes the polygon, so a
        # there-and-back segment retraces itself and the return leg fills the forward leg's gaps.
        # Sample the top edge away from the corners the other two edges reach.
        image = Image.new("RGB", (64, 40), (255, 255, 255))
        self.renderer._draw_dashed(
            ImageDraw.Draw(image), [(0, 1), (63, 1), (32, 38)], (0, 0, 0), 1, pattern)
        row = [image.getpixel((x, 1)) for x in range(4, 60)]
        inked = sum(1 for pixel in row if pixel == (0, 0, 0))
        self.assertGreater(inked, 0, "the reference role drew nothing")
        self.assertLess(inked, len(row), "the reference role drew a solid line")


if __name__ == "__main__":
    unittest.main()
