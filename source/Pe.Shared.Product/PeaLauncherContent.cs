namespace Pe.Shared.Product;

public static class PeaLauncherContent {
    public static string Create(string commandName = "pea") =>
        $$"""
        @echo off
        setlocal EnableExtensions EnableDelayedExpansion
        set "PEA_ROOT=%~dp0"
        set "PEA_COMMAND={{commandName}}"
        set "PEA_MODE=%PEA_RUNTIME%"

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

        echo Unknown pea runtime mode '%PEA_MODE%'. Use --installed, --dev, or PEA_RUNTIME=installed/dev. 1^>^&2
        exit /b 1

        :dev
        set "PEA_DEV_SOURCE=%PEA_ROOT%dev-source.txt"
        if exist "%PEA_DEV_SOURCE%" (
          set /p PEA_REPO_ROOT=<"%PEA_DEV_SOURCE%"
          set "PEA_TOOLS_ROOT=%PEA_REPO_ROOT%\source\pe-tools"
          set "PEA_APP_MAIN=%PEA_TOOLS_ROOT%\apps\pea\src\main.ts"
          set "PECO_APP_MAIN=%PEA_TOOLS_ROOT%\apps\pe-code\src\main.ts"
          if /i "%PEA_COMMAND%"=="peco" (
            if exist "%PECO_APP_MAIN%" (
              cd /d "%PEA_TOOLS_ROOT%"
              pnpm --dir "%PEA_TOOLS_ROOT%" --filter @pe/peco peco -- !PEA_ARGS!
              exit /b !ERRORLEVEL!
            )
          ) else (
            if exist "%PEA_APP_MAIN%" (
              cd /d "%PEA_TOOLS_ROOT%"
              pnpm --dir "%PEA_TOOLS_ROOT%" --filter @pe/pea pea -- !PEA_ARGS!
              exit /b !ERRORLEVEL!
            )
          )
        )

        echo source-linked pea/peco is not linked or is incomplete. Run pe-dev pea link-dev from the repo. 1^>^&2
        exit /b 1

        :installed
        if /i "%PEA_COMMAND%"=="peco" (
          echo peco is source-linked only. Run pe-dev pea link-dev from the repo. 1^>^&2
          exit /b 1
        )
        set "PEA_CURRENT=%PEA_ROOT%current.txt"
        if not exist "%PEA_CURRENT%" (
          echo pea is installed, but no active payload version is configured. 1^>^&2
          echo Reinstall Pe.Tools or run pea runtime update from a repaired installation. 1^>^&2
          exit /b 1
        )
        set /p PEA_VERSION=<"%PEA_CURRENT%"
        set "PEA_VERSION_ROOT=%PEA_ROOT%versions\%PEA_VERSION%"
        set "PEA_NODE=%PEA_VERSION_ROOT%\node.exe"
        set "PEA_MAIN=%PEA_VERSION_ROOT%\dist\main.js"
        if not exist "%PEA_NODE%" (
          echo pea payload '%PEA_VERSION%' is missing node.exe. 1^>^&2
          exit /b 1
        )
        if not exist "%PEA_MAIN%" (
          echo pea payload '%PEA_VERSION%' is missing dist\main.js. 1^>^&2
          exit /b 1
        )
        "%PEA_NODE%" "%PEA_MAIN%" !PEA_ARGS!
        exit /b !ERRORLEVEL!
        """;
}
