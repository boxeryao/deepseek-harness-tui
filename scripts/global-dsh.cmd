@echo off
node "%~dp0global-dsh-launcher.mjs" %*
exit /b %ERRORLEVEL%
