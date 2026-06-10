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
  assert.equal(payload.custom_greeting, "Hi, welcome to Clark's Hardwood Lumber. I'm Ash. Are you working on a project today, or would you like help finding something?");
  assert.equal(payload.custom_greeting.toLowerCase().includes('record'), false);
  assert.equal(payload.conversational_context.includes('Claude-powered Render brain'), true);
  assert.equal(payload.conversational_context.includes('Do not ask for permission to record'), true);
  assert.equal(payload.conversational_context.includes('Would you like me to get James to help you?'), true);
});


test('Tavus conversation payload does not forward unknown top-level or nested fields', () => {
  const payload = buildTavusConversationPayload({
    enable_prejoin_ui: false,
    replica_id: 'client-replica',
    persona_id: 'client-persona',
    callback_url: 'https://example.com/wrong-callback',
    token: { unexpected: true },
    meeting_token: { unexpected: true },
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
  assert.equal(Object.hasOwn(payload, 'token'), false);
  assert.equal(Object.hasOwn(payload, 'meeting_token'), false);
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


test('Tavus conversation response preserves only string tokens', () => {
  const response = normalizeTavusConversationResponse({
    conversation_id: 'conversation-3',
    conversation_url: 'https://tavus.daily.co/conversation-3',
    meeting_token: 'redacted-meeting-token',
    token: 'redacted-token'
  });

  assert.equal(response.meeting_token, 'redacted-meeting-token');
  assert.equal(response.token, 'redacted-token');
});

test('Tavus conversation response removes object tokens without inventing replacements', () => {
  const response = normalizeTavusConversationResponse({
    conversation_id: 'conversation-4',
    conversation_url: 'https://tavus.daily.co/conversation-4',
    meeting_token: { value: 'redacted-meeting-token' },
    token: { value: 'redacted-token' }
  });

  assert.equal(Object.hasOwn(response, 'meeting_token'), false);
  assert.equal(Object.hasOwn(response, 'token'), false);
});

test('Tavus conversation response does not invent a token when Tavus omits one', () => {
  const response = normalizeTavusConversationResponse({
    conversation_id: 'conversation-5',
    conversation_url: 'https://tavus.daily.co/conversation-5'
  });

  assert.equal(Object.hasOwn(response, 'meeting_token'), false);
  assert.equal(Object.hasOwn(response, 'token'), false);
});
