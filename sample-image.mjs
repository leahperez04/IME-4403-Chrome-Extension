const DATA_URL = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;
export function isSampleImage(value) {
  return typeof value === 'string' && value.length <= 2000000 && DATA_URL.test(value);
}
export function sampleImageBlob(value) {
  if (!isSampleImage(value)) throw new Error('The saved image sample is invalid. Upload the photo again.');
  const bytes = Uint8Array.from(atob(value.split(',')[1]), char => char.charCodeAt(0));
  return new Blob([bytes], { type: 'image/jpeg' });
}
export async function prepareSampleImage(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPG, PNG, or WebP photo. Convert HEIC photos to JPG first.');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40000000) throw new Error('This photo is too large. Crop or resize it to a single notebook page first.');
    const canvas = document.createElement('canvas');
    let edge = 1600;
    for (let attempt = 0; attempt < 4; attempt++) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Chrome could not prepare this photo.');
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/jpeg', 0.88);
      if (isSampleImage(data)) return data;
      edge = Math.floor(edge * 0.75);
    }
    throw new Error('This photo could not be saved. Try a smaller image.');
  } finally { bitmap.close(); }
}
