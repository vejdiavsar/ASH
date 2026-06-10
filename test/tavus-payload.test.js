import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildTavusConversationPayload, normalizeTavusConversationResponse } from '../server.js';

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


test('Tavus conversation payload does not forward unknown top-level or nested fields', () => {
  const payload = buildTavusConversationPayload({
    enable_prejoin_ui: false,
    replica_id: 'client-replica',
    persona_id: 'client-persona',
    callback_url: 'https://example.com/wrong-callback',
    properties: {
      enable_prejoin_ui: false,
      participant_left_timeout: 60,
      nested: { enable_prejoin_ui: false }
    }
  }, 'https://ash-avsar.onrender.com');

  assert.equal(payload.persona_id, process.env.TAVUS_PERSONA_ID || 'p3ebb7951fa5');
  assert.equal(payload.replica_id, process.env.TAVUS_REPLICA_ID || 'rdf61be0d4e1');
  assert.equal(payload.callback_url, 'https://ash-avsar.onrender.com/api/tavus/callback');
  assert.equal(Object.hasOwn(payload, 'properties'), false);
  assert.equal(JSON.stringify(payload).includes('enable_prejoin_ui'), false);
  assert.equal(JSON.stringify(payload).includes('participant_left_timeout'), false);
});

test('Tavus conversation response keeps official conversation_url field', () => {
  const response = normalizeTavusConversationResponse({
    conversation_id: 'conversation-1',
    conversation_url: 'https://tavus.daily.co/conversation-1',
    meeting_token: 'redacted-token'
  });

  assert.equal(response.conversation_url, 'https://tavus.daily.co/conversation-1');
});

test('Tavus conversation response normalizes alternate URL field names', () => {
  const response = normalizeTavusConversationResponse({
    conversation_id: 'conversation-2',
    daily_room_url: 'https://tavus.daily.co/conversation-2'
  });

  assert.equal(response.conversation_url, 'https://tavus.daily.co/conversation-2');
  assert.equal(response.daily_room_url, 'https://tavus.daily.co/conversation-2');
});
