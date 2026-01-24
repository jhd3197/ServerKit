# Build script for ServerKit Agent (Windows PowerShell)
# Cross-compiles for multiple platforms

param(
    [string]$Version = "",
    [string]$Target = "all"
)

$ErrorActionPreference = "Stop"

# Get version from git or use default
if ($Version -eq "") {
    try {
        $Version = git describe --tags --always --dirty 2>$null
    } catch {
        $Version = "dev"
    }
}

$BuildTime = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
try {
    $GitCommit = git rev-parse --short HEAD 2>$null
} catch {
    $GitCommit = "unknown"
}

# Build flags
$LdFlags = "-s -w -X main.Version=$Version -X main.BuildTime=$BuildTime -X main.GitCommit=$GitCommit"

# Output directory
$DistDir = "dist"
if (-not (Test-Path $DistDir)) {
    New-Item -ItemType Directory -Path $DistDir | Out-Null
}

Write-Host "Building ServerKit Agent $Version" -ForegroundColor Cyan
Write-Host "Build time: $BuildTime"
Write-Host "Git commit: $GitCommit"
Write-Host ""

# Build targets
$Targets = @(
    @{GOOS="linux"; GOARCH="amd64"},
    @{GOOS="linux"; GOARCH="arm64"},
    @{GOOS="linux"; GOARCH="arm"},
    @{GOOS="windows"; GOARCH="amd64"},
    @{GOOS="windows"; GOARCH="arm64"},
    @{GOOS="darwin"; GOARCH="amd64"},
    @{GOOS="darwin"; GOARCH="arm64"}
)

# Filter targets if specific one requested
if ($Target -ne "all") {
    $parts = $Target.Split("/")
    $Targets = @(@{GOOS=$parts[0]; GOARCH=$parts[1]})
}

foreach ($t in $Targets) {
    $goos = $t.GOOS
    $goarch = $t.GOARCH

    $outputName = "serverkit-agent-$Version-$goos-$goarch"
    if ($goos -eq "windows") {
        $outputName = "$outputName.exe"
    }

    Write-Host "Building $goos/$goarch..." -ForegroundColor Yellow

    $env:CGO_ENABLED = "0"
    $env:GOOS = $goos
    $env:GOARCH = $goarch

    go build -ldflags $LdFlags -o "$DistDir/$outputName" ./cmd/agent

    if ($LASTEXITCODE -ne 0) {
        Write-Host "Build failed for $goos/$goarch" -ForegroundColor Red
        exit 1
    }

    # Calculate checksum
    $hash = Get-FileHash -Path "$DistDir/$outputName" -Algorithm SHA256
    Add-Content -Path "$DistDir/checksums.txt" -Value "$($hash.Hash.ToLower())  $outputName"
}

Write-Host ""
Write-Host "Build complete! Binaries in $DistDir/" -ForegroundColor Green
Get-ChildItem $DistDir
