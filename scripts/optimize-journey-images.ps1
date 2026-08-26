param(
  [string]$SourceDirectory = (Join-Path $PSScriptRoot '..\prototype\assets'),
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\src\assets\journey')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$resolvedSource = (Resolve-Path -LiteralPath $SourceDirectory).Path
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$resolvedOutputParent = (Resolve-Path -LiteralPath (Split-Path -Parent $OutputDirectory)).Path

if (-not $resolvedSource.StartsWith($projectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Source directory must stay inside the project."
}
if (-not $resolvedOutputParent.StartsWith($projectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Output directory must stay inside the project."
}

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

$jpegEncoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
  Where-Object { $_.MimeType -eq 'image/jpeg' } |
  Select-Object -First 1
$encoderParameters = New-Object System.Drawing.Imaging.EncoderParameters(1)
$encoderParameters.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
  [System.Drawing.Imaging.Encoder]::Quality,
  [long]88
)

$names = @('bus-fields', 'train-lake', 'kyoto-day-night', 'riverside-garden')
foreach ($name in $names) {
  $inputPath = Join-Path $resolvedSource "$name.png"
  $outputPath = Join-Path $OutputDirectory "$name.jpg"
  $image = [System.Drawing.Image]::FromFile($inputPath)
  try {
    $bitmap = New-Object System.Drawing.Bitmap($image.Width, $image.Height)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.Clear([System.Drawing.Color]::FromArgb(246, 241, 232))
        $graphics.DrawImage($image, 0, 0, $image.Width, $image.Height)
      } finally {
        $graphics.Dispose()
      }
      $bitmap.Save($outputPath, $jpegEncoder, $encoderParameters)
    } finally {
      $bitmap.Dispose()
    }
  } finally {
    $image.Dispose()
  }
}

Get-ChildItem -LiteralPath $OutputDirectory -Filter '*.jpg' |
  Select-Object Name, Length
