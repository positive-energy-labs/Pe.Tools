"""Governor meter: read-only usage for both providers. Never redeems anything.
Claude: Anthropic usage endpoint with the stored Claude Code login (token goes to api.anthropic.com only).
Codex: a private stdio `codex app-server`, method account/rateLimits/read.
Redeem is a separate, deliberate act: account/rateLimitResetCredit/consume with an idempotencyKey.
"""
import json, os, subprocess, threading, time, urllib.request, datetime
def claude():
    tok = json.load(open(os.path.expanduser('~/.claude/.credentials.json'), encoding='utf-8'))['claudeAiOauth']['accessToken']
    r = urllib.request.Request('https://api.anthropic.com/api/oauth/usage', headers={'Authorization': 'Bearer ' + tok, 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'claude-code'})
    return [(l['kind'] + ('' if not l.get('scope') else ':' + l['scope']['model']['display_name']), l['percent'], l['resets_at'][:16]) for l in json.load(urllib.request.urlopen(r, timeout=20))['limits']]
def codex():
    p = subprocess.Popen('codex app-server', stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, shell=True)
    out = []
    threading.Thread(target=lambda: [out.append(l) for l in p.stdout], daemon=True).start()
    send = lambda o: (p.stdin.write((json.dumps(o) + '\n').encode()), p.stdin.flush())
    send({'id': 1, 'method': 'initialize', 'params': {'clientInfo': {'name': 'governor-meter', 'version': '0'}}})
    t = time.time() + 20
    while time.time() < t and not out: time.sleep(0.3)
    send({'method': 'initialized'}); send({'id': 2, 'method': 'account/rateLimits/read', 'params': None})
    t = time.time() + 20
    while time.time() < t and not any(json.loads(l).get('id') == 2 for l in out if l.startswith(b'{')): time.sleep(0.3)
    p.kill()
    r = next(json.loads(l)['result'] for l in out if l.startswith(b'{') and json.loads(l).get('id') == 2)
    pr = r['rateLimits']['primary']
    return pr['usedPercent'], datetime.datetime.fromtimestamp(pr['resetsAt']).isoformat()[:16], r['rateLimitResetCredits']['availableCount']
if __name__ == '__main__':
    print('claude used %:', claude())
    u, at, n = codex(); print('codex used %:', u, 'resets', at, 'reset credits available', n)
