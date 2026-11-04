#Requires -RunAsAdministrator
#
# ---------------------------------------------------------------------------
# CANONICAL SOURCE: jhd3197/serverkit-agent -> install.ps1
#
# This file is VENDORED into the panel repo at ServerKit/scripts/install.ps1,
# which is the copy the panel serves at GET /api/v1/servers/install.ps1 (it has
# to exist on the panel's own disk, so the panel cannot simply link to it).
#
# Edit it in the agent repo, then re-vendor with ServerKit's
# scripts/sync-agent-installers.sh. Do not patch one copy only -- see the note
# in install.sh; ServerKit's nightly CI fails on any drift.
# ---------------------------------------------------------------------------
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

.PARAMETER Level
    Permission level: monitor (report-only, no inbound commands), protect
    (security actions only) or full (everything). If omitted: a menu on an
    interactive console, otherwise full with a warning.

.PARAMETER Reconfigure
    Required to change the level of an already-installed agent.

.PARAMETER Yes
    Skip the typed confirmation when reconfiguring.

.EXAMPLE
    .\install.ps1 -Token "sk_reg_xxx" -Server "https://your-serverkit.com"

.EXAMPLE
    # The panel serves this at /api/v1/servers/install.ps1, not at the domain
    # root -- the root of a ServerKit domain is the panel UI.
    irm https://your-serverkit.com/api/v1/servers/install.ps1 | iex; Install-ServerKitAgent -Token "sk_reg_xxx" -Server "https://your-serverkit.com"

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
    [string]$Version = "latest",

    [Parameter(Mandatory=$false)]
    [ValidateSet("monitor", "protect", "full")]
    [string]$Level,

    [switch]$Reconfigure,

    [switch]$Yes
)

# Configuration
$InstallDir = "$env:ProgramFiles\ServerKit"
$ConfigDir = "$env:ProgramData\ServerKit\Agent"
$LogDir = "$env:ProgramData\ServerKit\Agent\logs"
$ServiceName = "ServerKitAgent"
# The agent has its own repo and its own vX.Y.Z releases; it no longer ships
# from the panel monorepo.
$GitHubRepo = "jhd3197/serverkit-agent"
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
                # Plain vX.Y.Z in the dedicated agent repo (it used to be
                # `agent-v*` back when the agent shipped from the panel monorepo).
                # Requiring a digit skips the malformed release tagged just "v".
                if ($release.tag_name -match "^v(\d.*)$") {
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

    $downloadUrl = "https://github.com/$GitHubRepo/releases/download/v$Version/serverkit-agent-$Version-windows-amd64.zip"
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
    Write-ColorOutput "Creating configuration and log directories..." "Info"

    if (-not (Test-Path $ConfigDir)) {
        New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null
    }

    if (-not (Test-Path $LogDir)) {
        New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
    }
}

# Level recorded in an existing config ("" when none; no key = legacy = full).
function Get-InstalledLevel {
    $cfg = Join-Path $ConfigDir "config.yaml"
    if (-not (Test-Path $cfg)) { return "" }
    $m = Select-String -Path $cfg -Pattern '^\s+level:\s*"?(\w+)"?' | Select-Object -First 1
    if ($m) { return $m.Matches[0].Groups[1].Value }
    return "full"
}

# Refuses to silently change an installed agent's level; returns the level to use.
function Resolve-Level {
    param([string]$Level, [bool]$Reconfigure, [bool]$Yes)

    $current = Get-InstalledLevel
    if ($current) {
        if (-not $Level) { return $current }
        if ($Level -eq $current) { return $Level }
        if (-not $Reconfigure) {
            Write-ColorOutput "This agent is already installed at level '$current'. Re-run with -Reconfigure to change it to '$Level'." "Error"
            exit 1
        }
        if (-not $Yes) {
            $answer = Read-Host "Changing level $current -> $Level. Type '$Level' to confirm"
            if ($answer -ne $Level) {
                Write-ColorOutput "Confirmation did not match; permission level unchanged (use -Yes for scripted use)" "Error"
                exit 1
            }
        }
        $script:ChangeLevelFrom = $current
        return $Level
    }
    if ($Level) { return $Level }
    if ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
        Write-Host ""
        Write-Host "  Choose what this agent may do on this server:"
        Write-Host "    1) monitor  report-only, accepts no commands from the panel"
        Write-Host "    2) protect  security actions only (firewall, fail2ban, CrowdSec, origin lock)"
        Write-Host "    3) full     everything"
        switch (Read-Host "  Selection [1-3]") {
            "1" { return "monitor" }
            "2" { return "protect" }
            "3" { return "full" }
            default { Write-ColorOutput "Invalid selection" "Error"; exit 1 }
        }
    }
    Write-ColorOutput "No -Level given and no console: defaulting to FULL control. Pass -Level monitor|protect|full to choose." "Warning"
    return "full"
}

function Register-Agent {
    param(
        [string]$Token,
        [string]$Server,
        [string]$Name,
        [string]$Level
    )

    Write-ColorOutput "Registering agent with ServerKit..." "Info"

    $agentPath = Join-Path $InstallDir $AgentBinary
    $configPath = Join-Path $ConfigDir "config.yaml"
    $arguments = @("--config", $configPath, "register", "--token", $Token, "--server", $Server)

    if ($Name) {
        $arguments += @("--name", $Name)
    }
    $arguments += @("--level", $Level)

    if ($script:ChangeLevelFrom) {
        Start-Process -FilePath $agentPath -ArgumentList @("--config", $configPath, "permissions", "set", $Level, "--yes") -Wait -NoNewWindow | Out-Null
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
    $configPath = Join-Path $ConfigDir "config.yaml"

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
    $binPath = "`"$agentPath`" --config `"$configPath`" start"
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
        [string]$Version = "latest",

        [Parameter(Mandatory=$false)]
        [ValidateSet("monitor", "protect", "full")]
        [string]$Level,

        [switch]$Reconfigure,

        [switch]$Yes
    )

    # Update script-level variables
    $script:Version = $Version

    Write-Banner

    if (-not (Test-Administrator)) {
        Write-ColorOutput "This script must be run as Administrator" "Error"
        Write-Host "Right-click PowerShell and select 'Run as Administrator'"
        exit 1
    }

    $Level = Resolve-Level -Level $Level -Reconfigure $Reconfigure.IsPresent -Yes $Yes.IsPresent

    Get-LatestVersion
    Install-Agent
    New-ConfigDirectory
    Register-Agent -Token $Token -Server $Server -Name $Name -Level $Level
    Install-WindowsService
    Start-AgentService
    Add-ToPath
    Write-SuccessMessage
    Write-Host "Permission level: $($Level.ToUpper())" -ForegroundColor Yellow
    switch ($Level) {
        "monitor" { Write-Host "  Report-only: this agent sends metrics out and accepts NO commands." }
        "protect" { Write-Host "  Security actions only (firewall, fail2ban, CrowdSec, origin lock)." }
        default   { Write-Host "  Full control: the panel can run any supported action." }
    }
    Write-Host "  Change it (elevated prompt, this machine only):"
    Write-Host "    & '$InstallDir\$AgentBinary' permissions set <monitor|protect|full>"
    Write-Host ""
}

# Direct execution with parameters
if ($Token -and $Server) {
    Install-ServerKitAgent -Token $Token -Server $Server -Name $Name -Version $Version -Level $Level -Reconfigure:$Reconfigure -Yes:$Yes
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
