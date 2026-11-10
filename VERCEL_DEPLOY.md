# Deploy frontend to Vercel

This is the frontend folder from the matching end-to-end encrypted chat app build.

## Vercel project settings
- Framework preset: Vite
- Root directory: `frontend` (when deploying from the full repository); if uploading this folder as the project root, use `./`
- Build command: `npm run build`
- Output directory: `dist`
- Install command: `npm install`

## Environment variables
- `VITE_API_URL`: your deployed backend origin, e.g. `https://your-api.onrender.com`
- `VITE_SOCKET_URL`: the same backend origin

Set these in Vercel Project Settings → Environment Variables, then redeploy.
Do not put MongoDB credentials, JWT secrets, or other server secrets in `VITE_*` variables.
