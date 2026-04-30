// /quiz/ — interactive grammar role quiz over the 108 sentences.
// Three question types alternate randomly:
//   Q1 single-pick      "Which of these is the SUBJECT?"  (4 options)
//   Q2 role recognition "What role does this phrase play?" (8 options)
//   Q3 label-the-whole  "Tag every phrase in this sentence" (per-phrase 8 select)
// State (review pool, cumulative stats) persists in localStorage.
// Data is fetched from /assets/data/quiz-data.json (built by /tmp/build_quiz_data.py).

(function () {
  "use strict";

  const DATA_URL = "/assets/data/quiz-data.json";
  const STATS_KEY = "quiz-stats-v1";
  const POOL_KEY = "quiz-review-pool-v1";

  const ROLES = ["s", "v", "o", "c", "a", "m", "fn", "cl"];
  const ROLE_INFO = {
    s:  { label: "主语",     en: "Subject" },
    v:  { label: "谓语",     en: "Verb" },
    o:  { label: "宾语",     en: "Object" },
    c:  { label: "表/补",   en: "Complement" },
    a:  { label: "状语",     en: "Adverbial" },
    m:  { label: "定/同",   en: "Modifier" },
    fn: { label: "功能词", en: "Function word" },
    cl: { label: "从句引导", en: "Clause marker" },
  };

  const Q_TYPES = ["q1", "q2", "q3"];
  const Q_WEIGHTS = { q1: 0.35, q2: 0.35, q3: 0.30 };

  // ─── DOM helpers ──────────────────────────────────────────────────────
  const root = document.getElementById("quiz-app");
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === "class") n.className = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k.startsWith("on") && typeof attrs[k] === "function")
        n.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    for (const k of kids) {
      if (k == null) continue;
      n.appendChild(typeof k === "string" ? document.createTextNode(k) : k);
    }
    return n;
  };
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); };

  // ─── State ────────────────────────────────────────────────────────────
  let DATA = null;
  let stats = loadJSON(STATS_KEY, { total: 0, correct: 0, byType: { q1: [0, 0], q2: [0, 0], q3: [0, 0] } });
  let pool = loadJSON(POOL_KEY, []); // array of {sentenceId, phraseIndex, role, qtype, ts}

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) { return fallback; }
  }
  function saveJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {}
  }
  function pushReview(item) {
    pool.push({ ...item, ts: Date.now() });
    if (pool.length > 200) pool = pool.slice(-200);
    saveJSON(POOL_KEY, pool);
  }
  function recordAnswer(qtype, correct) {
    stats.total++;
    if (correct) stats.correct++;
    stats.byType[qtype][1]++;
    if (correct) stats.byType[qtype][0]++;
    saveJSON(STATS_KEY, stats);
  }

  // ─── Random utilities ─────────────────────────────────────────────────
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function pickQType() {
    const r = Math.random();
    let acc = 0;
    for (const t of Q_TYPES) {
      acc += Q_WEIGHTS[t];
      if (r < acc) return t;
    }
    return "q1";
  }

  // ─── Question generators ──────────────────────────────────────────────
  // Q1: pick a sentence with a given target role; show the sentence with
  // each phrase clickable; user picks the one that is the target role.
  function makeQ1() {
    // Pick a target role that's likely to have a clear answer
    const targetRole = pick(["s", "v", "o", "a"]);
    // Find sentences that have ≥1 phrase of this role AND ≥3 distractors
    const candidates = DATA.sentences.filter(
      (s) =>
        s.phrases.some((p) => p.role === targetRole) &&
        s.phrases.length >= 4
    );
    if (!candidates.length) return makeQ2();
    const sentence = pick(candidates);
    // The "correct" phrase = a random one of the target role
    const correctPhrases = sentence.phrases.filter((p) => p.role === targetRole);
    const correctIdx = sentence.phrases.indexOf(pick(correctPhrases));
    return {
      type: "q1",
      sentence,
      targetRole,
      correctIdx,
      prompt: `这一句里,哪一个是 ${ROLE_INFO[targetRole].label}(${ROLE_INFO[targetRole].en})?`,
    };
  }

  // Q2: pick a random phrase from a random sentence, ask its role (8 options)
  function makeQ2() {
    const sentence = pick(DATA.sentences);
    const phraseIdx = Math.floor(Math.random() * sentence.phrases.length);
    return {
      type: "q2",
      sentence,
      phraseIdx,
      correctRole: sentence.phrases[phraseIdx].role,
      prompt: "下方高亮的短语是什么成分?",
    };
  }

  // Q3: pick a sentence with 3-7 phrases, user must tag every phrase
  function makeQ3() {
    const candidates = DATA.sentences.filter(
      (s) => s.phrases.length >= 3 && s.phrases.length <= 7
    );
    if (!candidates.length) return makeQ2();
    const sentence = pick(candidates);
    return {
      type: "q3",
      sentence,
      prompt: "为每一段选择正确的成分 · 全部贴完后点「提交」",
    };
  }

  function nextQuestion() {
    const t = pickQType();
    if (t === "q1") return makeQ1();
    if (t === "q2") return makeQ2();
    return makeQ3();
  }

  // ─── Renderers ────────────────────────────────────────────────────────
  function renderHeader() {
    const accuracy = stats.total ? Math.round((stats.correct / stats.total) * 100) : 0;
    return el("div", { class: "quiz-header" },
      el("span", { class: "quiz-stat" }, `已答 ${stats.total} 题`),
      el("span", { class: "quiz-stat" }, `正确 ${stats.correct}`),
      el("span", { class: "quiz-stat quiz-acc" }, `${accuracy}% 正确率`),
      el("span", { class: "quiz-stat" }, `复习池 ${pool.length}`),
      el("button", { class: "quiz-skip", onClick: () => render() }, "换一题 ↻"),
      el("button", { class: "quiz-reset", onClick: resetStats }, "清空统计")
    );
  }

  function resetStats() {
    if (!confirm("清空所有累计统计 + 错题复习池?(本地缓存)")) return;
    stats = { total: 0, correct: 0, byType: { q1: [0, 0], q2: [0, 0], q3: [0, 0] } };
    pool = [];
    saveJSON(STATS_KEY, stats);
    saveJSON(POOL_KEY, pool);
    render();
  }

  function buildSentenceView(sentence, opts = {}) {
    // Render sentence as inline phrases. opts:
    //   highlight: phrase index to highlight
    //   reveal: show role colors after answer
    //   onPhraseClick: callback(idx)
    const wrap = el("div", { class: "quiz-sentence" });
    wrap.appendChild(el("p", { class: "quiz-grammar" }, sentence.grammar));
    const line = el("p", { class: "quiz-line" });
    sentence.phrases.forEach((p, i) => {
      const cls =
        "quiz-phrase" +
        (opts.reveal ? " " + p.role + " quiz-revealed" : "") +
        (opts.highlight === i ? " quiz-highlight" : "") +
        (opts.onPhraseClick ? " quiz-clickable" : "");
      const span = el("span", { class: cls, "data-idx": i }, p.text);
      if (opts.onPhraseClick) span.addEventListener("click", () => opts.onPhraseClick(i));
      line.appendChild(span);
      if (i < sentence.phrases.length - 1) line.appendChild(document.createTextNode(" "));
    });
    wrap.appendChild(line);
    return wrap;
  }

  function feedback(correct, html) {
    return el("div", {
      class: "quiz-feedback " + (correct ? "ok" : "bad"),
      html,
    });
  }

  function nextBtn() {
    return el("button", { class: "quiz-next", onClick: () => render() }, "下一题 →");
  }

  // ─── Q1 renderer ──────────────────────────────────────────────────────
  function renderQ1(q) {
    const view = el("div", { class: "quiz-q quiz-q1" });
    view.appendChild(el("h3", { class: "quiz-prompt" }, q.prompt));
    const sentenceView = buildSentenceView(q.sentence, {
      onPhraseClick: handlePick,
    });
    view.appendChild(sentenceView);
    const helper = el("p", { class: "quiz-helper" }, "↑ 点击句子里你认为是「" + ROLE_INFO[q.targetRole].label + "」的那段。");
    view.appendChild(helper);

    function handlePick(idx) {
      const correct = q.sentence.phrases[idx].role === q.targetRole;
      recordAnswer("q1", correct);
      if (!correct) pushReview({
        sentenceId: q.sentence.id,
        phraseIndex: idx,
        role: q.targetRole,
        qtype: "q1",
      });

      // Replace with revealed view + feedback
      clear(view);
      view.appendChild(el("h3", { class: "quiz-prompt" }, q.prompt));
      view.appendChild(buildSentenceView(q.sentence, { reveal: true, highlight: idx }));
      const correctText = q.sentence.phrases[q.correctIdx].text;
      view.appendChild(feedback(correct,
        correct
          ? `✓ 答对!「<b>${escapeHTML(correctText)}</b>」 就是 ${ROLE_INFO[q.targetRole].label}。`
          : `✗ 答错。你选的是「<b>${escapeHTML(q.sentence.phrases[idx].text)}</b>」(${ROLE_INFO[q.sentence.phrases[idx].role].label}),正确答案是「<b>${escapeHTML(correctText)}</b>」(${ROLE_INFO[q.targetRole].label})。`
      ));
      view.appendChild(linkToBreakdown(q.sentence));
      view.appendChild(nextBtn());
    }
    return view;
  }

  // ─── Q2 renderer ──────────────────────────────────────────────────────
  function renderQ2(q) {
    const view = el("div", { class: "quiz-q quiz-q2" });
    view.appendChild(el("h3", { class: "quiz-prompt" }, q.prompt));
    view.appendChild(buildSentenceView(q.sentence, { highlight: q.phraseIdx }));
    const phrase = q.sentence.phrases[q.phraseIdx];
    const optionsRow = el("div", { class: "quiz-options" });
    ROLES.forEach((r) => {
      const btn = el("button", {
        class: "quiz-opt " + r,
        "data-role": r,
        onClick: () => handlePick(r),
      }, ROLE_INFO[r].label + " · " + ROLE_INFO[r].en);
      optionsRow.appendChild(btn);
    });
    view.appendChild(optionsRow);

    function handlePick(role) {
      const correct = role === q.correctRole;
      recordAnswer("q2", correct);
      if (!correct) pushReview({
        sentenceId: q.sentence.id,
        phraseIndex: q.phraseIdx,
        role: q.correctRole,
        qtype: "q2",
      });
      // Mark every option as correct/wrong
      optionsRow.querySelectorAll(".quiz-opt").forEach((b) => {
        const r = b.getAttribute("data-role");
        if (r === q.correctRole) b.classList.add("quiz-opt-correct");
        else if (r === role) b.classList.add("quiz-opt-wrong");
        b.disabled = true;
      });
      view.appendChild(feedback(correct,
        correct
          ? `✓ 答对!「<b>${escapeHTML(phrase.text)}</b>」 是 ${ROLE_INFO[q.correctRole].label}。`
          : `✗ 答错。「<b>${escapeHTML(phrase.text)}</b>」 是 ${ROLE_INFO[q.correctRole].label}(${ROLE_INFO[q.correctRole].en}),不是 ${ROLE_INFO[role].label}。`
      ));
      view.appendChild(linkToBreakdown(q.sentence));
      view.appendChild(nextBtn());
    }
    return view;
  }

  // ─── Q3 renderer ──────────────────────────────────────────────────────
  function renderQ3(q) {
    const view = el("div", { class: "quiz-q quiz-q3" });
    view.appendChild(el("h3", { class: "quiz-prompt" }, q.prompt));

    const grammarLine = el("p", { class: "quiz-grammar" }, q.sentence.grammar);
    view.appendChild(grammarLine);

    const grid = el("div", { class: "quiz-q3-grid" });
    const userAnswers = q.sentence.phrases.map(() => null);

    q.sentence.phrases.forEach((p, i) => {
      const row = el("div", { class: "quiz-q3-row" });
      row.appendChild(el("span", { class: "quiz-q3-phrase" }, p.text));
      const select = el("select", {
        class: "quiz-q3-select",
        "data-idx": i,
      });
      select.appendChild(el("option", { value: "" }, "选择 ..."));
      ROLES.forEach((r) => {
        const opt = el("option", { value: r }, ROLE_INFO[r].label + " · " + ROLE_INFO[r].en);
        select.appendChild(opt);
      });
      select.addEventListener("change", (e) => {
        userAnswers[i] = e.target.value || null;
      });
      row.appendChild(select);
      grid.appendChild(row);
    });
    view.appendChild(grid);

    const submitBtn = el("button", { class: "quiz-submit", onClick: handleSubmit }, "提交评分");
    view.appendChild(submitBtn);

    function handleSubmit() {
      // require all filled
      if (userAnswers.some((a) => a === null)) {
        alert("请为每一段都选择一个成分。");
        return;
      }
      let correctCount = 0;
      const results = userAnswers.map((a, i) => {
        const truth = q.sentence.phrases[i].role;
        const ok = a === truth;
        if (ok) correctCount++;
        else pushReview({
          sentenceId: q.sentence.id,
          phraseIndex: i,
          role: truth,
          qtype: "q3",
        });
        return { user: a, truth, ok };
      });
      const allCorrect = correctCount === userAnswers.length;
      recordAnswer("q3", allCorrect);

      // Replace grid with revealed annotation + per-phrase mark
      clear(grid);
      grid.appendChild(buildSentenceView(q.sentence, { reveal: true }));
      const breakdown = el("div", { class: "quiz-q3-results" });
      q.sentence.phrases.forEach((p, i) => {
        const r = results[i];
        const row = el("div", {
          class: "quiz-q3-result-row " + (r.ok ? "ok" : "bad"),
        },
          el("span", { class: "quiz-q3-mark" }, r.ok ? "✓" : "✗"),
          el("span", { class: "quiz-q3-phrase " + p.role }, p.text),
          el("span", { class: "quiz-q3-truth" }, "正确:" + ROLE_INFO[r.truth].label),
          r.ok ? null : el("span", { class: "quiz-q3-user" }, "你选:" + ROLE_INFO[r.user].label)
        );
        breakdown.appendChild(row);
      });
      grid.appendChild(breakdown);

      submitBtn.remove();
      view.appendChild(feedback(allCorrect,
        `${correctCount} / ${userAnswers.length} 段贴对。${allCorrect ? "全对!" : "继续努力。"}`
      ));
      view.appendChild(linkToBreakdown(q.sentence));
      view.appendChild(nextBtn());
    }
    return view;
  }

  // ─── Common helpers ───────────────────────────────────────────────────
  function linkToBreakdown(sentence) {
    return el("p", { class: "quiz-link" },
      el("a", { href: "/breakdown/#" + sentence.id }, "→ 看 " + sentence.id.toUpperCase() + " 完整拆解"),
      " · ",
      el("a", { href: "/#" + sentence.id }, "回原文"),
      " · ",
      el("a", { href: "/cohesion/" }, "看衔接")
    );
  }

  function escapeHTML(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // ─── Top render ───────────────────────────────────────────────────────
  function render() {
    if (!DATA) return;
    clear(root);
    root.appendChild(renderHeader());

    const q = nextQuestion();
    if (q.type === "q1") root.appendChild(renderQ1(q));
    else if (q.type === "q2") root.appendChild(renderQ2(q));
    else root.appendChild(renderQ3(q));

    // Footer with type stats
    const f = el("div", { class: "quiz-footer" });
    Q_TYPES.forEach((t) => {
      const [c, total] = stats.byType[t];
      const pct = total ? Math.round((c / total) * 100) : 0;
      f.appendChild(el("span", { class: "quiz-typestat" },
        t.toUpperCase() + " · " + c + "/" + total + " · " + pct + "%"));
    });
    root.appendChild(f);
  }

  // ─── Init ─────────────────────────────────────────────────────────────
  fetch(DATA_URL, { cache: "no-cache" })
    .then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then((d) => {
      DATA = d;
      render();
    })
    .catch((err) => {
      clear(root);
      root.appendChild(el("p", { class: "quiz-error" },
        "题库载入失败:" + err.message + "。请刷新页面 / 检查网络。"
      ));
    });
})();
