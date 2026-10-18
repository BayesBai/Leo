@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 22.12 或更新版本。
  pause
  exit /b 1
)
if not exist "node_modules\tsx" (
  call npm install
  if errorlevel 1 (
    echo 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)
call npm run build
if errorlevel 1 (
  echo 构建失败，请查看上方错误。
  pause
  exit /b 1
)
echo.
echo 请打开终端显示的 Local 地址。关闭本窗口将停止服务。
call npm start
pause
