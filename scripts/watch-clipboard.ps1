param(
    [string]$OutputDir = (Join-Path $PSScriptRoot "..\docs\images")
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

$fullOutputDir = (Resolve-Path $OutputDir).Path

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " [Clipboard Image Watcher Running...]" -ForegroundColor Green
Write-Host " How to use: Press Win+Shift+S to capture a screenshot." -ForegroundColor White
Write-Host " It will automatically save image and COPY its path to clipboard." -ForegroundColor White
Write-Host " Then press Ctrl+V in your CLI to paste the path directly!" -ForegroundColor Yellow
Write-Host " Press Ctrl+C to exit." -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Cyan

while ($true) {
    try {
        if ([System.Windows.Forms.Clipboard]::ContainsImage()) {
            $img = [System.Windows.Forms.Clipboard]::GetImage()
            if ($null -ne $img) {
                $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
                $filename = "screenshot_$timestamp.png"
                $filePath = Join-Path $fullOutputDir $filename
                $img.Save($filePath, [System.Drawing.Imaging.ImageFormat]::Png)
                $img.Dispose()
                
                [System.Windows.Forms.Clipboard]::SetText($filePath)
                Write-Host "[OK] Saved: $filename -> Path copied to clipboard!" -ForegroundColor Green
                Start-Sleep -Milliseconds 1500
            }
        }
    } catch {
        # Ignore momentary clipboard lock
    }
    Start-Sleep -Milliseconds 500
}
