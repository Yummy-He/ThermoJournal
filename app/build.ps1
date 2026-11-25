$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location -LiteralPath $project
try {
    $buildDir = Join-Path ([IO.Path]::GetTempPath()) ('thermo-build-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $buildDir | Out-Null
    & '.\.venv\Scripts\python.exe' -m PyInstaller --noconfirm --clean --onefile --console --name 'ThermoJournal' --distpath $project --workpath $buildDir --specpath $buildDir --paths $project --add-data ((Join-Path $project 'app\web') + ';app/web') --hidden-import bleak.backends.winrt.scanner --hidden-import bleak.backends.winrt.client --collect-all winrt (Join-Path $project 'dashboard.py')
    if ($LASTEXITCODE -ne 0) { throw '构建失败' }
    Compress-Archive -LiteralPath 'ThermoJournal.exe','UserGuide.txt' -DestinationPath 'ThermoJournal-Windows-x64.zip' -Force
} finally {
    Pop-Location
}

