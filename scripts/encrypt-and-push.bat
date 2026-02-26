@echo off
echo [ARIES] Building obfuscated distribution...
node scripts/build-dist.js
if errorlevel 1 (
    echo [ERROR] Build failed!
    exit /b 1
)
echo.
echo [ARIES] Pushing dist to GitHub...
cd dist
git init
git remote add origin https://github.com/dsfgsdgf33/aries.git 2>nul
git add -A
git commit -m "update"
git push -f origin main
echo.
echo [ARIES] Done!
