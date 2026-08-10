import { audit, requireUser } from '../_shared/auth.ts';
import { safeErrorMessage } from '../_shared/errors.ts';
import { json, preflight } from '../_shared/cors.ts';
import {
  CANVA_API,
  CanvaNotConfiguredError,
  CanvaNotConnectedError,
  accessTokenFor,
  canvaConfigured,
  canvaError,
} from '../_shared/canva.ts';

/**
 * Puts a rendered gift card into the sender's Canva account and hands back an
 * editing link.
 *
 * The card is rasterised in the browser, where it is already drawn, and posted
 * here as base64 — the alternative, re-rendering the SVG server-side, would
 * need a headless browser to resolve fonts and produce a second card that could
 * silently differ from the one on screen.
 *
 * Note what this is not: Canva's brand-template autofill, which would place the
 * recipient and message into named fields, requires a Canva Enterprise
 * organisation. This uploads the finished artwork instead, which needs no
 * Enterprise plan and leaves the sender free to restyle it in the editor.
 */

/** Generous for a card at 3x, small enough that a bad request cannot exhaust us. */
const MAX_PNG_BYTES = 12 * 1024 * 1024;

/** Canva's upload job is asynchronous; a card-sized PNG settles in seconds. */
const POLL_ATTEMPTS = 20;
const POLL_INTERVAL_MS = 750;

function decodeBase64(value: string): Uint8Array {
  // Accepts a data: URL as well as bare base64, since that is what a canvas
  // `toDataURL` hands back and stripping it caller-side is easy to forget.
  const payload = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value;
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    if (!canvaConfigured()) throw new CanvaNotConfiguredError();
    const user = await requireUser(request);
    const body = (await request.json()) as Record<string, unknown>;

    const title = String(body.title ?? 'Digital Carat gift card').slice(0, 120);
    const width = Math.round(Number(body.width ?? 1050));
    const height = Math.round(Number(body.height ?? 640));
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 40 || height < 40) {
      return json({ error: 'Invalid card dimensions' }, 400);
    }

    if (typeof body.pngBase64 !== 'string' || body.pngBase64.length === 0) {
      return json({ error: 'The card image is missing' }, 400);
    }
    const bytes = decodeBase64(body.pngBase64);
    if (bytes.byteLength > MAX_PNG_BYTES) {
      return json({ error: 'The card image is too large to send to Canva' }, 413);
    }

    const token = await accessTokenFor(user.id);
    const authorization = `Bearer ${token}`;

    const upload = await fetch(`${CANVA_API}/asset-uploads`, {
      method: 'POST',
      headers: {
        authorization,
        'content-type': 'application/octet-stream',
        // Base64 so a name carrying an emoji or an accent survives an HTTP
        // header, which Canva requires rather than merely permits.
        'asset-upload-metadata': JSON.stringify({ name_base64: btoa(title) }),
      },
      body: bytes,
    });
    if (!upload.ok) throw await canvaError(upload, 'Canva rejected the card image');

    let job = (await upload.json()) as {
      job: { id: string; status: string; asset?: { id: string }; error?: { message?: string } };
    };

    for (let attempt = 0; attempt < POLL_ATTEMPTS && job.job.status === 'in_progress'; attempt++) {
      await sleep(POLL_INTERVAL_MS);
      const poll = await fetch(`${CANVA_API}/asset-uploads/${job.job.id}`, {
        headers: { authorization },
      });
      if (!poll.ok) throw await canvaError(poll, 'Could not read the Canva upload status');
      job = (await poll.json()) as typeof job;
    }

    if (job.job.status !== 'success' || !job.job.asset?.id) {
      throw new Error(
        job.job.error?.message ??
          (job.job.status === 'in_progress'
            ? 'Canva is still processing the image. Try again in a moment.'
            : 'Canva could not process the card image'),
      );
    }

    const design = await fetch(`${CANVA_API}/designs`, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'type_and_asset',
        // Custom rather than a preset: the card is 1050x640, and dropping it
        // into a preset canvas would letterbox artwork that was composed to
        // fill the page.
        design_type: { type: 'custom', width, height },
        asset_id: job.job.asset.id,
        title,
      }),
    });
    if (!design.ok) throw await canvaError(design, 'Canva could not create the design');

    const created = (await design.json()) as {
      design: { id: string; urls: { edit_url: string; view_url: string } };
    };

    await audit(user.id, 'canva.exported', 'profile', user.id, { designId: created.design.id });

    return json({
      designId: created.design.id,
      // Canva documents this as accessible only to the user who made the
      // request, so it is safe to hand back to the browser that asked.
      editUrl: created.design.urls.edit_url,
      viewUrl: created.design.urls.view_url,
    });
  } catch (error) {
    if (error instanceof CanvaNotConfiguredError) {
      return json({ error: 'Canva is not configured for this deployment' }, 503);
    }
    if (error instanceof CanvaNotConnectedError) {
      return json({ error: error.message, needsConnection: true }, 409);
    }
    return json({ error: safeErrorMessage(error, 'Could not send the card to Canva') }, 400);
  }
});
