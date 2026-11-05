# Genera los pantallazos de cada programa (frente + reverso) que el bot envía
# por WhatsApp con [[IMG:curso-…]]. Usa los datos EN VIVO de dealerclubpe.com/cursos.
#
#   powershell -ExecutionPolicy Bypass -File scripts\capturas-cursos.ps1
#   (y luego: firebase deploy --only functions, para que el bot use las nuevas)
#
# Volver a correrlo cada vez que cambies precios, horarios o textos de un curso.
$ErrorActionPreference = "Stop"
$repo   = Split-Path -Parent $PSScriptRoot
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$destino = Join-Path $repo "functions\media"
$tmp = Join-Path $env:TEMP "dc-capturas"
New-Item -ItemType Directory -Force $tmp | Out-Null
$puerto = 8765

# Nombre de la imagen → id del curso (+ combo activado)
$capturas = @(
  @{ nombre = "curso-trotamundos"; id = "Trotamundos" },
  @{ nombre = "curso-combo";       id = "Trotamundos"; combo = $true },
  @{ nombre = "curso-sabelotodo";  id = "Sabelotodo" },
  @{ nombre = "curso-spin";        id = "Spin a la carta" },
  @{ nombre = "curso-poker";       id = "Póker Face" },
  @{ nombre = "curso-formacion";   id = "Formación a la Carta" },
  @{ nombre = "curso-bienvenidos"; id = "Bienvenidos a Bordo" }
)

Push-Location $repo
try {
  node scripts\exportar-cursos.js | Out-Null
  $server = Start-Process python -ArgumentList "-m","http.server","$puerto","--bind","127.0.0.1" -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds 2
  Add-Type -AssemblyName System.Drawing
  foreach ($c in $capturas) {
    $url = "http://127.0.0.1:$puerto/scripts/capturas/tarjeta.html?id=$([uri]::EscapeDataString($c.id))" + $(if ($c.combo) { "&combo=1" } else { "" })
    $png = Join-Path $tmp "$($c.nombre)-full.png"
    Start-Process -FilePath $chrome -Wait -RedirectStandardError (Join-Path $tmp "chrome.log") -ArgumentList "--headless=new","--disable-gpu","--hide-scrollbars","--virtual-time-budget=6000",
      "--user-data-dir=$tmp\perfil","--force-device-scale-factor=2","--window-size=760,1400","--screenshot=$png",$url
    # Recorte: quita el fondo vacío de abajo.
    $img = [Drawing.Bitmap]::FromFile($png)
    $fondo = $img.GetPixel(4, 4)
    $alto = $img.Height
    for ($y = $img.Height - 1; $y -gt 0; $y -= 2) {
      $lleno = $false
      for ($x = 0; $x -lt $img.Width; $x += 6) {
        $p = $img.GetPixel($x, $y)
        if ([Math]::Abs($p.R - $fondo.R) + [Math]::Abs($p.G - $fondo.G) + [Math]::Abs($p.B - $fondo.B) -gt 24) { $lleno = $true; break }
      }
      if ($lleno) { $alto = [Math]::Min($img.Height, $y + 30); break }
    }
    $corte = $img.Clone((New-Object Drawing.Rectangle 0, 0, $img.Width, $alto), $img.PixelFormat)
    $salida = Join-Path $destino "$($c.nombre).png"
    $corte.Save($salida, [Drawing.Imaging.ImageFormat]::Png)
    $img.Dispose(); $corte.Dispose()
    "{0,-20} {1}x{2}  {3:N0} KB" -f $c.nombre, $corte.Width, $alto, ((Get-Item $salida).Length / 1KB)
  }
} finally {
  if ($server) { Stop-Process -Id $server.Id -ErrorAction SilentlyContinue }
  Pop-Location
}
