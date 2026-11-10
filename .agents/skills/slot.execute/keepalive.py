"""Idle-relative keepalive: wake a thread N minutes after its last activity, from outside the thread.

usage: python keepalive.py arm [minutes]     enrol the calling thread (T3CODE_THREAD_ID); default 45 for every thread
       python keepalive.py disarm            leave the roster
       python keepalive.py tick [--dry]      send a wake to every enrolled thread idle past its cadence

The tick runs from one T3 automation (interval 10 minutes, a Haiku thread titled "Keepalive tick"), so the clock is
visible and pausable in T3 rather than hidden in Windows Task Scheduler.

Roster: .artifacts/keepalive/<threadId> holding the cadence in minutes. Idle = now minus the thread's last run completion in
T3's state db. Not `updatedAt`: it moved about 30 minutes after a run ended, so wakes landed at 86 to 90 minutes, past the
60-minute prompt cache (retro 2026-11-10, 8 of 9 wakes missed). A running thread is never woken. With a 10-minute tick and a
45-minute cadence a wake lands 45 to 55 minutes after the last run. A thread with no input but wakes for 16 hours is
disarmed, so a finished thread stops costing turns.
"""
import datetime as dt
import json
import os
import sqlite3
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
ROSTER = os.path.join(ROOT, ".artifacts", "keepalive")
T3 = os.path.expanduser("~/.t3/bin/t3.cmd")
PROMPT = "keepalive: nothing is asked. If nothing changed since your last turn, reply in one line and stop."
# A wake reads the cache at 0.1x the input price and a cold start writes it at 2x, so 20 wakes cost one cold start.
# At one wake per 50 minutes that is about 16 hours: past it, keeping the thread warm costs more than letting it go cold.
EXPIRE_MIN = 16 * 60
CADENCE = 45
STATE = (os.environ.get("T3_USERDATA") or os.path.expanduser("~/.t3/userdata")).replace(os.sep, "/") + "/statev2.sqlite"


def t3(*args):
    return subprocess.run(["cmd", "/c", T3, *args], capture_output=True, text=True).stdout


def thread(tid):
    out = t3("thread", "show", "--json", "--messages", "0", tid)
    try:
        return json.loads(out)["thread"]
    except (ValueError, KeyError):
        return None


def last_run_end(tid):
    db = sqlite3.connect(f"file:{STATE}?mode=ro", uri=True)
    try:
        return db.execute("select max(completed_at) from orchestration_v2_projection_runs where thread_id=?", (tid,)).fetchone()[0]
    finally:
        db.close()


def last_real_input(tid):
    """Newest message into the thread that is not a keepalive wake. A wake is itself a run, so idle time alone never grows past the cadence."""
    db = sqlite3.connect(f"file:{STATE}?mode=ro", uri=True)
    try:
        return db.execute("select max(created_at) from orchestration_v2_projection_messages where thread_id=? and role='user' "
                          "and payload_json not like ?", (tid, f"%{PROMPT[:30]}%")).fetchone()[0]
    finally:
        db.close()


def tick(dry):
    os.makedirs(ROSTER, exist_ok=True)
    now = dt.datetime.now(dt.timezone.utc)
    for name in os.listdir(ROSTER):
        path, tid = os.path.join(ROSTER, name), name.replace("~", ":")
        minutes = int(open(path).read().strip() or CADENCE)
        t = thread(tid)
        if t is None:
            print(f"{tid}: unavailable, disarmed"); os.remove(path); continue
        end = last_run_end(tid) or t["updatedAt"]
        idle = (now - dt.datetime.fromisoformat(end.replace("Z", "+00:00"))).total_seconds() / 60
        if t["status"] == "running":
            print(f"{tid}: running, skip"); continue
        real = last_real_input(tid) or end
        unasked = (now - dt.datetime.fromisoformat(real.replace("Z", "+00:00"))).total_seconds() / 60
        if unasked > EXPIRE_MIN:
            print(f"{tid}: no real input for {unasked:.0f} min, disarmed"); os.remove(path); continue
        if idle < minutes:
            print(f"{tid}: idle {idle:.0f} of {minutes} min"); continue
        print(f"{tid}: idle {idle:.0f} min >= {minutes}, {'would wake' if dry else 'waking'}")
        if not dry:
            t3("thread", "send", tid, PROMPT)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    verb = args[0] if args else "tick"
    tid = os.environ.get("T3CODE_THREAD_ID", "")
    # Windows file names refuse ":", and mcp:launch:<hash> thread ids carry two; tick maps "~" back.
    entry = tid.replace(":", "~")
    if verb == "arm":
        if not tid:
            print("no T3CODE_THREAD_ID; arm runs inside a T3 thread"); return 2
        os.makedirs(ROSTER, exist_ok=True)
        minutes = args[1] if len(args) > 1 else str(CADENCE)
        open(os.path.join(ROSTER, entry), "w").write(minutes)
        print(f"armed {tid} at {minutes} min after its last run"); return 0
    if verb == "disarm":
        p = os.path.join(ROSTER, entry)
        if os.path.exists(p):
            os.remove(p)
        print(f"disarmed {tid}"); return 0
    if verb == "tick":
        tick("--dry" in sys.argv); return 0
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main())
