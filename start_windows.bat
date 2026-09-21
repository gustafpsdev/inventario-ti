@echo off
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Python nao encontrado. Instale o Python 3.11 ou superior e marque Add Python to PATH.
  pause
  exit /b 1
)
echo.
echo ==============================================
echo   INVENTARIO E GESTAO DE ATIVOS DE TI
echo ==============================================
echo Abra no servidor: http://localhost:8086
echo Em outros PCs:    http://IP-DESTE-PC:8086
echo.
start "" http://localhost:8086
python server.py
pause
