import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
TOOL = Path(__file__).resolve().parents[1] / "journal_profile.py"
spec = importlib.util.spec_from_file_location("journal_profile", TOOL)
jp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(jp)
FIXTURE = Path(__file__).parent / "fixtures/basement-journal.txt"


class JournalProfileTests(unittest.TestCase):
    def parse_text(self, text, **kwargs):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "journal.txt"
            path.write_text(text, encoding="utf-8")
            return jp.parse_journal(path, **kwargs)

    def test_actual_retained_basement_records(self):
        result = jp.parse_journal(FIXTURE)
        self.assertEqual(result["status"], "completed")
        opening, = result["openings"]
        self.assertEqual(opening["targetViewId"], 1444670)
        for key, value in {"createNewCViewReportedSeconds": 7.594, "drawingReportedSeconds": 12.604445,
                           "browserToFirstJournalIdleSeconds": 21.065}.items():
            self.assertAlmostEqual(opening["metrics"][key], value)
        drawing, = [r for r in opening["records"] if r["kind"] == "drawing-total"]
        self.assertIsNone(drawing["timestampLocal"])
        self.assertEqual(drawing["precedingTimestampLocal"], "2026-10-24T03:00:02.678")
        self.assertEqual(drawing["followingTimestampLocal"], "2026-10-24T03:00:03.735")
        self.assertEqual(drawing["line"] + 17424, 17572)
        self.assertIsNone(opening["metrics"]["pixelCompletionSeconds"])

    def test_multiple_targets_null_all_attributed_metrics(self):
        text = FIXTURE.read_text().replace("DBViewPlan id=1444670:", "DBViewPlan id=999:\n' DBViewPlan id=1444670:")
        opening, = self.parse_text(text)["openings"]
        self.assertIsNone(opening["targetViewId"])
        self.assertTrue(all(v is None for k, v in opening["metrics"].items() if k != "durationsAdditive"))
        self.assertEqual(len([r for r in opening["records"] if r["kind"] == "target-id"]), 2)

    def test_next_command_prevents_later_idle_or_target_attachment(self):
        text = FIXTURE.read_text().replace("' 0:< ;PERF;MISC;ElementsGraphicCacheUpdater", 'Jrn.Command "later"\n\' 0:< ;PERF;MISC;ElementsGraphicCacheUpdater')
        opening, = self.parse_text(text)["openings"]
        self.assertIsNone(opening["metrics"]["browserToFirstJournalIdleSeconds"])
        self.assertIsNone(opening["metrics"]["drawingReportedSeconds"])
        self.assertIsNone(opening["targetViewId"])

    def test_missing_and_duplicate_view_open_are_null(self):
        text = FIXTURE.read_text()
        for altered in (text.replace("[Jrn.ViewOpen]", "[Other]"), text.replace("[Jrn.ViewOpen]", "[Jrn.ViewOpen]\n' [Jrn.ViewOpen]")):
            opening, = self.parse_text(altered)["openings"]
            self.assertIsNone(opening["metrics"]["createNewCViewReportedSeconds"])
            self.assertIsNone(opening["metrics"]["browserToFirstJournalIdleSeconds"])

    def test_wrong_activation_title_is_not_attributed(self):
        text = FIXTURE.read_text().replace("ViewTitleExpression: Floor Plan: 00 Mechanical Plan - Basement/Crawlspace", "ViewTitleExpression: Floor Plan: Other")
        opening, = self.parse_text(text)["openings"]
        self.assertIsNone(opening["metrics"]["createNewCViewReportedSeconds"])

    def test_url_redaction_header_and_input_limits(self):
        text = "' Build: 20260629_1515(x64)\n' Release: 2025.4.6\n" + FIXTURE.read_text().replace("Drawing thread could", "https://example.invalid/private?token=secret Drawing thread could")
        result = self.parse_text(text)
        self.assertEqual(result["source"]["releaseHeader"]["value"], "2025.4.6")
        self.assertNotIn("https://", json.dumps(result))
        self.assertNotIn("token=secret", json.dumps(result))
        partial = self.parse_text(text, max_bytes=800)
        self.assertEqual(partial["status"], "partial")
        if partial["openings"]:
            self.assertIsNone(partial["openings"][0]["metrics"]["createNewCViewReportedSeconds"])

    def test_cli_refuses_overwrite_and_missing_file_has_diagnostics(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "out.json"
            command = [sys.executable, str(TOOL), str(FIXTURE), str(output)]
            self.assertEqual(subprocess.run(command, capture_output=True).returncode, 0)
            before = output.read_bytes()
            self.assertEqual(subprocess.run(command, capture_output=True).returncode, 2)
            self.assertEqual(before, output.read_bytes())
            missing = jp.parse_journal(Path(folder) / "absent")
            self.assertEqual(missing["status"], "partial")
            self.assertTrue(missing["diagnostics"])


if __name__ == "__main__":
    unittest.main()
