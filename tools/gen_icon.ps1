$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot '..\icons'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-LLIcon([int]$size, [string]$out) {
  $scale = $size / 128.0
  $bmp = New-Object System.Drawing.Bitmap($size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb))
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  $radius = [Math]::Max(3, [int](12 * $scale))
  $d = $radius * 2
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc(0, 0, $d, $d, 180, 90)
  $path.AddArc($size - $d, 0, $d, $d, 270, 90)
  $path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
  $path.AddArc(0, $size - $d, $d, $d, 90, 90)
  $path.CloseFigure()

  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)), (New-Object System.Drawing.Point(0, $size)),
    [System.Drawing.Color]::FromArgb(255, 0, 212, 255),
    [System.Drawing.Color]::FromArgb(255, 47, 86, 222))
  $g.FillPath($bg, $path)

  $penW = [Math]::Max(5, [int](15 * $scale))
  $margin = [single](0.16 * $size)
  $rect = New-Object System.Drawing.RectangleF($margin, $margin, [single]($size - 2 * $margin), [single]($size - 2 * $margin))

  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, $penW)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $arrow = New-Object System.Drawing.Drawing2D.AdjustableArrowCap([single](4.5 * $scale + 1), [single](6.0 * $scale + 1), $true)
  $pen.CustomStartCap = $arrow
  $pen.CustomEndCap = $arrow
  $g.DrawArc($pen, $rect, 150, 300)

  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $pen.Dispose(); $bg.Dispose(); $path.Dispose(); $g.Dispose(); $bmp.Dispose()
}

New-LLIcon 128 (Join-Path $outDir 'icon128.png')
New-LLIcon 48 (Join-Path $outDir 'icon48.png')
New-LLIcon 32 (Join-Path $outDir 'icon32.png')
New-LLIcon 16 (Join-Path $outDir 'icon16.png')

Write-Output 'icons generated'
