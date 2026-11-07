param([switch]$SkipBuild)

$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    # Parse assignments as data: never execute the contents of .env.
    if (Test-Path -LiteralPath '.env') {
        foreach ($line in Get-Content -LiteralPath '.env') {
            if ($line -match '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
                $envName = $Matches[1]
                $envValue = $Matches[2].Trim()
                if ($envValue -match '^"(.*)"\s*(?:#.*)?$' -or $envValue -match "^'(.*)'\s*(?:#.*)?$") {
                    $envValue = $Matches[1]
                } else {
                    $envValue = ($envValue -replace '\s+#.*$', '').TrimEnd()
                }
                [Environment]::SetEnvironmentVariable($envName, $envValue, 'Process')
            }
        }
        Write-Host 'Loaded .env.'
    }
    $env:PYTHONUTF8 = '1'

    if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
        python -m venv .venv
        if ($LASTEXITCODE -ne 0) { throw 'Could not create the Python environment.' }
        & '.\.venv\Scripts\python.exe' -m pip install -r requirements.txt
        if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed.' }
    }
    if (-not (Test-Path -LiteralPath 'dashboard\node_modules')) {
        npm --prefix dashboard ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Dashboard dependency installation failed.' }
    }
    if (-not $SkipBuild) {
        npm --prefix dashboard run build
        if ($LASTEXITCODE -ne 0) { throw 'Dashboard build failed.' }
    }

    foreach ($port in @(8000, 9001, 5173)) {
        $probe = [System.Net.Sockets.TcpClient]::new()
        try {
            $probe.Connect('127.0.0.1', $port)
            throw "Port $port is already in use. Stop the existing server before starting again."
        } catch [System.Net.Sockets.SocketException] {
            # No listener: this port is available.
        } finally {
            $probe.Dispose()
        }
    }

    New-Item -ItemType Directory -Path logs -Force | Out-Null
    $pythonPath = (Resolve-Path '.venv\Scripts\python.exe').Path
    $nodePath = (Get-Command node).Source
    $servers = @(
        @{Name='party'; File=$pythonPath; Args='-m uvicorn party.proxy:app --host 127.0.0.1 --port 9001'; Dir=$PSScriptRoot; Url='http://127.0.0.1:9001/healthz'},
        @{Name='gateway'; File=$pythonPath; Args='-m uvicorn gateway.app:app --host 127.0.0.1 --port 8000'; Dir=$PSScriptRoot; Url='http://127.0.0.1:8000/healthz'},
        @{Name='frontend'; File=$nodePath; Args='node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort'; Dir="$PSScriptRoot\dashboard"; Url='http://127.0.0.1:5173/'}
    )
    foreach ($server in $servers) {
        $process = Start-Process -FilePath $server.File -ArgumentList $server.Args -WorkingDirectory $server.Dir -WindowStyle Hidden -RedirectStandardOutput "$PSScriptRoot\logs\$($server.Name).out.log" -RedirectStandardError "$PSScriptRoot\logs\$($server.Name).err.log" -PassThru
        Write-Host "$($server.Name) started (PID $($process.Id))."
    }
    foreach ($server in $servers) {
        $ready = $false
        for ($attempt = 0; $attempt -lt 20; $attempt++) {
            try {
                $response = Invoke-WebRequest -Uri $server.Url -UseBasicParsing -TimeoutSec 2
                if ($response.StatusCode -eq 200) { $ready = $true; break }
            } catch {
                Start-Sleep -Milliseconds 250
            }
        }
        if (-not $ready) { throw "$($server.Name) did not become ready. See logs\$($server.Name).err.log." }
    }
    Write-Host 'Frontend: http://127.0.0.1:5173'
    Write-Host 'Gateway and built dashboard: http://127.0.0.1:8000'
    Write-Host 'Party runtime: http://127.0.0.1:9001'
    Write-Host 'Servers run in the background; logs are in logs\.'
} finally {
    Pop-Location
}
