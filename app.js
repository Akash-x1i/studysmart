(function () {
  const app = document.getElementById("app");
  const topics = window.QUIZ_TOPICS;

  if (!topics || !app) return;

  let state = {
    screen: "home",
    topicId: null,
    index: 0,
    score: 0,
    answered: false,
    selected: null,
    /** @type {{ q: string; choices: string[]; picked: number; correct: number }[]} */
    review: [],
  };

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function renderHome() {
    const keys = Object.keys(topics);
    app.innerHTML = `
      <div class="panel" role="region" aria-label="Choose a quiz topic">
        <h1>Choose a quiz</h1>
        <p class="lead">Each quiz has a few multiple-choice questions. You get one try per question.</p>
        <div class="topic-list">
          ${keys
            .map(
              (id) => `
            <button type="button" class="btn btn-topic" data-topic="${esc(id)}">
              <span>${esc(topics[id].title)}</span>
              <span class="meta">${topics[id].questions.length} Q</span>
            </button>
          `
            )
            .join("")}
        </div>
      </div>
    `;
    app.querySelectorAll(".btn-topic").forEach((btn) => {
      btn.addEventListener("click", () => startQuiz(btn.getAttribute("data-topic")));
    });
  }

  function startQuiz(topicId) {
    if (!topics[topicId]) return;
    state = {
      screen: "quiz",
      topicId,
      index: 0,
      score: 0,
      answered: false,
      selected: null,
      review: [],
    };
    renderQuestion();
  }

  function currentQuestion() {
    const t = topics[state.topicId];
    return t.questions[state.index];
  }

  function renderQuestion() {
    const t = topics[state.topicId];
    const q = currentQuestion();
    const total = t.questions.length;
    const pct = ((state.index + (state.answered ? 1 : 0)) / total) * 100;

    const keys = ["1", "2", "3", "4"];
    app.innerHTML = `
      <div class="panel" role="region" aria-live="polite" aria-label="Quiz question">
        <div class="quiz-top">
          <span class="quiz-topic-label">${esc(t.title)}</span>
          <div class="progress-wrap">
            <div class="progress-bar" role="progressbar" aria-valuenow="${state.index + 1}" aria-valuemin="1" aria-valuemax="${total}">
              <div class="progress-fill"></div>
            </div>
            <div class="progress-text">Question ${state.index + 1} of ${total}</div>
          </div>
        </div>
        <h2 class="question-text">${esc(q.q)}</h2>
        <div class="choices" role="group" aria-label="Answer choices">
          ${q.choices
            .map(
              (c, i) => `
            <button type="button" class="choice" data-index="${i}">
              <span class="choice-key">${keys[i]}</span>
              <span>${esc(c)}</span>
            </button>
          `
            )
            .join("")}
        </div>
        <div id="feedback-slot"></div>
        <div class="actions-row" id="actions-slot"></div>
      </div>
    `;

    const fill = app.querySelector(".progress-fill");
    if (fill) fill.style.width = `${pct}%`;

    const choiceBtns = app.querySelectorAll(".choice");
    choiceBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        if (state.answered) return;
        const i = parseInt(btn.getAttribute("data-index"), 10);
        submitAnswer(i);
      });
    });
  }

  function submitAnswer(index) {
    const q = currentQuestion();
    state.answered = true;
    state.selected = index;
    const ok = index === q.correct;
    if (ok) state.score += 1;
    state.review.push({
      q: q.q,
      choices: q.choices,
      picked: index,
      correct: q.correct,
    });
    applyAnswerStyles();
    showFeedbackAndNext();
  }

  function applyAnswerStyles() {
    const q = currentQuestion();
    const choiceBtns = app.querySelectorAll(".choice");
    choiceBtns.forEach((btn, i) => {
      btn.disabled = true;
      if (i === q.correct) btn.classList.add("correct");
      else if (i === state.selected && i !== q.correct) btn.classList.add("wrong");
      else btn.classList.add("dim");
    });
  }

  function showFeedbackAndNext() {
    const t = topics[state.topicId];
    const fill = app.querySelector(".progress-fill");
    if (fill) fill.style.width = `${((state.index + 1) / t.questions.length) * 100}%`;

    const q = currentQuestion();
    const ok = state.selected === q.correct;
    const slot = document.getElementById("feedback-slot");
    const actions = document.getElementById("actions-slot");
    if (slot) {
      slot.innerHTML = `
        <div class="feedback ${ok ? "correct" : "wrong"}" role="status">
          ${ok ? "Correct — nice work." : `Not quite. The right answer: "${esc(q.choices[q.correct])}".`}
        </div>
      `;
    }
    const isLast = state.index >= t.questions.length - 1;
    if (actions) {
      actions.innerHTML = isLast
        ? `<button type="button" class="btn btn-primary" id="btn-see-results">See results</button>`
        : `<button type="button" class="btn btn-primary" id="btn-next">Next question</button>`;
      const next = document.getElementById("btn-next");
      const results = document.getElementById("btn-see-results");
      if (next) next.addEventListener("click", goNext);
      if (results) results.addEventListener("click", renderResults);
    }
  }

  function goNext() {
    state.index += 1;
    state.answered = false;
    state.selected = null;
    renderQuestion();
  }

  function renderResults() {
    const t = topics[state.topicId];
    const total = t.questions.length;
    const pct = Math.round((state.score / total) * 100);
    app.innerHTML = `
      <div class="panel" role="region" aria-label="Quiz results">
        <h1>Results</h1>
        <p class="lead">${esc(t.title)}</p>
        <p class="result-score">${state.score} / ${total}</p>
        <p class="result-detail">${pct}% correct</p>
        <ul class="review-list" aria-label="Question review">
          ${state.review
            .map((r, i) => {
              const good = r.picked === r.correct;
              return `
              <li class="review-item ${good ? "ok" : "bad"}">
                <strong>Q${i + 1}.</strong> ${esc(r.q)}<br />
                <span style="color: var(--text-muted); font-size: 0.85rem;">
                  You: ${esc(r.choices[r.picked])} ·
                  Answer: ${esc(r.choices[r.correct])}
                </span>
              </li>
            `;
            })
            .join("")}
        </ul>
        <div class="actions-row" style="margin-top: 1.25rem;">
          <button type="button" class="btn btn-primary" id="btn-retry">Same topic again</button>
          <button type="button" class="btn btn-ghost" id="btn-home">All topics</button>
        </div>
      </div>
    `;
    document.getElementById("btn-retry")?.addEventListener("click", () => startQuiz(state.topicId));
    document.getElementById("btn-home")?.addEventListener("click", () => {
      state.screen = "home";
      renderHome();
    });
  }

  document.addEventListener("keydown", (e) => {
    if (state.screen !== "quiz" || !state.topicId) return;
    if (state.answered) {
      if (e.key === "Enter") {
        const next = document.getElementById("btn-next");
        const res = document.getElementById("btn-see-results");
        if (next) next.click();
        if (res) res.click();
      }
      return;
    }
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 4) {
      const q = currentQuestion();
      if (q && n - 1 < q.choices.length) submitAnswer(n - 1);
    }
  });

  renderHome();
})();
