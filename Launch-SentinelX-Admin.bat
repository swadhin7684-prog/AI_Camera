@echo off
title SentinelX AI — Super Admin Control Plane
cd /d "%~dp0"
echo ========================================================
echo Starting SentinelX Admin (Company & License Control)...
echo ========================================================
call npm run start:admin
pause
