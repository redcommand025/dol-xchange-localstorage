@echo off

:: Set working directory
pushd %~dp0
node "%~dp0devTools\generate-music-library.cjs"
if errorlevel 1 exit /b 1
@set TWEEGO_PATH="%~dp0devTools\tweego\StoryFormats"

:: Run the appropriate compiler for the user's CPU architecture.
if %PROCESSOR_ARCHITECTURE% == AMD64 (
	CALL "%~dp0devTools\tweego\tweego_win64.exe" -o "%~dp0Degrees of Lewdity VERSION.html" --head "%~dp0devTools\head.html" "%~dp0game" --module "%~dp0modules"
) else (
	CALL "%~dp0devTools\tweego\tweego_win86.exe" -o "%~dp0Degrees of Lewdity VERSION.html" --head "%~dp0devTools\head.html" "%~dp0game" --module "%~dp0modules"
)

:: tweego places --head content after SugarCube's libraries; copy the storage fallback to the top of <head>.
:: Needs Python 3 on PATH. Without it the build still works, but blocked-storage browsers will fail to start.
set "DOL_PY="
where py >nul 2>nul && set "DOL_PY=py -3"
if not defined DOL_PY where python >nul 2>nul && set "DOL_PY=python"
if defined DOL_PY (
	%DOL_PY% "%~dp0devTools\prepend-storage-fallback.py" "%~dp0Degrees of Lewdity VERSION.html"
) else (
	echo WARNING: Python not found; storage fallback was not prepended to the compiled HTML.
)
