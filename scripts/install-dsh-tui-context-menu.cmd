@echo off
setlocal

reg.exe import "%~dp0install-dsh-tui-context-menu.reg" >nul
if errorlevel 1 (
  echo Failed to register the standard DSH Mini TUI context menu.
  exit /b 1
)

reg.exe import "%~dp0install-dsh-tui-full-access-context-menu.reg" >nul
if errorlevel 1 (
  echo The standard menu was registered, but the full-access menu failed.
  exit /b 1
)

echo DSH Mini TUI context menus registered for the current user.
exit /b 0
