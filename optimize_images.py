"""
Optimiza las imágenes pesadas de DealerClub:
- Respaldo de originales en assets/images/originals/
- Redimensiona al tamaño real de visualización
- Reexporta JPEG progresivo optimizado (en su mismo nombre)
- Genera WebP siblings (~30% más liviano)
Uso: python optimize_images.py
"""
from PIL import Image
import os, shutil

IMG_DIR  = os.path.join('assets', 'images')
BACKUP   = os.path.join(IMG_DIR, 'originals')
THRESHOLD = 800 * 1024  # solo procesa imágenes de más de 800 KB

# nombre -> (lado_maximo_px, calidad)
SPECIAL = {
    'FondoInicio.jpeg': (1920, 80),  # fondo hero a pantalla completa
    'kev_photo.png':    (600,  86),  # foto circular pequeña
}
DEFAULT = (1400, 82)                  # fotos del carrusel y demás

os.makedirs(BACKUP, exist_ok=True)

def flatten(im):
    """Quita transparencia componiendo sobre blanco."""
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGBA')
        bg = Image.new('RGB', im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[-1])
        return bg
    return im.convert('RGB')

def human(n):
    for u in ('B', 'KB', 'MB'):
        if n < 1024: return f'{n:.0f} {u}'
        n /= 1024
    return f'{n:.1f} GB'

total_before = total_after = 0
processed = []

for fn in sorted(os.listdir(IMG_DIR)):
    path = os.path.join(IMG_DIR, fn)
    if not os.path.isfile(path):
        continue
    ext = os.path.splitext(fn)[1].lower()
    if ext not in ('.jpg', '.jpeg', '.png'):
        continue
    before = os.path.getsize(path)
    if before < THRESHOLD:
        continue

    max_dim, q = SPECIAL.get(fn, DEFAULT)

    # Respaldo (una sola vez)
    bpath = os.path.join(BACKUP, fn)
    if not os.path.exists(bpath):
        shutil.copy2(path, bpath)

    im = flatten(Image.open(path))
    im.thumbnail((max_dim, max_dim), Image.LANCZOS)

    base = os.path.splitext(fn)[0]

    # 1) Reexporta en su formato original (mismo nombre) ya optimizado
    if ext in ('.jpg', '.jpeg'):
        im.save(path, 'JPEG', quality=q, optimize=True, progressive=True)
    else:  # .png de foto -> guardamos un JPG hermano y reducimos el png en sitio
        im.save(os.path.join(IMG_DIR, base + '.jpg'), 'JPEG', quality=q, optimize=True, progressive=True)
        im.save(path, 'PNG', optimize=True)

    # 2) WebP hermano (mejor compresión)
    im.save(os.path.join(IMG_DIR, base + '.webp'), 'WEBP', quality=q, method=6)

    after = os.path.getsize(path)
    total_before += before
    total_after  += after
    processed.append((fn, before, after))

print('=== Imágenes optimizadas ===')
for fn, b, a in processed:
    print(f'  {fn:<22} {human(b):>9}  ->  {human(a):>9}')
print('----------------------------------------------')
print(f'  TOTAL (archivo principal) {human(total_before)} -> {human(total_after)}')
print(f'  Originales respaldados en: {BACKUP}')
print('  (Se generaron además versiones .webp de cada una.)')
