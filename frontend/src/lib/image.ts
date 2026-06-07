/**
 * Turn a chosen image File into a small square JPEG data URL (center-cropped).
 * Avatars are kept tiny (~128px) so they fit in the DB / localStorage and sync
 * with the account, instead of needing any external file storage.
 */
export async function fileToAvatarDataUrl(file: File, size = 128, quality = 0.85): Promise<string> {
  const img = await loadImage(file);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas not supported");
  // Cover-crop: scale so the image fills the square, then center it.
  const scale = Math.max(size / img.width, size / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image load failed"));
    };
    img.src = url;
  });
}
