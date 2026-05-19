# StudySmart API

Base URL while running locally:

```text
http://127.0.0.1:3333
```

For ESP32, use your computer LAN IP instead of `127.0.0.1`.

Start server:

```bash
GEMINI_API_KEY="your_key" npm start
```

## Health

```http
GET /api/health
```

Response:

```json
{ "ok": true, "v": 2, "gemini": true }
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

These use `data/quizzes.json` and do not require Gemini.

