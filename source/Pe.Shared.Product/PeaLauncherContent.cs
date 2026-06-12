namespace Pe.Shared.Product;

public static class PeaLauncherContent {
    public static string Create(string commandName = "pea") =>
        $$"""
        @echo off
        setlocal EnableExtensions EnableDelayedExpansion
        set "PEA_ROOT=%~dp0"
        set "PEA_COMMAND={{commandName}}"
        set "PEA_MODE=%PEA_RUNTIME%"
        if "%PEA_PNPM%"=="" (
          if exist "%ProgramData%\chocolatey\bin\pnpm.exe" (
            set "PEA_PNPM=%ProgramData%\chocolatey\bin\pnpm.exe"
          ) else (
            set "PEA_PNPM=pnpm"
          )
        )

        if /i "%PEA_COMMAND%"=="peco" set "PEA_MODE=dev"

        if /i "%~1"=="--installed" (
          set "PEA_MODE=installed"
          shift /1
        ) else if /i "%~1"=="--dev" (
          set "PEA_MODE=dev"
          shift /1
        )

        set "PEA_ARGS="
        :collect_args
        if "%~1"=="" goto args_done
        set "PEA_ARGS=!PEA_ARGS! "%~1""
        shift /1
        goto collect_args
        :args_done

        if "%PEA_MODE%"=="" (
          if exist "%PEA_ROOT%dev-source.txt" (
            set "PEA_MODE=dev"
          ) else (
            set "PEA_MODE=installed"
          )
        )
        if /i "%PEA_MODE%"=="installed" goto installed
        if /i "%PEA_MODE%"=="dev" goto dev

        >&2 echo Unknown pea runtime mode '%PEA_MODE%'. Use --installed, --dev, or PEA_RUNTIME=installed/dev.
        exit /b 1

        :dev
        set "PEA_DEV_SOURCE=%PEA_ROOT%dev-source.txt"
        if exist "!PEA_DEV_SOURCE!" (
          set /p PEA_REPO_ROOT=<"!PEA_DEV_SOURCE!"
          set "PEA_TOOLS_ROOT=!PEA_REPO_ROOT!\source\pe-tools"
          set "PEA_APP_MAIN=!PEA_TOOLS_ROOT!\apps\pea\src\main.ts"
          set "PECO_APP_MAIN=!PEA_TOOLS_ROOT!\apps\pe-code\src\main.ts"
          if /i "%PEA_COMMAND%"=="peco" (
            if exist "!PECO_APP_MAIN!" (
              cd /d "!PEA_TOOLS_ROOT!"
              "!PEA_PNPM!" --dir "!PEA_TOOLS_ROOT!" --filter @pe/peco peco !PEA_ARGS!
              exit /b !ERRORLEVEL!
            )
          ) else (
            if exist "!PEA_APP_MAIN!" (
              cd /d "!PEA_TOOLS_ROOT!"
              "!PEA_PNPM!" --dir "!PEA_TOOLS_ROOT!" --filter @pe/pea pea !PEA_ARGS!
              exit /b !ERRORLEVEL!
            )
          )
        )

        >&2 echo source-linked pea/peco is not linked or is incomplete. Run pe-dev pea link-dev from the repo.
        exit /b 1

        :installed
        if /i "%PEA_COMMAND%"=="peco" (
          >&2 echo peco is source-linked only. Run pe-dev pea link-dev from the repo.
          exit /b 1
        )
        set "PEA_CURRENT=%PEA_ROOT%current.txt"
        if not exist "%PEA_CURRENT%" (
          >&2 echo pea is installed, but no active payload version is configured.
          >&2 echo Reinstall Pe.Tools or run pea runtime update from a repaired installation.
          exit /b 1
        )
        set /p PEA_VERSION=<"%PEA_CURRENT%"
        set "PEA_VERSION_ROOT=%PEA_ROOT%versions\%PEA_VERSION%"
        set "PEA_BUN=%PEA_VERSION_ROOT%\bun.exe"
        set "PEA_MAIN=%PEA_VERSION_ROOT%\app\installed-main.js"
        if not exist "%PEA_BUN%" (
          >&2 echo pea payload '%PEA_VERSION%' is missing bun.exe.
          exit /b 1
        )
        if not exist "%PEA_MAIN%" (
          >&2 echo pea payload '%PEA_VERSION%' is missing app\installed-main.js.
          exit /b 1
        )
        "%PEA_BUN%" "%PEA_MAIN%" !PEA_ARGS!
        exit /b !ERRORLEVEL!
        """;
}
