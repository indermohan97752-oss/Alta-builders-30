# ChatGPT (OpenAI) integration

This repository currently tracks the backend as `chat-app-backend.zip`, rather than as an unpacked backend source tree. The route below is ready to add to that Express backend; mount it in the server entry point after extracting the archive.

## Backend setup

1. From the backend project directory, install the official OpenAI Node SDK:

   ```bash
   npm install openai
   ```

2. Set these variables in the backend's local `.env` (do not commit real keys):

   ```dotenv
   OPENAI_API_KEY=your_openai_api_key
   OPENAI_MODEL=gpt-4.1-mini
   ```

   Keep `OPENAI_API_KEY` on the server only. Add it to your hosting provider's secret/environment-variable settings for deployment. Do not put it in React/Vite variables, source code, or a committed `.env` file.

3. Copy `backend/routes/ai.js` into the backend source tree. In the Express server entry point, mount the route after JSON body parsing and alongside the existing API routes:

   ```js
   app.use('/api/ai', require('./routes/ai'));
   ```

   The router uses the existing `backend/middleware/auth` JWT middleware, so requests must be authenticated. It exposes:

   ```text
   POST /api/ai/chat
   Content-Type: application/json
   Authorization: Bearer <JWT>

   { "message": "Suggest a name for our study group" }
   ```

   Success response: `{ "reply": "..." }`. The endpoint accepts one message per request, limits input to 4,000 characters, and does not provide tools or access to users' private chat history.

## Frontend call

Call the API through the application's existing authenticated Axios/API helper, rather than calling OpenAI from the browser. For example, adapt the import and token handling to the app's existing API client:

```js
const { data } = await api.post('/ai/chat', { message });
setReply(data.reply);
```

The API client should send the user's JWT and target the backend base URL that already serves `/api` routes. Show a useful error when the endpoint returns `4xx` or `5xx`.

## Access and privacy

This integration gives the application a server-side OpenAI API connection; it does not grant ChatGPT or OpenAI account access to this GitHub repository. The repository is public, so its public contents are readable without extra permissions. Changing GitHub collaborators, app installations, or repository permissions must be done by an authorized repository owner in GitHub settings. Never share a GitHub token or OpenAI API key in chat or commit one to this repository.
