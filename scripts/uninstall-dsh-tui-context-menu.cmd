@echo off
setlocal

reg.exe import "%~dp0uninstall-dsh-tui-context-menu.reg" >nul
if errorlevel 1 (
  echo Failed to remove the DSH Mini TUI context menus.
  exit /b 1
)

echo DSH Mini TUI context menus removed for the current user.
exit /b 0
