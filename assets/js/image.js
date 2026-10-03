// ============================================================
// COMPRESIÓN DE IMAGEN (Canvas API)
// ============================================================
// Reduce una foto en el navegador antes de guardarla en Firestore
// como Base64 (sin Firebase Storage). Limita a 800px de ancho y
// 80% de calidad JPEG para no crear documentos de varios MB.
// ============================================================
export const compressImage = (file, maxWidth = 800, quality = 0.8) =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const scale  = Math.min(1, maxWidth / img.width);
                canvas.width  = Math.round(img.width  * scale);
                canvas.height = Math.round(img.height * scale);
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
