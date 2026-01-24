#Requires -RunAsAdministrator
<#
.SYNOPSIS
    ServerKit Agent Installation Script for Windows

.DESCRIPTION
    Downloads and installs the ServerKit Agent on Windows systems.

.PARAMETER Token
    Registration token from ServerKit (required)

.PARAMETER Server
    ServerKit server URL (required)

.PARAMETER Name
    Display name for this server (optional)

.PARAMETER Version
    Specific agent version to install (optional, defaults to latest)

.EXAMPLE
    .\install.ps1 -Token "sk_reg_xxx" -Server "https://your-serverkit.com"

.EXAMPLE
    irm https://your-serverkit.com/install.ps1 | iex; Install-ServerKitAgent -Token "sk_reg_xxx" -Server "https://your-serverkit.com"

.NOTES
    Requires Administrator privileges.
#>

param(
    [Parameter(Mandatory=$false)]
    [string]$Token,

    [Parameter(Mandatory=$false)]
    [string]$Server,

    [Parameter(Mandatory=$false)]
    [string]$Name,

    [Parameter(Mandatory=$false)]
    [string]$Version = "latest"
)

# Configuration
$InstallDir = "$env:ProgramFiles\ServerKit"
$ConfigDir = "$env:ProgramData\ServerKit"
$ServiceName = "ServerKitAgent"
$GitHubRepo = "serverkit/serverkit"
$AgentBinary = "serverkit-agent.exe"

# Colors
function Write-ColorOutput {
    param(
        [string]$Message,
        [string]$Type = "Info"
    )

    switch ($Type) {
        "Info"    { Write-Host "[INFO] " -ForegroundColor Cyan -NoNewline; Write-Host $Message }
        "Success" { Write-Host "[SUCCESS] " -ForegroundColor Green -NoNewline; Write-Host $Message }
        "Warning" { Write-Host "[WARN] " -ForegroundColor Yellow -NoNewline; Write-Host $Message }
        "Error"   { Write-Host "[ERROR] " -ForegroundColor Red -NoNewline; Write-Host $Message }
    }
}

function Write-Banner {
    Write-Host ""
    Write-Host "╔═══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║               ServerKit Agent Installer                    ║" -ForegroundColor Cyan
    Write-Host "╚═══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
}

function Test-Administrator {
    $currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-LatestVersion {
    if ($Version -eq "latest") {
        Write-ColorOutput "Fetching latest version..." "Info"

        try {
            $releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$GitHubRepo/releases" -Method Get
            foreach ($release in $releases) {
                if ($release.tag_name -match "^agent-v(.+)$") {
                    $script:Version = $Matches[1]
                    Write-ColorOutput "Latest version: v$Version" "Info"
                    return
                }
            }
            throw "No agent release found"
        }
        catch {
            Write-ColorOutput "Failed to fetch latest version: $_" "Error"
            exit 1
        }
    }
}

function Install-Agent {
    Write-ColorOutput "Downloading ServerKit Agent v$Version..." "Info"

    # Create temp directory
    $tempDir = Join-Path $env:TEMP "serverkit-install-$(Get-Random)"
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

    $downloadUrl = "https://github.com/$GitHubRepo/releases/download/agent-v$Version/serverkit-agent-$Version-windows-amd64.zip"
    $archivePath = Join-Path $tempDir "serverkit-agent.zip"

    try {
        # Download
        Write-ColorOutput "Downloading from: $downloadUrl" "Info"
        Invoke-WebRequest -Uri $downloadUrl -OutFile $archivePath -UseBasicParsing

        # Extract
        Write-ColorOutput "Extracting agent..." "Info"
        Expand-Archive -Path $archivePath -DestinationPath $tempDir -Force

        # Create install directory
        if (-not (Test-Path $InstallDir)) {
            New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
        }

        # Copy binary
        $binarySource = Join-Path $tempDir "serverkit-agent-windows-amd64.exe"
        $binaryDest = Join-Path $InstallDir $AgentBinary
        Copy-Item -Path $binarySource -Destination $binaryDest -Force

        Write-ColorOutput "Agent installed to $binaryDest" "Success"
    }
    catch {
        Write-ColorOutput "Failed to download/install agent: $_" "Error"
        exit 1
    }
    finally {
        # Cleanup
        Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function New-ConfigDirectory {
    Write-ColorOutput "Creating configuration directory..." "Info"

    if (-not (Test-Path $ConfigDir)) {
        New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null
    }
}

function Register-Agent {
    param(
        [string]$Token,
        [string]$Server,
        [string]$Name
    )

    Write-ColorOutput "Registering agent with ServerKit..." "Info"

    $agentPath = Join-Path $InstallDir $AgentBinary
    $arguments = @("register", "--token", $Token, "--server", $Server)

    if ($Name) {
        $arguments += @("--name", $Name)
    }

    try {
        $process = Start-Process -FilePath $agentPath -ArgumentList $arguments -Wait -PassThru -NoNewWindow
        if ($process.ExitCode -ne 0) {
            throw "Registration command failed with exit code: $($process.ExitCode)"
        }
        Write-ColorOutput "Agent registered successfully" "Success"
    }
    catch {
        Write-ColorOutput "Agent registration failed: $_" "Error"
        exit 1
    }
}

function Install-WindowsService {
    Write-ColorOutput "Installing Windows service..." "Info"

    $agentPath = Join-Path $InstallDir $AgentBinary

    # Check if service already exists
    $existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue

    if ($existingService) {
        Write-ColorOutput "Stopping existing service..." "Info"
        Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2

        Write-ColorOutput "Removing existing service..." "Info"
        sc.exe delete $ServiceName | Out-Null
        Start-Sleep -Seconds 2
    }

    # Create the service using sc.exe
    $binPath = "`"$agentPath`" start"
    $result = sc.exe create $ServiceName binPath= $binPath start= auto DisplayName= "ServerKit Agent"

    if ($LASTEXITCODE -ne 0) {
        Write-ColorOutput "Failed to create service: $result" "Error"
        exit 1
    }

    # Set service description
    sc.exe description $ServiceName "ServerKit Agent for remote server management" | Out-Null

    # Set service recovery options (restart on failure)
    sc.exe failure $ServiceName reset= 86400 actions= restart/60000/restart/60000/restart/60000 | Out-Null

    Write-ColorOutput "Windows service installed" "Success"
}

function Start-AgentService {
    Write-ColorOutput "Starting ServerKit Agent service..." "Info"

    try {
        Start-Service -Name $ServiceName
        Start-Sleep -Seconds 3

        $service = Get-Service -Name $ServiceName
        if ($service.Status -eq "Running") {
            Write-ColorOutput "Agent service is running" "Success"
        }
        else {
            Write-ColorOutput "Service failed to start. Status: $($service.Status)" "Warning"
            Write-ColorOutput "Check logs in Event Viewer > Windows Logs > Application" "Info"
        }
    }
    catch {
        Write-ColorOutput "Failed to start service: $_" "Error"
    }
}

function Add-ToPath {
    Write-ColorOutput "Adding to system PATH..." "Info"

    $currentPath = [Environment]::GetEnvironmentVariable("Path", "Machine")

    if ($currentPath -notlike "*$InstallDir*") {
        $newPath = "$currentPath;$InstallDir"
        [Environment]::SetEnvironmentVariable("Path", $newPath, "Machine")
        Write-ColorOutput "Added $InstallDir to system PATH" "Success"
    }
    else {
        Write-ColorOutput "Already in PATH" "Info"
    }
}

function Write-SuccessMessage {
    Write-Host ""
    Write-Host "╔═══════════════════════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "║          Installation completed successfully!             ║" -ForegroundColor Green
    Write-Host "╚═══════════════════════════════════════════════════════════╝" -ForegroundColor Green
    Write-Host ""
    Write-Host "Agent Status:"
    Write-Host "  Binary:     $InstallDir\$AgentBinary"
    Write-Host "  Config:     $ConfigDir\config.yaml"
    Write-Host "  Service:    $ServiceName"
    Write-Host ""
    Write-Host "Useful commands:"
    Write-Host "  Check status:    Get-Service $ServiceName"
    Write-Host "  View logs:       Get-EventLog -LogName Application -Source $ServiceName"
    Write-Host "  Restart agent:   Restart-Service $ServiceName"
    Write-Host "  Stop agent:      Stop-Service $ServiceName"
    Write-Host ""
}

# Main function for piped execution
function Install-ServerKitAgent {
    param(
        [Parameter(Mandatory=$true)]
        [string]$Token,

        [Parameter(Mandatory=$true)]
        [string]$Server,

        [Parameter(Mandatory=$false)]
        [string]$Name,

        [Parameter(Mandatory=$false)]
        [string]$Version = "latest"
    )

    # Update script-level variables
    $script:Version = $Version

    Write-Banner

    if (-not (Test-Administrator)) {
        Write-ColorOutput "This script must be run as Administrator" "Error"
        Write-Host "Right-click PowerShell and select 'Run as Administrator'"
        exit 1
    }

    Get-LatestVersion
    Install-Agent
    New-ConfigDirectory
    Register-Agent -Token $Token -Server $Server -Name $Name
    Install-WindowsService
    Start-AgentService
    Add-ToPath
    Write-SuccessMessage
}

# Direct execution with parameters
if ($Token -and $Server) {
    Install-ServerKitAgent -Token $Token -Server $Server -Name $Name -Version $Version
}
elseif ($PSBoundParameters.Count -gt 0) {
    Write-ColorOutput "Both -Token and -Server parameters are required" "Error"
    Write-Host ""
    Write-Host "Usage:"
    Write-Host "  .\install.ps1 -Token 'sk_reg_xxx' -Server 'https://your-serverkit.com'"
    exit 1
}
else {
    # Script was sourced, export the function
    Write-Host "ServerKit Agent installer loaded." -ForegroundColor Cyan
    Write-Host "Usage: Install-ServerKitAgent -Token 'sk_reg_xxx' -Server 'https://your-serverkit.com'" -ForegroundColor Gray
}
