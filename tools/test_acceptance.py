"""Plain-assert checks for the setup logic in acceptance.py: python tools/test_acceptance.py. No Revit, no host."""

import hashlib, json, os, shutil, subprocess, sys, tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import acceptance as a


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


def test_host_wait(tmp: Path) -> None:
    """A python sleeper stands in for the host launcher; a hand-written service file stands in for the host."""
    run, home = "t", tmp / "home"
    a.run_dir = lambda r: tmp / "run"
    (tmp / "run").mkdir()
    state = {"home": str(home), "lane": "dev", "web": False, "sessions": [], "docs": ["d.rvt"], "host": None}
    service_file = home / ".local-state" / "state" / "service" / "host-source-t.json"
    sleeper = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"])
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
        a.env = real_env
        sleeper.kill()


with tempfile.TemporaryDirectory() as t:
    for test in (test_pod_build_skip, test_pick_models, test_copy_hashed, test_host_wait):
        test(Path(tempfile.mkdtemp(dir=t)))
print("ok")
