Run with Node 24 (`nvm use`), `npm ci`, then copy `.env.example` to `.env` and set your Atlas `MONGODB_URI`. Run `npm start`. Startup connects to MongoDB and creates the unique email index before accepting requests.

Run `npm test` for HTTP integration tests using an isolated temporary MongoDB replica set. The first run downloads a MongoDB binary; no Atlas credentials are needed. Writes use MongoDB transactions, supported by Atlas, so reference updates and resource changes commit together or roll back together. Standalone MongoDB servers are not supported.

Deploy this directory as a Render Node service using `render.yaml` (if deploying a parent repository, set the service root directory to `mp3`). Provide the Atlas URI as a secret and configure Atlas network access as specified in the assignment. Set `API_URL` in `submit.js` to the deployed base URL and run `npm run submit`. Submit the repository and deployment using the README's submission form.

Successful deletes and OPTIONS return HTTP 204 with no body. Other responses use `{ message, data }`. Count returns the total matching documents before pagination.

This implementation was generated with OpenAI Codex. Per the course LLM policy, include this chat log with the source code and answer the LLM survey questions when submitting.
