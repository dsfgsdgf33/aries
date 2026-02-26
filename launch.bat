@echo off
title ARIES v5.0 (Watchdog)
cd /d "%~dp0"
set NODE_TLS_REJECT_UNAUTHORIZED=0
node watchdog.js
pause
