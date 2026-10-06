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
Write-Host " [剪贴板图片自动存图并复制路径] 监听中..." -ForegroundColor Green
Write-Host " 使用方式: 随时按 Win+Shift+S 截图" -ForegroundColor White
Write-Host " 监听器会自动将图片存为文件，并把文件路径复制到剪贴板！" -ForegroundColor White
Write-Host " 然后在 CLI 聊天框直接按 Ctrl+V 粘贴路径即可！" -ForegroundColor Yellow
Write-Host " 按 Ctrl+C 可随时退出" -ForegroundColor Gray
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
                Write-Host "[OK] 截图已存: $filename (路径已拷入剪贴板，可直接在 CLI 粘贴)" -ForegroundColor Green
                Start-Sleep -Milliseconds 1500
            }
        }
    } catch {
        # 忽略瞬时剪贴板锁定
    }
    Start-Sleep -Milliseconds 500
}
