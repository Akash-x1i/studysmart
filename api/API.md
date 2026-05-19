# StudySmart API

Base URL while running locally:

```text
http://127.0.0.1:3333
```

For ESP32, use your computer LAN IP instead of `127.0.0.1`.

Start server:

```bash
NVIDIA_API_KEY="your_key" npm start
```

## Render Deploy

This repo includes `render.yaml` for Render.

Deploy steps:

1. Push the repo to GitHub.
2. In Render, choose New > Blueprint.
3. Select this repo.
4. Add environment variable `NVIDIA_API_KEY`.
5. Deploy.

Render will run:

```bash
cd api && npm install
cd api && npm start
```

After deploy, your base URL will look like:

```text
https://studysmart-api.onrender.com
```

Check it:

```bash
curl https://studysmart-api.onrender.com/api/health
```

For ESP32, set `API_HOST` to the Render hostname without `https://`:

```cpp
const char *API_HOST = "studysmart-api.onrender.com";
const uint16_t API_PORT = 443;
```

Use HTTPS on the device when calling Render.

## Health

```http
GET /api/health
```

Response:

```json
{ "ok": true, "v": 3, "provider": "nvidia", "ai": true }
```

## Ask

Creates an answer and returns page 1.

```http
POST /api/ask
```

Body:

```json
{
  "question": "What is photosynthesis?",
  "deviceId": "AA:BB:CC:DD:EE:FF"
}
```

Response:

```json
{
  "answerId": "ans_abc123",
  "totalPages": 3,
  "page": 1,
  "text": "Photosynthesis is how plants make food using sunlight.",
  "hasMore": true
}
```

Fetch another page:

```http
GET /api/ask/:answerId/page/:pageNum
```

Example:

```bash
curl http://127.0.0.1:3333/api/ask/ans_abc123/page/2
```

## Generate Quiz

Generates a quiz and returns question 0.

```http
POST /api/quiz/generate
```

Body:

```json
{
  "topic": "Photosynthesis",
  "count": 10,
  "deviceId": "AA:BB:CC:DD:EE:FF"
}
```

Response:

```json
{
  "quizId": "qz_xyz789",
  "topic": "Photosynthesis",
  "totalQuestions": 10,
  "question": {
    "index": 0,
    "text": "Which pigment absorbs light?",
    "options": ["Melanin", "Chlorophyll", "Keratin", "Insulin"],
    "correctIndex": 1,
    "explanation": "Chlorophyll absorbs light for photosynthesis."
  }
}
```

## Fetch Quiz Question

```http
GET /api/quiz/:quizId/question/:index
```

Example:

```bash
curl http://127.0.0.1:3333/api/quiz/qz_xyz789/question/1
```

## Submit Quiz

```http
POST /api/quiz/:quizId/submit
```

Body:

```json
{
  "deviceId": "AA:BB:CC:DD:EE:FF",
  "score": 8,
  "totalQuestions": 10,
  "topic": "Photosynthesis"
}
```

Response:

```json
{ "ok": true, "percent": 80, "grade": "B" }
```

## Legacy Static Quiz Routes

```http
GET /api/topics
GET /api/question/:topicId/:index
POST /api/verify
```

These use `data/quizzes.json` and do not require NVIDIA or DeepSeek.
