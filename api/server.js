/**
 * StudySmart API — small JSON REST for ESP32 HTTPClient.
 * Bind: 0.0.0.0 (LAN). CORS: * (embedded clients often send no Origin).
 *
 * Run: npm install && npm start
 * Env:
 * - PORT (default 3333)
 * - QUIZ_DATA (path to quizzes.json)
 * - GEMINI_API_KEY (required for generated ask/quiz routes)
 * - GEMINI_MODEL (default gemini-2.5-flash)
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");

const PORT = Number(process.env.PORT) || 3333;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GEMINI_BASE_URL =
  process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";
const DATA_PATH =
  process.env.QUIZ_DATA ||
  path.join(__dirname, "..", "data", "quizzes.json");

const LIMITS = {
  answerPage: 220,
  question: 120,
  option: 40,
  explanation: 120,
  askQuestion: 300,
  quizTopic: 80,
  maxQuizCount: 20,
};

const ASK_TTL_MS = 30 * 60 * 1000;
const QUIZ_TTL_MS = 2 * 60 * 60 * 1000;
const askSessions = new Map();
const quizSessions = new Map();

function loadQuizzes() {
  const raw = fs.readFileSync(DATA_PATH, "utf8");
  return JSON.parse(raw);
}

let quizzes = loadQuizzes();

const app = express();
app.use(express.json({ limit: "8kb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/api/health", (req, res) => {
  res.type("application/json");
  res.json({ ok: true, v: 2, gemini: Boolean(GEMINI_API_KEY) });
});

function now() {
  return Date.now();
}

function makeId(prefix) {
  return `${prefix}_${cryptoRandom(12)}`;
}

function cryptoRandom(length) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

function pruneExpiredSessions() {
  const t = now();
  for (const [id, item] of askSessions) {
    if (item.expiresAt <= t) askSessions.delete(id);
  }
  for (const [id, item] of quizSessions) {
    if (item.expiresAt <= t) quizSessions.delete(id);
  }
}

setInterval(pruneExpiredSessions, 5 * 60 * 1000).unref();

function cleanText(value, maxChars) {
  const text = String(value || "")
    .replace(/[*_`>#~-]/g, "")
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/\s*\n+\s*/g, " ")
    .trim();
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(0, maxChars - 1)).trimEnd() + ".";
}

function splitIntoPages(text) {
  const cleaned = cleanText(text, 4000);
  const sentences = cleaned.match(/[^.!?]+[.!?]?/g) || [cleaned];
  const pages = [];
  let page = "";

  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if (sentence.length > LIMITS.answerPage) {
      if (page) {
        pages.push(page);
        page = "";
      }
      for (let i = 0; i < sentence.length; i += LIMITS.answerPage) {
        pages.push(cleanText(sentence.slice(i, i + LIMITS.answerPage), LIMITS.answerPage));
      }
      continue;
    }
    const next = page ? `${page} ${sentence}` : sentence;
    if (next.length > LIMITS.answerPage && page) {
      pages.push(page);
      page = sentence;
    } else {
      page = next;
    }
  }
  if (page) pages.push(page);
  return pages.slice(0, 12).map((item) => cleanText(item, LIMITS.answerPage));
}

function parseJsonFromText(text) {
  const trimmed = String(text || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    const match = trimmed.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) throw new Error("Gemini did not return JSON");
    return JSON.parse(match[0]);
  }
}

function requireGemini(res) {
  if (GEMINI_API_KEY) return true;
  res.status(503).json({ error: "gemini_not_configured", need: "GEMINI_API_KEY" });
  return false;
}

async function callGemini(systemText, userText, responseMimeType) {
  const url = `${GEMINI_BASE_URL}/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemText }] },
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig: {
        temperature: 0.4,
        responseMimeType,
      },
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body && body.error && body.error.message;
    throw new Error(message || `Gemini request failed with ${response.status}`);
  }

  const text =
    body &&
    body.candidates &&
    body.candidates[0] &&
    body.candidates[0].content &&
    body.candidates[0].content.parts &&
    body.candidates[0].content.parts.map((part) => part.text || "").join("").trim();

  if (!text) throw new Error("Gemini returned an empty response");
  return text;
}

function answerPayload(answerId, pages, pageIndex) {
  return {
    answerId,
    totalPages: pages.length,
    page: pageIndex + 1,
    text: pages[pageIndex],
    hasMore: pageIndex + 1 < pages.length,
  };
}

function normalizeQuestion(item, index) {
  const options = Array.isArray(item.options) ? item.options : item.choices;
  const safeOptions = Array.from({ length: 4 }, (_, i) =>
    cleanText(options && options[i] ? options[i] : `Option ${i + 1}`, LIMITS.option)
  );
  let correctIndex = Number(item.correctIndex);
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) correctIndex = 0;
  return {
    index,
    text: cleanText(item.text || item.q, LIMITS.question),
    options: safeOptions,
    correctIndex,
    explanation: cleanText(item.explanation, LIMITS.explanation),
  };
}

function questionPayload(quizId, session, index) {
  return {
    quizId,
    index,
    totalQuestions: session.questions.length,
    question: session.questions[index],
  };
}

app.post("/api/ask", async (req, res) => {
  if (!requireGemini(res)) return;
  const question = cleanText(req.body && req.body.question, LIMITS.askQuestion);
  const deviceId = cleanText(req.body && req.body.deviceId, 40);
  if (!question || !deviceId) {
    res.status(400);
    return res.json({ error: "bad_body", need: ["question", "deviceId"] });
  }

  try {
    const systemText = [
      "You are a study assistant for a device with a tiny screen.",
      "Plain text only. No markdown. No bullet symbols.",
      "Write short sentences. Max 15 words per sentence.",
      "Answer clearly for a student.",
    ].join(" ");
    const fullAnswer = await callGemini(systemText, question, "text/plain");
    const pages = splitIntoPages(fullAnswer);
    const answerId = makeId("ans");
    askSessions.set(answerId, { deviceId, pages, expiresAt: now() + ASK_TTL_MS });
    res.json(answerPayload(answerId, pages, 0));
  } catch (e) {
    res.status(502).json({ error: "gemini_failed", message: cleanText(e.message, 160) });
  }
});

app.get("/api/ask/:answerId/page/:pageNum", (req, res) => {
  const session = askSessions.get(req.params.answerId);
  const pageNum = parseInt(req.params.pageNum, 10);
  if (!session || session.expiresAt <= now()) {
    askSessions.delete(req.params.answerId);
    res.status(404);
    return res.json({ error: "not_found" });
  }
  if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > session.pages.length) {
    res.status(404);
    return res.json({ error: "not_found" });
  }
  res.json(answerPayload(req.params.answerId, session.pages, pageNum - 1));
});

app.post("/api/quiz/generate", async (req, res) => {
  if (!requireGemini(res)) return;
  const topic = cleanText(req.body && req.body.topic, LIMITS.quizTopic);
  const deviceId = cleanText(req.body && req.body.deviceId, 40);
  const requestedCount = Number(req.body && req.body.count);
  const count = Math.max(1, Math.min(LIMITS.maxQuizCount, Number.isInteger(requestedCount) ? requestedCount : 10));
  if (!topic || !deviceId) {
    res.status(400);
    return res.json({ error: "bad_body", need: ["topic", "deviceId"] });
  }

  try {
    const systemText = [
      `Generate exactly ${count} multiple choice questions about the requested topic.`,
      "Plain text only in all fields.",
      "Question text max 100 characters.",
      "Each option max 35 characters.",
      "Explanation max 100 characters, one sentence only.",
      "Return JSON with this shape: {\"questions\":[{\"text\":\"\",\"options\":[\"\",\"\",\"\",\"\"],\"correctIndex\":0,\"explanation\":\"\"}]}",
    ].join(" ");
    const text = await callGemini(systemText, `Generate ${count} quiz questions about ${topic}.`, "application/json");
    const parsed = parseJsonFromText(text);
    const rawQuestions = Array.isArray(parsed.questions) ? parsed.questions : [];
    const questions = rawQuestions.slice(0, count).map(normalizeQuestion);
    if (!questions.length) throw new Error("Gemini returned no questions");

    const quizId = makeId("qz");
    const session = { deviceId, topic, questions, expiresAt: now() + QUIZ_TTL_MS };
    quizSessions.set(quizId, session);
    res.json({
      quizId,
      topic,
      totalQuestions: questions.length,
      question: questions[0],
    });
  } catch (e) {
    res.status(502).json({ error: "gemini_failed", message: cleanText(e.message, 160) });
  }
});

app.get("/api/quiz/:quizId/question/:index", (req, res) => {
  const session = quizSessions.get(req.params.quizId);
  const index = parseInt(req.params.index, 10);
  if (!session || session.expiresAt <= now()) {
    quizSessions.delete(req.params.quizId);
    res.status(404);
    return res.json({ error: "not_found" });
  }
  if (!Number.isInteger(index) || index < 0 || index >= session.questions.length) {
    res.status(404);
    return res.json({ error: "not_found" });
  }
  res.json(questionPayload(req.params.quizId, session, index));
});

app.post("/api/quiz/:quizId/submit", (req, res) => {
  const session = quizSessions.get(req.params.quizId);
  const score = Number(req.body && req.body.score);
  const totalQuestions = Number(req.body && req.body.totalQuestions);
  if (!session || session.expiresAt <= now()) {
    quizSessions.delete(req.params.quizId);
    res.status(404);
    return res.json({ error: "not_found" });
  }
  if (!Number.isInteger(score) || !Number.isInteger(totalQuestions) || totalQuestions <= 0) {
    res.status(400);
    return res.json({ error: "bad_body", need: ["score", "totalQuestions"] });
  }
  const percent = Math.max(0, Math.min(100, Math.round((score / totalQuestions) * 100)));
  const grade = percent >= 90 ? "A" : percent >= 80 ? "B" : percent >= 70 ? "C" : percent >= 60 ? "D" : "F";
  res.json({ ok: true, percent, grade });
});

/** List topics (compact for tiny buffers on MCU). */
app.get("/api/topics", (req, res) => {
  const topics = Object.keys(quizzes).map((id) => ({
    id,
    title: quizzes[id].title,
    n: quizzes[id].questions.length,
  }));
  res.type("application/json");
  res.json({ topics });
});

/**
 * Full quiz for a topic: questions include index i, text q, choices[].
 * Does not include the correct index (verify via POST /api/verify).
 */
app.get("/api/quizzes/:topicId", (req, res) => {
  const quiz = quizzes[req.params.topicId];
  if (!quiz) {
    res.status(404);
    return res.json({ error: "unknown_topic" });
  }
  const questions = quiz.questions.map((item, i) => ({
    i,
    q: item.q,
    c: item.choices,
  }));
  res.type("application/json");
  res.json({
    id: req.params.topicId,
    title: quiz.title,
    questions,
  });
});

/**
 * One question only — smallest payload for ESP32 (optional).
 * GET /api/question/science/0
 */
app.get("/api/question/:topicId/:index", (req, res) => {
  const quiz = quizzes[req.params.topicId];
  const qi = parseInt(req.params.index, 10);
  if (!quiz || Number.isNaN(qi) || qi < 0 || qi >= quiz.questions.length) {
    res.status(404);
    return res.json({ error: "not_found" });
  }
  const item = quiz.questions[qi];
  res.type("application/json");
  res.json({
    topic: req.params.topicId,
    i: qi,
    q: item.q,
    c: item.choices,
    k: item.choices.length,
  });
});

/**
 * Verify an answer.
 * Body: { "topicId": "science", "i": 0, "choice": 1 }
 * Response: { "ok": true, "correct": true, "answer": 1 }
 * answer = correct choice index (for feedback on device).
 */
app.post("/api/verify", (req, res) => {
  const topicId = req.body && req.body.topicId;
  const qi = req.body && req.body.i;
  const choice = req.body && req.body.choice;

  if (typeof topicId !== "string" || typeof qi !== "number" || typeof choice !== "number") {
    res.status(400);
    return res.json({ error: "bad_body", need: ["topicId", "i", "choice"] });
  }
  if (!Number.isInteger(qi) || qi < 0 || !Number.isInteger(choice)) {
    res.status(400);
    return res.json({ error: "bad_body" });
  }

  const quiz = quizzes[topicId];
  if (!quiz || qi >= quiz.questions.length) {
    res.status(404);
    return res.json({ error: "not_found" });
  }
  const item = quiz.questions[qi];
  if (choice < 0 || choice >= item.choices.length) {
    res.status(400);
    return res.json({ error: "bad_choice" });
  }

  const answer = item.correct;
  const correct = choice === answer;
  res.type("application/json");
  res.json({
    ok: true,
    correct,
    answer,
  });
});

app.post("/api/reload", (req, res) => {
  try {
    quizzes = loadQuizzes();
    res.json({ ok: true });
  } catch (e) {
    res.status(500);
    res.json({ error: "reload_failed" });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: "not_found" });
});

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`StudySmart quiz API http://0.0.0.0:${PORT}`);
  console.log(`Data: ${DATA_PATH}`);
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Another API instance is already running.`);
    console.error(`Use that running process, stop it first, or run with a different port: PORT=3334 npm start`);
    process.exit(1);
    return;
  }
  throw err;
});
