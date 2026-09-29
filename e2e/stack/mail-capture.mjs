#!/usr/bin/env node
/**
 * Stands in for Resend during the end-to-end suite. Edge functions POST here
 * (RESEND_API_URL); tests read GET /emails and clear with DELETE /emails.
 */
import http from 'node:http';

const port = Number(process.env.MAIL_CAPTURE_PORT ?? 4010);
let emails = [];

http
  .createServer((request, response) => {
    const reply = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (request.url !== '/emails') return reply(404, { error: 'not found' });
    if (request.method === 'GET') return reply(200, emails);
    if (request.method === 'DELETE') {
      emails = [];
      return reply(200, { cleared: true });
    }
    if (request.method === 'POST') {
      let raw = '';
      request.on('data', (chunk) => (raw += chunk));
      request.on('end', () => {
        const id = `captured-${emails.length + 1}`;
        emails.push({ id, receivedAt: new Date().toISOString(), ...JSON.parse(raw) });
        reply(200, { id });
      });
      return;
    }
    reply(405, { error: 'method not allowed' });
  })
  .listen(port, '0.0.0.0', () => console.log(`[mail-capture] listening on :${port}`));
