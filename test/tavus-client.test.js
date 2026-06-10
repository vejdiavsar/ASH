import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const html = readFileSync(new URL('../ash-v2.html', import.meta.url), 'utf8');

test('Tavus client defaults to Daily join instead of hosted iframe prejoin', () => {
  assert.match(html, /const TAVUS_CUSTOMER_NAME = "Clark's Customer";/);
  assert.match(html, /return mode === 'iframe' \|\| mode === 'redirect' \? mode : 'daily';/);
});

test('Tavus Daily join supplies a default customer participant name', () => {
  assert.match(html, /userName: TAVUS_CUSTOMER_NAME/);
  assert.doesNotMatch(html, /userName:\s*['"]Guest['"]/);
});


test('Tavus Daily join hides meeting-style chrome for the customer iPad', () => {
  assert.match(html, /showLocalVideo:\s*false/);
  assert.match(html, /showParticipantsBar:\s*false/);
  assert.match(html, /showFullscreenButton:\s*false/);
});

test('Tavus fallback prejoin copy stays customer-friendly', () => {
  assert.match(html, /Tap Join to speak with Ash\./);
  assert.match(html, /Ash is getting ready to talk with you\./);
  assert.doesNotMatch(html, /Tavus is opening Ash's face and voice/);
  assert.doesNotMatch(html, /Claude-powered Render app/);
});
