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

  $radius = [Math]::Max(2, [int](4 * $scale))
  $d = $radius * 2
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc(0, 0, $d, $d, 180, 90)
  $path.AddArc($size - $d, 0, $d, $d, 270, 90)
  $path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
  $path.AddArc(0, $size - $d, $d, $d, 90, 90)
  $path.CloseFigure()

  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)), (New-Object System.Drawing.Point(0, $size)),
    [System.Drawing.Color]::FromArgb(255, 255, 152, 0),
    [System.Drawing.Color]::FromArgb(255, 244, 67, 54))
  $g.FillPath($bg, $path)

  $cx = [single](0.60 * $size)
  $cy = [single](0.5 * $size)
  $turns = 2.3
  $maxT = 2 * [Math]::PI * $turns
  $r0 = 0.028 * $size
  $rMax = 0.23 * $size
  $k = [Math]::Log($rMax / $r0) / $maxT
  $n = 140

  $pts = New-Object 'System.Collections.Generic.List[System.Drawing.PointF]'
  for ($i = 0; $i -le $n; $i++) {
    $t = $maxT * $i / $n
    $rr = $r0 * [Math]::Exp($k * $t)
    $ang = $t - [Math]::PI / 2
    $pts.Add((New-Object System.Drawing.PointF([single]($cx + $rr * [Math]::Cos($ang)), [single]($cy + $rr * [Math]::Sin($ang)))))
  }

  $penW = [Math]::Max(4, [int](13 * $scale))
  $outCol = [System.Drawing.Color]::FromArgb(255, 140, 40, 10)
  $outPen = New-Object System.Drawing.Pen -ArgumentList @($outCol, [single]($penW * 1.5))
  $outPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $outPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawLines($outPen, $pts.ToArray())

  $pen = New-Object System.Drawing.Pen -ArgumentList @([System.Drawing.Color]::White, $penW)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawLines($pen, $pts.ToArray())

  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $pen.Dispose(); $outPen.Dispose(); $bg.Dispose(); $path.Dispose(); $g.Dispose(); $bmp.Dispose()
}

New-LLIcon 128 (Join-Path $outDir 'icon128.png')
New-LLIcon 48 (Join-Path $outDir 'icon48.png')
New-LLIcon 32 (Join-Path $outDir 'icon32.png')
New-LLIcon 16 (Join-Path $outDir 'icon16.png')

Write-Output 'icons generated'
