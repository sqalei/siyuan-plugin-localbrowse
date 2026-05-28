# Install script for siyuan-plugin-localbrowse
# Run this script in PowerShell to install the plugin

$PluginDir = "$env:USERPROFILE\.siyuan\data\plugins\siyuan-plugin-localbrowse"

Write-Host "Installing siyuan-plugin-localbrowse..." -ForegroundColor Cyan

# Create plugin directory if not exists
if (-not (Test-Path $PluginDir)) {
    New-Item -ItemType Directory -Path $PluginDir -Force | Out-Null
}

# Copy all plugin files
Copy-Item -Path ".\*" -Destination $PluginDir -Recurse -Force

Write-Host "Plugin installed to: $PluginDir" -ForegroundColor Green
Write-Host "Please restart SiYuan and enable the plugin in Settings > Marketplace > Downloaded" -ForegroundColor Yellow
