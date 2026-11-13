"""Lightweight real Windows child-process falsifiers; never use shared reservation state."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import reservation as R


WORKER = r'''
import sys, json, time, uuid, sqlite3
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import reservation as R
home, receipt, mode, wait, child = sys.argv[2:]
home = Path(home)
R.BUDGETS = {kind:1/16 for kind in R.BUDGETS}
R.HEADROOM = 64 * 2**20
original_fits = R.fits
R.fits = lambda free, commit, rows, budget: original_fits(free, commit, rows, budget, R.HEADROOM)
real_capacity = R.capacity
def capacity():
    free, commit = real_capacity()
    rows = []
    if (home/'reservations.sqlite3').exists():
        with sqlite3.connect(home/'reservations.sqlite3') as db:
            saved = db.execute('SELECT body FROM reservations WHERE id=1').fetchone()
            rows = json.loads(saved[0]) if saved else []
    # Same bounded memory pool for baseline and candidate, including measured consumption.
    usage = [R.job_read(r['job']) for r in rows if r['running']]
    pool = (1024 if mode in ('suite','browser') else 160)*2**20
    return min(free, pool-sum(x[1] for x in usage)), min(commit, pool-sum(x[2] for x in usage))
R.capacity = capacity
if mode == 'blocked':
    R.capacity = lambda: (0, 0)
if mode == 'cancel':
    import threading, _thread
    R.capacity = lambda: (0, 0)
    threading.Timer(.2, _thread.interrupt_main).start()
if mode == 'cancel-running':
    import threading, _thread
    def cancel_started():
        deadline = time.monotonic()+5
        while not Path(receipt+'.child').exists() and time.monotonic() < deadline: time.sleep(.01)
        _thread.interrupt_main()
    threading.Thread(target=cancel_started, daemon=True).start()
if mode == 'spawn-fail':
    def fail(*a, **kw): raise OSError('injected spawn failure')
    R.subprocess.Popen = fail
if mode == 'baseline':
    job = 'Local\\Pe.Tools.baseline.' + uuid.uuid4().hex
    handle = R.own_job(job)
    started = time.monotonic()
    assert min(R.capacity()) >= 128*2**20
    Path(receipt + '.ready').write_text(job)
    while not (home/'go').exists(): time.sleep(.01)
    admitted = time.monotonic()
    p = R.subprocess.Popen([sys.executable, child, receipt+'.child'])
    peak_ws = peak_private = 0
    while True:
        count, ws, private, peak = R.job_read(job)
        peak_ws, peak_private = max(peak_ws, ws), max(peak_private, private, peak)
        if p.poll() is not None and count <= 1: break
        time.sleep(.05)
    Path(receipt).write_text(json.dumps(dict(setup_s=0,queue_s=0,barrier_s=admitted-started,execution_s=time.monotonic()-admitted,wall_s=time.monotonic()-started,peak_ws_bytes=peak_ws,peak_private_bytes=peak_private,result=p.returncode)))
    sys.exit(p.returncode)
try:
    kind = mode if mode in ('suite','browser') else 'codegen'
    sys.exit(R.run([kind,'--integrator','--home',str(home),'--wait',wait,'--receipt',receipt,'--',sys.executable,child,receipt+'.child']))
except KeyboardInterrupt:
    sys.exit(130)
except OSError:
    sys.exit(3)
'''

CHILD = '''import json, os, sys, time
from pathlib import Path
data = bytearray(32*2**20)
record = dict(pid=os.getpid(),start=time.monotonic())
def write():
    temp = Path(sys.argv[1]+'.tmp')
    temp.write_text(json.dumps(record))
    os.replace(temp,sys.argv[1])
write()
time.sleep(.6)
record['end'] = time.monotonic()
write()
'''


def until(predicate, timeout=8):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(.02)
    raise AssertionError("bounded observation expired")


class ReservationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pe-reservation-test-")
        self.home = Path(self.temp.name)
        self.worker = self.home / "worker.py"
        self.worker.write_text(WORKER)
        self.child = self.home / "child.py"
        self.child.write_text(CHILD)
        self.children = []

    def tearDown(self):
        for p in self.children:
            if p.poll() is None:
                p.terminate()
            p.wait(timeout=5)
            p.stderr.close()
        self.temp.cleanup()

    def start(self, name, mode="normal", wait="3", home=None):
        receipt = self.home / (name + ".json")
        p = subprocess.Popen([sys.executable, str(self.worker), str(HERE), str(home or self.home), str(receipt), mode, wait, str(self.child)],
                             stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        self.children.append(p)
        return p, receipt

    def rows(self):
        with R.state(self.home, time.monotonic()+2) as rows:
            return rows[:]

    def test_concurrent_admission_serializes_bounded_pool(self):
        jobs = [self.start(str(n),wait='10') for n in range(3)]
        seen_running = 0
        while any(p.poll() is None for p, _ in jobs):
            seen_running = max(seen_running, sum(r['running'] for r in self.rows()))
            time.sleep(.02)
        self.assertEqual(seen_running, 1)
        self.assertEqual([p.wait() for p, _ in jobs], [0]*3,
                         [(p.stderr.read().decode(),json.loads(r.read_text())) for p,r in jobs])
        self.assertEqual(self.rows(), [])
        metrics = [json.loads(r.read_text()) for _, r in jobs]
        self.assertGreater(max(r["queue_s"] for r in metrics), .5)
        for r in metrics:
            self.assertTrue(r['running'])
            self.assertAlmostEqual(sum(r[k] for k in ('setup_s','queue_s','execution_s','cleanup_s')),r['wall_s'],places=6)

    def test_crash_kills_descendant_and_recovers_stale_owner(self):
        p, receipt = self.start("crash")
        child_file = Path(str(receipt) + '.child')
        until(child_file.exists)
        pid = json.loads(child_file.read_text())["pid"]
        self.assertIsNotNone(R.identity(pid))
        p.terminate()
        p.wait(timeout=5)
        until(lambda: R.identity(pid) is None)
        replacement, _ = self.start("replacement")
        self.assertEqual(replacement.wait(timeout=6), 0)
        self.assertEqual(self.rows(), [])

    def test_waits_for_grandchild_after_launcher_exits(self):
        grandchild = self.home/'grandchild.py'
        grandchild.write_text(CHILD)
        self.child.write_text('import subprocess,sys\nsubprocess.Popen([sys.executable,' + repr(str(grandchild)) + ',sys.argv[1]])\n')
        p, receipt = self.start('descendant')
        until(lambda: Path(str(receipt)+'.child').exists())
        self.assertIsNone(p.poll())
        self.assertEqual(p.wait(timeout=5), 0)
        self.assertIn('end', json.loads(Path(str(receipt)+'.child').read_text()))
        self.assertEqual(self.rows(), [])

    def test_nested_launcher_uses_verified_outer_job(self):
        grandchild = self.home/'grandchild.py'
        grandchild.write_text(CHILD)
        self.child.write_text('import sys\nsys.path.insert(0,'+repr(str(HERE))+')\nimport reservation as R\nraise SystemExit(R.run(["codegen","--home",'+repr(str(self.home))+',"--wait","0","--",sys.executable,'+repr(str(grandchild))+',sys.argv[1]]))\n')
        p, receipt = self.start('nested')
        self.assertEqual(p.wait(timeout=6), 0)
        self.assertIn('end', json.loads(Path(str(receipt)+'.child').read_text()))
        self.assertEqual(self.rows(), [])

    def test_second_suite_waits_without_blocking_ready_browser(self):
        self.child.write_text(CHILD.replace('time.sleep(.6)', '''if 'first-suite' in sys.argv[1]:
    deadline=time.monotonic()+10
    while not Path(sys.argv[1]+'.release').exists() and time.monotonic()<deadline: time.sleep(.01)
time.sleep(.6)'''))
        first, first_receipt = self.start('first-suite','suite','10')
        until(lambda: Path(str(first_receipt)+'.child').exists())
        second, second_receipt = self.start('second-suite','suite','10')
        until(lambda: len(self.rows()) == 2)
        browser, browser_receipt = self.start('browser','browser','10')
        until(lambda: Path(str(browser_receipt)+'.child').exists())
        self.assertFalse(Path(str(second_receipt)+'.child').exists())
        Path(str(first_receipt)+'.child.release').touch()
        self.assertEqual([p.wait(timeout=8) for p in (first,second,browser)], [0,0,0])
        self.assertEqual(self.rows(), [])

    def test_cancellation_running_kills_only_own_job_then_recovers(self):
        self.child.write_text(CHILD.replace('time.sleep(.6)', 'time.sleep(20)'))
        p, receipt = self.start('cancel-running', 'cancel-running')
        until(lambda: Path(str(receipt)+'.child').exists())
        pid = json.loads(Path(str(receipt)+'.child').read_text())['pid']
        self.assertEqual(p.wait(timeout=5), 130)
        until(lambda: R.identity(pid) is None)
        with R.state(self.home, time.monotonic()+2) as rows:
            R.sweep(rows)
            self.assertEqual(rows, [])

    def test_queue_timeout_cancel_and_spawn_failure_leave_no_hold(self):
        for mode, expected in [('blocked',3), ('cancel',130), ('spawn-fail',3)]:
            with self.subTest(mode=mode):
                p, receipt = self.start(mode, mode, '.3')
                self.assertEqual(p.wait(timeout=5), expected)
                self.assertEqual(self.rows(), [])
                self.assertFalse(Path(str(receipt)+'.child').exists())

    def test_pid_reuse_and_unknown_owner_fail_closed(self):
        row = dict(pid=os.getpid(), created=R.identity(os.getpid())-1, job='Local\\Pe.Tools.absent.test', running=True)
        rows = [row]
        R.sweep(rows)
        self.assertEqual(rows, [])
        with patch.object(R, 'job_read', return_value=(1,0,0,0)):
            rows = [row]
            R.sweep(rows)
            self.assertEqual(rows, [row])
        with patch.object(R, 'identity', side_effect=PermissionError('unknown owner')):
            with self.assertRaises(PermissionError): R.sweep([row])
        rows = [dict(pid=os.getpid(),created=R.identity(os.getpid()),running=False,deadline=time.monotonic()-1)]
        R.sweep(rows)
        self.assertEqual(rows, [])  # a suspended waiter cannot starve ready work

    def test_crash_releases_atomic_state_lock(self):
        locker = self.home/'locker.py'
        locker.write_text('import sys,time\nfrom pathlib import Path\nsys.path.insert(0,'+repr(str(HERE))+')\nimport reservation as R\nwith R.state(Path('+repr(str(self.home))+'),time.monotonic()+2):\n Path('+repr(str(self.home/'locked'))+').touch()\n time.sleep(20)\n')
        p = subprocess.Popen([sys.executable,str(locker)],stderr=subprocess.PIPE)
        self.children.append(p)
        until(lambda: (self.home/'locked').exists())
        p.terminate()
        p.wait(timeout=5)
        with R.state(self.home,time.monotonic()+1) as rows:
            self.assertEqual(rows, [])

    def test_commit_and_physical_debt_are_separate_without_double_charge(self):
        rows = [dict(running=True, budget=100, job='fixture')]
        with patch.object(R, 'job_read', return_value=(2,60,80,80)):
            self.assertTrue(R.fits(150,130,rows,100,10))
            self.assertFalse(R.fits(149,130,rows,100,10))
            self.assertFalse(R.fits(150,129,rows,100,10))
        with patch.object(R, 'job_read', return_value=(2,120,120,120)):
            self.assertTrue(R.fits(110,110,rows,100,10))

    def test_machine_entrypoint_light_passthrough_and_validation(self):
        machine = HERE / 'machine.py'
        result = subprocess.run([sys.executable,str(machine),'run','light','--home',str(self.home),'--',sys.executable,'-c','raise SystemExit(7)'], capture_output=True)
        self.assertEqual(result.returncode, 7, result.stderr)
        self.assertFalse((self.home/'reservations.sqlite3').exists())
        result = subprocess.run([sys.executable,str(machine),'run','revit-test','--',sys.executable], capture_output=True)
        self.assertEqual(result.returncode, 2)
        batch = self.home/'command with spaces.cmd'
        batch.write_text('@exit /b 7\n')
        result = subprocess.run([sys.executable,str(machine),'run','light','--',str(batch)],capture_output=True)
        self.assertEqual(result.returncode, 7, result.stderr)


if __name__ == '__main__':
    unittest.main()
