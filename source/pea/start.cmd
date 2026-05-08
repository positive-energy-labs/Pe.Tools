@echo off
setlocal
set "ROOT=%~dp0"
set "PATH=%ROOT%runtime\node;%SystemRoot%\System32;%SystemRoot%;%SystemRoot%\System32\Wbem"
set "NODE_OPTIONS="
cd /d "%ROOT%app"
"%ROOT%runtime\node\node.exe" "%ROOT%app\node_modules\tsx\dist\cli.mjs" "%ROOT%app\main.ts"
