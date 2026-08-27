@echo off
setlocal EnableExtensions
title Make image sequence

if "%~1"=="" (
  echo.
  echo  Drag a video onto this file.
  echo  Or run:  Make-Sequence.bat "C:\Videos\hero.mp4"
  echo.
  pause
  exit /b 1
)

if not exist "%~1" (
  echo File not found:
  echo   %~1
  echo.
  pause
  exit /b 1
)

where ffmpeg >nul 2>&1
if errorlevel 1 goto :noffmpeg
where ffprobe >nul 2>&1
if errorlevel 1 goto :noffmpeg

set "ISG_SELF=%~f0"
set "ISG_IN=%~f1"
set "ISG_DIR=%~dp1"
set "ISG_STEM=%~n1"
set "ISG_FILE=%~nx1"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$raw = Get-Content -LiteralPath $env:ISG_SELF -Raw; Invoke-Expression $raw.Substring($raw.LastIndexOf('<#PS#>') + 6)"
set "ERR=%ERRORLEVEL%"
echo.
if not "%ERR%"=="0" echo  Something went wrong. Screenshot this window and send it back.
pause
exit /b %ERR%

:noffmpeg
echo FFmpeg is not installed ^(or this window is using an old PATH^).
echo.
echo  1. Open PowerShell
echo  2. Run:  winget install Gyan.FFmpeg
echo  3. Close this window. If it still fails, log out of Windows and try again.
echo.
pause
exit /b 1

<#PS#>
$ErrorActionPreference = "Stop"
$in = $env:ISG_IN
$dir = $env:ISG_DIR
$stem = $env:ISG_STEM
$file = $env:ISG_FILE
$out = Join-Path $dir ($stem + "_frames")

$maxWidth = 1920
$fps = 24
$cap = 240
$quality = 75
$prefix = "frame_"

$probeJson = & ffprobe -v error -print_format json -show_format -show_streams -select_streams v:0 $in
if ($LASTEXITCODE -ne 0) { throw "ffprobe could not read that video." }
$meta = $probeJson | ConvertFrom-Json
$stream = $meta.streams[0]
if (-not $stream) { throw "No video track found." }

$duration = 0.0
[void][double]::TryParse($meta.format.duration, [ref]$duration)
if ($duration -le 0) { throw "Could not read video duration." }

$count = [Math]::Max(1, [Math]::Min($cap, [int][Math]::Round($duration * $fps)))
$extractFps = $count / $duration
$fpsStr = $extractFps.ToString("0.000000", [Globalization.CultureInfo]::InvariantCulture)
$pad = [Math]::Max(4, "$count".Length)

if (Test-Path -LiteralPath $out) {
  Write-Host "  Replacing existing folder:" $out
  Remove-Item -LiteralPath $out -Recurse -Force
}
New-Item -ItemType Directory -Path $out | Out-Null

$pattern = Join-Path $out ($prefix + "%0${pad}d.webp")
$vf = "fps=$fpsStr,scale=w=min($maxWidth\,iw):h=-2:flags=lanczos"

Write-Host ""
Write-Host "  Source  $in"
Write-Host "  Output  $out"
Write-Host "  Frames  $count   quality $quality   max width $maxWidth"
Write-Host ""

& ffmpeg -hide_banner -y -i $in -vf $vf -an -c:v libwebp -quality $quality -compression_level 6 -preset photo -start_number 1 $pattern
if ($LASTEXITCODE -ne 0) { throw "FFmpeg failed." }

$files = @(Get-ChildItem -LiteralPath $out -Filter ($prefix + "*.webp") | Sort-Object Name)
if ($files.Count -eq 0) { throw "FFmpeg finished but no .webp files were created." }

$bytes = ($files | Measure-Object -Property Length -Sum).Sum
$n = $files.Count
$manifest = [ordered]@{
  total_frames   = $n
  start_number   = 1
  pad            = $pad
  prefix         = $prefix
  extension      = "webp"
  pattern        = ($prefix + "%0${pad}d.webp")
  first_frame    = $files[0].Name
  last_frame     = $files[-1].Name
  format         = "webp"
  quality        = $quality
  fps            = [Math]::Round($extractFps, 6)
  folder_size_mb = [Math]::Round($bytes / 1e6, 2)
  source         = $file
}
$manifestPath = Join-Path $out "manifest.json"
$manifest | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding utf8

Write-Host ""
Write-Host ("  Done    {0} frames   {1:N2} MB" -f $n, ($bytes / 1e6))
Write-Host "  Folder  $out"
Write-Host ""

Invoke-Item $out
exit 0
