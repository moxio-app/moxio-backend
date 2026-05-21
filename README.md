# Moxio Backend

Fastify backend for the AI-first Moxio workspace MVP. It serves bootstrap data, typed UI/chat actions, integration OAuth handoff helpers, and the chat endpoint used by the frontend.

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

The API runs at `http://localhost:4000` by default.

## Scripts

- `npm run dev` starts the backend in watch mode.
- `npm run build` type-checks the backend.
- `npm start` starts the backend with `tsx`.
