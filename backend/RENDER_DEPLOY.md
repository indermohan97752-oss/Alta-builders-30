# Deploy backend to Render

Render deploys services from a connected Git repository or a Docker image; it does not deploy a Node source ZIP directly.
Extract this folder into your repository as `backend/`, then connect that repository to Render.

## Render Web Service settings
- Runtime: Node
- Build command (repository root): `cd backend && npm install --no-audit --no-fund && npm run build`
- Start command (repository root): `cd backend && npm start`
- Health check path: `/health`
- Region: Singapore (close to users in India)

## Environment variables
- `NODE_ENV=production`
- `MONGODB_URI`: Atlas SRV URI for a fresh, empty database using a dedicated least-privilege `readWrite` user
- `JWT_SECRET`: generate a new random secret locally (for example: `openssl rand -base64 48`)
- `CLIENT_ORIGIN`: exact HTTPS origin of your deployed Vercel frontend
- `BCRYPT_ROUNDS=12`
- `TRUST_PROXY=0` unless you have confirmed the correct trusted proxy configuration

The production session cookie uses `SameSite=None; Secure` so the Vercel frontend can send it cross-origin. Browsers that block third-party cookies may require custom frontend/backend domains under the same site. Add Render's outbound IP addresses to the MongoDB Atlas IP access list. Do not use `0.0.0.0/0`.
Never commit `.env` or place backend secrets in the frontend.

IMPORTANT: This E2EE build has a new database schema. Use a new empty database; do not point it at the old plaintext chat database.
