@echo off
title SentinelX AI — Safety Monitoring Console (User App)
cd /d "%~dp0"
echo ========================================================
echo Starting SentinelX AI (Worker Safety & Monitoring)...
echo ========================================================
call npm run start:user
pause
