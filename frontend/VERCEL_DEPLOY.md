# Deploy frontend to Vercel

This is the frontend folder from the matching end-to-end encrypted chat app build.

## Vercel project settings
- Framework preset: Vite
- Root directory: `frontend` (when deploying from the full repository); if uploading this folder as the project root, use `./`
- Build command: `npm run build`
- Output directory: `dist`
- Install command: `npm install --no-audit --no-fund`

## Environment variables
- `VITE_API_URL`: your deployed backend origin, e.g. `https://your-api.onrender.com`
- `VITE_SOCKET_URL`: the same backend origin

Set both variables in Vercel Project Settings → Environment Variables for Production, Preview, and Development, then redeploy. The API URL must be the public HTTPS Render backend origin with no trailing slash.
Do not put MongoDB credentials, JWT secrets, or other server secrets in `VITE_*` variables.
