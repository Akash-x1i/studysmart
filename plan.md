Great plan. Here's the full API design for both features, built around the ESP32's constraints.

## Core design principles for the ESP32

Every endpoint follows these rules: responses are plain text only (no markdown symbols), all text fields are pre-truncated server-side, pagination is built into every content endpoint, and the device sends a `deviceId` (MAC address) with every request so the server can maintain session state instead of the device.

## Ask? API

The trick here is that the device doesn't hold the full answer in RAM. The server generates the complete answer, stores it, and the device fetches it one chunk at a time by page number.

```
POST /api/ask
Body:
{
  "question": "What is photosynthesis?",
  "deviceId": "AA:BB:CC:DD:EE:FF"
}

Response:
{
  "answerId": "ans_abc123",
  "totalPages": 4,
  "page": 1,
  "text": "Photosynthesis is the process by which plants convert sunlight into food. Chlorophyll in the leaves absorbs light energy.",
  "hasMore": true
}
```

The server generates the full answer on the first call, splits it into ~200 character chunks (fits your display width), stores all pages in Redis with a 30-minute TTL keyed by `answerId`, and returns page 1 immediately. The device stores only `answerId` and `totalPages` in RAM — two small variables. When the user scrolls down, the device fetches the next page:

```
GET /api/ask/:answerId/page/:pageNum

Response:
{
  "answerId": "ans_abc123",
  "page": 2,
  "totalPages": 4,
  "text": "The process happens in two stages. The light reactions occur in the thylakoid membranes. The Calvin cycle occurs in the stroma.",
  "hasMore": true
}
```

No AI call on subsequent pages — it's just a Redis read, so response time is under 100ms. The device RAM usage for Ask? is just two ints and one short string.

## Quiz API

Quiz is stateless on the device side. The server generates all 20 questions at once, stores them, and the device fetches one at a time.

```
POST /api/quiz/generate
Body:
{
  "topic": "Photosynthesis",
  "count": 20,
  "deviceId": "AA:BB:CC:DD:EE:FF"
}

Response:
{
  "quizId": "qz_xyz789",
  "topic": "Photosynthesis",
  "totalQuestions": 20,
  "question": {
    "index": 0,
    "text": "Which pigment absorbs light in photosynthesis?",
    "options": ["Melanin", "Chlorophyll", "Keratin", "Carotene"],
    "correctIndex": 1,
    "explanation": "Chlorophyll absorbs red and blue light wavelengths."
  }
}
```

One AI call, 20 questions generated, all stored in Redis. Device only gets back question 0 immediately. The device stores `quizId`, `totalQuestions`, current question index, and score — four variables total.

Fetching subsequent questions:

```
GET /api/quiz/:quizId/question/:index

Response:
{
  "quizId": "qz_xyz789",
  "index": 5,
  "totalQuestions": 20,
  "question": {
    "text": "Where does the Calvin cycle take place?",
    "options": ["Thylakoid", "Stroma", "Nucleus", "Cytoplasm"],
    "correctIndex": 1,
    "explanation": "The Calvin cycle occurs in the stroma of the chloroplast."
  }
}
```

Again, just a Redis lookup — no AI involved after the first call.

Submitting the final score:

```
POST /api/quiz/:quizId/submit
Body:
{
  "deviceId": "AA:BB:CC:DD:EE:FF",
  "score": 16,
  "totalQuestions": 20,
  "topic": "Photosynthesis"
}

Response:
{
  "ok": true,
  "percent": 80,
  "grade": "B"
}
```

## Response size budget

Every response must fit in a `DynamicJsonDocument(2048)` on the device side. Here's how the server enforces this:

| Field | Max chars | Reason |
|---|---|---|
| Answer page text | 220 chars | ~9 lines on your display |
| Question text | 120 chars | 5 display lines |
| Each option | 40 chars | One display line |
| Explanation | 120 chars | 5 display lines |
| answerId / quizId | 20 chars | Short generated ID |

The server trims all fields to these limits before sending. The LLM prompt explicitly instructs the model to keep each sentence short enough to fit.

## Server-side LLM prompts

For Ask?, the prompt structure:

```
System: You are a study assistant for a device with a tiny screen.
Rules:
- Plain text only. No markdown. No asterisks. No bullet symbols.
- Write short sentences. Max 15 words per sentence.
- Split your answer into chunks of exactly 200 characters at sentence boundaries.
- Return a JSON array called "pages" where each element is one chunk string.

User: {question}
```

For Quiz generation:

```
System: Generate exactly {count} multiple choice questions about "{topic}".
Rules:
- Plain text only in all fields.
- Question text: max 100 characters.
- Each option: max 35 characters.
- Explanation: max 100 characters. One sentence only.
- Return JSON: { questions: [{ text, options: [4 strings], correctIndex, explanation }] }
- No markdown. No special characters.

User: Generate {count} quiz questions about {topic}.
```

## Device-side RAM changes

With this design, replace your current large buffers with these:

```cpp
// Ask? state — replaces studySummary[2048]
char  askAnswerId[24]   = "";
int   askTotalPages     = 0;
int   askCurrentPage    = 0;
char  askPageText[256]  = "";   // only current page in RAM

// Quiz state — replaces quizQuestions[10] array
char  quizId[24]        = "";
int   quizTotal         = 0;
int   quizIndex         = 0;
int   quizScore         = 0;
// Single question in RAM at a time
char  quizQuestionText[128]    = "";
char  quizOptions[4][44]       = {};
int   quizCorrectIndex         = 0;
char  quizExplanation[128]     = "";
int   quizSelected             = 0;
```

The `QuizQuestion quizQuestions[MAX_QUIZ_Q]` array you currently have takes `10 × (180 + 4×80 + 4 + 180) = ~6.8KB` of RAM. The new approach uses under `700 bytes` for the same functionality.

## Full flow on the device

**Ask? flow:**
1. User types question → POST `/api/ask` → store `answerId`, `totalPages`, display page 1 text
2. NAV_DOWN → GET `/api/ask/:id/page/2` → replace `askPageText` buffer → redraw
3. NAV_UP → fetch previous page the same way
4. BACK → clear `askAnswerId`, return to Ask? input screen

**Quiz flow:**
1. User types topic → POST `/api/quiz/generate` → store `quizId`, `quizTotal`, display question 0
2. User selects answer → ENTER → record correct/wrong, increment `quizIndex`
3. GET `/api/quiz/:id/question/1` → overwrite question buffers → redraw
4. After question 20 → POST `/api/quiz/:id/submit` → show score screen
5. BACK mid-quiz → confirm exit (score is lost, that's fine)

## Backend tech stack

Since you're already on Node.js with Express:

```
Express routes
    ├── POST /api/ask              → calls LLM, splits pages, stores in Redis
    ├── GET  /api/ask/:id/page/:n  → Redis GET, returns one page
    ├── POST /api/quiz/generate    → calls LLM, stores all questions in Redis
    ├── GET  /api/quiz/:id/question/:n → Redis GET, returns one question
    └── POST /api/quiz/:id/submit  → stores score in DB, returns grade

Redis keys:
    ask:{answerId}:meta    → { totalPages }            TTL 30min
    ask:{answerId}:{page}  → "plain text chunk"        TTL 30min
    quiz:{quizId}:meta     → { topic, total }          TTL 2hr
    quiz:{quizId}:{index}  → { text, options[], ... }  TTL 2hr
```

Using Redis this way means the LLM is only ever called once per ask or quiz session. All subsequent device requests (page turns, next questions) are microsecond Redis reads — no AI latency, no extra cost, and the ESP32 never has to hold more than one page or one question in RAM at a time.