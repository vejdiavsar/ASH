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
