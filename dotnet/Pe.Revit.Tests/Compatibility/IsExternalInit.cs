#if NETFRAMEWORK
// net48: both NJsonSchema (public) and Pe.Revit.Takeoff (internal, via InternalsVisibleTo)
// export IsExternalInit — ambiguous (CS8356). A source-level declaration takes precedence.
namespace System.Runtime.CompilerServices;

internal static class IsExternalInit {
}
#endif
