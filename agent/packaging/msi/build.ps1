# Build MSI installer for ServerKit Agent
# Usage: .\build.ps1 -Version "1.0.0" -BinaryPath "..\dist\serverkit-agent-windows-amd64.exe"

param(
    [string]$Version = "1.0.0",
    [string]$BinaryPath = "..\..\dist\serverkit-agent-windows-amd64.exe",
    [string]$OutputDir = ".\output"
)

$ErrorActionPreference = "Stop"

Write-Host "Building MSI installer..."
Write-Host "  Version: $Version"
Write-Host "  Binary: $BinaryPath"

# Check for WiX Toolset
$wixPath = Get-Command wix -ErrorAction SilentlyContinue
if (-not $wixPath) {
    Write-Host "WiX Toolset not found. Please install it first:"
    Write-Host "  winget install WixToolset.WixToolset"
    Write-Host "  or download from: https://wixtoolset.org/"
    exit 1
}

# Create build directory
$buildDir = New-Item -ItemType Directory -Force -Path "$env:TEMP\serverkit-msi-build-$(Get-Random)"
Write-Host "Build directory: $buildDir"

try {
    # Copy binary
    Copy-Item $BinaryPath "$buildDir\serverkit-agent.exe"

    # Create default config file
    $configContent = @"
# ServerKit Agent Configuration
# This file is created during installation.
# Run 'serverkit-agent register' to configure the agent.

server:
  url: ""
  reconnect_interval: 5s
  max_reconnect_interval: 5m
  ping_interval: 30s

agent:
  id: ""
  name: ""

features:
  docker: true
  metrics: true
  logs: true
  file_access: false
  exec: false

metrics:
  enabled: true
  interval: 10s

docker:
  socket: npipe:////./pipe/docker_engine
  timeout: 30s

logging:
  level: info
  file: C:\ProgramData\ServerKit\Agent\logs\agent.log
  max_size_mb: 100
  max_backups: 5
  max_age_days: 30
  compress: true
"@
    $configContent | Out-File -FilePath "$buildDir\config.yaml" -Encoding UTF8

    # Create license file (RTF format required by WiX)
    $licenseContent = @"
{\rtf1\ansi\deff0
{\fonttbl{\f0 Consolas;}}
\f0\fs20
MIT License\par
\par
Copyright (c) 2024 ServerKit\par
\par
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:\par
\par
The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.\par
\par
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.\par
}
"@
    $licenseContent | Out-File -FilePath "$buildDir\License.rtf" -Encoding ASCII

    # Copy WiX source
    Copy-Item "Product.wxs" "$buildDir\"

    # Create output directory
    New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

    # Build MSI
    Push-Location $buildDir
    try {
        Write-Host "Running WiX build..."
        wix build Product.wxs -o "$OutputDir\serverkit-agent-$Version-x64.msi" -define Version=$Version
    }
    finally {
        Pop-Location
    }

    Write-Host ""
    Write-Host "MSI built successfully!"
    Write-Host "Output: $OutputDir\serverkit-agent-$Version-x64.msi"
}
finally {
    # Cleanup
    Remove-Item -Recurse -Force $buildDir -ErrorAction SilentlyContinue
}
