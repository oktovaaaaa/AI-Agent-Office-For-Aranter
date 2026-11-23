@echo off
REM Build ulang model 3D dari script Blender ke assets\office.glb & assets\agents.glb
cd /d "%~dp0"
set BLENDER="C:\Program Files\Blender Foundation\Blender 5.3\blender.exe"
%BLENDER% -b --factory-startup --python blender\build_office.py
%BLENDER% -b --factory-startup --python blender\build_agents.py
echo.
echo Selesai. File .blend untuk diedit manual: blender\office.blend dan blender\agents.blend
pause
