public readonly struct Result<TValue> {
    private readonly TValue? _value;
    private readonly Exception? _error;

    private Result(TValue? value, Exception? error) {
        this._value = value;
        this._error = error;
    }

    public static Result<TValue> Succeeded { get; set; }

    public void Deconstruct(out TValue? value, out Exception? error) {
        value = this._value;
        error = this._error;
    }

    public (TValue? value, Exception? error) AsTuple() => (this._value, this._error);

    public static implicit operator Result<TValue>(TValue value) =>
        new(value, null);

    public static implicit operator Result<TValue>(Exception error) =>
        new(default, error);
}

// mayber put this into the global namespace somehow
// private static ParametersApi.Parameters GetParamSvcParamInfos(
//         JsonReadWriter<ParametersApi.Parameters> svcStorageCache,
//         Parameters svcApsParams
//     ) {
//     var tcsParams = new TaskCompletionSource<Result<ParametersApi.Parameters>>();
//     _ = Task.Run(async () => {
//         try {
//             tcsParams.SetResult(await svcApsParams.GetParameters(svcStorageCache));
//         } catch (Exception ex) {
//             tcsParams.SetResult(ex);
//         }
//     });
//     tcsParams.Task.Wait();

//     var (parameters, paramsResult) = tcsParams.Task.Result;
//     return paramsResult != null ? throw paramsResult : parameters;
// }