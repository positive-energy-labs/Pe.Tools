"""Small deterministic checks for the cycle report's pure decisions."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from cycle import branch_rows, next_n, read_tip, three_counts


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
                        ('integrator', 0, False), ('lead', None, False))]
        self.assertEqual(three_counts(['pp/new', 'pp/writing', 'pp/new'], ['pp/writing'], branches, partners),
                         (['pp/new'], ['pp/checked', 'pp/unknown (thread unknown)'], ['driver']))
        self.assertEqual(three_counts([], [], [], []), ([], [], []))

    def test_completed_run_uses_latest_prefix(self):
        with patch('cycle.git', side_effect=['pp/open\nold/open',
                                            'Merge pp/done\nMerge old/a\nMerge old/b']):
            rows = branch_rows('tip', 'tip', [])
        self.assertEqual([r['name'] for r in rows], ['pp/open'])


if __name__ == '__main__':
    unittest.main()
