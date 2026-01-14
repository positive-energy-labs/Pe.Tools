namespace Pe.Global.Services.Storage.Core.Json;

// ============================================================
// INTERFACES - Restrictive interfaces for different operation types
// ============================================================

public interface JsonReader<out T> {
    string FilePath { get; }
    T Read();
}

public interface JsonWriter<in T> {
    string FilePath { get; }
    string Write(T data);
}

public interface JsonReadWriter<T> : JsonReader<T>, JsonWriter<T> where T : class, new() {
    bool IsCacheValid(int maxAgeMinutes, Func<T, bool>? contentValidator = null);
}

public interface CsvReader<T> {
    string FilePath { get; }
    Dictionary<string, T> Read();
    T ReadRow(string key);
}

public interface CsvWriter<T> {
    string FilePath { get; }
    string Write(Dictionary<string, T> data);
    string WriteRow(string key, T rowData);
}

public interface CsvReadWriter<T> : CsvReader<T>, CsvWriter<T> where T : class, new() {
}