"""Help must never inspect, admit or stop work; run arguments stay literal."""
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import machine


class HelpTests(unittest.TestCase):
    def test_help_has_no_machine_actions(self):
        for args in (["--help"], ["-h"], ["admit", "--help"], ["prune", "--help"],
                     ["who", "--json", "--help"], ["stop", "--help"]):
            with self.subTest(args=args), patch.object(sys, "argv", ["machine.py", *args]), \
                    patch("builtins.print") as output:
                with patch.multiple(machine, **{name: Mock(side_effect=AssertionError(name))
                                              for name in ("safe_admit", "who", "stop", "prune", "processes")}):
                    self.assertEqual(machine.main(), 0)
                output.assert_called_once_with(machine.__doc__)

    def test_run_forwards_child_help(self):
        run = Mock(return_value=23)
        args = ["codegen", "--", "owned-command", "--help"]
        with patch.object(sys, "argv", ["machine.py", "run", *args]), \
                patch.dict(sys.modules, {"reservation": types.SimpleNamespace(run=run)}):
            self.assertEqual(machine.main(), 23)
        run.assert_called_once_with(args)


if __name__ == "__main__":
    unittest.main()
