import unittest

from cadence import parse_cycle, voids, wave_bands
from cycle import row_kinds

REPORT = '''# Cycle 7

UTC: 2026-11-17 10:16:00 UTC
Tip: `7ba39d97aaaa` (7ba39d97) Merge x

## Rows

PROVEN 8, FALSIFIED 0, UNPROVEN 24
- journey rows: PROVEN 1, FALSIFIED 0, UNPROVEN 5
- test rows: PROVEN 7, FALSIFIED 0, UNPROVEN 19

## Backlog

open 7, fixing 0, fixed 5, owed? 1, owed 5
'''


class CadenceTests(unittest.TestCase):
    def test_parse_cycle_reads_totals_and_kinds(self):
        c = parse_cycle(REPORT)
        self.assertEqual((c['n'], c['t'], c['tip']), (7, '2026-11-17T10:16', '7ba39d97'))
        self.assertEqual(c['total'], {'PROVEN': 8, 'FALSIFIED': 0, 'UNPROVEN': 24})
        self.assertEqual(c['kinds']['test']['PROVEN'], 7)

    def test_a_drop_of_three_is_a_void(self):
        cycles = [dict(t=str(i), total=dict(PROVEN=p)) for i, p in enumerate([7, 0, 9, 8, 15, 8, 2])]
        self.assertEqual([(v['t'], v['drop']) for v in voids(cycles)], [('1', 7), ('5', 7), ('6', 6)])

    def test_wave_bands_span_named_merges(self):
        merges = [('2026-11-16T21:10', 'Merge crusade/fans-P1-a'), ('2026-11-16T21:19', 'Merge crusade/fans-P1-b'),
                  ('2026-11-16T22:21', 'Merge crusade/fans-P2-c including P2-d'), ('2026-11-16T23:00', 'Merge crusade/fans-P1-a-fix')]
        bands = wave_bands('Wave: 1 P1-a P1-b   blockers: none\nWave: 2 P2-d\n', merges)
        self.assertEqual(bands, [('1', '2026-11-16T21:10', '2026-11-16T21:19'), ('2', '2026-11-16T22:21', '2026-11-16T22:21')])

    def test_row_kinds_follow_headings(self):
        table = '## Test rows\n| a | PROVEN[x] |\n| b | UNPROVEN[y] |\n## Journey rows\n| J | FALSIFIED[z] |\n## Notes\n| n | PROVEN |\n'
        kinds = row_kinds(table)
        self.assertEqual((kinds['test']['PROVEN'], kinds['test']['UNPROVEN'], kinds['journey']['FALSIFIED']), (1, 1, 1))
        self.assertEqual(row_kinds('| a | PROVEN |'), {})


if __name__ == '__main__':
    unittest.main()
