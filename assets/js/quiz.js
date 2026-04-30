// /quiz/ — interactive grammar test over the full project (108 sentences,
// 688 vocab, 25 cohesion cases, 161 terms, 15 hand-crafted error pairs).
//
// 9 question types — covers every teaching dimension except listening:
//   Q1  · 句法 / 主谓宾单选         · click which phrase is the [target role]
//   Q2  · 句法 / 8 选 1 角色识别     · highlighted phrase → which role?
//   Q3  · 句法 / 完整句贴标签       · tag every phrase in the sentence
//   Q4  · 语法点识别                · which grammar does THIS sentence demonstrate?
//   Q5  · 时态精细识别              · this verb is in which tense?
//   Q7  · 衔接判断                  · which cohesion type does this case use?
//   Q8  · 翻译选择                  · English → 4 Chinese options (or reverse)
//   Q9  · 术语反查                  · definition shown → pick the term
//   Q10 · 词汇                      · English word → pick its Chinese gloss
//   Q11 · 改错                      · two sentences, pick the correct one
//
// State (cumulative stats + review pool) persists in localStorage.
// Filter UI lets user choose which question types to include.

(function () {
  "use strict";

  const DATA_URL = "/assets/data/quiz-data.json";
  const STATS_KEY = "quiz-stats-v2";
  const POOL_KEY = "quiz-review-pool-v2";
  const FILTER_KEY = "quiz-filter-v2";

  const ROLES = ["s", "v", "o", "c", "a", "m", "fn", "cl"];
  const ROLE_INFO = {
    s:  { label: "主语", en: "Subject" },
    v:  { label: "谓语", en: "Verb" },
    o:  { label: "宾语", en: "Object" },
    c:  { label: "表/补", en: "Complement" },
    a:  { label: "状语", en: "Adverbial" },
    m:  { label: "定/同", en: "Modifier" },
    fn: { label: "功能词", en: "Function word" },
    cl: { label: "从句引导", en: "Clause marker" },
  };

  const ALL_TYPES = ["q1", "q2", "q3", "q4", "q5", "q7", "q8", "q9", "q10", "q11"];
  const TYPE_LABELS = {
    q1:  "Q1 · 单选 · 哪个是主语?",
    q2:  "Q2 · 8 选 1 角色识别",
    q3:  "Q3 · 整句贴标签",
    q4:  "Q4 · 语法点识别",
    q5:  "Q5 · 时态精细",
    q7:  "Q7 · 衔接类型",
    q8:  "Q8 · 中英互译",
    q9:  "Q9 · 术语反查",
    q10: "Q10 · 词汇",
    q11: "Q11 · 改错",
  };

  // ─── DOM helpers ──────────────────────────────────────────────────────
  const root = document.getElementById("quiz-app");
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
  let stats = loadJSON(STATS_KEY, defaultStats());
  let pool = loadJSON(POOL_KEY, []);
  let filter = loadJSON(FILTER_KEY, defaultFilter());

  function defaultStats() {
    const byType = {};
    ALL_TYPES.forEach((t) => (byType[t] = [0, 0]));
    return { total: 0, correct: 0, byType };
  }
  function defaultFilter() {
    const enabled = {};
    ALL_TYPES.forEach((t) => (enabled[t] = true));
    return { enabled, reviewMode: false };
  }

  function loadJSON(key, fb) {
    try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fb; }
    catch (_) { return fb; }
  }
  function saveJSON(key, v) {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch (_) {}
  }

  function pushReview(item) {
    pool.push({ ...item, ts: Date.now() });
    if (pool.length > 200) pool = pool.slice(-200);
    saveJSON(POOL_KEY, pool);
  }
  function recordAnswer(qtype, correct) {
    stats.total++;
    if (correct) stats.correct++;
    if (!stats.byType[qtype]) stats.byType[qtype] = [0, 0];
    stats.byType[qtype][1]++;
    if (correct) stats.byType[qtype][0]++;
    saveJSON(STATS_KEY, stats);
  }

  // ─── Random utilities ─────────────────────────────────────────────────
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function sampleDistinct(pool, n, exclude) {
    const filtered = pool.filter((p) => !exclude || p !== exclude);
    return shuffle(filtered).slice(0, n);
  }
  function pickEnabledQType() {
    const enabled = ALL_TYPES.filter((t) => filter.enabled[t]);
    if (!enabled.length) return "q2"; // fallback
    return pick(enabled);
  }

  // ─── Question generators ──────────────────────────────────────────────
  function makeQ1() {
    const target = pick(["s", "v", "o", "a"]);
    const candidates = DATA.sentences.filter(
      (s) => s.phrases.some((p) => p.role === target) && s.phrases.length >= 4
    );
    if (!candidates.length) return makeQ2();
    const sentence = pick(candidates);
    const correctPhrases = sentence.phrases.filter((p) => p.role === target);
    const correctIdx = sentence.phrases.indexOf(pick(correctPhrases));
    return { type: "q1", sentence, targetRole: target, correctIdx,
      prompt: `这一句里,哪一个是 ${ROLE_INFO[target].label}(${ROLE_INFO[target].en})?` };
  }

  function makeQ2() {
    const sentence = pick(DATA.sentences);
    const phraseIdx = Math.floor(Math.random() * sentence.phrases.length);
    return { type: "q2", sentence, phraseIdx,
      correctRole: sentence.phrases[phraseIdx].role,
      prompt: "下方高亮的短语是什么成分?" };
  }

  function makeQ3() {
    const candidates = DATA.sentences.filter(
      (s) => s.phrases.length >= 3 && s.phrases.length <= 7
    );
    if (!candidates.length) return makeQ2();
    return { type: "q3", sentence: pick(candidates),
      prompt: "为每一段选择正确的成分 · 全部贴完后点「提交」" };
  }

  // Q4 · grammar point identification
  function makeQ4() {
    const sentence = pick(DATA.sentences);
    const correct = sentence.grammar_name;
    // 3 distractors from other sentences
    const distractors = sampleDistinct(
      DATA.grammars.filter((g) => g !== correct), 3
    );
    const options = shuffle([correct, ...distractors]);
    return {
      type: "q4", sentence, correct,
      options,
      prompt: "这一句使用的核心语法是?",
    };
  }

  // Q5 · tense fine-grained recognition
  // Pick a verb phrase whose data-tag has tense info (data-tag of v role)
  function makeQ5() {
    // look for sentences whose verb tag is a recognizable tense phrase
    const tenseKeywords = ["时", "态", "现在", "过去", "完成", "进行", "被动", "虚拟"];
    const candidates = [];
    DATA.sentences.forEach((s) => {
      s.phrases.forEach((p, i) => {
        if (p.role === "v" && p.tag && tenseKeywords.some((k) => p.tag.includes(k)) && p.tag !== "谓") {
          candidates.push({ sentence: s, phraseIdx: i, tag: p.tag });
        }
      });
    });
    if (!candidates.length) return makeQ4();
    const c = pick(candidates);
    // distractors: other v-tags in the dataset
    const allTags = new Set();
    DATA.sentences.forEach((s) => {
      s.phrases.forEach((p) => {
        if (p.role === "v" && p.tag && p.tag !== "谓" && tenseKeywords.some((k) => p.tag.includes(k))) {
          allTags.add(p.tag);
        }
      });
    });
    const distractors = sampleDistinct(
      [...allTags].filter((t) => t !== c.tag), 3
    );
    const options = shuffle([c.tag, ...distractors]);
    return {
      type: "q5",
      sentence: c.sentence,
      phraseIdx: c.phraseIdx,
      correct: c.tag,
      options,
      prompt: "下方高亮的动词,处于什么时态 / 语态?",
    };
  }

  // Q7 · cohesion type
  function makeQ7() {
    if (!DATA.cohesion || !DATA.cohesion.length) return makeQ4();
    const c = pick(DATA.cohesion);
    const types = Object.keys(DATA.cohesion_types);
    const options = types.map((t) => ({
      key: t,
      label: DATA.cohesion_types[t].label_zh + " · " + DATA.cohesion_types[t].label_en,
    }));
    return {
      type: "q7",
      cohesion: c,
      correct: c.type,
      options: shuffle(options),
      prompt: "这一句的衔接现象属于五大类中的哪一类?",
    };
  }

  // Q8 · translation choice (English -> 4 Chinese, or Chinese -> 4 English)
  function makeQ8() {
    const sentence = pick(DATA.sentences);
    if (!sentence.zh_flow) return makeQ4();
    const direction = Math.random() < 0.5 ? "en2zh" : "zh2en";
    if (direction === "en2zh") {
      // English phrase → pick its Chinese translation
      const correct = sentence.zh_flow;
      const distractorPool = DATA.sentences
        .filter((s) => s.id !== sentence.id && s.zh_flow)
        .map((s) => s.zh_flow);
      const distractors = sampleDistinct(distractorPool, 3);
      const options = shuffle([correct, ...distractors]);
      const enText = sentence.phrases.map((p) => p.text).join(" ");
      return {
        type: "q8",
        direction,
        sentence,
        prompt: "这句英文的中文版本是哪一个?",
        questionText: enText,
        options,
        correct,
      };
    } else {
      const correct = sentence.phrases.map((p) => p.text).join(" ");
      const distractorPool = DATA.sentences
        .filter((s) => s.id !== sentence.id)
        .map((s) => s.phrases.map((p) => p.text).join(" "));
      const distractors = sampleDistinct(distractorPool, 3);
      const options = shuffle([correct, ...distractors]);
      return {
        type: "q8",
        direction,
        sentence,
        prompt: "这句中文的英文原版是哪一个?",
        questionText: sentence.zh_flow,
        options,
        correct,
      };
    }
  }

  // Q9 · term lookup — definition shown, pick term name
  function makeQ9() {
    if (!DATA.terms || !DATA.terms.length) return makeQ4();
    const correct = pick(DATA.terms.filter((t) => t.definition.length >= 20));
    const distractors = sampleDistinct(
      DATA.terms.filter((t) => t.id !== correct.id).map((t) => t.name), 3
    );
    const options = shuffle([correct.name, ...distractors]);
    return {
      type: "q9",
      term: correct,
      options,
      correct: correct.name,
      prompt: "下方定义对应的术语是?",
    };
  }

  // Q10 · vocabulary
  function makeQ10() {
    if (!DATA.vocab || !DATA.vocab.length) return makeQ4();
    // prefer common words (high count)
    const sorted = DATA.vocab
      .filter((w) => w.zh && w.zh.length >= 1 && w.zh.length <= 20)
      .filter((w) => !["(冠)", "&nbsp;"].includes(w.zh.trim()));
    const correct = pick(sorted);
    const distractors = sampleDistinct(
      sorted.filter((w) => w.zh !== correct.zh).map((w) => w.zh), 3
    );
    const options = shuffle([correct.zh, ...distractors]);
    return {
      type: "q10",
      word: correct,
      options,
      correct: correct.zh,
      prompt: `这个英文词的中文释义是?`,
    };
  }

  // Q11 · error correction
  function makeQ11() {
    if (!DATA.errors || !DATA.errors.length) return makeQ4();
    const e = pick(DATA.errors);
    const order = Math.random() < 0.5 ? ["wrong", "correct"] : ["correct", "wrong"];
    const options = order.map((k) => ({ key: k, text: e[k] }));
    return {
      type: "q11",
      error: e,
      options,
      correct: "correct",
      prompt: "以下两句,哪一个语法正确?",
    };
  }

  function nextQuestion() {
    const t = pickEnabledQType();
    const fns = {
      q1: makeQ1, q2: makeQ2, q3: makeQ3, q4: makeQ4,
      q5: makeQ5, q7: makeQ7, q8: makeQ8, q9: makeQ9,
      q10: makeQ10, q11: makeQ11,
    };
    return (fns[t] || makeQ2)();
  }

  // ─── Renderers · header / footer / common ─────────────────────────────
  function renderHeader() {
    const accuracy = stats.total ? Math.round((stats.correct / stats.total) * 100) : 0;
    return el("div", { class: "quiz-header" },
      el("span", { class: "quiz-stat" }, `已答 ${stats.total} 题`),
      el("span", { class: "quiz-stat" }, `正确 ${stats.correct}`),
      el("span", { class: "quiz-stat quiz-acc" }, `${accuracy}% 正确率`),
      el("span", { class: "quiz-stat" }, `复习池 ${pool.length}`),
      el("button", { class: "quiz-skip", onClick: () => render() }, "换一题 ↻"),
      el("button", { class: "quiz-filter-btn", onClick: openFilter }, "题型筛选 ⚙"),
      el("button", { class: "quiz-reset", onClick: resetStats }, "清空")
    );
  }

  function openFilter() {
    const overlay = el("div", { class: "quiz-overlay" });
    const panel = el("div", { class: "quiz-filter-panel" });
    panel.appendChild(el("h3", null, "题型筛选 · 选择想测试的题型"));
    panel.appendChild(el("p", { class: "quiz-helper" }, "至少保留 1 项,否则 fallback 到 Q2。"));
    const grid = el("div", { class: "quiz-filter-grid" });
    ALL_TYPES.forEach((t) => {
      const checked = filter.enabled[t];
      const lbl = el("label", { class: "quiz-filter-row" },
        el("input", { type: "checkbox", "data-type": t, ...(checked ? { checked: "checked" } : {}) }),
        el("span", null, TYPE_LABELS[t])
      );
      grid.appendChild(lbl);
    });
    panel.appendChild(grid);

    panel.appendChild(el("hr"));
    const reviewLbl = el("label", { class: "quiz-filter-row quiz-review-toggle" },
      el("input", { type: "checkbox", id: "quiz-review-cb", ...(filter.reviewMode ? { checked: "checked" } : {}) }),
      el("span", null, `🎯 仅复习错题模式(当前池 ${pool.length} 题)`)
    );
    panel.appendChild(reviewLbl);

    const btns = el("div", { class: "quiz-filter-actions" },
      el("button", { class: "quiz-filter-save", onClick: () => {
          ALL_TYPES.forEach((t) => {
            const cb = panel.querySelector(`input[data-type="${t}"]`);
            filter.enabled[t] = !!(cb && cb.checked);
          });
          const rcb = panel.querySelector("#quiz-review-cb");
          filter.reviewMode = !!(rcb && rcb.checked);
          saveJSON(FILTER_KEY, filter);
          document.body.removeChild(overlay);
          render();
        }
      }, "保存并继续"),
      el("button", { class: "quiz-filter-cancel", onClick: () => document.body.removeChild(overlay) }, "取消")
    );
    panel.appendChild(btns);
    overlay.appendChild(panel);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) document.body.removeChild(overlay);
    });
    document.body.appendChild(overlay);
  }

  function resetStats() {
    if (!confirm("清空所有累计统计 + 错题复习池?(本地缓存)")) return;
    stats = defaultStats();
    pool = [];
    saveJSON(STATS_KEY, stats);
    saveJSON(POOL_KEY, pool);
    render();
  }

  function buildSentenceView(sentence, opts = {}) {
    const wrap = el("div", { class: "quiz-sentence" });
    if (opts.showGrammar !== false) {
      wrap.appendChild(el("p", { class: "quiz-grammar" }, sentence.grammar));
    }
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
    return el("div", { class: "quiz-feedback " + (correct ? "ok" : "bad"), html });
  }
  const nextBtn = () => el("button", { class: "quiz-next", onClick: () => render() }, "下一题 →");

  function linkRow(s, extra) {
    const links = [];
    if (s) {
      links.push(el("a", { href: "/breakdown/#" + s.id }, "→ " + s.id.toUpperCase() + " 完整拆解"));
      links.push(document.createTextNode(" · "));
      links.push(el("a", { href: "/#" + s.id }, "回原文"));
    }
    if (extra && extra.length) {
      extra.forEach((x, i) => {
        if (i > 0 || s) links.push(document.createTextNode(" · "));
        links.push(x);
      });
    }
    return el("p", { class: "quiz-link" }, ...links);
  }

  function escapeHTML(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // ─── Per-question renderers ───────────────────────────────────────────
  function renderQ1(q) {
    const view = el("div", { class: "quiz-q quiz-q1" });
    view.appendChild(el("h3", { class: "quiz-prompt" }, q.prompt));
    view.appendChild(buildSentenceView(q.sentence, { onPhraseClick: handlePick }));
    view.appendChild(el("p", { class: "quiz-helper" },
      "↑ 点击你认为是「" + ROLE_INFO[q.targetRole].label + "」的那段。"));

    function handlePick(idx) {
      const correct = q.sentence.phrases[idx].role === q.targetRole;
      recordAnswer("q1", correct);
      if (!correct) pushReview({ qtype: "q1", sentenceId: q.sentence.id, phraseIndex: idx, role: q.targetRole });
      clear(view);
      view.appendChild(el("h3", { class: "quiz-prompt" }, q.prompt));
      view.appendChild(buildSentenceView(q.sentence, { reveal: true, highlight: idx }));
      const correctText = q.sentence.phrases[q.correctIdx].text;
      view.appendChild(feedback(correct,
        correct
          ? `✓ 答对!「<b>${escapeHTML(correctText)}</b>」 是 ${ROLE_INFO[q.targetRole].label}。`
          : `✗ 答错。你选「<b>${escapeHTML(q.sentence.phrases[idx].text)}</b>」(${ROLE_INFO[q.sentence.phrases[idx].role].label}),正确是「<b>${escapeHTML(correctText)}</b>」(${ROLE_INFO[q.targetRole].label})。`
      ));
      view.appendChild(linkRow(q.sentence));
      view.appendChild(nextBtn());
    }
    return view;
  }

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
      if (!correct) pushReview({ qtype: "q2", sentenceId: q.sentence.id, phraseIndex: q.phraseIdx, role: q.correctRole });
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
      view.appendChild(linkRow(q.sentence));
      view.appendChild(nextBtn());
    }
    return view;
  }

  function renderQ3(q) {
    const view = el("div", { class: "quiz-q quiz-q3" });
    view.appendChild(el("h3", { class: "quiz-prompt" }, q.prompt));
    view.appendChild(el("p", { class: "quiz-grammar" }, q.sentence.grammar));
    const grid = el("div", { class: "quiz-q3-grid" });
    const userAnswers = q.sentence.phrases.map(() => null);

    q.sentence.phrases.forEach((p, i) => {
      const row = el("div", { class: "quiz-q3-row" });
      row.appendChild(el("span", { class: "quiz-q3-phrase" }, p.text));
      const select = el("select", { class: "quiz-q3-select", "data-idx": i });
      select.appendChild(el("option", { value: "" }, "选择 ..."));
      ROLES.forEach((r) => {
        select.appendChild(el("option", { value: r }, ROLE_INFO[r].label + " · " + ROLE_INFO[r].en));
      });
      select.addEventListener("change", (e) => { userAnswers[i] = e.target.value || null; });
      row.appendChild(select);
      grid.appendChild(row);
    });
    view.appendChild(grid);
    const submitBtn = el("button", { class: "quiz-submit", onClick: handleSubmit }, "提交评分");
    view.appendChild(submitBtn);

    function handleSubmit() {
      if (userAnswers.some((a) => a === null)) {
        alert("请为每一段都选择一个成分。"); return;
      }
      let correctCount = 0;
      const results = userAnswers.map((a, i) => {
        const truth = q.sentence.phrases[i].role;
        const ok = a === truth;
        if (ok) correctCount++;
        else pushReview({ qtype: "q3", sentenceId: q.sentence.id, phraseIndex: i, role: truth });
        return { user: a, truth, ok };
      });
      const allCorrect = correctCount === userAnswers.length;
      recordAnswer("q3", allCorrect);
      clear(grid);
      grid.appendChild(buildSentenceView(q.sentence, { reveal: true, showGrammar: false }));
      const breakdown = el("div", { class: "quiz-q3-results" });
      q.sentence.phrases.forEach((p, i) => {
        const r = results[i];
        const row = el("div", { class: "quiz-q3-result-row " + (r.ok ? "ok" : "bad") },
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
        `${correctCount} / ${userAnswers.length} 段贴对。${allCorrect ? "全对!" : "继续努力。"}`));
      view.appendChild(linkRow(q.sentence));
      view.appendChild(nextBtn());
    }
    return view;
  }

  function renderQ4(q) {
    const view = el("div", { class: "quiz-q quiz-q4" });
    view.appendChild(el("h3", { class: "quiz-prompt" }, q.prompt));
    // show sentence WITHOUT the grammar header (would give it away)
    const line = el("p", { class: "quiz-line quiz-q4-sentence" });
    q.sentence.phrases.forEach((p, i) => {
      line.appendChild(el("span", { class: "quiz-phrase" }, p.text));
      if (i < q.sentence.phrases.length - 1) line.appendChild(document.createTextNode(" "));
    });
    view.appendChild(line);
    const optGrid = el("div", { class: "quiz-options quiz-options-tall" });
    q.options.forEach((o) => {
      optGrid.appendChild(el("button", {
        class: "quiz-opt",
        onClick: () => handlePick(o),
      }, o));
    });
    view.appendChild(optGrid);

    function handlePick(o) {
      const correct = o === q.correct;
      recordAnswer("q4", correct);
      if (!correct) pushReview({ qtype: "q4", sentenceId: q.sentence.id, correct: q.correct });
      optGrid.querySelectorAll(".quiz-opt").forEach((b) => {
        if (b.textContent === q.correct) b.classList.add("quiz-opt-correct");
        else if (b.textContent === o) b.classList.add("quiz-opt-wrong");
        b.disabled = true;
      });
      view.appendChild(feedback(correct,
        correct
          ? `✓ 答对!这一句正是 <b>${escapeHTML(q.correct)}</b>。`
          : `✗ 答错。正确语法是 <b>${escapeHTML(q.correct)}</b>。`
      ));
      view.appendChild(linkRow(q.sentence));
      view.appendChild(nextBtn());
    }
    return view;
  }

  function renderQ5(q) {
    const view = el("div", { class: "quiz-q quiz-q5" });
    view.appendChild(el("h3", { class: "quiz-prompt" }, q.prompt));
    view.appendChild(buildSentenceView(q.sentence, { highlight: q.phraseIdx, showGrammar: false }));
    const optGrid = el("div", { class: "quiz-options" });
    q.options.forEach((o) => {
      optGrid.appendChild(el("button", {
        class: "quiz-opt",
        onClick: () => handlePick(o),
      }, o));
    });
    view.appendChild(optGrid);

    function handlePick(o) {
      const correct = o === q.correct;
      recordAnswer("q5", correct);
      if (!correct) pushReview({ qtype: "q5", sentenceId: q.sentence.id, correct: q.correct });
      optGrid.querySelectorAll(".quiz-opt").forEach((b) => {
        if (b.textContent === q.correct) b.classList.add("quiz-opt-correct");
        else if (b.textContent === o) b.classList.add("quiz-opt-wrong");
        b.disabled = true;
      });
      view.appendChild(feedback(correct,
        correct
          ? `✓ 答对!这一动词的时态是 <b>${escapeHTML(q.correct)}</b>。`
          : `✗ 答错。正确时态是 <b>${escapeHTML(q.correct)}</b>。`
      ));
      view.appendChild(linkRow(q.sentence));
      view.appendChild(nextBtn());
    }
    return view;
  }

  function renderQ7(q) {
    const view = el("div", { class: "quiz-q quiz-q7" });
    view.appendChild(el("h3", { class: "quiz-prompt" }, q.prompt));
    view.appendChild(el("p", { class: "quiz-grammar" }, q.cohesion.title));
    view.appendChild(el("p", { class: "quiz-q7-en" }, q.cohesion.en));
    if (q.cohesion.zh_flow) {
      view.appendChild(el("p", { class: "quiz-q7-zh" }, q.cohesion.zh_flow));
    }
    const optGrid = el("div", { class: "quiz-options quiz-options-tall" });
    q.options.forEach((o) => {
      optGrid.appendChild(el("button", {
        class: "quiz-opt",
        "data-key": o.key,
        onClick: () => handlePick(o),
      }, o.label));
    });
    view.appendChild(optGrid);

    function handlePick(o) {
      const correct = o.key === q.correct;
      recordAnswer("q7", correct);
      if (!correct) pushReview({ qtype: "q7", cohesionId: q.cohesion.id, correct: q.correct });
      optGrid.querySelectorAll(".quiz-opt").forEach((b) => {
        const k = b.getAttribute("data-key");
        if (k === q.correct) b.classList.add("quiz-opt-correct");
        else if (k === o.key) b.classList.add("quiz-opt-wrong");
        b.disabled = true;
      });
      const correctLabel = DATA.cohesion_types[q.correct].label_zh;
      view.appendChild(feedback(correct,
        correct
          ? `✓ 答对!这是 <b>${correctLabel}</b>。${q.cohesion.phenomenon ? "<br>" + escapeHTML(q.cohesion.phenomenon.slice(0, 200)) : ""}`
          : `✗ 答错。正确类别是 <b>${correctLabel}</b>。${q.cohesion.phenomenon ? "<br>" + escapeHTML(q.cohesion.phenomenon.slice(0, 200)) : ""}`
      ));
      const extra = [];
      if (q.cohesion.id) extra.push(el("a", { href: "/cohesion/#" + q.cohesion.id }, "→ 看 " + q.cohesion.id.toUpperCase() + " 完整解析"));
      if (q.cohesion.sentence_id) extra.push(el("a", { href: "/breakdown/#" + q.cohesion.sentence_id }, "→ " + q.cohesion.sentence_id.toUpperCase() + " 拆解"));
      view.appendChild(el("p", { class: "quiz-link" }, ...extra.flatMap((e, i) => i ? [document.createTextNode(" · "), e] : [e])));
      view.appendChild(nextBtn());
    }
    return view;
  }

  function renderQ8(q) {
    const view = el("div", { class: "quiz-q quiz-q8" });
    view.appendChild(el("h3", { class: "quiz-prompt" }, q.prompt));
    view.appendChild(el("p", { class: "quiz-q8-source" }, q.questionText));
    const optList = el("div", { class: "quiz-q8-options" });
    q.options.forEach((o) => {
      optList.appendChild(el("button", {
        class: "quiz-opt quiz-q8-opt",
        onClick: () => handlePick(o),
      }, o));
    });
    view.appendChild(optList);

    function handlePick(o) {
      const correct = o === q.correct;
      recordAnswer("q8", correct);
      if (!correct) pushReview({ qtype: "q8", sentenceId: q.sentence.id, correct: q.correct });
      optList.querySelectorAll(".quiz-opt").forEach((b) => {
        if (b.textContent === q.correct) b.classList.add("quiz-opt-correct");
        else if (b.textContent === o) b.classList.add("quiz-opt-wrong");
        b.disabled = true;
      });
      view.appendChild(feedback(correct,
        correct ? `✓ 答对!` : `✗ 答错。正确版本是上方高亮的那一项。`
      ));
      view.appendChild(linkRow(q.sentence));
      view.appendChild(nextBtn());
    }
    return view;
  }

  function renderQ9(q) {
    const view = el("div", { class: "quiz-q quiz-q9" });
    view.appendChild(el("h3", { class: "quiz-prompt" }, q.prompt));
    view.appendChild(el("p", { class: "quiz-q9-def" }, q.term.definition));
    const optGrid = el("div", { class: "quiz-options quiz-options-tall" });
    q.options.forEach((o) => {
      optGrid.appendChild(el("button", {
        class: "quiz-opt",
        onClick: () => handlePick(o),
      }, o));
    });
    view.appendChild(optGrid);

    function handlePick(o) {
      const correct = o === q.correct;
      recordAnswer("q9", correct);
      if (!correct) pushReview({ qtype: "q9", termId: q.term.id, correct: q.correct });
      optGrid.querySelectorAll(".quiz-opt").forEach((b) => {
        if (b.textContent === q.correct) b.classList.add("quiz-opt-correct");
        else if (b.textContent === o) b.classList.add("quiz-opt-wrong");
        b.disabled = true;
      });
      view.appendChild(feedback(correct,
        correct
          ? `✓ 答对!这是 <b>${escapeHTML(q.correct)}</b>。`
          : `✗ 答错。正确术语是 <b>${escapeHTML(q.correct)}</b>。`
      ));
      view.appendChild(el("p", { class: "quiz-link" },
        el("a", { href: "/terms/#" + q.term.id }, "→ 看 " + q.term.name + " 完整定义")
      ));
      view.appendChild(nextBtn());
    }
    return view;
  }

  function renderQ10(q) {
    const view = el("div", { class: "quiz-q quiz-q10" });
    view.appendChild(el("h3", { class: "quiz-prompt" }, q.prompt));
    const wordBlock = el("div", { class: "quiz-q10-word" },
      el("div", { class: "quiz-q10-en" }, q.word.en),
      q.word.ipa ? el("div", { class: "quiz-q10-ipa" }, "/" + q.word.ipa + "/") : null
    );
    view.appendChild(wordBlock);
    const optGrid = el("div", { class: "quiz-options" });
    q.options.forEach((o) => {
      optGrid.appendChild(el("button", {
        class: "quiz-opt quiz-q10-opt",
        onClick: () => handlePick(o),
      }, o));
    });
    view.appendChild(optGrid);

    function handlePick(o) {
      const correct = o === q.correct;
      recordAnswer("q10", correct);
      if (!correct) pushReview({ qtype: "q10", word: q.word.en, correct: q.correct });
      optGrid.querySelectorAll(".quiz-opt").forEach((b) => {
        if (b.textContent === q.correct) b.classList.add("quiz-opt-correct");
        else if (b.textContent === o) b.classList.add("quiz-opt-wrong");
        b.disabled = true;
      });
      view.appendChild(feedback(correct,
        correct
          ? `✓ 答对!<b>${escapeHTML(q.word.en)}</b> = ${escapeHTML(q.correct)}`
          : `✗ 答错。<b>${escapeHTML(q.word.en)}</b> = ${escapeHTML(q.correct)}`
      ));
      view.appendChild(nextBtn());
    }
    return view;
  }

  function renderQ11(q) {
    const view = el("div", { class: "quiz-q quiz-q11" });
    view.appendChild(el("h3", { class: "quiz-prompt" }, q.prompt));
    view.appendChild(el("p", { class: "quiz-q11-rule" }, "提示规则:" + q.error.rule));
    const optList = el("div", { class: "quiz-q11-options" });
    q.options.forEach((o, i) => {
      optList.appendChild(el("button", {
        class: "quiz-opt quiz-q11-opt",
        "data-key": o.key,
        onClick: () => handlePick(o),
      }, "(" + String.fromCharCode(65 + i) + ") " + o.text));
    });
    view.appendChild(optList);

    function handlePick(o) {
      const correct = o.key === q.correct;
      recordAnswer("q11", correct);
      if (!correct) pushReview({ qtype: "q11", errorId: q.error.id, correct: q.correct });
      optList.querySelectorAll(".quiz-opt").forEach((b) => {
        const k = b.getAttribute("data-key");
        if (k === "correct") b.classList.add("quiz-opt-correct");
        else if (k === o.key) b.classList.add("quiz-opt-wrong");
        b.disabled = true;
      });
      view.appendChild(feedback(correct,
        correct
          ? `✓ 答对!<br>${escapeHTML(q.error.explain)}`
          : `✗ 答错。<br>正确答案是另一句。<br>${escapeHTML(q.error.explain)}`
      ));
      if (q.error.source) {
        view.appendChild(el("p", { class: "quiz-link" }, "出处:" + q.error.source));
      }
      view.appendChild(nextBtn());
    }
    return view;
  }

  // ─── Top render ───────────────────────────────────────────────────────
  function render() {
    if (!DATA) return;
    clear(root);
    root.appendChild(renderHeader());

    const q = nextQuestion();
    const fns = {
      q1: renderQ1, q2: renderQ2, q3: renderQ3, q4: renderQ4,
      q5: renderQ5, q7: renderQ7, q8: renderQ8, q9: renderQ9,
      q10: renderQ10, q11: renderQ11,
    };
    const fn = fns[q.type] || renderQ2;
    root.appendChild(fn(q));

    // Footer with type stats
    const f = el("div", { class: "quiz-footer" });
    ALL_TYPES.forEach((t) => {
      const [c, total] = stats.byType[t] || [0, 0];
      if (total === 0 && !filter.enabled[t]) return;
      const pct = total ? Math.round((c / total) * 100) : 0;
      const chip = el("span", { class: "quiz-typestat" + (filter.enabled[t] ? "" : " quiz-typestat-off") },
        t.toUpperCase() + " · " + c + "/" + total + (total ? " · " + pct + "%" : ""));
      f.appendChild(chip);
    });
    root.appendChild(f);
  }

  // ─── Init ─────────────────────────────────────────────────────────────
  fetch(DATA_URL, { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then((d) => { DATA = d; render(); })
    .catch((err) => {
      clear(root);
      root.appendChild(el("p", { class: "quiz-error" },
        "题库载入失败:" + err.message + "。请刷新页面 / 检查网络。"));
    });
})();
