@echo off
chcp 65001 >nul
title Fish语音本地代理 (关闭窗口即停止)
cd /d "%~dp0"
where node >nul 2>nul || (echo [错误] 未找到 Node.js, 请先安装 Node 18+ & pause & exit /b)
node fish-proxy.js
pause
