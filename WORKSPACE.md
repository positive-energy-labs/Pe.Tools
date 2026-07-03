# MONOREPO SETUP

```md
source/pea/
apps/
pea/ # installed user CLI, TUI, local web/protocol server
peco/ # your private repo/Revit dev workflow agent
ui/ # local web UI, launched/served by pea. probably home to both chat app and profile editor
cli/ # MAYBE??? using opentui
packages/
runtime/ # shared runtime/session/protocol-neutral pieces
host-contracts/ # generated Effect schemas/RPC contracts and TS-owned host operation types
schema-runtime/ # TS schema/document helpers
schema-ui/ # form/view model helpers for profile UI
pea-tools/ # user/operator-safe tools
peco-tools/ # RRD, build, dev-loop, repo-only tools
```

new pea/peco structure something like this:

```
pea agent            # user-facing operator agent
pea ui               # starts local profile/chat UI
pea host status      # okay as product diagnostics
pea host logs        # okay, bounded diagnostics
pea profile ...      # NEW validate/open/save/profile-authoring helpers
pea script ...       # only if you truly want user-visible scripting

Move these to peco:

peco              # your repo coding/dev agent
peco live ...
peco rrd ...
peco test ...
peco codegen ...
peco talk-to-pea ...
peco sync ...
peco dev-loop ...
```
