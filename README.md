# ASH

Clark's Hardwood Lumber AI guide.

## Tavus + Render brain connection

This app now exposes the two sides of Ash as one flow:

- **Ash's brain** stays in this Render app and uses Claude through Anthropic.
- **Ash's face and voice** run in Tavus Conversational Video Interface (CVI).
- The iPad launches the Tavus `conversation_url` and embeds it directly in a full-screen iframe (with a direct-room redirect fallback).
- Tavus calls the app's OpenAI-compatible `/v1/chat/completions` endpoint, which translates the request to Claude and returns Ash's Clark's/woodworking answer.

Default Tavus IDs are baked in for Ash:

- Persona: `p3ebb7951fa5`
- Replica: `rdf61be0d4e1`

## Required environment variables

```bash
ANTHROPIC_API_KEY=sk-ant-...
TAVUS_API_KEY=...
PUBLIC_BASE_URL=https://ash-avsar.onrender.com
ASH_LLM_API_KEY=<shared-secret-for-tavus-custom-llm>
```

Optional overrides:

```bash
TAVUS_PERSONA_ID=p3ebb7951fa5
TAVUS_REPLICA_ID=rdf61be0d4e1
TAVUS_LLM_MODEL=ash-claude
ANTHROPIC_MODEL=claude-sonnet-4-6
```

## One-time Tavus persona configuration

After deploying the Render app, configure the Tavus persona to use this app as its custom LLM:

```bash
curl -X POST https://ash-avsar.onrender.com/api/tavus/configure-persona \
  -H 'Content-Type: application/json' \
  -d '{}'
```

That endpoint patches persona `p3ebb7951fa5` so Tavus uses:

- `base_url`: `https://ash-avsar.onrender.com/v1`
- `model`: `ash-claude`
- `api_key`: `ASH_LLM_API_KEY` (or `TAVUS_LLM_API_KEY`)
- `default_replica_id`: `rdf61be0d4e1`

## Runtime flow

1. Customer taps **START VIDEO WITH ASH** on the iPad.
2. Browser calls `POST /api/tavus/conversations`.
3. Server creates a Tavus CVI conversation with Ash's persona and replica.
4. Browser embeds the returned Tavus `conversation_url` directly in a full-screen iframe, avoiding the Daily Prebuilt join wrapper that can stall on pre-join.
5. Tavus handles camera, microphone, STT, Ash's video, and Ash's voice.
6. Tavus sends chat completions to `/v1/chat/completions`.
7. This app sends those messages to Claude and returns OpenAI-compatible chat/SSE responses.

## Local development

```bash
npm start
```

Health check:

```bash
curl http://localhost:3000/api/health
```
