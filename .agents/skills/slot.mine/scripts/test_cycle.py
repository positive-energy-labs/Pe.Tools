"""Small deterministic checks for the cycle report's pure decisions."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from cycle import backlog_counts, branch_rows, next_n, read_tip, row_counts, three_counts, wave_rows
from pulse import ESTIMATE, line_verdict
import re


class CycleTests(unittest.TestCase):
    def test_numbering_and_previous_tip(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            self.assertEqual(next_n(directory), 1)
            for name in ('1.md', '9.md', '10.md', 'notes.md'):
                (directory / name).write_text('Tip: `' + 'a' * 40 + '` (aaaaaaaa) subject\n', encoding='utf-8')
            self.assertEqual(next_n(directory), 11)
            self.assertEqual(read_tip(directory / '10.md'), 'a' * 40)
            (directory / '11.md').write_text('Previous tip: ' + 'b' * 40, encoding='utf-8')
            with self.assertRaises(ValueError):
                read_tip(directory / '11.md')

    def test_three_counts(self):
        branches = [dict(name=name, has_commits=commits, merged=merged, running=running)
                    for name, commits, merged, running in (
                        ('pp/checked', True, False, False), ('pp/writing', True, False, True),
                        ('pp/unknown', True, False, None), ('pp/landed', True, True, False),
                        ('pp/empty', False, False, False))]
        partners = [dict(role=role, behind=behind, running=running)
                    for role, behind, running in (
                        ('driver', 2, False), ('purger', 2, True),
                        ('integrator', 0, False), ('implementor', None, False))]
        self.assertEqual(three_counts(['pp/new', 'pp/writing', 'pp/new'], ['pp/writing'], branches, partners),
                         (['pp/new'], ['pp/checked', 'pp/unknown (thread unknown)'], ['driver']))
        self.assertEqual(three_counts([], [], [], []), ([], [], []))

    def test_run_directory_counts(self):
        backlog = '- [open] 1 driver abc x:1: seen\n- [fixing] 2 purger abc y:2: seen | cv/fix\n- [owed?] 3 integrator abc z: old\n- [OPEN] 4 driver abc w: seen\nprose [open]\n'
        self.assertEqual(backlog_counts(backlog), {'open': 2, 'fixing': 1, 'fixed': 0, 'owed?': 1, 'owed': 0})
        rows = '| row | stamp |\n|---|---|\n| a | PROVEN at abc |\n| b | UNPROVEN, was PROVEN |\nPROVEN in prose\n'
        self.assertEqual(row_counts(rows), {'PROVEN': 1, 'FALSIFIED': 0, 'UNPROVEN': 1})
        waves = wave_rows('Wave: 1 cv/a cv/b\n- Wave: 2 cv/c, cv/d\n', 'Merge cv/a: x\nMerge cv/b\nMerge cv/c-fix', ['cv/c'])
        self.assertEqual([(w['n'], w['merged'], w['started'], w['status']) for w in waves], [('1', 2, 2, 'UNKNOWN'), ('2', 0, 1, 'UNKNOWN')])

    def test_merged_hands_do_not_close_active_wave(self):
        text = 'Wave: 0 cv/a cv/b cv/c\nWave-Status: 0 ACTIVE\n'
        waves = wave_rows(text, 'Merge cv/a\nMerge cv/b\nMerge cv/c', [])
        self.assertEqual((waves[0]['merged'], waves[0]['total'], waves[0]['status']), (3, 3, 'ACTIVE'))

    def test_estimate_is_hours_and_lines(self):
        self.assertEqual(re.findall(ESTIMATE, 'Estimate: cv/a 2h\nEstimate: cv/b 0.5h 400L -\nEstimate: cv/c 1h 90L\n'),
                         [('cv/a', '2', '', ''), ('cv/b', '0.5', '400', '-'), ('cv/c', '1', '90', '')])
        self.assertIsNone(line_verdict(400, '-', 100, 300))
        self.assertEqual(line_verdict(400, '-', 700, 200), '2.2x its lines, AGAINST SIGN -')
        self.assertEqual(line_verdict(400, '0', 250, 150), 'AGAINST SIGN 0')
        self.assertIsNone(line_verdict(0, '', 9000, 0))

    def test_completed_run_uses_latest_prefix(self):
        with patch('cycle.git', side_effect=['pp/open\nold/open',
                                            'Merge pp/done\nMerge old/a\nMerge old/b']):
            rows = branch_rows('tip', 'tip', [])
        self.assertEqual([r['name'] for r in rows], ['pp/open'])


if __name__ == '__main__':
    unittest.main()
