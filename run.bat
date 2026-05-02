@echo off
chcp 65001 >nul
echo ========================================
echo  ระบบแจ้งซ่อมเครื่องจักร V11
echo  LINE Server (optional — for notifications)
echo ========================================
cd /d "%~dp0"
python line_server.py
pause
