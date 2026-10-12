@echo off
rem Ouvre Veille Madagascar dans le navigateur. Laisser cette fenetre ouverte pendant l'utilisation.
cd /d "%~dp0"
node serveur.js --ouvrir
pause
