import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailNotConfiguredError, emailConfigured, escapeHtml, sendEmail } from './email.ts';

const environment = new Map<string, string>();
const fetchMock = vi.fn<typeof fetch>();

describe('outbound email', () => {
  beforeEach(() => {
    environment.clear();
    vi.stubGlobal('Deno', { env: { get: (name: string) => environment.get(name) } });
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requires both the provider key and a verified sender', () => {
    expect(emailConfigured()).toBe(false);
    environment.set('RESEND_API_KEY', 're_test');
    expect(emailConfigured()).toBe(false);
    environment.set('MAIL_FROM', 'Digital Carat <alerts@digitalcarat.io>');
    expect(emailConfigured()).toBe(true);
  });

  it('sends the complete transactional payload to Resend', async () => {
    environment.set('RESEND_API_KEY', 're_test');
    environment.set('MAIL_FROM', 'Digital Carat <alerts@digitalcarat.io>');
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: 'email-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(
      sendEmail({
        to: 'recipient@example.com',
        subject: 'Your swap can be recovered',
        html: '<p>Recover it now.</p>',
        text: 'Recover it now.',
        replyTo: 'sender@example.com',
        attachments: [{ filename: 'gift-card.html', content: 'PGh0bWw+' }],
      }),
    ).resolves.toBe('email-1');

    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(request?.headers).toEqual({
      authorization: 'Bearer re_test',
      'content-type': 'application/json',
    });
    expect(JSON.parse(String(request?.body))).toEqual({
      from: 'Digital Carat <alerts@digitalcarat.io>',
      to: ['recipient@example.com'],
      subject: 'Your swap can be recovered',
      html: '<p>Recover it now.</p>',
      text: 'Recover it now.',
      reply_to: 'sender@example.com',
      attachments: [{ filename: 'gift-card.html', content: 'PGh0bWw+' }],
    });
  });

  it('fails clearly when delivery is not configured or the provider rejects it', async () => {
    await expect(
      sendEmail({ to: 'a@example.com', subject: 'Test', html: 'Test', text: 'Test' }),
    ).rejects.toBeInstanceOf(EmailNotConfiguredError);

    environment.set('RESEND_API_KEY', 're_test');
    environment.set('MAIL_FROM', 'Digital Carat <alerts@digitalcarat.io>');
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: 'Domain is not verified' }), {
        status: 422,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect(
      sendEmail({ to: 'a@example.com', subject: 'Test', html: 'Test', text: 'Test' }),
    ).rejects.toThrow('Domain is not verified');
  });

  it('escapes user-controlled values placed into HTML emails', () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'quote'`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quote&#39;',
    );
  });
});
