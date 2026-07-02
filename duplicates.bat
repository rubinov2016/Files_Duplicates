@echo off
setlocal EnableExtensions

set "DUP_ROOT=%cd%"
set "DUP_USE_DATE=false"

:parse
if "%~1"=="" goto run

if /I "%~1"=="-date" (
    set "DUP_USE_DATE=true"
    shift
    goto parse
)

if /I "%~1"=="--date" (
    set "DUP_USE_DATE=true"
    shift
    goto parse
)

if /I "%~1"=="-h" goto help
if /I "%~1"=="--help" goto help

set "DUP_ROOT=%~1"
shift
goto parse

:run
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "$Root = $env:DUP_ROOT;" ^
  "$UseDate = [System.Convert]::ToBoolean($env:DUP_USE_DATE);" ^
  "$Ext = @('.jpg','.jpeg','.png','.gif','.bmp','.tif','.tiff','.webp','.heic','.heif');" ^
  "if (-not (Test-Path -LiteralPath $Root -PathType Container)) { throw ('Folder not found: ' + $Root) }" ^
  "$RootItem = Get-Item -LiteralPath $Root;" ^
  "$OutFile = Join-Path $RootItem.FullName ('image_duplicates_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.csv');" ^
  "$Files = Get-ChildItem -LiteralPath $RootItem.FullName -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $Ext -contains $_.Extension.ToLowerInvariant() };" ^
  "$Groups = $Files | Group-Object -Property { if ($UseDate) { $_.Name + '|' + $_.Length + '|' + $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss') } else { $_.Name + '|' + $_.Length } } | Where-Object { $_.Count -gt 1 };" ^
  "$GroupNo = 0;" ^
  "$Rows = foreach ($G in $Groups) { $GroupNo++; foreach ($F in $G.Group) { [pscustomobject]@{ Group=$GroupNo; FileName=$F.Name; SizeBytes=$F.Length; Modified=$F.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'); FullPath=$F.FullName } } };" ^
  "Write-Host ('Checked image files: ' + $Files.Count);" ^
  "Write-Host ('Duplicate groups: ' + $Groups.Count);" ^
  "if ($Rows) { $Rows | Sort-Object Group, FullPath | Export-Csv -LiteralPath $OutFile -NoTypeInformation -Encoding UTF8; Write-Host ('Report saved: ' + $OutFile) } else { Write-Host 'No duplicates found.' }"

if errorlevel 1 (
    echo Error occurred.
    exit /b 1
)

exit /b 0

:help
echo Usage:
echo   %~nx0 [folder] [-date]
echo.
echo Examples:
echo   %~nx0
echo   %~nx0 "D:\Photos"
echo   %~nx0 "D:\Photos" -date
exit /b 0