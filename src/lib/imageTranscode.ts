/**
 * Turning a phone photograph into something the upload will accept.
 *
 * iPhones store photographs as HEIC. Some pickers transcode to JPEG on the way
 * out and some hand over the original, so a seller could be told their perfectly
 * ordinary photo was an unsupported file — with no way to tell which of their
 * pictures would work.
 *
 * No decoder is shipped for this. The browsers that produce HEIC can also decode
 * it, so the file is drawn to a canvas and re-encoded; on a browser that cannot
 * read it, the decode fails and the caller says so plainly. Bundling a megabyte
 * of WASM to convert a format only one platform emits, on a page most sellers
 * reach from that platform, is a poor trade.
 *
 * Oversized photographs are shrunk on the same pass. A modern phone camera
 * clears the 10 MB media limit on its own, and a seller who has to guess which
 * of their photos is too large is barely better off than one whose format was
 * refused.
 */

/** Long edge beyond which a photograph is scaled down before upload. */
const MAX_EDGE = 3_000;

/** JPEG quality for the re-encode. High enough that inclusions stay legible. */
const QUALITY = 0.9;

const TRANSCODE_TYPES = new Set(['image/heic', 'image/heif', 'image/heic-sequence']);

/**
 * Whether this file has to be converted before it can be uploaded.
 *
 * The extension is checked as well as the type: some pickers hand over a HEIC
 * with an empty `type`, which would otherwise pass the check here and fail the
 * one on the server.
 */
export function needsTranscode(file: { name: string; type: string }): boolean {
  if (TRANSCODE_TYPES.has(file.type.toLowerCase())) return true;
  return file.type === '' && /\.(heic|heif)$/i.test(file.name);
}

/** Dimensions after fitting inside {@link MAX_EDGE}, preserving aspect ratio. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge = MAX_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  // Rounded, and never to zero: a canvas of zero width throws rather than
  // producing an empty image.
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    /*
     * Safari has historically been fussy about `createImageBitmap` with some
     * sources, and an `<img>` uses the same underlying decoders. Worth the
     * second attempt before declaring a format unreadable.
     */
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return await createImageBitmap(image);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/**
 * Returns a file the upload will accept, converting only when it must.
 *
 * A JPEG or PNG within the size limit is handed straight back, so the common
 * path costs nothing.
 */
export async function ensureUploadableImage(file: File, maxBytes: number): Promise<File> {
  const mustConvert = needsTranscode(file);
  if (!mustConvert && file.size <= maxBytes) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await decode(file);
  } catch {
    throw new Error(
      `${file.name} could not be read by this browser. Save or export it as JPEG and try again.`,
    );
  }

  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser could not process the image.');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', QUALITY),
  );
  if (!blob) throw new Error(`${file.name} could not be converted.`);

  if (blob.size > maxBytes) {
    // Converted and still too large. Said plainly, with the actual figure,
    // rather than letting the server refuse it after the upload.
    throw new Error(
      `${file.name} is still ${(blob.size / 1024 / 1024).toFixed(1)} MB after conversion. Please use a smaller photograph.`,
    );
  }

  return new File([blob], file.name.replace(/\.(heic|heif)$/i, '.jpg'), {
    type: 'image/jpeg',
    lastModified: file.lastModified,
  });
}
