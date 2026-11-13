# Installs Bringup, the SE 423 practice game, on Windows.
#   irm https://marius-juston.github.io/SE423-Bringup/install.ps1 | iex
# The game also runs in a browser, with nothing to install:
#   https://marius-juston.github.io/SE423-Bringup/
$ErrorActionPreference = "Stop"
$repo = "Marius-Juston/SE423-Bringup"
$web = "https://marius-juston.github.io/SE423-Bringup/"
try {
  Write-Host "Looking up the latest release of Bringup..."
  $release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest"
  $asset = $release.assets | Where-Object { $_.name -like "*-setup.exe" } | Select-Object -First 1
  if (-not $asset) { throw "the latest release has no Windows installer." }
  $file = Join-Path $env:TEMP $asset.name
  Write-Host "Downloading $($asset.name)..."
  Invoke-WebRequest $asset.browser_download_url -OutFile $file
  Write-Host "Starting the installer. Windows may warn that the publisher is unknown: choose More info, then Run anyway."
  Start-Process $file -Wait
  Remove-Item $file -ErrorAction SilentlyContinue
  Write-Host "Done. Start Bringup from the Start menu."
} catch {
  Write-Host "bringup: $($_.Exception.Message)"
  Write-Host "You can play in the browser instead: $web"
}
