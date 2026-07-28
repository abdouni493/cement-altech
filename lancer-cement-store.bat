@echo off
title Cement Store — Application Vente & Fabrication de Ciment
cd /d "%~dp0"
echo ==================================================
echo    CEMENT STORE — Demarrage de l'application...
echo    Vente ^& Fabrication de Ciment
echo    Gardez cette fenetre OUVERTE pendant l'usage.
echo    Fermez-la pour arreter l'application.
echo ==================================================
echo.
if not exist "node_modules" (
  echo Installation des dependances ^(premier lancement^)...
  call npm install
)
call npm run dev -- --open
echo.
echo L'application s'est arretee.
pause
