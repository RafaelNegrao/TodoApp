Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$iconsDir = Join-Path $root "src-tauri\icons"
$icoPath = Join-Path $iconsDir "icon.ico"
$pngPath = Join-Path $iconsDir "icon.png"

[System.IO.Directory]::CreateDirectory($iconsDir) | Out-Null

$size = 256
$bitmap = New-Object System.Drawing.Bitmap $size, $size
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::Transparent)

function New-Brush($hex) {
    return New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($hex))
}

function New-Pen($hex, $width) {
    $pen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml($hex)), $width
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    return $pen
}

function New-RoundedRectPath($x, $y, $w, $h, $r) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

$background = New-Brush "#1f1f23"
$shape = New-RoundedRectPath 0 0 $size $size 54
$graphics.FillPath($background, $shape)

$lightPen = New-Pen "#f5f2ee" 18
$orangePen = New-Pen "#d97745" 18
$bluePen = New-Pen "#7ba5c9" 18
$greenBrush = New-Brush "#98b66e"
$orangeBrush = New-Brush "#d97745"
$blueBrush = New-Brush "#7ba5c9"

$graphics.DrawLine($lightPen, 72, 78, 184, 78)
$graphics.DrawLine($orangePen, 72, 128, 148, 128)
$graphics.DrawLine($bluePen, 72, 178, 184, 178)
$graphics.FillEllipse($greenBrush, 41, 67, 22, 22)
$graphics.FillEllipse($orangeBrush, 41, 117, 22, 22)
$graphics.FillEllipse($blueBrush, 41, 167, 22, 22)

$bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

$stream = New-Object System.IO.MemoryStream
$bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $stream.ToArray()
$stream.Dispose()

$file = [System.IO.File]::Open($icoPath, [System.IO.FileMode]::Create)
$writer = New-Object System.IO.BinaryWriter $file
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]1)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]32)
$writer.Write([UInt32]$pngBytes.Length)
$writer.Write([UInt32]22)
$writer.Write($pngBytes)
$writer.Close()

$graphics.Dispose()
$bitmap.Dispose()
$background.Dispose()
$lightPen.Dispose()
$orangePen.Dispose()
$bluePen.Dispose()
$greenBrush.Dispose()
$orangeBrush.Dispose()
$blueBrush.Dispose()
$shape.Dispose()
