"""1 Hz sampler + watchdog for ONE controlled Revit pid (the harness's probe session).
usage: guard.py <pid> <receiptPath> <out.jsonl> <floorGiB> <checkoutDir> <sessionId>
Samples private/working bytes of <pid> and machine available memory. If available < floor for 3 consecutive
samples, stops ONLY <sessionId> through the SDK, pinned to <receiptPath> (--unsaved keep --force), logs the
envelope, exits. Never touches any other Revit."""
import json, subprocess, sys, time, psutil
pid, receipt, out, floor_gib, checkout, sid = int(sys.argv[1]), sys.argv[2], sys.argv[3], float(sys.argv[4]), sys.argv[5], sys.argv[6]
floor = floor_gib * 2**30
p = psutil.Process(pid)
low = 0
with open(out, 'a', encoding='utf-8') as f:
    def w(**k): f.write(json.dumps(dict(t=time.time(), **k)) + '\n'); f.flush()
    w(event='armed', pid=pid, receipt=receipt, floor=floor)
    while True:
        try: m = p.memory_info()
        except psutil.NoSuchProcess: w(event='gone'); break
        a = psutil.virtual_memory().available
        w(private=m.private, working=m.rss, available=a)
        low = low + 1 if a < floor else 0
        if low >= 3:
            r = subprocess.run(['dotnet', 'tool', 'run', 'pe-revit', '--', 'session', 'stop', '--id', sid, '--unsaved', 'keep',
                                '--force', '--expect-session', receipt, '--json'], cwd=checkout, capture_output=True, text=True)
            w(event='stop-session', available=a, exit=r.returncode, out=r.stdout[-3000:], err=r.stderr[-1500:])
            break
        time.sleep(1)
