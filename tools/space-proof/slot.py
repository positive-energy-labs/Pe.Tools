"""Slot and backend-host steps for a hold that is not driven by run.py or verbs.py (for example `pe-revit test`).

    python tools/space-proof/slot.py take "<what>"     ORDER's first line must be PE_PROOF_SESSION; mkdir the slot, delete that line, write holder
    python tools/space-proof/slot.py host-start        backend-only host for this checkout (reused by session start)
    python tools/space-proof/slot.py host-stop         stop this checkout's host stack
    python tools/space-proof/slot.py release "<what>"  remove holder/owner and the slot dir, log RELEASE
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run as R  # noqa: E402


def main():
    cmd = sys.argv[1]
    what = sys.argv[2] if len(sys.argv) > 2 else ""
    if cmd == "take":
        R.acquire_slot()
        (R.LOCK / "holder").write_text(f"{R.SID} {R.CHECKOUT} {R.utc()} {what}\n")
        print("slot taken")
    elif cmd == "host-start":
        R.ensure_backend_host()
        print("host pid", R.service_pid())
    elif cmd == "host-stop":
        print("stopped", R.stop_dev_host())
    elif cmd == "release":
        for f in ("owner.txt", "holder"):
            (R.LOCK / f).unlink(missing_ok=True)
        R.LOCK.rmdir()
        R.slot_log(f"RELEASE slot-1; {what}")
        print("slot released")


if __name__ == "__main__":
    main()
