@echo off

:: Set working directory
pushd %~dp0
node "%~dp0devTools\generate-music-library.cjs"
if errorlevel 1 exit /b 1
node "%~dp0devTools\generate-imagepack-manifest.cjs"
if errorlevel 1 exit /b 1
@set TWEEGO_PATH="%~dp0devTools\tweego\StoryFormats"

:: Run the appropriate compiler for the user's CPU architecture.
if %PROCESSOR_ARCHITECTURE% == AMD64 (
	CALL "%~dp0devTools\tweego\tweego_win64.exe" -o "%~dp0Degrees of Lewdity VERSION.html" --head "%~dp0devTools\head.html" "%~dp0game" --module "%~dp0modules"
) else (
	CALL "%~dp0devTools\tweego\tweego_win86.exe" -o "%~dp0Degrees of Lewdity VERSION.html" --head "%~dp0devTools\head.html" "%~dp0game" --module "%~dp0modules"
)
