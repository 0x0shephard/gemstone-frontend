/**
 * Turning a rendered gift card into something the sender can actually hand over.
 *
 * All of it works off the live `<svg>` element rather than re-deriving the
 * artwork, so what gets printed is exactly what was on screen — including the
 * template the sender picked and the code they were shown.
 */

/** Serialised copy of the card, as a blob URL an `<img>` can load. */
function svgObjectUrl(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  // A detached document needs the namespace declared explicitly, and needs real
  // pixel dimensions — width="100%" resolves against nothing here and Safari
  // renders a zero-width image rather than failing outright.
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  const [, , width, height] = (clone.getAttribute('viewBox') ?? '0 0 1050 640').split(/\s+/);
  clone.setAttribute('width', width);
  clone.setAttribute('height', height);
  const markup = new XMLSerializer().serializeToString(clone);
  return URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
}

function triggerDownload(href: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/**
 * Rasterises the card to a canvas at `scale`.
 *
 * Shared by the download and the Canva upload so both send the same bitmap.
 * Re-rendering the SVG somewhere else — server-side, or from a second code path
 * — risks a card that differs from the one the sender approved on screen, in
 * ways nobody would notice until it was printed.
 */
async function rasterise(svg: SVGSVGElement, scale: number): Promise<HTMLCanvasElement> {
  const url = svgObjectUrl(svg);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('The card could not be rendered for export'));
      element.src = url;
    });

    const [, , width, height] = (svg.getAttribute('viewBox') ?? '0 0 1050 640').split(/\s+/);
    const canvas = document.createElement('canvas');
    canvas.width = Number(width) * scale;
    canvas.height = Number(height) * scale;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot export images');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Downloads the card as a print-resolution PNG. */
export async function downloadCardPng(
  svg: SVGSVGElement,
  filename: string,
  scale = 3,
): Promise<void> {
  const canvas = await rasterise(svg, scale);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The card could not be converted to an image');
  const pngUrl = URL.createObjectURL(blob);
  triggerDownload(pngUrl, filename);
  // Revoked on the next frame: revoking synchronously races the download in
  // Firefox, which reads the blob after the click handler returns.
  setTimeout(() => URL.revokeObjectURL(pngUrl), 30_000);
}

/**
 * The card as a base64 PNG, for handing to a server.
 *
 * Scaled down from the print default: the payload travels in a JSON body and
 * base64 adds a third again on top, so 3x turns a 3 MB bitmap into a 12 MB
 * request for no visible gain in an editor.
 */
export async function cardAsPngBase64(svg: SVGSVGElement, scale = 2): Promise<string> {
  const canvas = await rasterise(svg, scale);
  const dataUrl = canvas.toDataURL('image/png');
  if (!dataUrl.startsWith('data:image/png')) {
    throw new Error('The card could not be converted to an image');
  }
  return dataUrl;
}

/** Downloads the card as SVG — the right format to hand to a print shop. */
export function downloadCardSvg(svg: SVGSVGElement, filename: string): void {
  const url = svgObjectUrl(svg);
  triggerDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Opens the card in a print window sized to a standard gift card.
 *
 * A separate window rather than a print stylesheet on the app: the card has to
 * print alone on the page, and hiding an entire application for print is a
 * losing battle against every fixed header and modal overlay in it.
 */
export function printCard(svg: SVGSVGElement, title: string): boolean {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.removeAttribute('width');
  const markup = new XMLSerializer().serializeToString(clone);

  const window_ = window.open('', '_blank', 'noopener,width=1100,height=760');
  if (!window_) return false;

  window_.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>` +
      '<style>' +
      '@page { size: 190mm 116mm; margin: 0 }' +
      'html,body { margin:0; padding:0; background:#fff }' +
      'svg { display:block; width:190mm; height:auto }' +
      '@media screen { body { padding:24px; background:#111 } svg { width:100%; max-width:1050px; margin:0 auto } }' +
      '</style></head><body>' +
      markup +
      '</body></html>',
  );
  window_.document.close();
  // Give the document a beat to lay out before the print dialog measures it.
  window_.addEventListener('load', () => window_.print());
  setTimeout(() => {
    try {
      window_.print();
    } catch {
      /* The load handler already ran. */
    }
  }, 600);
  return true;
}

/**
 * Fetches a remote image and returns it as a data URI.
 *
 * Required for PNG export rather than merely nice: drawing a cross-origin image
 * into a canvas taints it, and `toBlob` then throws a `SecurityError`. IPFS
 * gateways vary in whether they send permissive CORS headers, so this is
 * allowed to fail — the card falls back to its engraved facet motif and stays
 * exportable.
 */
export async function inlineImage(url: string | undefined): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) return undefined;
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) return undefined;
    return await new Promise<string | undefined>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : undefined);
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}
