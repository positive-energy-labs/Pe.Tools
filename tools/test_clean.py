import os, stat, tempfile, unittest
from pathlib import Path

import clean


class CleanTests(unittest.TestCase):
    def test_removes_inside_a_root_and_refuses_outside(self):
        base = Path(tempfile.mkdtemp(prefix='clean-test-'))
        deep = base / 'ts' / 'node_modules' / 'pkg'
        deep.mkdir(parents=True)
        locked = deep / 'pack.idx'
        locked.write_text('x')
        os.chmod(locked, stat.S_IREAD)
        allowed = clean.roots()
        self.assertTrue(clean.clean(str(base), allowed)['removed'])
        self.assertFalse(base.exists())
        self.assertEqual(clean.clean(tempfile.gettempdir(), allowed)['refused'], 'an allowed root itself')
        self.assertEqual(clean.clean(str(clean.CHECKOUT), allowed)['refused'], 'a checkout itself')
        self.assertEqual(clean.clean(str(Path.home() / 'Documents'), allowed)['refused'], 'outside every allowed root')


if __name__ == '__main__':
    unittest.main()
