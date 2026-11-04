@echo off
cd /d "%~dp0"
if exist "release\win-unpacked\Messroom.exe" (
  start "" "release\win-unpacked\Messroom.exe"
) else if exist "release\Messroom 1.0.0.exe" (
  start "" "release\Messroom 1.0.0.exe"
) else (
  npm start
)
