import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isJamesHelpIntent } from '../server.js';

const jamesQuestionHistory = [
  { role: 'assistant', content: 'Would you like me to get James to help you?' }
];

test('James help intent detects explicit staff-help requests', () => {
  const examples = [
    'get James',
    'I need help',
    'call someone',
    'can someone help me',
    'I need a real person',
    'Could someone help me pick out walnut?'
  ];

  for (const example of examples) {
    assert.equal(isJamesHelpIntent(example, []), true, example);
  }
});

test('James help intent treats yes as a request only after Ash asks about James', () => {
  assert.equal(isJamesHelpIntent('yes please', jamesQuestionHistory), true);
  assert.equal(isJamesHelpIntent('yes', []), false);
});
