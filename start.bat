@echo off
title Pijar Server
color 0A
echo ========================================
echo    🚀 PIJAR EDUCATION SERVER
echo ========================================
echo.
cd /d "%~dp0"
echo 📦 Checking dependencies...
call npm install
echo.
echo 🚀 Starting server on http://localhost:9090
echo 📊 Admin: http://localhost:9090/admin.html
echo 🎓 Pijar: http://localhost:9090/index.html
echo.
echo Press Ctrl+C to stop
echo ========================================
echo.
npm start