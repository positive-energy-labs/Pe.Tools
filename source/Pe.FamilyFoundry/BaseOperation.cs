using Pe.Extensions.FamDocument;
using System.Diagnostics;

namespace Pe.FamilyFoundry;

/// <summary>
///     Creates an abort operation exception with a message explaining why the operation was aborted.
/// </summary>
public class AbortOperationException(string message) : Exception(Clean(message)) {
    private static readonly string DefaultMessage = "Aborted: no more work to do.";

    private static string Clean(string message) =>
        string.IsNullOrWhiteSpace(message) ? DefaultMessage : message;

    /// <summary>
    ///     Creates an OperationLog for this abort with the operation name and abort reason as a skipped entry.
    /// </summary>
    internal OperationLog ToOperationLog(string operationName) =>
        new(operationName, [new LogEntry("Aborted").Skip(this.Message)]);
}

public interface IExecutable {
    Func<FamilyDocument, FamilyProcessingContext, List<OperationLog>> ToFunc(OperationContext groupContext);
}

public interface IOperation : IExecutable {
    string Name { get; set; }
    string Description { get; }
    IOperationSettings Settings { get; }
    OperationLog Execute(FamilyDocument doc, FamilyProcessingContext processingContext, OperationContext groupContext);
}

/// <summary>
///     Base abstract class for document-level operations.
///     Document-level operations are executed on the entire family document all at once.
/// </summary>
public abstract class DocOperation<TSettings>(TSettings settings) : IOperation
    where TSettings : IOperationSettings {
    private string? _nameOverride;

    public TSettings Settings { get; set; } = settings;
    public abstract string Description { get; }

    /// <summary>
    ///     Gets the operation name. Returns the type name by default, or the override value if set.
    ///     Setting a value creates an override that will be returned instead of the type name.
    /// </summary>
    public string Name {
        get => this._nameOverride ?? this.GetType().Name;
        set => this._nameOverride = value;
    }

    IOperationSettings IOperation.Settings => this.Settings;

    public Func<FamilyDocument, FamilyProcessingContext, List<OperationLog>> ToFunc(OperationContext groupContext) =>
        (famDoc, processingContext) => {
            try {
                var sw = Stopwatch.StartNew();
                var log = this.Execute(famDoc, processingContext, groupContext);
                log ??= new OperationLog("No Logs", []);
                sw.Stop();
                log.MsElapsed = sw.Elapsed.TotalMilliseconds;
                return [log];
            } catch (Exception ex) {
                return [
                    new OperationLog(
                        $"{this.Name}: (FATAL ERROR)",
                        [new LogEntry(ex.GetType().Name).Error(ex)])
                ];
            }
        };

    /// <summary>
    ///     Execute the operation. Use the contexts you need, ignore the rest.
    ///     - processingContext: Read-only snapshot data (parameters, types, etc.)
    ///     - groupContext: Shared state for coordinating with other operations in a group (null if not in a group)
    /// </summary>
    public abstract OperationLog Execute(
        FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext
    );
}

/// <summary>
///     Base abstract class for type-level operations.
///     Type-level operations are executed for each type in the family document.
///     The OperationEnqueuer batches consecutive type-operations for better performance.
/// </summary>
public abstract class TypeOperation<TSettings>(TSettings settings) : IOperation
    where TSettings : IOperationSettings {
    private string? _nameOverride;

    public TSettings Settings { get; set; } = settings;
    public abstract string Description { get; }

    /// <summary>
    ///     Gets the operation name. Returns the type name by default, or the override value if set.
    ///     Setting a value creates an override that will be returned instead of the type name.
    /// </summary>
    public string Name {
        get => this._nameOverride ?? this.GetType().Name;
        set => this._nameOverride = value;
    }

    IOperationSettings IOperation.Settings => this.Settings;

    public Func<FamilyDocument, FamilyProcessingContext, List<OperationLog>> ToFunc(OperationContext groupContext) =>
        (famDoc, processingContext) => {
            try {
                var fm = famDoc.FamilyManager;
                var typeLogs = new List<OperationLog>();
                var famTypes = fm.Types.Cast<FamilyType>()
                    .OrderBy(t => t == fm.CurrentType ? 0 : 1)
                    .ThenBy(t => t.Name)
                    .ToList();

                // Loop over types and execute the operation for each type
                try {
                    foreach (var famType in famTypes) {
                        var swType = Stopwatch.StartNew();
                        fm.CurrentType = famType;
                        var typeLog = this.Execute(famDoc, processingContext, groupContext);
                        swType.Stop();

                        typeLog.MsElapsed = swType.Elapsed.TotalMilliseconds;
                        foreach (var entry in typeLog.Entries) entry.SetFamilyType(famType.Name);
                        typeLogs.Add(typeLog);
                    }

                    return [
                        new OperationLog(
                            this.Name,
                            typeLogs.SelectMany(log => log.Entries).ToList()
                        ) { MsElapsed = typeLogs.Sum(log => log.MsElapsed) }
                    ];
                } catch (AbortOperationException abort) {
                    return [abort.ToOperationLog(this.Name)];
                }
            } catch (Exception ex) {
                return [new OperationLog(this.Name, [new LogEntry(ex.GetType().Name).Error(ex)])];
            }
        };

    /// <summary>
    ///     Execute the operation for the current family type. Use the contexts you need, ignore the rest.
    ///     - processingContext: Read-only snapshot data (parameters, types, etc.)
    ///     - groupContext: Shared state for coordinating with other operations in a group (null if not in a group)
    /// </summary>
    /// <exception cref="AbortOperationException">
    ///     Throw this to abort an operation (and avoid further type switches) if there
    ///     is no more work to do.
    /// </exception>
    public abstract OperationLog Execute(
        FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext
    );

    public void AbortOperation(string message) => throw new AbortOperationException(message);
}

public class MergedTypeOperation(List<(IOperation Op, OperationContext Ctx)> operations) : IExecutable {
    private readonly HashSet<IOperation> _abortedOps = [];

    public List<(IOperation Op, OperationContext Ctx)> Operations { get; } = operations;

    public Func<FamilyDocument, FamilyProcessingContext, List<OperationLog>> ToFunc(OperationContext ignoredContext) =>
        (famDoc, processingContext) => {
            string? currFamTypeName = null;
            string? currOpName = null;
            try {
                var fm = famDoc.FamilyManager;
                var operationLogs = new List<OperationLog>();

                // Order types: current type first, then alphabetically (minimize type switches)
                var famTypes = fm.Types.Cast<FamilyType>()
                    .OrderBy(t => t == fm.CurrentType ? 0 : 1)
                    .ThenBy(t => t.Name)
                    .ToList();

                // Switch types once, executing all operations per type
                foreach (var famType in famTypes) {
                    // All operations aborted - exit early
                    if (this._abortedOps.Count == this.Operations.Count)
                        break;

                    currFamTypeName = famType.Name;
                    var typeSwitchSw = Stopwatch.StartNew();
                    fm.CurrentType = famType;
                    typeSwitchSw.Stop();
                    var activeOpsCount = this.Operations.Count - this._abortedOps.Count;
                    var amortizedSwitchMs = activeOpsCount > 0
                        ? typeSwitchSw.Elapsed.TotalMilliseconds / activeOpsCount
                        : 0;

                    // Execute all non-aborted operations for this type
                    foreach (var (op, ctx) in this.Operations) {
                        if (this._abortedOps.Contains(op)) continue;

                        try {
                            currOpName = op.Name;
                            var opSw = Stopwatch.StartNew();
                            var log = op.Execute(famDoc, processingContext, ctx);

                            opSw.Stop();

                            log.MsElapsed = opSw.Elapsed.TotalMilliseconds + amortizedSwitchMs;
                            foreach (var entry in log.Entries) entry.SetFamilyType(currFamTypeName);
                            operationLogs.Add(log);
                        } catch (AbortOperationException abort) {
                            _ = this._abortedOps.Add(op);
                            // Record the abort as a skipped log entry
                            operationLogs.Add(abort.ToOperationLog(op.Name));
                        }
                    }
                }

                // Combine logs by operation name
                return operationLogs
                    .GroupBy(log => log.OperationName)
                    .Select(group => new OperationLog(group.Key, group.SelectMany(log => log.Entries).ToList()) {
                        MsElapsed = group.Sum(log => log.MsElapsed)
                    })
                    .ToList();
            } catch (Exception ex) {
                var errorLog = new LogEntry(currFamTypeName ?? "Unknown Family Type").Error(ex);
                return [
                    new OperationLog(
                        $"Operation {currOpName ?? "Unknown Operation"} (FATAL ERROR)",
                        [errorLog])
                ];
            }
        };
}

public interface IOperationSettings {
    bool Enabled { get; init; }
}

public class DefaultOperationSettings : IOperationSettings {
    public bool Enabled { get; init; } = true;
}

/// <summary>
///     Container for grouping related operations that share settings. Groups are not operations themselves.
///     A consequence of this is that settings.Enabled has no bearing on the individual operation/s Enabled state
///     unless you manually map this in the construction of the operations.
///     The name is automatically derived from the type name.
///     Groups create a shared OperationContext for inter-operation coordination.
/// </summary>
public class OperationGroup<TSettings> where TSettings : IOperationSettings {
    /// <summary>
    ///     Creates an operation group with work items for inter-operation coordination.
    ///     The key selector extracts a string key from work items for tracking handled state.
    /// </summary>
    protected OperationGroup(
        string description,
        List<IOperation> operations,
        IEnumerable<string> groupContextKeys
    ) {
        this.Description = description;
        this.Operations = operations;
        this.GroupContext = new OperationContext();

        // Initialize context entries from work items
        foreach (var key in groupContextKeys) this.GroupContext.InitializeEntry(key);
    }

    public string Name => this.GetType().Name;

    /// <summary>
    ///     Shared context for inter-operation coordination within this group.
    ///     Reset per-family by the OperationQueue to ensure clean state for each family.
    /// </summary>
    public OperationContext GroupContext { get; }

    public string Description { get; init; }
    public List<IOperation> Operations { get; init; }
}