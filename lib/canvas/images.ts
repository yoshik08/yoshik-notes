// Images are stored inside the note (data URLs), so they are downscaled and
// re-encoded before insertion: a 12 MP phone photo becomes a few hundred KB.

const MAX_SIDE = 2000;
const BUDGET = 1_200_000; // bytes of data URL per image

export interface PreparedImage {
  src: string;
  width: number;
  height: number;
}

function hasAlpha(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 40_000)));
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) if (data[(y * w + x) * 4 + 3] < 250) return true;
  return false;
}

export async function prepareImage(file: Blob): Promise<PreparedImage> {
  if (!file.type.startsWith('image/')) throw new Error('That file isn’t an image.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('This image format can’t be opened here.');
  }
  let scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  for (let attempt = 0; attempt < 4; attempt++) {
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const alpha = hasAlpha(ctx, w, h);
    let src = canvas.toDataURL('image/webp', 0.85);
    if (!src.startsWith('data:image/webp')) src = alpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85);
    if (src.length <= BUDGET) {
      bitmap.close();
      return { src, width: w, height: h };
    }
    scale *= 0.7;
  }
  bitmap.close();
  throw new Error('This image is too large to add.');
}
