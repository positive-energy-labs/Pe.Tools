# Document profiler

Find suspects, test them on a copy, recommend only measured improvements. Requires Revit 2024+.

**A large element count is a clue, not a cost.** One complex object can matter more than thousands of simple ones. Unsheeted parent views can have sheeted dependents, so unsheeted does not mean unused.

## Start here

Ask Pea to run `script:@document-profiler/src/Profile.cs` with **ReadOnly** permission. It writes inventories, repeated API timings and whole-process memory observations.

For mechanical working views, run `script:@document-profiler/src/MechanicalPlanCensus.cs`. It preserves the distinction between parents and their sheeted dependents.

These reads identify candidates. They do not measure element RAM or finished drawing.

## Read existing journals

From this Pod's folder:

```powershell
python tools/journal_profile.py "C:/path/to/journal.txt" "C:/existing-folder/new-report.json"
```

The offline companion needs no Revit connection or Computer Use. It creates a new JSON file and refuses overwrite.

It separates **view creation, geometry updates, drawing and journal idle**, with source line numbers. Timings overlap: do not add them. Missing or ambiguous measurements stay unknown. First observed does not mean cold; idle does not mean finished pixels. Verified against Revit 2025.4.6 journals.

## Test a deletion

Experiments ship disabled. Configure [Settings.cs](src/Settings.cs) on an acknowledged disposable copy: exact copy/original paths, candidate UniqueIds and the same preserved elements/views across trials.

- [DeletionExperiment.cs](src/DeletionExperiment.cs): compare sham, deletion and restored controls. Record dependencies Revit also deletes. Require repeated benefit above control variation.
- [SaveVariant.cs](src/SaveVariant.cs): save a new deletion variant for fresh-process comparisons. Save/reopen behavior and RAM savings still need native proof.
- [ViewOpenProbe.cs](src/ViewOpenProbe.cs): time activation, refresh and zoom API calls, then check state restoration. These are not drawing-completion times.

All three require **NoTransaction** permission. Read their guards before enabling them. RAM comparisons require matched variants in fresh processes; rollback does not reset caches or allocations.

**Chadds result: no deletion winner is proven for mechanical-plan opening or navigation.** The GUI trial had CU/load interference. Keep API speed, drawing phases and RAM as separate outcomes.

Implementation details are in the linked source. Repository parser tests: `python tools/tests/test_journal_profile.py`.
