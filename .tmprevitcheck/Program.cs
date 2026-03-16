using System.Runtime.Loader;

var path = @"C:\Program Files\Autodesk\Revit 2025\RevitAPI.dll";
Console.WriteLine($"Process bitness: {(Environment.Is64BitProcess ? "x64" : "x86")}");

try {
    var assembly = AssemblyLoadContext.Default.LoadFromAssemblyPath(path);
    Console.WriteLine($"Loaded: {assembly.FullName}");

    var builtInCategoryType = assembly.GetType("Autodesk.Revit.DB.BuiltInCategory");
    Console.WriteLine(builtInCategoryType?.FullName ?? "Type not found");
} catch (Exception ex) {
    Console.WriteLine(ex);
    if (ex.InnerException != null) {
        Console.WriteLine("INNER:");
        Console.WriteLine(ex.InnerException);
    }
}
