# ARIES v4.0 — System Tray Icon
# Creates a tray icon with context menu for managing Aries

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 3333

# Create notification icon
$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Text = "ARIES v4.0"
$notifyIcon.Visible = $true

# Try custom icon, fall back to system icon
$icoPath = Join-Path $scriptDir "aries.ico"
if (Test-Path $icoPath) {
    $notifyIcon.Icon = New-Object System.Drawing.Icon($icoPath)
} else {
    # Create a simple cyan circle icon programmatically
    $bmp = New-Object System.Drawing.Bitmap(32, 32)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.Clear([System.Drawing.Color]::Transparent)
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(0, 200, 220))
    $g.FillEllipse($brush, 2, 2, 28, 28)
    $font = New-Object System.Drawing.Font("Consolas", 14, [System.Drawing.FontStyle]::Bold)
    $g.DrawString("A", $font, [System.Drawing.Brushes]::White, 7, 5)
    $g.Dispose()
    $handle = $bmp.GetHicon()
    $notifyIcon.Icon = [System.Drawing.Icon]::FromHandle($handle)
}

# Context menu
$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip

# Open Aries
$openItem = New-Object System.Windows.Forms.ToolStripMenuItem("Open Aries")
$openItem.Add_Click({
    Start-Process "http://localhost:$port"
})
$contextMenu.Items.Add($openItem) | Out-Null

# Open TUI
$tuiItem = New-Object System.Windows.Forms.ToolStripMenuItem("Open TUI")
$tuiItem.Add_Click({
    Start-Process "cmd.exe" -ArgumentList "/k cd /d `"$scriptDir`" && node aries.js"
})
$contextMenu.Items.Add($tuiItem) | Out-Null

$contextMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

# Status
$statusItem = New-Object System.Windows.Forms.ToolStripMenuItem("Status")
$statusItem.Add_Click({
    try {
        $response = Invoke-RestMethod -Uri "http://localhost:$port/api/status" -TimeoutSec 3
        $msg = "Version: $($response.version)`nUptime: $($response.uptime)s`nAI: $(if($response.aiOnline){'Online'}else{'Offline'})`nWorkers: $($response.workers)`nModel: $($response.model)"
        $notifyIcon.BalloonTipTitle = "ARIES Status"
        $notifyIcon.BalloonTipText = $msg
        $notifyIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
        $notifyIcon.ShowBalloonTip(5000)
    } catch {
        $notifyIcon.BalloonTipTitle = "ARIES Status"
        $notifyIcon.BalloonTipText = "Could not reach Aries on port $port"
        $notifyIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Warning
        $notifyIcon.ShowBalloonTip(3000)
    }
})
$contextMenu.Items.Add($statusItem) | Out-Null

# Restart
$restartItem = New-Object System.Windows.Forms.ToolStripMenuItem("Restart")
$restartItem.Add_Click({
    $notifyIcon.BalloonTipTitle = "ARIES"
    $notifyIcon.BalloonTipText = "Restarting..."
    $notifyIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
    $notifyIcon.ShowBalloonTip(2000)
    # Kill existing node processes for aries
    Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
        try { $_.CommandLine -match "launcher\.js|aries\.js" } catch { $false }
    } | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    Start-Process "wscript.exe" -ArgumentList "`"$(Join-Path $scriptDir 'launch.vbs')`""
})
$contextMenu.Items.Add($restartItem) | Out-Null

$contextMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

# Quit
$quitItem = New-Object System.Windows.Forms.ToolStripMenuItem("Quit")
$quitItem.Add_Click({
    # Kill node processes
    Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
        try { $_.CommandLine -match "launcher\.js" } catch { $false }
    } | Stop-Process -Force -ErrorAction SilentlyContinue
    $notifyIcon.Visible = $false
    $notifyIcon.Dispose()
    [System.Windows.Forms.Application]::Exit()
})
$contextMenu.Items.Add($quitItem) | Out-Null

$notifyIcon.ContextMenuStrip = $contextMenu

# Double-click opens browser
$notifyIcon.Add_DoubleClick({
    Start-Process "http://localhost:$port"
})

# Startup balloon
$notifyIcon.BalloonTipTitle = "ARIES v4.0"
$notifyIcon.BalloonTipText = "Aries is running on port $port"
$notifyIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
$notifyIcon.ShowBalloonTip(3000)

# Run message loop
[System.Windows.Forms.Application]::Run()
