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

  $radius = [Math]::Max(6, [int](24 * $scale))
  $d = $radius * 2
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc(0, 0, $d, $d, 180, 90)
  $path.AddArc($size - $d, 0, $d, $d, 270, 90)
  $path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
  $path.AddArc(0, $size - $d, $d, $d, 90, 90)
  $path.CloseFigure()

  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)), (New-Object System.Drawing.Point(0, $size)),
    [System.Drawing.Color]::FromArgb(255, 122, 92, 255),
    [System.Drawing.Color]::FromArgb(255, 52, 34, 130))
  $g.FillPath($bg, $path)

  $penW = [Math]::Max(4, [int](9 * $scale))
  $pts = New-Object 'System.Collections.Generic.List[System.Drawing.PointF]'
  $n = 96
  for ($i = 0; $i -le $n; $i++) {
    $t = $i / $n
    $px = 0.12 * $size + 0.76 * $size * $t
    $phase = 2 * [Math]::PI * 1.6 * $t - 1.0
    $py = 0.5 * $size + 0.21 * $size * [Math]::Sin($phase)
    $pts.Add((New-Object System.Drawing.PointF([single]$px, [single]$py)))
  }

  $wave = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point([int](0.1 * $size), 0)), (New-Object System.Drawing.Point([int](0.9 * $size), 0)),
    [System.Drawing.Color]::FromArgb(255, 150, 255, 215),
    [System.Drawing.Color]::FromArgb(255, 255, 255, 255))
  $pen = New-Object System.Drawing.Pen($wave, $penW)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $g.DrawLines($pen, $pts.ToArray())

  $dot = [Math]::Max(2, [int](6 * $scale))
  $dotBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
  $g.FillEllipse($dotBrush, [single](0.5 * $size - $dot / 2), [single](0.5 * $size - $dot / 2), [single]$dot, [single]$dot)

  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $pen.Dispose(); $wave.Dispose(); $dotBrush.Dispose(); $bg.Dispose(); $path.Dispose(); $g.Dispose(); $bmp.Dispose()
}

New-LLIcon 128 (Join-Path $outDir 'icon128.png')
New-LLIcon 48 (Join-Path $outDir 'icon48.png')
New-LLIcon 32 (Join-Path $outDir 'icon32.png')
New-LLIcon 16 (Join-Path $outDir 'icon16.png')

Write-Output 'icons generated'
