#Requires -RunAsAdministrator
#
# ServerKit Agent Installation Script for Windows
# Usage: irm https://your-serverkit.com/install.ps1 | iex; Install-ServerKitAgent -Token "sk_reg_xxx" -Server "https://..."
#

function Install-ServerKitAgent {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)]
        [string]$Token,

        [Parameter(Mandatory=$true)]
        [string]$Server,

        [Parameter(Mandatory=$false)]
        [string]$Name = "",

        [Parameter(Mandatory=$false)]
        [string]$DownloadUrl = ""
    )

    $ErrorActionPreference = "Stop"

    # Configuration
    $InstallDir = "$env:ProgramFiles\ServerKit Agent"
    $ConfigDir = "$env:ProgramData\ServerKit\Agent"
    $LogDir = "$env:ProgramData\ServerKit\Agent\logs"
    $ServiceName = "ServerKitAgent"

    function Write-Info { param([string]$Message) Write-Host "[INFO] $Message" -ForegroundColor Cyan }
    function Write-Success { param([string]$Message) Write-Host "[SUCCESS] $Message" -ForegroundColor Green }
    function Write-Warn { param([string]$Message) Write-Host "[WARN] $Message" -ForegroundColor Yellow }
    function Write-Err { param([string]$Message) Write-Host "[ERROR] $Message" -ForegroundColor Red }

    Write-Host ""
    Write-Host "╔══════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "║     ServerKit Agent Installation         ║" -ForegroundColor Green
    Write-Host "╚══════════════════════════════════════════╝" -ForegroundColor Green
    Write-Host ""

    # Detect architecture
    $Arch = if ([Environment]::Is64BitOperatingSystem) { "amd64" } else { "386" }
    Write-Info "Detected architecture: windows/$Arch"

    # Create directories
    Write-Info "Creating directories..."
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

    # Stop existing service if running
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($service -and $service.Status -eq "Running") {
        Write-Info "Stopping existing agent service..."
        Stop-Service -Name $ServiceName -Force
        Start-Sleep -Seconds 2
    }

    # Construct download URL
    if ([string]::IsNullOrEmpty($DownloadUrl)) {
        $DownloadUrl = "$Server/downloads/agent/serverkit-agent-windows-$Arch.exe"
    }

    # Download agent
    Write-Info "Downloading agent from $DownloadUrl..."
    $AgentPath = "$InstallDir\serverkit-agent.exe"
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $DownloadUrl -OutFile $AgentPath -UseBasicParsing
    } catch {
        Write-Err "Failed to download agent: $_"
        throw
    }

    # Verify download
    if (-not (Test-Path $AgentPath)) {
        Write-Err "Agent binary not found after download"
        throw "Download failed"
    }

    Write-Success "Agent downloaded successfully"

    # Register with ServerKit
    Write-Info "Registering agent with ServerKit..."
    $RegisterArgs = @("register", "--token", $Token, "--server", $Server)
    if (-not [string]::IsNullOrEmpty($Name)) {
        $RegisterArgs += @("--name", $Name)
    }

    $process = Start-Process -FilePath $AgentPath -ArgumentList $RegisterArgs -Wait -PassThru -NoNewWindow
    if ($process.ExitCode -ne 0) {
        Write-Err "Registration failed with exit code $($process.ExitCode)"
        throw "Registration failed"
    }

    Write-Success "Registration successful"

    # Install as Windows Service
    Write-Info "Installing Windows service..."

    # Remove existing service if present
    if ($service) {
        Write-Info "Removing existing service..."
        sc.exe delete $ServiceName | Out-Null
        Start-Sleep -Seconds 2
    }

    # Create service using sc.exe
    $binPath = "`"$AgentPath`" start"
    $result = sc.exe create $ServiceName binPath= $binPath start= auto displayname= "ServerKit Agent"
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Failed to create service"
        throw "Service creation failed"
    }

    # Set service description
    sc.exe description $ServiceName "ServerKit Agent - Remote server management agent" | Out-Null

    # Configure service recovery (restart on failure)
    sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/10000/restart/30000 | Out-Null

    Write-Success "Service installed"

    # Configure firewall (optional)
    Write-Info "Configuring Windows Firewall..."
    try {
        $firewallRule = Get-NetFirewallRule -DisplayName "ServerKit Agent" -ErrorAction SilentlyContinue
        if (-not $firewallRule) {
            New-NetFirewallRule -DisplayName "ServerKit Agent" `
                -Direction Outbound `
                -Action Allow `
                -Program $AgentPath `
                -Description "Allow ServerKit Agent outbound connections" | Out-Null
            Write-Success "Firewall rule created"
        } else {
            Write-Info "Firewall rule already exists"
        }
    } catch {
        Write-Warn "Could not configure firewall: $_"
    }

    # Start service
    Write-Info "Starting agent service..."
    Start-Service -Name $ServiceName
    Start-Sleep -Seconds 3

    $service = Get-Service -Name $ServiceName
    if ($service.Status -eq "Running") {
        Write-Success "Agent is running"
    } else {
        Write-Err "Agent failed to start"
        Get-EventLog -LogName Application -Source $ServiceName -Newest 10 -ErrorAction SilentlyContinue | Format-List
        throw "Agent failed to start"
    }

    # Add to PATH
    $currentPath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    if ($currentPath -notlike "*$InstallDir*") {
        Write-Info "Adding agent to system PATH..."
        [Environment]::SetEnvironmentVariable("Path", "$currentPath;$InstallDir", "Machine")
    }

    Write-Host ""
    Write-Success "Installation complete!"
    Write-Host ""
    Write-Host "Agent Status:    Get-Service $ServiceName"
    Write-Host "View Logs:       Get-Content '$LogDir\agent.log' -Tail 50"
    Write-Host "Config File:     $ConfigDir\config.yaml"
    Write-Host "Uninstall:       Uninstall-ServerKitAgent"
    Write-Host ""
}

function Uninstall-ServerKitAgent {
    [CmdletBinding()]
    param()

    $ErrorActionPreference = "Stop"

    $InstallDir = "$env:ProgramFiles\ServerKit Agent"
    $ConfigDir = "$env:ProgramData\ServerKit\Agent"
    $ServiceName = "ServerKitAgent"

    Write-Host "Uninstalling ServerKit Agent..." -ForegroundColor Yellow

    # Stop and remove service
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($service) {
        if ($service.Status -eq "Running") {
            Stop-Service -Name $ServiceName -Force
            Start-Sleep -Seconds 2
        }
        sc.exe delete $ServiceName | Out-Null
        Write-Host "Service removed" -ForegroundColor Green
    }

    # Remove firewall rule
    Remove-NetFirewallRule -DisplayName "ServerKit Agent" -ErrorAction SilentlyContinue

    # Remove installation directory
    if (Test-Path $InstallDir) {
        Remove-Item -Path $InstallDir -Recurse -Force
        Write-Host "Installation directory removed" -ForegroundColor Green
    }

    # Ask about config removal
    $removeConfig = Read-Host "Remove configuration and logs? (y/N)"
    if ($removeConfig -eq "y" -or $removeConfig -eq "Y") {
        if (Test-Path $ConfigDir) {
            Remove-Item -Path $ConfigDir -Recurse -Force
            Write-Host "Configuration removed" -ForegroundColor Green
        }
    }

    # Remove from PATH
    $currentPath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $newPath = ($currentPath.Split(';') | Where-Object { $_ -ne $InstallDir }) -join ';'
    [Environment]::SetEnvironmentVariable("Path", $newPath, "Machine")

    Write-Host ""
    Write-Host "ServerKit Agent has been uninstalled" -ForegroundColor Green
}

# Export functions
Export-ModuleMember -Function Install-ServerKitAgent, Uninstall-ServerKitAgent
