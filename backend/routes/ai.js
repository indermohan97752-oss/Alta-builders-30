const express = require('express');
const OpenAI = require('openai');
const auth = require('../middleware/auth');

const router = express.Router();
const MAX_MESSAGE_LENGTH = 4000;

// Keep this endpoint behind the app's JWT middleware. Never expose the OpenAI
// API key to the browser or accept arbitrary model/tool settings from clients.
router.post('/chat', auth, async (req, res) => {
  const message = req.body && req.body.message;

  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ message: 'A non-empty message is required.' });
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return res.status(413).json({ message: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.` });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ message: 'AI chat is not configured.' });
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      instructions: 'You are a helpful assistant in a campus community chat app. Be concise, respectful, and do not claim to have access to private chats or repository data.',
      input: message.trim(),
      max_output_tokens: 500,
    });

    return res.status(200).json({ reply: response.output_text || '' });
  } catch (error) {
    // Avoid returning provider errors or configuration details to clients.
    console.error('OpenAI chat request failed:', error.message);
    return res.status(502).json({ message: 'The AI assistant could not complete that request.' });
  }
});

module.exports = router;
