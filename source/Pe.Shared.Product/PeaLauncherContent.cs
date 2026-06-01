namespace Pe.Shared.Product;

public static class PeaLauncherContent {
    public static string Create() =>
        """
        @echo off
        setlocal EnableExtensions EnableDelayedExpansion
        set "PEA_ROOT=%~dp0"
        set "PEA_MODE=%PEA_RUNTIME%"

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

        if /i "%PEA_MODE%"=="installed" goto installed

        set "PEA_DEV_SOURCE=%PEA_ROOT%dev-source.txt"
        if exist "%PEA_DEV_SOURCE%" (
          set /p PEA_REPO_ROOT=<"%PEA_DEV_SOURCE%"
          set "PEA_DEV_NODE=%PEA_REPO_ROOT%\source\pea\runtime\node\node.exe"
          set "PEA_DEV_TSX=%PEA_REPO_ROOT%\source\pea\app\node_modules\tsx\dist\cli.mjs"
          set "PEA_DEV_MAIN=%PEA_REPO_ROOT%\source\pea\app\main.ts"
          if exist "%PEA_DEV_NODE%" if exist "%PEA_DEV_TSX%" if exist "%PEA_DEV_MAIN%" (
            cd /d "%PEA_REPO_ROOT%\source\pea\app"
            "%PEA_DEV_NODE%" "%PEA_DEV_TSX%" "%PEA_DEV_MAIN%" !PEA_ARGS!
            exit /b !ERRORLEVEL!
          )
        )

        if /i "%PEA_MODE%"=="dev" (
          echo pea dev source is not linked or is incomplete. Run pe-dev pea link-dev from the repo. 1>&2
          exit /b 1
        )

        :installed
        set "PEA_CURRENT=%PEA_ROOT%current.txt"
        if not exist "%PEA_CURRENT%" (
          echo pea is installed, but no active payload version is configured. 1>&2
          echo Reinstall Pe.Tools or run pea runtime update from a repaired installation. 1>&2
          exit /b 1
        )
        set /p PEA_VERSION=<"%PEA_CURRENT%"
        set "PEA_VERSION_ROOT=%PEA_ROOT%versions\%PEA_VERSION%"
        set "PEA_NODE=%PEA_VERSION_ROOT%\node.exe"
        set "PEA_MAIN=%PEA_VERSION_ROOT%\dist\main.js"
        if not exist "%PEA_NODE%" (
          echo pea payload '%PEA_VERSION%' is missing node.exe. 1>&2
          exit /b 1
        )
        if not exist "%PEA_MAIN%" (
          echo pea payload '%PEA_VERSION%' is missing dist\main.js. 1>&2
          exit /b 1
        )
        "%PEA_NODE%" "%PEA_MAIN%" !PEA_ARGS!
        exit /b !ERRORLEVEL!
        """;
}
