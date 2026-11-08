# Fans ledger

## Decided

## Tried & rejected

## Owed

- Replace the Revert journey settlement wait `findByRole` for Write to Revit, introduced by `4fef696a`, with readiness. Evidence: `.artifacts/runs/kernel-crusade-20261104/takeover/WAVE-5.md:548`.
- Fix cold-load of product-generated Fans URLs: target validation and router canonicalization quote a valid target object as a JSON string; reproduced at `9ade3c3e` and `4b6bfec7`. Evidence: `.artifacts/runs/kernel-crusade-20261104/takeover/DIAGNOSE-FANS-TARGET-URL-REPORT.md`.
