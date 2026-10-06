param(
    [string]$name = "screenshot"
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($null -eq $img) {
    Write-Host "[!] No image detected in Windows clipboard. Please press Win+Shift+S first!" -ForegroundColor Yellow
    exit 1
}

$dir = Join-Path $PSScriptRoot "..\docs\images"
if (-not (Test-Path $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

$targetPath = Join-Path $dir "$name.png"
$img.Save($targetPath, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "[+] Successfully saved clipboard image to: docs/images/$name.png" -ForegroundColor Green
