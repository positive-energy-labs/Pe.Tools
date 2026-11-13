"""Deterministic setup boundary tests. No discovery, copies or native processes may escape."""
import json
import ctypes
import subprocess
import sys
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import acceptance as a


class Acquisition(Exception):
    pass


def trapped(*args, **kwargs):
    print("ACQUISITION", file=sys.stderr)
    raise Acquisition()


def barriers(stack):
    for name in ("owner_home", "main_checkout", "installed_identity", "pick_models", "owner_files",
                 "copy_hashed", "sdk", "dev_session", "setup_installed", "adopt_host", "processes", "revit_pids"):
        stack.enter_context(patch.object(a, name, side_effect=trapped))
    stack.enter_context(patch.object(a.subprocess, "Popen", side_effect=trapped))
    stack.enter_context(patch.object(a.shutil, "copytree", side_effect=trapped))
    stack.enter_context(patch.object(a.shutil, "copy2", side_effect=trapped))


def machine_result(code=3, output=None):
    return subprocess.CompletedProcess([], code, output or json.dumps({"verdict": "HOLD", "kind": "revit-drive"}), "")


class AdmissionTests(unittest.TestCase):
    def test_denials_precede_every_acquisition(self):
        readings = [machine_result(), machine_result(0), machine_result(4, '{"verdict":"REFUSE"}'),
                    machine_result(0, '{"verdict":"REFUSE","kind":"revit-drive"}'),
                    machine_result(0, ' '), machine_result(0, 'broken'), machine_result(0, 'null'),
                    machine_result(0, '{}'), machine_result(0, '[]'),
                    machine_result(0, '{"verdict":"ADMIT"}'),
                    machine_result(0, '{"verdict":"ADMIT","kind":"browser"}'),
                    machine_result(1, '{"verdict":"ADMIT","kind":"revit-drive"}'),
                    machine_result(0, '{"verdict":"ADMIT","kind":"revit-drive","error":"bad"}'),
                    OSError("missing interpreter"), subprocess.TimeoutExpired("machine", 8)]
        for args in ([], ["--web"], ["--installed"]):
            for reading in readings:
                with self.subTest(args=args, reading=reading), ExitStack() as stack:
                    barriers(stack)
                    command = stack.enter_context(patch.object(a.subprocess, "run",
                        **({"side_effect": reading} if isinstance(reading, Exception) else {"return_value": reading})))
                    with self.assertRaises(SystemExit):
                        a.setup("guard", args)
                    self.assertEqual(command.call_count, 1)
                    self.assertEqual(command.call_args.args[0], [sys.executable,
                        str(a.CHECKOUT / ".agents/skills/slot.execute/machine.py"), "admit", "revit-drive", "--json"])

    def test_admit_zero_reaches_setup(self):
        for args in ([], ["--web"], ["--installed"]):
            with self.subTest(args=args), ExitStack() as stack:
                barriers(stack)
                stack.enter_context(patch.object(a.subprocess, "run", return_value=machine_result(
                    0, '{"verdict":"ADMIT","kind":"revit-drive"}')))
                with self.assertRaises(Acquisition):
                    a.setup("guard", args)

    def test_resume_is_also_gated(self):
        with tempfile.TemporaryDirectory() as directory, ExitStack() as stack:
            root = Path(directory)
            (root / "run.json").write_text(json.dumps({"host": {"launcher": 123}, "sessions": []}))
            barriers(stack)
            stack.enter_context(patch.object(a, "run_dir", return_value=root))
            owner = stack.enter_context(patch.object(a, "owner_home", return_value=root))
            command = stack.enter_context(patch.object(a.subprocess, "run", return_value=machine_result()))
            with self.assertRaises(SystemExit):
                a.setup("resume", [])
            owner.assert_not_called()
            command.return_value = machine_result(0, '{"verdict":"ADMIT","kind":"revit-drive"}')
            stack.enter_context(patch.object(a, "log"))
            adopt = stack.enter_context(patch.object(a, "adopt_host"))
            session = stack.enter_context(patch.object(a, "dev_session"))
            a.setup("resume", [])
            adopt.assert_called_once()
            session.assert_called_once()

    def test_help_bypasses_admission_and_sdk_help_is_forwarded(self):
        with ExitStack() as stack:
            barriers(stack)
            command = stack.enter_context(patch.object(a.subprocess, "run", side_effect=trapped))
            stack.enter_context(patch("builtins.print"))
            for args in (["--help"], ["setup", "--help"], ["setup", "-h"]):
                a.main(args)
            sdk = stack.enter_context(patch.object(a, "sdk"))
            a.main(["sdk", "guard", "guide", "session", "--help"])
            sdk.assert_called_once_with("guard", "guide", ["session", "--help"])
            command.assert_not_called()

    def test_outer_shell_pipeline_cannot_bypass_internal_hold(self):
        script = str(Path(__file__).resolve()).replace("'", "''")
        python = sys.executable.replace("'", "''")
        result = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command",
            f"& '{python}' '{script}' --hold-probe | Select-Object -First 1; exit 0"],
            capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0)  # shell exit status deliberately hides the setup refusal
        self.assertIn("HOLD", result.stderr)
        self.assertNotIn("ACQUISITION", result.stdout + result.stderr)

    @unittest.skipUnless(sys.platform == "win32", "Windows admission process tree")
    def test_timeout_reaps_real_discovery_child(self):
        # Run the real diagnostic; only its CIM argv and physical-memory reading are fixtures.
        import time
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            machine = root / ".agents/skills/slot.execute/machine.py"
            machine.parent.mkdir(parents=True)
            pidfile = root / "child.pid"
            source = a.CHECKOUT / ".agents/skills/slot.execute/machine.py"
            child = "import os,time,pathlib; pathlib.Path(" + repr(str(pidfile)) + ").write_text(str(os.getpid())); time.sleep(30)"
            machine.write_text(
                "import sys,subprocess,importlib.util\n"
                f"sys.path.insert(0,{str(source.parent)!r})\n"
                f"spec=importlib.util.spec_from_file_location('exact_machine',{str(source)!r})\n"
                "m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\n"
                "real_run=subprocess.run\n"
                "def discovery(argv,*args,**kwargs):\n"
                " assert argv[0]=='powershell',argv\n"
                f" return real_run([sys.executable,'-c',{child!r}],*args,**kwargs)\n"
                "m.subprocess.run=discovery\nm.free_gib=lambda:(30,64)\nsys.exit(m.main())\n",
                encoding="utf8",
            )
            driver = root / "driver.py"
            driver.write_text(
                f"import sys,pathlib\nsys.path.insert(0,{str(Path(a.__file__).parent)!r})\n"
                f"import acceptance as a\na.CHECKOUT=pathlib.Path({str(root)!r})\n"
                "a.owner_home=lambda: (_ for _ in ()).throw(AssertionError('ACQUISITION'))\n"
                "a.setup('timeout',[])\n", encoding="utf8",
            )
            k = ctypes.WinDLL("kernel32", use_last_error=True)
            k.OpenProcess.argtypes = [ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
            k.OpenProcess.restype = ctypes.c_void_p
            k.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
            k.TerminateProcess.argtypes = [ctypes.c_void_p, ctypes.c_uint]
            k.CloseHandle.argtypes = [ctypes.c_void_p]
            process = subprocess.Popen([sys.executable, str(driver)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            handle = None
            try:
                deadline = time.monotonic() + 5
                while not pidfile.exists() and process.poll() is None and time.monotonic() < deadline:
                    time.sleep(.02)
                self.assertTrue(pidfile.exists(), "diagnostic must actually spawn its discovery child")
                handle = k.OpenProcess(0x100000 | 1, False, int(pidfile.read_text()))
                self.assertTrue(handle)
                stdout, stderr = process.communicate(timeout=12)
                self.assertNotEqual(process.returncode, 0)
                self.assertIn("HOLD", stderr)
                self.assertNotIn("ACQUISITION", stdout + stderr)
                self.assertEqual(k.WaitForSingleObject(handle, 2000), 0, "discovery child survived refusal")
            finally:
                if process.poll() is None:
                    process.kill()
                    process.communicate(timeout=5)
                if handle:
                    if k.WaitForSingleObject(handle, 0) != 0:
                        k.TerminateProcess(handle, 1)
                        k.WaitForSingleObject(handle, 5000)
                    k.CloseHandle(handle)


if __name__ == "__main__":
    if "--hold-probe" in sys.argv:
        with ExitStack() as stack:
            barriers(stack)
            stack.enter_context(patch.object(a.subprocess, "run", return_value=machine_result()))
            a.main(["setup", "guard"])
    else:
        unittest.main(verbosity=2)
