function Invoke-GateSdk($exe, $arguments, $name) {
    & $exe @arguments --json > "$run\$name.json" 2> "$run\$name.stderr.txt"
    $code = $LASTEXITCODE
    @{ name = $name; argv = $arguments; executable = $exe; sha256 = (Get-FileHash $exe).Hash; exitCode = $code } | ConvertTo-Json -Compress | Add-Content "$run\commands.jsonl"
    return Get-Content "$run\$name.json" -Raw | ConvertFrom-Json
}
function AssertCandidate($plan, $config, [long]$candidateLength) {
    $msi = @($config.files | Where-Object role -eq 'candidateMsi')[0]
    if (!$plan.available -or $plan.current -ne $config.previousVersion -or $plan.latest -ne $config.candidateVersion -or $plan.msi.digest -ne ('sha256:' + $msi.sha256.ToLowerInvariant()) -or $plan.msi.size -ne $candidateLength) { throw 'Published feed does not offer the exact expected candidate.' }
    if (@($plan.revits).Count -ne 0 -or @($plan.effects.restartYears).Count -ne 0 -or @($plan.effects.reopen).Count -ne 0 -or @($plan.blockers).Count -ne 0) { throw 'Sandbox update must have an empty Revit fleet and no document restoration.' }
}
function AssertTerminal($receipt) {
    if ($receipt.state -ne 'ok' -or @($receipt.legs | Where-Object { $_.status -in 'failed', 'refused', 'warning' }).Count -or !@($receipt.legs | Where-Object { $_.name -eq 'install' -and $_.status -eq 'ok' -and $_.exitCode -in 0, 3010 }).Count -or !@($receipt.legs | Where-Object { $_.name -eq 'done' -and $_.status -eq 'ok' }).Count) { throw 'Update has no successful terminal installation/restoration receipt.' }
}
