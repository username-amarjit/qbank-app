// Practice player (CP31): one question at a time with a palette, answer checking, the solution, bookmarks,
// favourites and notes. It plays any list: a paper, a subject, a year, a search, a saved list, or random questions.
import { api } from "../api.js";
import {
  answerText, blocks, BROWSE_VIEWS, browseHref, clock, el, emptyState, errorBanner, examLabel, examName, external, eyeIcon, hash, incognito,
  loading, marksText, paperLabel, percent, practiceHref, replace, TYPE_LABELS, TYPE_NAMES, when,
} from "../ui.js";
import { entryText, mistakeForm } from "./notebook.js";

// topic is a topic id of the exam's topic list (needs exam); site_topic is the source site's own topic label
const FILTERS = ["exam", "year", "paper", "subject", "topic", "site_topic", "type", "q", "list"];
const MAX_QUESTIONS = 500;
const MAX_NOTE = 10000;
const LIST_NAMES = { bookmarks: "Bookmarks", favorites: "Favourites", notes: "Questions with notes" };

function describe(params) {
  if (params.get("title")) {
    return params.get("title");
  }
  if (params.get("paper")) {
    return paperLabel(params.get("paper"), params.get("exam"));
  }
  if (params.get("list")) {
    return LIST_NAMES[params.get("list")] || "Saved questions";
  }
  if (params.get("q")) {
    return `Search: ${params.get("q")}`;
  }
  const parts = [params.get("exam") && examLabel(params.get("exam")), params.get("subject"), params.get("site_topic"), params.get("topic"),
    params.get("year"), params.get("type") && TYPE_LABELS[params.get("type")]].filter(Boolean);
  return parts.join(" · ") || "All questions";
}

function backLink(params) {
  const exam = params.get("exam");
  if (params.get("list")) {
    return ["#/saved", "Saved"];
  }
  if (params.get("q")) {
    return [hash("search", { q: params.get("q"), exam }), "Search"];
  }
  const from = BROWSE_VIEWS.find(([key]) => key === params.get("from")) || (params.get("topic") ? BROWSE_VIEWS[0] : null);
  if (exam && from) {
    return [browseHref(exam, from[0]), `${examLabel(exam)} ${from[1].toLowerCase()}`];
  }
  if (exam) {
    return [practiceHref(exam), examLabel(exam)];
  }
  return ["#/practice", "Practice"];
}

async function loadList(params) {
  const items = new Map();
  if (params.get("id")) {
    return { ids: [params.get("id")], items };
  }
  if (params.get("ids")) {
    return { ids: params.get("ids").split(",").filter(Boolean).slice(0, 100), items };
  }
  const filters = {};
  FILTERS.forEach((key) => {
    if (params.get(key)) {
      filters[key] = params.get(key);
    }
  });
  if (params.get("random")) {
    const records = await api.random({ ...filters, count: Math.max(1, Math.min(100, Number(params.get("random")) || 10)) });
    records.forEach((record) => items.set(record.id, record));
    return { ids: records.map((record) => record.id), items, random: true };
  }
  const ids = [];
  const fetchPage = filters.q ? api.search : api.questions;
  for (let page = 1; ids.length < MAX_QUESTIONS; page += 1) {
    const result = await fetchPage({ ...filters, page, per_page: 100 });
    result.items.forEach((item) => {
      ids.push(item.id);
      items.set(item.id, item);
    });
    if (page >= result.pages) {
      break;
    }
  }
  return { ids: ids.slice(0, MAX_QUESTIONS), items, capped: ids.length >= MAX_QUESTIONS };
}

export async function renderRun(view, { params, app }) {
  const [backHref, backText] = backLink(params);
  view.appendChild(loading("Loading questions…"));
  const list = await loadList(params);
  if (!view.isConnected) {
    return null; // the user moved to another page while the list loaded
  }
  view.replaceChildren();
  if (!list.ids.length) {
    view.appendChild(emptyState("No questions match.", el("a", { class: "btn", href: backHref }, `Back to ${backText}`)));
    return null;
  }
  let title = describe(params);
  if (list.random) {
    // The address is rewritten to the questions drawn, so a reload shows the same ones again.
    title = params.get("title") || `Random questions${title === "All questions" ? "" : ` · ${title}`}`;
    const fixed = new URLSearchParams(params);
    fixed.delete("random");
    fixed.set("ids", list.ids.join(","));
    fixed.set("title", title);
    fixed.set("mode", "random");
    fixed.set("n", params.get("random"));
    history.replaceState(null, "", hash("run", fixed));
    params = fixed;
  }
  const randomRun = params.get("mode") === "random";
  const settings = app.settings || {};
  const run = {
    ids: list.ids,
    items: list.items,
    cache: new Map(),
    results: new Map(),
    index: Math.max(0, list.ids.indexOf(params.get("at"))),
    sessionId: null,
    session: null,
    finished: false,
    shownAt: Date.now(),
    timer: null,
  };
  const exams = new Set(list.ids.map((id) => id.split(":")[0]));
  const sessionExam = params.get("exam") || (exams.size === 1 ? [...exams][0] : null);
  const sessionFilters = Object.fromEntries([...params.entries()].filter(([key]) => key !== "at"));
  const onePaper = list.items.size === list.ids.length && new Set([...list.items.values()].map((item) => item.paper)).size === 1;

  const progress = el("span", { class: "run-progress" });
  const score = el("span", { class: "run-score" });
  const timer = el("span", { class: "run-timer", title: "Time on this question" });
  const card = el("article", { class: "qcard", "aria-live": "polite" });
  const palette = el("div", { class: "palette", role: "list" });
  timer.hidden = settings.show_timer === false;

  view.appendChild(el("section", { class: "run" },
    el("header", { class: "run-head" },
      el("div", {}, el("a", { href: backHref, class: "back" }, `← ${backText}`), el("h1", { text: title }),
        params.get("topic") && params.get("exam") && !list.random
          ? el("a", { class: "small", href: hash("search", { exam: params.get("exam"), topic: params.get("topic") }) }, "See these questions as a list")
          : null,
        list.capped ? el("p", { class: "muted", text: `Showing the first ${MAX_QUESTIONS} questions.` }) : null),
      el("div", { class: "run-stats" }, progress, score, timer,
        el("button", { class: "btn", type: "button", onclick: () => finish() }, "Finish"))),
    el("div", { class: "run-body" },
      card,
      el("aside", { class: "palette-wrap", "aria-label": "Questions in this set" },
        el("h2", { text: "Questions" }), palette,
        el("p", { class: "legend muted" },
          el("span", { class: "dot correct" }), " correct ", el("span", { class: "dot wrong" }), " wrong ",
          el("span", { class: "dot revealed" }), " answer shown ", el("span", { class: "dot marked" }), " bookmarked")))));

  function paletteLabel(i) {
    const item = run.items.get(run.ids[i]);
    return onePaper && item ? String(item.question_number) : String(i + 1);
  }

  function updateHeader() {
    const answered = [...run.results.values()].filter((result) => result.kind === "answered");
    const graded = answered.filter((result) => result.isCorrect !== null);
    const correct = graded.filter((result) => result.isCorrect).length;
    progress.textContent = `Question ${run.index + 1} of ${run.ids.length}`;
    score.textContent = answered.length ? `${correct} of ${graded.length} correct (${percent(graded.length ? correct / graded.length : null)})` : "Not answered yet";
  }

  function updatePalette() {
    palette.replaceChildren(...run.ids.map((id, i) => {
      const result = run.results.get(id);
      const cached = run.cache.get(id);
      const classes = ["pal"];
      let state = "not answered";
      if (result && result.kind === "answered") {
        state = result.isCorrect === true ? "correct" : result.isCorrect === false ? "wrong" : "answered";
        classes.push(state);
      } else if (result) {
        classes.push("revealed");
        state = "answer shown";
      }
      if (cached && cached.state.bookmarked) {
        classes.push("marked");
        state += ", bookmarked";
      }
      if (i === run.index) {
        classes.push("current");
      }
      return el("button", { type: "button", role: "listitem", class: classes.join(" "), "aria-label": `Question ${paletteLabel(i)}, ${state}`,
        "aria-current": i === run.index ? "true" : false, onclick: () => show(i) }, paletteLabel(i));
    }));
  }

  function startTimer() {
    clearInterval(run.timer);
    run.shownAt = Date.now();
    timer.textContent = clock(0);
    run.timer = setInterval(() => {
      timer.textContent = clock(Math.floor((Date.now() - run.shownAt) / 1000));
    }, 1000);
  }

  async function getQuestion(id) {
    if (!run.cache.has(id)) {
      const data = await api.question(id);
      run.cache.set(id, data);
      if (!run.items.has(id)) {
        run.items.set(id, data.question);
      }
    }
    return run.cache.get(id);
  }

  async function ensureSession() {
    if (run.sessionId === null) {
      run.session = run.session || api.startSession({ exam: sessionExam, mode: randomRun ? "random" : "practice", filters: sessionFilters });
      try {
        run.sessionId = await run.session;
      } catch (error) {
        run.session = null;
        throw error;
      }
    }
    return run.sessionId;
  }

  async function show(i) {
    if (i < 0 || i >= run.ids.length || !view.isConnected) {
      return;
    }
    run.index = i;
    clearInterval(run.timer);
    updateHeader();
    updatePalette();
    const at = new URLSearchParams(params);
    at.set("at", run.ids[i]);
    history.replaceState(null, "", hash("run", at));
    card.replaceChildren(loading());
    let data;
    try {
      data = await getQuestion(run.ids[i]);
    } catch (error) {
      if (run.index === i) {
        card.replaceChildren(errorBanner(error, app.reconnect));
      }
      return;
    }
    if (run.index !== i || run.finished || !view.isConnected) {
      return;
    }
    renderCard(data.question, data.state, data);
    updatePalette();
    startTimer();
    if (i + 1 < run.ids.length) {
      getQuestion(run.ids[i + 1]).catch(() => {});
    }
  }

  const topicLists = new Map(); // exam -> promise of its topic list, for the add-topic picker

  function topicList(exam) {
    if (!topicLists.has(exam)) {
      const pending = api.examTopics(exam);
      topicLists.set(exam, pending);
      pending.catch(() => topicLists.delete(exam));
    }
    return topicLists.get(exam);
  }

  // The question's topics (CP40B) as chips: the name opens that topic's questions, × removes it, + Topic adds one,
  // and "Back to suggested" forgets your corrections. Corrections are saved by the worker and always win.
  function topicsRow(data) {
    const question = data.question;
    data.topics = data.topics || []; // a worker older than CP40B sends none
    const row = el("div", { class: "qtopics" });
    const status = el("span", { class: "muted small", role: "status" });
    let busy = false;

    async function change(body, done) {
      if (busy) {
        return;
      }
      busy = true;
      try {
        const result = await api.editTopics(question.id, body);
        data.topics = result.topics;
        data.topics_edited = result.edited;
        draw();
        status.textContent = done;
      } catch (error) {
        status.textContent = error.message;
      } finally {
        busy = false;
      }
    }

    function chips() {
      return data.topics.map((topic) => el("span", { class: topic.source === "you" ? "topic-chip mine" : "topic-chip",
        title: `${topic.subject}${topic.source === "you" ? " · added by you" : ""}` },
        el("a", { href: hash("run", { exam: question.exam, topic: topic.id, title: topic.name, from: "topics" }), text: topic.name }),
        el("button", { type: "button", class: "chip-x", "aria-label": `Remove topic ${topic.name}`, title: "Remove this topic",
          onclick: () => change({ remove: topic.id }, `Removed ${topic.name}.`) }, "×")));
    }

    function draw() {
      replace(row,
        el("span", { class: "qtopics-label", text: "Topics:" }),
        data.topics.length ? chips() : el("span", { class: "muted", text: question.topic ? `none yet (site: ${question.topic})` : "none yet" }),
        el("button", { type: "button", class: "btn btn-ghost btn-small", onclick: () => pick() }, "+ Topic"),
        data.topics_edited ? el("button", { type: "button", class: "btn btn-ghost btn-small", title: "Forget your changes to this question's topics",
          onclick: () => change({ reset: true }, "Back to the suggested topics.") }, "Back to suggested") : null,
        status);
    }

    async function pick() {
      status.textContent = "Loading topics…";
      let list;
      try {
        list = await topicList(question.exam);
      } catch (error) {
        status.textContent = error.message;
        return;
      }
      if (!row.isConnected) {
        return;
      }
      const have = new Set(data.topics.map((topic) => topic.id));
      const subjects = [...list.subjects].sort((a, b) => (b.subject === question.subject) - (a.subject === question.subject));
      const picker = el("select", { "aria-label": "Topic to add" }, el("option", { value: "", text: "Choose a topic…" }),
        subjects.map((subject) => el("optgroup", { label: subject.subject },
          subject.topics.filter((topic) => !have.has(topic.id)).map((topic) => el("option", { value: topic.id, text: topic.name })))));
      const form = el("form", { class: "topic-picker" }, picker,
        el("button", { class: "btn btn-small", type: "submit" }, "Add"),
        el("button", { class: "btn btn-ghost btn-small", type: "button", onclick: () => draw() }, "Cancel"));
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (picker.value) {
          change({ add: picker.value }, `Added ${picker.selectedOptions[0].textContent}.`);
        }
      });
      replace(row, el("span", { class: "qtopics-label", text: "Topics:" }), chips(), form, status);
      status.textContent = "";
      picker.focus();
    }

    draw();
    return row;
  }

  function renderCard(question, state, data) {
    const id = question.id;
    const single = question.question_type === "mcq_single";
    const numerical = question.question_type === "numerical";
    const previous = run.results.get(id);
    const chosen = new Set(previous && Array.isArray(previous.selected) ? previous.selected : []);
    let locked = Boolean(previous);

    const feedback = el("div", { class: "feedback-area" });
    const message = el("p", { class: "form-error", role: "alert" });
    const numberInput = numerical
      ? el("input", { type: "text", inputmode: "decimal", class: "num-input", "aria-label": "Your answer", autocomplete: "off",
        value: previous && previous.kind === "answered" ? String(previous.selected) : "", disabled: locked, oninput: () => sync(),
        onkeydown: (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            check();
          }
        } })
      : null;
    const optionNodes = new Map();
    const optionsBox = numerical
      ? el("div", { class: "numeric" }, el("label", { class: "field" }, el("span", { text: "Your answer (a number)" }), numberInput))
      : el("div", { class: "options", role: single ? "radiogroup" : "group", "aria-label": single ? "Choose one option" : "Choose one or more options" },
        question.options.map((option) => {
          const node = el("div", { class: "option", role: single ? "radio" : "checkbox", tabindex: "0", dataset: { label: option.label } },
            el("span", { class: "option-label", text: option.label }), blocks(question, option.blocks));
          node.addEventListener("click", (event) => {
            if (!event.target.closest("a")) {
              choose(option.label);
            }
          });
          node.addEventListener("keydown", (event) => {
            if (event.key === " " || event.key === "Enter") {
              event.preventDefault();
              choose(option.label);
            }
          });
          optionNodes.set(option.label, node);
          return node;
        }));

    const checkButton = el("button", { class: "btn btn-primary", type: "button", onclick: () => check() }, "Check answer");
    const showButton = el("button", { class: "btn", type: "button", onclick: () => reveal() }, "Show answer");
    const clearButton = el("button", { class: "btn btn-ghost", type: "button", onclick: () => {
      chosen.clear();
      if (numberInput) {
        numberInput.value = "";
      }
      sync();
    } }, "Clear");

    function sync() {
      optionNodes.forEach((node, label) => {
        node.setAttribute("aria-checked", String(chosen.has(label)));
        node.setAttribute("aria-disabled", String(locked));
        node.classList.toggle("selected", chosen.has(label));
      });
      const ready = numerical ? numberInput.value.trim() !== "" : chosen.size > 0;
      checkButton.disabled = locked || !ready;
      showButton.disabled = locked;
      clearButton.disabled = locked || !ready;
      message.textContent = "";
    }

    function choose(label) {
      if (locked) {
        return;
      }
      if (single) {
        chosen.clear();
        chosen.add(label);
      } else if (chosen.has(label)) {
        chosen.delete(label);
      } else {
        chosen.add(label);
      }
      sync();
    }

    function markOptions(answer) {
      const right = new Set(answer && answer.status === "known" ? answer.correct_labels || [] : []);
      optionNodes.forEach((node, label) => {
        node.classList.toggle("correct", right.has(label));
        node.classList.toggle("wrong", chosen.has(label) && !right.has(label) && right.size > 0);
        node.classList.toggle("missed", !chosen.has(label) && right.has(label) && chosen.size > 0);
      });
    }

    function showFeedback(result) {
      const answer = result.answer || question.answer;
      markOptions(answer);
      let kind = "info";
      let heading = "Answer";
      if (result.kind === "answered") {
        kind = result.isCorrect === true ? "good" : result.isCorrect === false ? "bad" : "info";
        heading = result.isCorrect === true ? "Correct" : result.isCorrect === false ? "Not correct" : "Answer recorded";
      }
      const lines = [el("strong", { class: "feedback-title", text: heading }),
        el("p", {}, "Correct answer: ", el("b", { text: answerText(question, answer) }))];
      if (result.kind === "answered" && numerical) {
        lines.push(el("p", { class: "muted", text: `Your answer: ${result.selected}` }));
      }
      if (state.attempts) {
        lines.push(el("p", { class: "muted", text: `You have answered this question ${state.attempts} time${state.attempts === 1 ? "" : "s"}, ${state.correct} correct.` }));
      }
      if (result.kind === "answered" && result.isCorrect === false) {
        lines.push(el("p", { class: "notebook-prompt" },
          el("button", { class: "btn btn-small", type: "button", onclick: () => openForm(result.attemptId) }, "Add to error notebook"),
          el("span", { class: "muted small", text: " why it went wrong, and what to remember" })));
      }
      const explanation = question.explanation && question.explanation.blocks && question.explanation.blocks.length
        ? el("div", { class: "explanation" }, el("h3", { text: "Solution" }), blocks(question, question.explanation.blocks))
        : el("p", { class: "muted", text: "No solution was given with this question." });
      feedback.replaceChildren(el("div", { class: `feedback ${kind}` }, lines, explanation));
    }

    async function check() {
      if (locked) {
        return;
      }
      let selected;
      if (numerical) {
        selected = Number(numberInput.value.trim().replace(",", "."));
        if (numberInput.value.trim() === "" || !Number.isFinite(selected)) {
          message.textContent = "Enter a number, for example 2.5 or -3.";
          return;
        }
      } else {
        selected = [...chosen].sort();
        if (!selected.length) {
          return;
        }
      }
      checkButton.disabled = true;
      try {
        const sessionId = await ensureSession();
        const response = await api.attempt({ question_id: id, selected, time_spent_ms: Date.now() - run.shownAt, session_id: sessionId });
        locked = true;
        state.attempts += 1;
        if (response.is_correct) {
          state.correct += 1;
        }
        const result = { kind: "answered", selected, isCorrect: response.is_correct, answer: response.answer, attemptId: response.attempt_id };
        run.results.set(id, result);
        clearInterval(run.timer);
        if (numberInput) {
          numberInput.disabled = true;
        }
        sync();
        showFeedback(result);
        updateHeader();
        updatePalette();
      } catch (error) {
        checkButton.disabled = false;
        feedback.replaceChildren(errorBanner(error, app.reconnect));
      }
    }

    function reveal() {
      if (locked) {
        return;
      }
      locked = true;
      const result = { kind: "revealed", selected: [...chosen], answer: question.answer };
      run.results.set(id, result);
      clearInterval(run.timer);
      if (numberInput) {
        numberInput.disabled = true;
      }
      sync();
      showFeedback(result);
      updatePalette();
    }

    function toggleButton(label, field, save) {
      const button = el("button", { class: "btn btn-ghost toggle", type: "button", "aria-pressed": String(Boolean(state[field])) }, label);
      button.addEventListener("click", async () => {
        try {
          await save(!state[field]);
          state[field] = !state[field];
          button.setAttribute("aria-pressed", String(state[field]));
          updatePalette();
        } catch (error) {
          feedback.replaceChildren(errorBanner(error, app.reconnect));
        }
      });
      return button;
    }

    const noteText = el("textarea", { class: "note-input", rows: "4", maxlength: String(MAX_NOTE), "aria-label": "Your note on this question" });
    noteText.value = state.note ? state.note.body : "";
    const noteStatus = el("span", { class: "muted", role: "status" });
    const noteButton = el("button", { class: "btn btn-ghost toggle", type: "button", "aria-pressed": String(Boolean(state.note)) }, "Note");
    const noteBox = el("div", { class: "note-box", hidden: !state.note },
      noteText,
      el("div", { class: "actions" },
        el("button", { class: "btn", type: "button", onclick: async () => {
          try {
            const saved = (await api.saveNote(id, noteText.value)).note;
            state.note = saved ? { body: saved } : null;
            noteButton.setAttribute("aria-pressed", String(Boolean(state.note)));
            noteStatus.textContent = saved ? "Saved." : "Note deleted.";
          } catch (error) {
            noteStatus.textContent = error.message;
          }
        } }, "Save note"),
        noteStatus));
    noteButton.addEventListener("click", () => {
      noteBox.hidden = !noteBox.hidden;
      if (!noteBox.hidden) {
        noteText.focus();
      }
    });

    // Error notebook (CP40A): this question's entries, newest first, and a form to add or change one
    state.mistakes = state.mistakes || []; // a worker older than CP40A sends none
    const notebookButton = el("button", { class: "btn btn-ghost toggle", type: "button" });
    const notebookBox = el("div", { class: "notebook-box", hidden: true });

    function notebookLabel() {
      notebookButton.textContent = state.mistakes.length ? `Notebook (${state.mistakes.length})` : "Notebook";
      notebookButton.setAttribute("aria-pressed", String(state.mistakes.length > 0));
    }

    function lastWrongAttempt() {
      const result = run.results.get(id);
      return result && result.kind === "answered" && result.isCorrect === false ? result.attemptId : undefined;
    }

    function drawNotebook(form, editing) {
      notebookLabel();
      replace(notebookBox,
        el("div", { class: "notebook-box-head" }, el("strong", { text: "Error notebook" }), el("a", { class: "small", href: "#/notebook" }, "Open the notebook")),
        state.mistakes.map((entry) => (entry.id === editing ? form : el("div", { class: entry.resolved ? "mistake mini resolved" : "mistake mini" },
          el("div", { class: "mistake-foot" },
            el("span", { class: "muted small", text: `${when(entry.created_at)}${entry.resolved ? " · resolved" : ""}` }),
            el("button", { class: "btn btn-ghost btn-small", type: "button", onclick: () => editEntry(entry) }, "Edit")),
          entryText(entry)))),
        form && editing === undefined ? form
          : el("button", { class: "btn btn-small", type: "button", onclick: () => openForm(lastWrongAttempt()) }, state.mistakes.length ? "+ Another entry" : "+ Add an entry"));
    }

    function openForm(attemptId) {
      const form = mistakeForm({ questionId: id, attemptId, onSaved: (saved) => {
        state.mistakes = [saved, ...state.mistakes];
        drawNotebook();
      }, onCancel: () => drawNotebook() });
      notebookBox.hidden = false;
      drawNotebook(form);
      form.focusFirst();
      notebookBox.scrollIntoView({ block: "nearest" });
    }

    function editEntry(entry) {
      const form = mistakeForm({ entry, onSaved: (saved) => {
        state.mistakes = state.mistakes.map((item) => (item.id === saved.id ? saved : item));
        drawNotebook();
      }, onCancel: () => drawNotebook() });
      drawNotebook(form, entry.id);
      form.focusFirst();
    }

    notebookButton.addEventListener("click", () => {
      if (!notebookBox.hidden) {
        notebookBox.hidden = true;
      } else if (!state.mistakes.length) {
        openForm(lastWrongAttempt());
      } else {
        notebookBox.hidden = false;
        drawNotebook();
      }
    });
    notebookLabel();

    // Incognito display: the year tag (the paper, e.g. "GATE CSE 2023 SET-1") and the topics wait behind the eye.
    // Each question starts hidden again; the rest of the line (number, subject, type, marks) always shows.
    const masked = incognito();
    let revealed = !masked;
    const yearTag = el("span", { class: "year-tag" });
    const topicLine = topicsRow(data);
    // the source page's address names the exam and year, so it waits behind the eye too
    const sourceLink = question.source && question.source.url ? external(question.source.url, "Source") : null;
    const eye = masked ? el("button", { class: "eye-button", type: "button" }) : null;
    function drawTag() {
      yearTag.textContent = revealed ? question.paper || examName(question.exam) : examLabel(question.exam);
      topicLine.hidden = !revealed;
      if (sourceLink) {
        sourceLink.hidden = !revealed;
      }
      if (eye) {
        const label = revealed ? "Hide the year and topics" : "Show the year and topics";
        eye.setAttribute("aria-pressed", String(revealed));
        eye.setAttribute("aria-label", label);
        eye.title = label;
        eye.replaceChildren(eyeIcon(revealed));
      }
    }
    if (eye) {
      eye.addEventListener("click", () => {
        revealed = !revealed;
        drawTag();
      });
    }
    drawTag();

    card.replaceChildren(
      el("div", { class: "qmeta" },
        el("span", {}, yearTag, ` · Q${question.question_number}`, question.subject ? ` · ${question.subject}` : ""),
        eye,
        el("span", { class: "chip", title: TYPE_NAMES[question.question_type] || "", text: TYPE_LABELS[question.question_type] || question.question_type }),
        marksText(question.marks) ? el("span", { class: "chip", text: marksText(question.marks) }) : null),
      topicLine,
      el("div", { class: "qtools" },
        toggleButton("Bookmark", "bookmarked", (on) => api.bookmark(id, on)),
        toggleButton("Favourite", "favorite", (on) => api.favorite(id, on)),
        noteButton,
        notebookButton,
        sourceLink),
      noteBox,
      notebookBox,
      el("div", { class: "stem" }, blocks(question, question.content.blocks)),
      optionsBox,
      message,
      el("div", { class: "actions" }, checkButton, showButton, clearButton),
      feedback,
      el("div", { class: "qnav" },
        el("button", { class: "btn", type: "button", disabled: run.index === 0, onclick: () => show(run.index - 1) }, "← Previous"),
        el("button", { class: "btn btn-primary", type: "button", disabled: run.index === run.ids.length - 1, onclick: () => show(run.index + 1) }, "Next →")));
    sync();
    if (previous) {
      showFeedback(previous);
    }
    card.chooseOption = (index) => {
      const option = question.options[index];
      if (option) {
        choose(option.label);
      }
    };
    card.check = () => check();
  }

  function finish() {
    run.finished = true;
    clearInterval(run.timer);
    document.removeEventListener("keydown", onKey);
    if (run.sessionId !== null) {
      api.endSession(run.sessionId).catch(() => {});
    }
    const answered = [...run.results.entries()].filter(([, result]) => result.kind === "answered");
    const graded = answered.filter(([, result]) => result.isCorrect !== null);
    const correct = graded.filter(([, result]) => result.isCorrect).length;
    const wrongIds = graded.filter(([, result]) => result.isCorrect === false).map(([id]) => id);
    const again = new URLSearchParams(params);
    again.delete("at");
    if (randomRun) {
      ["ids", "title", "mode", "n"].forEach((key) => again.delete(key));
      again.set("random", params.get("n") || "10");
    }
    view.replaceChildren(el("section", { class: "card summary" },
      el("h1", { text: "Session summary" }),
      el("p", { class: "muted", text: title }),
      el("div", { class: "tiles" },
        el("div", { class: "tile" }, el("span", { class: "tile-value", text: `${answered.length} / ${run.ids.length}` }), el("span", { text: "answered" })),
        el("div", { class: "tile" }, el("span", { class: "tile-value", text: String(correct) }), el("span", { text: "correct" })),
        el("div", { class: "tile" }, el("span", { class: "tile-value", text: percent(graded.length ? correct / graded.length : null) }), el("span", { text: "accuracy" }))),
      el("div", { class: "actions" },
        wrongIds.length ? el("a", { class: "btn btn-primary", href: hash("run", { ids: wrongIds.slice(0, 100).join(","), title: `Mistakes: ${title}` }) },
          `Review ${wrongIds.length} mistake${wrongIds.length === 1 ? "" : "s"}`) : null,
        el("button", { class: "btn", type: "button", onclick: () => {
          history.replaceState(null, "", hash("run", again));
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        } }, "Practice again"),
        el("a", { class: "btn btn-ghost", href: backHref }, `Back to ${backText}`))));
  }

  function onKey(event) {
    if (run.finished || event.altKey || event.ctrlKey || event.metaKey || settings.shortcuts === false) {
      return;
    }
    const target = event.target;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) {
      return;
    }
    if (event.key === "ArrowRight") {
      show(run.index + 1);
    } else if (event.key === "ArrowLeft") {
      show(run.index - 1);
    } else if (/^[1-9]$/.test(event.key) && card.chooseOption) {
      card.chooseOption(Number(event.key) - 1);
    } else if (/^[a-h]$/i.test(event.key) && card.chooseOption && !event.shiftKey) {
      card.chooseOption(event.key.toLowerCase().charCodeAt(0) - 97);
    } else if (event.key === "Enter" && card.check && !(target && target.closest && target.closest(".option, button, a"))) {
      card.check();
    }
  }

  document.addEventListener("keydown", onKey);
  await show(run.index);
  return () => {
    document.removeEventListener("keydown", onKey);
    clearInterval(run.timer);
    if (run.sessionId !== null && !run.finished) {
      api.endSession(run.sessionId).catch(() => {});
    }
  };
}
