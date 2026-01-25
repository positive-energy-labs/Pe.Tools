namespace Pe.App.Commands.Palette.TaskPalette;

/// <summary>
///     Singleton registry for all executable tasks.
///     Handles task registration, persistence, and retrieval.
/// </summary>
public sealed class TaskRegistry {
    private static readonly Lazy<TaskRegistry> _instance = new(() => new TaskRegistry());

    private readonly Dictionary<string, ITask> _tasks = new();
    private readonly object _lock = new();

    private TaskRegistry() { }

    public static TaskRegistry Instance => _instance.Value;

    /// <summary>
    ///     Registers a task using its type name as the unique ID.
    ///     Thread-safe for future extensibility (user-defined tasks loaded in parallel).
    /// </summary>
    /// <typeparam name="T">The task type (used to generate unique ID)</typeparam>
    /// <param name="task">The task instance to register</param>
    public void Register<T>(T task) where T : ITask {
        var id = typeof(T).Name;

        lock (this._lock) {
            if (this._tasks.ContainsKey(id))
                throw new InvalidOperationException(
                    $"Task '{id}' is already registered. Each task class must have a unique name.");

            this._tasks[id] = task;
        }
    }

    /// <summary>
    ///     Gets all registered tasks with their IDs.
    /// </summary>
    public IReadOnlyList<(string Id, ITask Task)> GetAll() {
        lock (this._lock) {
            return this._tasks.Select(kvp => (kvp.Key, kvp.Value)).ToList();
        }
    }

    /// <summary>
    ///     Gets a task by ID (type name)
    /// </summary>
    public ITask GetById(string id) {
        lock (this._lock) {
            return this._tasks.GetValueOrDefault(id);
        }
    }

    /// <summary>
    ///     Gets all unique categories from registered tasks
    /// </summary>
    public IReadOnlyList<string> GetAllCategories() {
        lock (this._lock) {
            return this._tasks.Values
                .Select(t => t.Category)
                .Where(c => !string.IsNullOrEmpty(c))
                .Distinct()
                .OrderBy(c => c)
                .ToList();
        }
    }
}
