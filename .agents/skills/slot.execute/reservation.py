"""Windows heavy-command admission. One user/machine namespace across all checkouts.

The caller joins a kill-on-close Job BEFORE spawning. Never use this for SDK
sessions or persistent services: their lifecycle authority is elsewhere.
Only migrated launchers participate. Envelopes are admission estimates, not OS
memory limits; unmanaged work or a job exceeding its envelope can exhaust RAM.
"""
import argparse
from contextlib import contextmanager
import ctypes as c
from ctypes import wintypes as w
import json
import math
import os
from pathlib import Path
import shutil
import re
import signal
import sqlite3
import subprocess
import sys
import time
import uuid

GIB = 2**30
# Existing floors minus the four-GiB stop headroom. These are envelopes, not caps.
BUDGETS = {"codegen": 4, "suite": 4, "browser": 4}
HEADROOM = 4 * GIB
K = c.WinDLL("kernel32", use_last_error=True)
P = c.WinDLL("psapi", use_last_error=True)


def api(dll, name, args, result=w.BOOL):
    fn = getattr(dll, name)
    fn.argtypes, fn.restype = args, result
    return fn


close = api(K, "CloseHandle", [w.HANDLE])
open_process = api(K, "OpenProcess", [w.DWORD, w.BOOL, w.DWORD], w.HANDLE)
current_process = api(K, "GetCurrentProcess", [], w.HANDLE)
times = api(K, "GetProcessTimes", [w.HANDLE] + [c.POINTER(w.FILETIME)] * 4)
wait_process = api(K, "WaitForSingleObject", [w.HANDLE, w.DWORD], w.DWORD)
create_job = api(K, "CreateJobObjectW", [c.c_void_p, w.LPCWSTR], w.HANDLE)
open_job = api(K, "OpenJobObjectW", [w.DWORD, w.BOOL, w.LPCWSTR], w.HANDLE)
set_job = api(K, "SetInformationJobObject", [w.HANDLE, c.c_int, c.c_void_p, w.DWORD])
query_job = api(K, "QueryInformationJobObject", [w.HANDLE, c.c_int, c.c_void_p, w.DWORD, c.c_void_p])
assign_job = api(K, "AssignProcessToJobObject", [w.HANDLE, w.HANDLE])
in_job = api(K, "IsProcessInJob", [w.HANDLE, w.HANDLE, c.POINTER(w.BOOL)])


def checked(ok):
    if not ok:
        raise c.WinError(c.get_last_error())
    return ok


class Memory(c.Structure):
    _fields_ = [("length", w.DWORD), ("load", w.DWORD)] + [
        (n, c.c_ulonglong) for n in ("total", "free", "commit_limit", "commit_free", "virtual", "virtual_free", "extended")]


class Counters(c.Structure):
    _fields_ = [("size", w.DWORD), ("faults", w.DWORD)] + [
        (n, c.c_size_t) for n in ("peak_ws", "ws", "peak_paged", "paged", "peak_nonpaged", "nonpaged", "commit", "peak_commit", "private", "private_ws")] + [("shared_commit", c.c_ulonglong)]


class Limits(c.Structure):
    _fields_ = [("process_time", c.c_longlong), ("job_time", c.c_longlong), ("flags", w.DWORD),
                ("min_ws", c.c_size_t), ("max_ws", c.c_size_t), ("active", w.DWORD),
                ("affinity", c.c_size_t), ("priority", w.DWORD), ("scheduling", w.DWORD)]


class ExtendedLimits(c.Structure):
    _fields_ = [("basic", Limits), ("io", c.c_ulonglong * 6)] + [
        (n, c.c_size_t) for n in ("process_limit", "job_limit", "peak_process", "peak_job")]


memory_status = api(K, "GlobalMemoryStatusEx", [c.POINTER(Memory)])
memory_info = api(P, "GetProcessMemoryInfo", [w.HANDLE, c.POINTER(Counters), w.DWORD])


def capacity():
    m = Memory()
    m.length = c.sizeof(m)
    checked(memory_status(c.byref(m)))
    return m.free, m.commit_free


def identity(pid):
    handle = open_process(0x101000, False, pid)
    if not handle:
        if c.get_last_error() == 87:  # no such process; access denied is not death
            return None
        raise c.WinError(c.get_last_error())
    try:
        if wait_process(handle, 0) == 0:
            return None
        values = [w.FILETIME() for _ in range(4)]
        checked(times(handle, *(c.byref(v) for v in values)))
        return (values[0].dwHighDateTime << 32) | values[0].dwLowDateTime
    finally:
        close(handle)


def job_read(name):
    handle = open_job(4, False, name)  # JOB_OBJECT_QUERY
    if not handle:
        if c.get_last_error() == 2:
            return 0, 0, 0, 0
        raise c.WinError(c.get_last_error())
    try:
        # Fail closed on an unexpectedly large job, rather than miss its consumption.
        ids = c.create_string_buffer(65536)
        checked(query_job(handle, 3, ids, len(ids), None))
        count = w.DWORD.from_buffer(ids, 4).value
        pids = (c.c_size_t * count).from_buffer(ids, 8)
        ws = private = 0
        for pid in pids:
            ph = open_process(0x410, False, pid)
            if not ph:
                if c.get_last_error() == 87:
                    continue
                raise c.WinError(c.get_last_error())
            try:
                m = Counters()
                m.size = c.sizeof(m)
                if not memory_info(ph, c.byref(m), m.size):
                    error = c.get_last_error()
                    # A job member may exit between enumeration and this reading.
                    if identity(pid) is None:
                        continue
                    raise c.WinError(error)
                # EX2's private WS excludes shared DLL/mapped pages credited by other jobs.
                ws += m.private_ws
                private += m.private
            finally:
                close(ph)
        limits = ExtendedLimits()
        checked(query_job(handle, 9, c.byref(limits), c.sizeof(limits), None))
        return count, ws, private, limits.peak_job
    finally:
        close(handle)


def own_job(name):
    handle = checked(create_job(None, name))
    limits = ExtendedLimits()
    limits.basic.flags = 0x2000  # KILL_ON_JOB_CLOSE, no breakaway permitted
    try:
        checked(set_job(handle, 9, c.byref(limits), c.sizeof(limits)))
        checked(assign_job(handle, current_process()))
    except BaseException:
        close(handle)
        raise
    # Intentionally keep the only owning handle until interpreter exit. Closing it
    # here would kill this supervisor too. Descendants inherit job membership.
    return handle


@contextmanager
def state(home, deadline):
    home.mkdir(parents=True, exist_ok=True)
    database = sqlite3.connect(home / "reservations.sqlite3", timeout=max(0, deadline-time.monotonic()))
    try:
        database.execute("CREATE TABLE IF NOT EXISTS reservations (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)")
        database.execute("BEGIN IMMEDIATE")
        saved = database.execute("SELECT body FROM reservations WHERE id=1").fetchone()
        rows = json.loads(saved[0]) if saved else []
        validate_rows(rows)
        yield rows
        validate_rows(rows)
        body = json.dumps(rows)
        if not saved or saved[0] != body:
            database.execute("INSERT OR REPLACE INTO reservations VALUES (1, ?)", (body,))
        database.commit()
    finally:
        database.close()  # rolls back on cancellation/crash; the OS releases the lock


def validate_rows(rows):
    keys = {"id", "pid", "created", "checkout", "thread", "kind", "budget", "running", "deadline", "job"}
    seen = set()
    if type(rows) is not list:
        raise ValueError("invalid reservation state: expected rows")
    for row in rows:
        if type(row) is not dict or row.keys() != keys:
            raise ValueError("invalid reservation row fields")
        valid = (
            type(row["id"]) is str and re.fullmatch(r"[0-9a-f]{32}", row["id"]) is not None
            and type(row["pid"]) is int and 0 < row["pid"] < 2**32
            and type(row["created"]) is int and 0 < row["created"] < 2**64
            and type(row["kind"]) is str and row["kind"] in BUDGETS
            and type(row["budget"]) is int and 0 < row["budget"] == int(BUDGETS[row["kind"]] * GIB)
            and type(row["running"]) is bool
            and type(row["deadline"]) in (float, int) and 0 <= row["deadline"] <= 2**63 and math.isfinite(row["deadline"])
            and type(row["checkout"]) is str and 0 < len(row["checkout"]) <= 32767
            and Path(row["checkout"]).is_absolute()
            and type(row["thread"]) is str and len(row["thread"]) <= 4096
            and row["job"] == "Local\\Pe.Tools.reservation." + row["id"]
        )
        if not valid or row["id"] in seen:
            raise ValueError("invalid reservation row values or duplicate identity")
        seen.add(row["id"])


def sweep(rows):
    # Never recover by age alone: a running command can legitimately be old.
    for row in rows[:]:
        if not row["running"] and time.monotonic() >= row["deadline"]:
            rows.remove(row)
        elif identity(row["pid"]) != row["created"] and job_read(row["job"])[0] == 0:
            rows.remove(row)


def fits(free, commit, rows, budget, headroom=HEADROOM):
    physical_debt = commit_debt = 0
    for row in rows:
        if row["running"]:
            _, ws, private, _ = job_read(row["job"])
            physical_debt += max(0, row["budget"] - ws)
            commit_debt += max(0, row["budget"] - private)
    return free - physical_debt >= budget + headroom and commit - commit_debt >= budget + headroom


def run(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=["light", *BUDGETS])
    parser.add_argument("--wait", type=float, default=60, help="queue deadline in seconds, 0..600")
    parser.add_argument("--owns-suite", action="store_true")
    parser.add_argument("--home", type=Path)
    parser.add_argument("--receipt", type=Path)
    split = argv.index("--") if "--" in argv else len(argv)
    options = parser.parse_args(argv[:split])
    command = argv[split + 1:]
    if not command or not 0 <= options.wait <= 600:
        parser.error("needs -- command and a wait between 0 and 600 seconds")
    if options.kind == "suite" and not options.owns_suite and os.environ.get("T3CODE_THREAD_ID", "").startswith("thread:delegated-task:"):
        print("REFUSE suite: a delegated child runs a full suite only when its brief names it the owner, and then passes --owns-suite", file=sys.stderr)
        return 4
    # Executable argv only: list2cmdline cannot escape cmd.exe shell syntax.
    executable = shutil.which(command[0])
    if executable is None:
        raise FileNotFoundError(command[0])
    command[0] = executable
    if executable.lower().endswith((".cmd", ".bat")):
        raise ValueError("batch forwarding is unsupported; invoke an executable or node <pnpm.cjs> directly")
    if options.kind == "light":
        return subprocess.call(command)
    inherited = os.environ.get("PE_MACHINE_RESERVATION_JOB")
    if inherited:
        inherited_home = os.environ.get("PE_MACHINE_RESERVATION_HOME")
        if not inherited_home or not Path(inherited_home).is_absolute():
            raise ValueError("inherited reservation needs its coordinator namespace")
        home = Path(inherited_home).resolve()
        if options.home is not None and options.home.resolve() != home:
            raise ValueError("nested commands cannot change the coordinator namespace")
        with state(home, time.monotonic() + options.wait) as rows:
            row = next((r for r in rows if r["job"] == inherited and r["running"]), None)
            if row is None or row["kind"] != options.kind or identity(row["pid"]) != row["created"]:
                raise ValueError("inherited reservation has no matching running owner")
            handle = checked(open_job(4, False, inherited))
            owner = None
            try:
                owner = checked(open_process(0x1000, False, row["pid"]))
                member, owner_member = w.BOOL(), w.BOOL()
                checked(in_job(current_process(), handle, c.byref(member)))
                checked(in_job(owner, handle, c.byref(owner_member)))
                if not member.value or not owner_member.value:
                    raise ValueError("inherited reservation does not contain caller and owner")
                if not fits(*capacity(), rows, 0):
                    raise ValueError("inherited reservation capacity is no longer available")
            finally:
                if owner:
                    close(owner)
                close(handle)
        # Reuse exactly the verified outer envelope, never another waiting reservation.
        return subprocess.call(command)
    options.home = (options.home or Path(os.environ["LOCALAPPDATA"]) / "Positive Energy/Pe.Tools/machine-reservations-v1").resolve()
    started = time.monotonic()
    deadline = started + options.wait
    row = {"id": uuid.uuid4().hex, "pid": os.getpid(), "created": identity(os.getpid()),
           "checkout": str(Path.cwd().resolve()), "thread": os.environ.get("T3CODE_THREAD_ID", ""),
           "kind": options.kind, "budget": int(BUDGETS[options.kind] * GIB), "running": False, "deadline": deadline}
    row["job"] = "Local\\Pe.Tools.reservation." + row["id"]
    # This self-containing job closes the spawn/crash gap without suspended or orphan processes.
    job = own_job(row["job"])
    setup_done = time.monotonic()
    admitted = None
    peak_ws = peak_commit = 0
    result = 3
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(130))
    try:
        while True:
            with state(options.home, max(deadline, time.monotonic() + 0.1)) as rows:
                sweep(rows)
                if not any(r["id"] == row["id"] for r in rows):
                    rows.append(row)
                suite_busy = any(r["running"] and r["kind"] == "suite" for r in rows)
                # A second suite waits without blocking ready drivers or codegen.
                first = next((r for r in rows if not r["running"] and not (r["kind"] == "suite" and suite_busy)), None)
                free, commit = capacity()
                within_wait = options.wait == 0 or time.monotonic() < deadline
                if within_wait and first and first["id"] == row["id"] and fits(free, commit, rows, row["budget"]):
                    next(r for r in rows if r["id"] == row["id"])["running"] = True
                    row["running"] = True
                    admitted = time.monotonic()
            if admitted is not None:
                break
            if time.monotonic() >= deadline:
                print("HOLD: queue deadline expired; no process launched", file=sys.stderr)
                return 3
            time.sleep(min(0.1, max(0, deadline - time.monotonic())))
        child = subprocess.Popen(command, env={**os.environ, "PE_MACHINE_RESERVATION_JOB": row["job"],
                                               "PE_MACHINE_RESERVATION_HOME": str(options.home)})
        while True:
            count, ws, private, peak = job_read(row["job"])
            peak_ws = max(peak_ws, ws)
            peak_commit = max(peak_commit, peak, private)
            if child.poll() is not None and count <= 1:
                result = child.returncode
                return result
            time.sleep(0.05)
    except (KeyboardInterrupt, SystemExit):
        result = 130
        raise
    finally:
        finished = time.monotonic()
        # A cancelled/crashed supervisor leaves its row until its job is empty.
        # OS handle closure kills only its own descendants, then the next reader sweeps it.
        if job_read(row["job"])[0] <= 1:
            with state(options.home, time.monotonic() + 2) as rows:
                rows[:] = [r for r in rows if r["id"] != row["id"]]
        if options.receipt:
            options.receipt.parent.mkdir(parents=True, exist_ok=True)
            ended = time.monotonic()
            options.receipt.write_text(json.dumps({**row, "result": result,
                "setup_s": setup_done - started,
                "queue_s": (admitted or finished) - setup_done,
                "execution_s": finished - admitted if admitted else 0, "cleanup_s": ended - finished,
                "wall_s": ended - started, "peak_private_ws_bytes": peak_ws,
                "peak_private_bytes": peak_commit}), encoding="utf-8")


if __name__ == "__main__":
    try:
        sys.exit(run(sys.argv[1:]))
    except (OSError, ValueError, TimeoutError, sqlite3.Error) as error:
        print(f"HOLD: {error}", file=sys.stderr)
        sys.exit(3)
