# MONOREPO SETUP

```md
source/pea/
  apps/
    pea/              # installed user CLI, TUI, local web/protocol server
    pe-code/          # your private repo/Revit dev workflow agent
    ui/               # local web UI, launched/served by pea. probably home to both chat app and profile editor
    cli/              # MAYBE??? using opentui
  packages/
    runtime/          # shared runtime/session/protocol-neutral pieces
    host-generated/   # generated TS host types/catalog/client only
    host-client/      # small hand wrappers over generated host calls
    schema-runtime/   # TS schema/document helpers
    schema-ui/        # form/view model helpers for profile UI
    pea-tools/        # user/operator-safe tools
    pe-code-tools/    # RRD, build, dev-loop, repo-only tools
```

new pea/pe-code structure something like this: 
```
pea agent            # user-facing operator agent
pea ui               # starts local profile/chat UI
pea host status      # okay as product diagnostics
pea host logs        # okay, bounded diagnostics
pea profile ...      # NEW validate/open/save/profile-authoring helpers
pea script ...       # only if you truly want user-visible scripting

Move these to pe-code:

pe-code              # your repo coding/dev agent
pe-code live ...
pe-code rrd ...
pe-code test ...
pe-code codegen ...
pe-code talk-to-pea ...
pe-code sync ...
pe-code dev-loop ...
```
