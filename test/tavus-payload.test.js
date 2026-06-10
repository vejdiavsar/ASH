import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildTavusConversationPayload } from '../server.js';

test('Tavus conversation payload omits unsupported prejoin fields', () => {
  const payload = buildTavusConversationPayload({
    replica_id: 'client-replica',
    persona_id: 'client-persona',
    callback_url: 'https://example.com/wrong-callback',
    properties: {
      enable_prejoin_ui: false,
      participant_left_timeout: 60,
      language: 'en'
    }
  }, 'https://ash-avsar.onrender.com');

  assert.equal(payload.persona_id, process.env.TAVUS_PERSONA_ID || 'p3ebb7951fa5');
  assert.equal(payload.replica_id, process.env.TAVUS_REPLICA_ID || 'rdf61be0d4e1');
  assert.equal(payload.callback_url, 'https://ash-avsar.onrender.com/api/tavus/callback');
  assert.deepEqual(payload.properties, { language: 'en' });
  assert.equal(JSON.stringify(payload).includes('enable_prejoin_ui'), false);
  assert.equal(JSON.stringify(payload).includes('participant_left_timeout'), false);
});

test('Tavus conversation payload includes only valid app defaults when no options are sent', () => {
  const payload = buildTavusConversationPayload({}, 'https://ash-avsar.onrender.com');

  assert.equal(payload.persona_id, process.env.TAVUS_PERSONA_ID || 'p3ebb7951fa5');
  assert.equal(payload.replica_id, process.env.TAVUS_REPLICA_ID || 'rdf61be0d4e1');
  assert.equal(payload.callback_url, 'https://ash-avsar.onrender.com/api/tavus/callback');
  assert.equal(Object.hasOwn(payload, 'properties'), false);
  assert.equal(payload.custom_greeting.includes("I'm Ash"), true);
  assert.equal(payload.conversational_context.includes('Claude-powered Render brain'), true);
});
