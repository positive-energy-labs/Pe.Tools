"""Plain-assert checks for the setup logic in acceptance.py: python tools/test_acceptance.py. No Revit, no host."""

import hashlib, json, os, shutil, subprocess, sys, tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import acceptance as a


def test_help(tmp: Path) -> None:
    script = Path(a.__file__).resolve()
    for args in (["--help"], ["-h"], ["setup", "--help"], ["setup", "-h"]):
        result = subprocess.run([sys.executable, str(script), *args], cwd=tmp,
                                capture_output=True, text=True, timeout=5)
        assert result.returncode == 0 and "Native acceptance harness" in result.stdout, result
    prior, calls = a.sdk, []
    try:
        a.sdk = lambda *args: calls.append(args)
        a.main(["sdk", "run", "guide", "session", "--help"])
        assert calls == [("run", "guide", ["session", "--help"])], calls
    finally:
        a.sdk = prior


def touch(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("x")


def test_pod_build_skip(tmp: Path) -> None:
    pods = tmp / "Pods"
    for rel in ("default/src/a.cs", "default/output/big.dll", "default/obj/o.txt", "default/src/bin/b.dll",
                "default/src/output/keep.txt", "other/Pod.json"):
        touch(pods / rel)
    shutil.copytree(pods, tmp / "copy", ignore=a.pod_build_skip(pods))
    kept = sorted(p.relative_to(tmp / "copy").as_posix() for p in (tmp / "copy").rglob("*") if p.is_file())
    # output is skipped only directly under a pod; a nested output folder is source and stays.
    assert kept == ["default/src/a.cs", "default/src/output/keep.txt", "other/Pod.json"], kept


def test_pick_models(tmp: Path) -> None:
    fixture = tmp / "fixture.rvt"
    assert a.pick_models(["--model", "x.rvt=B.rvt"], fixture) == [["x.rvt", "B.rvt"]]  # flag wins, no disk look
    try:
        a.pick_models([], fixture)
        raise AssertionError("expected refusal")
    except SystemExit as e:
        assert "--model" in str(e) and str(fixture) in str(e) and "\n" not in str(e), e
    touch(fixture)
    assert a.pick_models([], fixture) == [[str(fixture), "A.rvt"]]


def test_copy_hashed(tmp: Path) -> None:
    for size in (0, 1, 1 << 20, (5 << 19) + 1):  # empty, tiny, exactly one chunk, a bit over two
        source = tmp / f"s{size}.bin"
        source.write_bytes(os.urandom(size))
        target = tmp / f"t{size}.bin"
        expected = hashlib.sha256(source.read_bytes()).hexdigest()
        assert a.copy_hashed(source, target) == expected
        assert target.read_bytes() == source.read_bytes()
        assert a.sha256_file(target) == expected
        assert target.stat().st_mtime_ns == source.stat().st_mtime_ns  # copy2's metadata survives


def test_isolated_home(tmp: Path) -> None:
    """Stop setup at its first custody save, before it can launch any process."""
    checkout = tmp / "checkout"
    (checkout / ".git").mkdir(parents=True)
    model = tmp / "model.rvt"
    touch(model)
    owner = tmp / "owner"
    owner.mkdir()
    names = ("CHECKOUT", "owner_home", "main_checkout", "save", "git", "processes", "owner_files")
    prior = {name: getattr(a, name) for name in names}
    captured = {}
    class Saved(Exception): pass
    def save(_, state):
        captured.update(state)
        raise Saved()
    a.CHECKOUT = checkout
    a.owner_home = lambda: owner
    a.main_checkout = lambda: checkout
    a.save = save
    a.git = lambda *_: "test-head"
    a.processes = lambda: []
    a.owner_files = lambda _: {}
    try:
        try:
            a.setup("isolated", ["--model", str(model)])
            raise AssertionError("setup did not save custody")
        except Saved:
            pass
        home = Path(captured["home"])
        assert home.is_dir() and home.name == "Pe.Tools", home
        assert home.parent.name.startswith("pe-accept-"), home
        assert home.parent.parent.resolve() == Path(tempfile.gettempdir()).resolve(), home
        assert not any((p / ".git").exists() for p in (home, *home.parents)), home
        evidence = checkout / ".artifacts" / "accept" / "isolated"
        assert Path(captured["ownerBefore"]).parent == evidence
        assert Path(captured["docs"][0]).parent == evidence / "docs"
    finally:
        for name, value in prior.items(): setattr(a, name, value)
        if captured: shutil.rmtree(Path(captured["home"]).parent)


def test_host_wait(tmp: Path) -> None:
    """A python sleeper stands in for the host launcher; a hand-written service file stands in for the host."""
    run, home = "t", tmp / "home"
    real_run_dir = a.run_dir
    a.run_dir = lambda r: tmp / "run"
    (tmp / "run").mkdir()
    state = {"home": str(home), "lane": "dev", "web": False, "sessions": [], "docs": ["d.rvt"], "host": None}
    service_file = home / ".local-state" / "state" / "service" / "host-source-t.json"
    sleeper = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"])
    real_pid_alive, a.pid_alive = a.pid_alive, lambda pid: pid == sleeper.pid and sleeper.poll() is None
    resumed = []
    a.dev_session = lambda r, s, args: resumed.append(s["host"])
    def no_launch(*_, **__): raise AssertionError("a second host was launched")
    real_env, a.env = a.env, no_launch  # env() feeds only the host launch and the sdk calls
    try:
        # 1. timeout while the launcher lives: exits, but the launcher is already recorded.
        try:
            a.adopt_host(run, state, sleeper.pid, lambda: sleeper.poll() is None, patience=1)
            raise AssertionError("expected exit")
        except SystemExit as e:
            assert "still booting" in str(e) and "setup t" in str(e), e
        assert a.load(run)["host"] == {"launcher": sleeper.pid}
        # 2. the host appears; a second setup call adopts it without launching anything.
        service_file.parent.mkdir(parents=True)
        service_file.write_text(json.dumps({"port": 1234, "pid": 4321, "sourceRoot": str(a.CHECKOUT)}))
        a.setup(run, [])
        assert a.load(run)["host"]["pid"] == 4321 and a.load(run)["host"]["launcher"] == sleeper.pid
        assert resumed and resumed[0]["port"] == 1234
        # 3. a launcher that died with no service file is reported, not adopted.
        service_file.unlink()
        assert a.pid_alive(sleeper.pid)  # the liveness probe a resumed call uses
        sleeper.kill(); sleeper.wait()
        assert not a.pid_alive(sleeper.pid)
        try:
            a.adopt_host(run, state, sleeper.pid, lambda: sleeper.poll() is None, patience=1)
            raise AssertionError("expected exit")
        except SystemExit as e:
            assert "exited without a service file" in str(e), e
    finally:
        a.run_dir = real_run_dir
        a.env = real_env
        a.pid_alive = real_pid_alive
        sleeper.kill()


def test_teardown_home(tmp: Path) -> None:
    names = ("run_dir", "load", "service", "census", "processes", "git", "log")
    prior = {name: getattr(a, name) for name in names}
    keep = os.environ.get("PE_ACCEPT_KEEP_HOME")
    try:
        a.run_dir = lambda _: tmp
        a.git = lambda *_, **__: ""
        for retained in (False, True):
            for failed in (False, True):
                with tempfile.TemporaryDirectory(prefix="pe-accept-") as directory:
                    home = Path(directory) / "Pe.Tools"
                    home.mkdir()
                    a.load = lambda _: {"home": str(home), "lane": "dev", "sessions": [], "revitBefore": []}
                    a.service = lambda _: None
                    def census(*_):
                        if failed: raise RuntimeError("census failed")
                    a.census = census
                    a.processes = lambda: []
                    a.log = lambda *_: None
                    if retained: os.environ["PE_ACCEPT_KEEP_HOME"] = "1"
                    else: os.environ.pop("PE_ACCEPT_KEEP_HOME", None)
                    try:
                        a.teardown("cleanup")
                        assert not failed
                    except RuntimeError:
                        assert failed
                    assert home.exists() == retained, (retained, failed)
    finally:
        for name, value in prior.items(): setattr(a, name, value)
        if keep is None: os.environ.pop("PE_ACCEPT_KEEP_HOME", None)
        else: os.environ["PE_ACCEPT_KEEP_HOME"] = keep


def no_runtime(*args, **kwargs):
    raise AssertionError(f"unexpected runtime/discovery: {args}")


real_popen = subprocess.Popen
def fixture_process(argv, *args, **kwargs):
    if (argv != [sys.executable, "-c", "import time; time.sleep(120)"]
            and not (argv[0] == sys.executable and argv[1] == str(Path(a.__file__).resolve())
                     and argv[-1] in ("-h", "--help"))):
        no_runtime(argv)
    return real_popen(argv, *args, **kwargs)


with tempfile.TemporaryDirectory() as t, \
        patch.object(a.subprocess, "Popen", side_effect=fixture_process), \
        patch.object(a, "require_setup_admission"), \
        patch.object(a, "owner_home", return_value=Path(t)), \
        patch.object(a, "listeners", return_value=[]), \
        patch.multiple(a, sdk=no_runtime, dev_session=no_runtime, setup_installed=no_runtime,
                       installed_identity=no_runtime, processes=no_runtime, revit_pids=no_runtime):
    for test in (test_help, test_pod_build_skip, test_pick_models, test_copy_hashed, test_isolated_home, test_host_wait, test_teardown_home):
        test(Path(tempfile.mkdtemp(dir=t)))
print("ok")


class CustodyTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.ev = self.root / "ev"
        self.ev.mkdir()
        patcher = patch.object(a, "run_dir", return_value=self.root)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_commands_append_with_output_and_exit_status(self):
        a.save("drive", {"checkout": str(self.root), "home": str(self.root)})
        sdk = ["dotnet", "tool", "run", "pe-revit", "--", "version", "--json"]
        driver = ["driver.exe", "argument with spaces"]

        def execute(argv, **kwargs):
            if argv == sdk:
                return subprocess.CompletedProcess(argv, 2, b'{"exitCode":2}', b"error")
            self.assertEqual(argv, driver)
            self.assertEqual(kwargs["env"]["PE_TOOLS_PRODUCT_HOME"], str(self.root))
            return subprocess.CompletedProcess(argv, 7)

        with patch.object(a.subprocess, "run", side_effect=execute), patch.object(a, "setup"):
            a.main(["setup", "drive"])
            a.main(["sdk", "drive", "version", "version"])
            with self.assertRaises(SystemExit) as exited:
                a.main(["run", "drive", "--", *driver])
        self.assertEqual(exited.exception.code, 7)
        records = [json.loads(line) for line in (self.ev / "commands.jsonl").read_text().splitlines()]
        by_argv = {tuple(row["argv"]): row for row in records}
        self.assertIn("setup", records[0]["argv"])
        self.assertEqual(by_argv[tuple(sdk)]["exitCode"], 2)
        self.assertEqual(Path(by_argv[tuple(sdk)]["output"]), self.ev / "version.json")
        self.assertEqual((self.ev / "version.json").read_bytes(), b'{"exitCode":2}')
        self.assertEqual(by_argv[tuple(driver)]["exitCode"], 7)
        self.assertIsNone(by_argv[tuple(driver)]["output"])
        for row in records:
            self.assertTrue(Path(row["cwd"]).is_absolute())
            self.assertLessEqual(datetime.fromisoformat(row["start"]), datetime.fromisoformat(row["end"]))

    def test_teardown_records_observed_stops_and_post_cleanup_residue(self):
        with tempfile.TemporaryDirectory(prefix="pe-accept-") as directory:
            home = Path(directory) / "Pe.Tools"
            home.mkdir()
            a.save("drive", {"checkout": str(self.root), "home": str(home), "lane": "dev",
                            "sessions": ["clean", "blocked"], "revitPids": [20], "revitBefore": [10],
                            "host": {"pid": 22, "port": 3456}, "web": "http://127.0.0.1:4567"})
            for custody, pid in (("owned", 23), ("attached", 10)):
                browser = home / ".local-state" / "state" / "browser" / custody / "session.json"
                browser.parent.mkdir(parents=True)
                browser.write_text(json.dumps({"info": {"custody": custody, "pid": pid},
                                               "controlPort": 5680 if custody == "owned" else 9999}))
            sockets = [{"pid": 21, "port": 5000}, {"pid": 23, "port": 5001},
                       {"pid": 24, "port": 3456}, {"pid": 25, "port": 4567},
                       {"pid": 26, "port": 5680}, {"pid": 10, "port": 9999}]

            def execute(argv, **kwargs):
                self.assertEqual(Path(kwargs["cwd"]), self.root)
                if argv[0] == "git":
                    self.assertEqual(argv, ["git", "status", "--porcelain"])
                    self.assertFalse(home.exists())
                    return subprocess.CompletedProcess(argv, 0, " M changed.txt\n?? new.txt\n", "")
                self.assertEqual(argv[:5], ["dotnet", "tool", "run", "pe-revit", "--"])
                family, action, selector, session = argv[5:9]
                self.assertEqual((family, selector), ("session", "--id"))
                self.assertIn(action, ("list", "stop"))
                code = int(action == "stop" and session == "blocked")
                result = ({"sessions": []} if action == "list"
                          else {"id": session, "phase": "blocked" if code else "stopped"})
                answer = {"exitCode": code, "result": result}
                if code:
                    answer["resolved"] = {"id": session, "pid": 21}
                return subprocess.CompletedProcess(argv, code, json.dumps(answer).encode(), b"")

            with patch.object(a, "census"), \
                    patch.object(a, "service", return_value=None), patch.object(a, "log"), \
                    patch.object(a, "processes", return_value=[{"ProcessId": i} for i in (10, 21, 23, 24, 25, 26)]), \
                    patch.object(a, "listeners", return_value=sockets), \
                    patch.dict(os.environ, {"PE_ACCEPT_KEEP_HOME": "0"}), \
                    patch.object(a.subprocess, "run", side_effect=execute), patch("builtins.print"):
                a.main(["teardown", "drive"])
        receipt = json.loads((self.ev / "teardown.json").read_text())
        self.assertEqual(receipt["sessionsStopped"], ["clean"])
        self.assertEqual(receipt["livePids"], [21, 23])
        self.assertEqual(receipt["listeners"], sockets[:-1])
        self.assertEqual(receipt["gitStatus"], " M changed.txt\n?? new.txt")
        self.assertFalse(receipt["privateHomeExists"])

    def test_setup_snapshots_owner_and_guard_refuses_before_effect(self):
        owner = [{"ProcessId": 10, "Name": "Revit.exe"}, {"ProcessId": 11, "Name": "Pe.Host.exe"}]
        sockets = [{"pid": 11, "port": 5432}]
        checkout = self.root / "checkout"
        with patch.object(a, "run_dir", return_value=checkout / "drive"), \
                patch.object(a, "require_setup_admission"), patch.object(a, "git", return_value="head"), \
                patch.object(a, "processes", return_value=owner), \
                patch.object(a, "listeners", return_value=sockets), \
                patch.object(a.subprocess, "Popen", side_effect=Acquired):
            with self.assertRaises(Acquired):
                a.setup("drive", ["--host-only"])
            state = a.load("drive")
        self.addCleanup(shutil.rmtree, Path(state["home"]).parent)
        a.save("drive", state)

        def execute(argv, **kwargs):
            answer = {"exitCode": 0, "result": {"sessions": []}}
            if argv[-5:-2] == ["session", "list", "--id"]:
                self.assertEqual(argv[-2], "mine")
                answer["result"]["sessions"] = [{"id": "mine", "process": {"pid": 10}}]
            else:
                self.assertEqual(argv[-5:], ["session", "stop", "--pid", "12", "--json"])
            return subprocess.CompletedProcess(argv, 0, json.dumps(answer).encode(), b"")

        with patch.object(a.subprocess, "run", side_effect=execute) as command, \
                patch.object(a, "service", return_value={"pid": 99, "port": 5432}), \
                patch.object(a.urllib.request, "build_opener", side_effect=no_runtime), patch("builtins.print"):
            with self.assertRaisesRegex(SystemExit, r"owner.*10"):
                a.sdk("drive", "stop", ["stop", "--pid", "10"])
            with self.assertRaisesRegex(SystemExit, r"owner.*10"):
                a.sdk("drive", "hr", ["session", "hr", "--id", "mine", "--restart"])
            with self.assertRaisesRegex(SystemExit, r"owner.*Revit"):
                a.sdk("drive", "implicit", ["doc", "open", "model.rvt"])
            with self.assertRaisesRegex(SystemExit, r"owner.*5432"):
                a.http(state, "anon", "POST", "/admin/shutdown")
            self.assertEqual(command.call_count, 1)
            self.assertTrue(a.sdk_ok(a.sdk("drive", "allowed", ["session", "stop", "--pid", "12"])))
        self.assertEqual(state["processesBefore"], owner)
        self.assertEqual(state["listenersBefore"], sockets)


class Acquired(Exception):
    pass


if __name__ == "__main__":
    unittest.main()
