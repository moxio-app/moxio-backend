# Moxio Backend

Fastify backend for the AI-first Moxio workspace MVP. It serves bootstrap data, typed UI/chat actions, integration OAuth helpers, and the AI chat endpoint used by the frontend.

Repository: https://github.com/moxio-app/moxio-backend

## Prerequisites

- Node.js 20 or newer.
- npm.
- Access to both private GitHub repositories:
  - https://github.com/moxio-app/moxio-backend
  - https://github.com/moxio-app/moxio-frontend
- A backend `.env` file from the Moxio team.

## Local Workspace

Keep the backend and frontend folders beside each other:

```bash
moxio/
  moxio-backend/
  moxio-frontend/
```

Clone with SSH:

```bash
git clone git@github.com:moxio-app/moxio-backend.git
git clone git@github.com:moxio-app/moxio-frontend.git
```

Clone with HTTPS if SSH is not configured:

```bash
git clone https://github.com/moxio-app/moxio-backend.git
git clone https://github.com/moxio-app/moxio-frontend.git
```

## Environment

Create `moxio-backend/.env` from the shared backend env file. Do not commit real `.env` files.

Common local values:

```bash
HOST=
PORT=4000
APP_URL=http://localhost:4000
FRONTEND_URL=http://localhost:3000

DB_HOST=
DB_PORT=
DB_USER=
DB_PASSWORD=
DB_NAME=

OPENAI_API_KEY=
MOXIO_USE_MODEL_CHAT=false
MOXIO_AI_MODEL=gpt-4o-mini

ZERNIO_API_KEY=
ZERNIO_PROFILE_ID=
ZERNIO_PROFILE_NAME=

AYRSHARE_API_KEY=
AYRSHARE_DOMAIN=
AYRSHARE_PROFILE_KEY=
AYRSHARE_PRIVATE_KEY=

FAL_KEY=
```

Notes:
- `OPENAI_API_KEY` plus `MOXIO_USE_MODEL_CHAT=true` enables model-backed Account Manager chat. Without it, the backend uses the local fallback chat behavior.
- Zernio values are required only when testing integration OAuth.
- `FAL_KEY` is planned for the Generate Images backend integration; current frontend generation still uses a static preview stub.
- The PostgreSQL schema draft is in `migrations/001_initial_schema.sql`, but the current MVP still serves mock/in-memory data.

The frontend must also have its own `.env` in `../moxio-frontend/.env`.

## Install

```bash
cd moxio-backend
npm install
cd ../moxio-frontend
npm install
```

## Run The Full App

From `moxio-backend`, start both backend and frontend:

```bash
npm run start-all
```

Or run them in separate terminals:

```bash
cd moxio-backend
npm run dev
```

```bash
cd moxio-frontend
npm run dev
```

Backend health check: http://localhost:4000/health.

Open the frontend at http://localhost:3000.

## Scripts

- `npm run dev` starts the backend in watch mode on port `4000`.
- `npm run start-all` starts the backend and sibling frontend together.
- `npm run build` type-checks the backend.
- `npm start` starts the backend with `tsx`.
