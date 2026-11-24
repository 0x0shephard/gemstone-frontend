import { describe, expect, it } from 'vitest';
import {
  analyticsPath,
  pageIsShareable,
  readUtm,
  sanitizeProperties,
  sanitizeUrl,
  withUtm,
} from './attribution';

const ORIGIN = 'https://digitalcarat.io';

describe('readUtm', () => {
  it('keeps only campaign tags', () => {
    expect(
      readUtm('?code=FIRST100&utm_source=instagram&utm_campaign=first100&fbclid=abc&utm_term='),
    ).toEqual({ utm_source: 'instagram', utm_campaign: 'first100' });
  });
});

describe('analyticsPath', () => {
  it('hides gift codes and trailing slashes', () => {
    expect(analyticsPath('/gift/ABCD-1234')).toBe('/gift/:code');
    expect(analyticsPath('/gift')).toBe('/gift');
    expect(analyticsPath('/claim/')).toBe('/claim');
    expect(analyticsPath('/')).toBe('/');
  });
});

describe('sanitizeUrl', () => {
  it('drops everything but campaign tags from same-site URLs', () => {
    expect(
      sanitizeUrl(`${ORIGIN}/claim?code=FIRST100&utm_source=instagram#access_token=secret`, ORIGIN),
    ).toBe(`${ORIGIN}/claim?utm_source=instagram`);
    expect(sanitizeUrl(`${ORIGIN}/gift/ABCD-1234?x=1`, ORIGIN)).toBe(`${ORIGIN}/gift/:code`);
  });

  it('reduces other sites to origin and path', () => {
    expect(sanitizeUrl('https://l.instagram.com/?u=abc', ORIGIN)).toBe('https://l.instagram.com/');
  });
});

describe('sanitizeProperties', () => {
  it('cleans nested URLs and paths', () => {
    expect(
      sanitizeProperties(
        {
          $current_url: `${ORIGIN}/gift/SECRET`,
          $pathname: '/gift/SECRET',
          $session_entry_pathname: '/gift/SECRET',
          $set_once: { $initial_current_url: `${ORIGIN}/claim#access_token=x` },
          flow: 'promo',
        },
        ORIGIN,
      ),
    ).toEqual({
      $current_url: `${ORIGIN}/gift/:code`,
      $pathname: '/gift/:code',
      $session_entry_pathname: '/gift/:code',
      $set_once: { $initial_current_url: `${ORIGIN}/claim` },
      flow: 'promo',
    });
  });
});

describe('pageIsShareable', () => {
  it('refuses pages that can carry a secret', () => {
    expect(pageIsShareable({ pathname: '/claim', search: '?code=FIRST100', hash: '' })).toBe(true);
    expect(pageIsShareable({ pathname: '/gift/ABCD', search: '', hash: '' })).toBe(false);
    expect(pageIsShareable({ pathname: '/claim', search: '', hash: '#access_token=x' })).toBe(
      false,
    );
    expect(pageIsShareable({ pathname: '/canva/callback', search: '?code=x', hash: '' })).toBe(
      false,
    );
  });
});

describe('withUtm', () => {
  it('carries campaign tags onto a return link without overwriting', () => {
    expect(withUtm(`${ORIGIN}/claim?code=FIRST100`, { utm_source: 'instagram' })).toBe(
      `${ORIGIN}/claim?code=FIRST100&utm_source=instagram`,
    );
    expect(withUtm(`${ORIGIN}/claim`, {})).toBe(`${ORIGIN}/claim`);
  });
});
