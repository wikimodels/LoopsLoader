$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'icons'
$svgPath = Join-Path $outDir 'logo.svg'
if (-not (Test-Path -LiteralPath $svgPath)) { throw 'logo.svg not found: ' + $svgPath }

$candidates = @(
  "$env:ProgramFiles (x86)\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles (x86)\Google\Chrome\Application\chrome.exe"
)
$browser = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $browser) { throw 'no Edge/Chrome found for SVG rendering' }
Write-Output ('render browser: ' + $browser)

$tmpHtml = Join-Path $env:TEMP 'll_icon.html'
$tmpPng = Join-Path $env:TEMP 'll_icon1024.png'
Remove-Item -LiteralPath $tmpPng -ErrorAction SilentlyContinue

$svg = Get-Content -LiteralPath $svgPath -Raw
$html = "<!DOCTYPE html><html><head><meta charset='utf-8'></head><body style='margin:0;padding:0;background:#A43D25'>$svg</body></html>"
Set-Content -LiteralPath $tmpHtml -Value $html -Encoding UTF8

$url = 'file:///' + $tmpHtml.Replace('\', '/')
& $browser --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --virtual-time-budget=2000 --window-size=1024,1024 --screenshot="$tmpPng" $url | Out-Null
if (-not (Test-Path -LiteralPath $tmpPng)) { throw 'screenshot failed - no PNG produced' }
Write-Output 'SVG rendered to temp PNG'

$src = [System.Drawing.Image]::FromFile($tmpPng)
foreach ($s in 128, 48, 32, 16) {
  $bmp = New-Object System.Drawing.Bitmap($s, $s, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb))
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.DrawImage($src, 0, 0, $s, $s)
  $bmp.Save((Join-Path $outDir "icon$s.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
  Write-Output ("icon$s.png written")
}
$src.Dispose()
Remove-Item -LiteralPath $tmpHtml -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $tmpPng -ErrorAction SilentlyContinue
Write-Output 'icons generated'