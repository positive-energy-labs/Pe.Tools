"""Plain-assert checks for the setup logic in acceptance.py: python tools/test_acceptance.py. No Revit, no host."""

import os, shutil, sys, tempfile
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


with tempfile.TemporaryDirectory() as t:
    test_pod_build_skip(Path(t))
    test_pick_models(Path(t))
print("ok")
