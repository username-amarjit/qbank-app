// Taking a test (CP40D), GATE style: answers hidden until you submit, a countdown that submits at zero, mark for review,
// a palette of question states; then the result with marks per subject and every question's solution and reasoning.
import { api } from "../api.js";
import { ANSWER_KEY, append, blocks, clock, el, emptyState, errorBanner, focusAnswer, FRACTION, hash, loading, percent, replace, TYPE_LABELS } from "../ui.js";
import { reviewItem } from "./review.js";
import { testTitle } from "./tests.js";

const SAVE_DELAY = 1200;

function marksLine(record) {
  const positive = (record.marks || {}).positive || 1;
  const negative = record.marks && record.marks.negative !== null && record.marks.negative !== undefined
    ? record.marks.negative : record.question_type === "mcq_single" ? positive / 3 : 0;
  return `${positive} mark${positive === 1 ? "" : "s"}${negative ? ` · −${Number(negative).toFixed(2)} if wrong` : " · no negative marks"}`;
}

function intro(view, test, app, onStart) {
  const minutes = test.minutes ? `${test.minutes} minutes` : "no time limit";
  const start = el("button", { class: "btn btn-primary btn-large", type: "button" }, "Start the test");
  const status = el("p", { class: "muted", role: "status" });
  start.addEventListener("click", async () => {
    start.disabled = true;
    try {
      onStart(await api.startTest(test.id));
    } catch (error) {
      status.textContent = error.message;
      start.disabled = false;
    }
  });
  view.append(el("section", { class: "card test-intro" },
    el("a", { class: "back", href: hash("tests", { exam: test.exam }) }, "← Tests"),
    el("h1", { text: testTitle(test) }),
    el("p", { class: "lead", text: `${test.question_count} questions · ${minutes}` }),
    test.sections.length > 1 ? el("p", { text: `Sections: ${test.sections.map((part) => `${part.name} (${part.count})`).join(", ")}.` }) : null,
    el("ul", {},
      el("li", { text: "Answers and solutions stay hidden until you submit." }),
      el("li", { text: test.minutes ? "The clock counts down from the moment you start, even if you leave the page; at zero the test is submitted." : "There is no time limit; submit when you are done." }),
      el("li", { text: "A wrong MCQ loses a third of its marks; MSQ and NAT questions lose nothing." }),
      el("li", { text: "Mark a question for review to come back to it. Your answers are saved as you go." })),
    el("div", { class: "actions" }, start, status)));
}

function runner(view, test, app, onSubmitted) {
  const ids = test.question_ids;
  const records = new Map();
  const responses = Object.fromEntries(ids.map((id) => [id, { selected: null, marked: false, visited: false, time_ms: 0, ...(test.responses[id] || {}) }]));
  const dirty = new Set();
  let index = Math.max(0, ids.findIndex((id) => !responses[id].visited));
  let shownAt = Date.now();
  let saveTimer = null;
  let tick = null;
  let ended = false;
  let deadline = test.remaining_seconds === null ? null : Date.now() + test.remaining_seconds * 1000;
  let answerInput = null; // the shown question's NAT answer box

  const timer = el("span", { class: "test-timer", role: "timer", "aria-live": "off" });
  const saved = el("span", { class: "muted small", role: "status" });
  const card = el("article", { class: "qcard test-card" });
  const palette = el("div", { class: "test-palette" });
  const counts = el("p", { class: "palette-counts muted small" });
  const submitArea = el("div");
  const sectionOf = [];
  test.sections.forEach((part) => {
    for (let i = 0; i < part.count; i += 1) {
      sectionOf.push(part.name);
    }
  });

  function answered(id) {
    const value = responses[id].selected;
    return Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && String(value).trim() !== "";
  }

  function state(id) {
    const response = responses[id];
    if (answered(id)) {
      return response.marked ? "answered-marked" : "answered";
    }
    return response.marked ? "marked" : response.visited ? "not-answered" : "not-visited";
  }

  async function flush() {
    clearTimeout(saveTimer);
    if (!dirty.size || ended) {
      return;
    }
    const batch = Object.fromEntries([...dirty].map((id) => [id, responses[id]]));
    dirty.clear();
    try {
      const reply = await api.saveResponses(test.id, batch);
      if (reply.remaining_seconds !== null && reply.remaining_seconds !== undefined) {
        deadline = Date.now() + reply.remaining_seconds * 1000;
      }
      saved.textContent = "Saved";
    } catch (error) {
      Object.keys(batch).forEach((id) => dirty.add(id));
      saved.textContent = "Not saved yet: the worker did not answer";
    }
  }

  function changed(id) {
    dirty.add(id);
    saved.textContent = "";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, SAVE_DELAY);
    drawPalette();
  }

  function leaveQuestion() {
    const id = ids[index];
    responses[id].time_ms += Date.now() - shownAt;
    dirty.add(id);
  }

  function drawPalette() {
    const groups = [];
    ids.forEach((id, i) => {
      const name = sectionOf[i] || "Questions";
      if (!groups.length || groups[groups.length - 1].name !== name) {
        groups.push({ name, items: [] });
      }
      groups[groups.length - 1].items.push(el("button", {
        type: "button", class: `pal-test ${state(id)}${i === index ? " current" : ""}`, "aria-current": i === index ? "true" : false,
        "aria-label": `Question ${i + 1}, ${state(id).replace("-", " ")}`, onclick: () => go(i),
      }, String(i + 1)));
    });
    replace(palette, groups.map((group) => el("div", { class: "palette-section" },
      groups.length > 1 ? el("h3", { text: group.name }) : null, el("div", { class: "palette-grid" }, group.items))));
    const tally = { answered: 0, "not-answered": 0, "not-visited": 0, marked: 0, "answered-marked": 0 };
    ids.forEach((id) => { tally[state(id)] += 1; });
    counts.textContent = `${tally.answered + tally["answered-marked"]} answered · ${tally["not-answered"]} not answered · `
      + `${tally["not-visited"]} not visited · ${tally.marked + tally["answered-marked"]} marked for review`;
  }

  async function record(id) {
    if (!records.has(id)) {
      records.set(id, api.question(id).then((data) => data.question));
      records.get(id).catch(() => records.delete(id));
    }
    return records.get(id);
  }

  async function go(i) {
    if (i < 0 || i >= ids.length || ended) {
      return;
    }
    leaveQuestion();
    index = i;
    await show();
    flush();
  }

  async function show() {
    const id = ids[index];
    responses[id].visited = true;
    dirty.add(id);
    shownAt = Date.now();
    drawPalette();
    card.replaceChildren(loading());
    let question;
    try {
      question = await record(id);
    } catch (error) {
      card.replaceChildren(errorBanner(error, app.reconnect));
      return;
    }
    if (ids[index] !== id || ended) {
      return;
    }
    if (index + 1 < ids.length) {
      record(ids[index + 1]).catch(() => {}); // the next question is ready before you move on
    }
    const response = responses[id];
    const single = question.question_type === "mcq_single";
    const numerical = question.question_type === "numerical";
    const chosen = new Set(Array.isArray(response.selected) ? response.selected : []);
    let input = null;
    let options = null;
    let hint = null;
    if (numerical) {
      input = el("input", { type: "text", inputmode: "decimal", class: "num-input", autocomplete: "off", "aria-label": "Your answer",
        value: response.selected === null || response.selected === undefined ? "" : String(response.selected) });
      // numbers only, as in GATE (a fraction is for practice, CP40I): say so at once, as anything else counts as not answered
      hint = el("p", { class: "form-error", role: "status" });
      const checkNumber = () => {
        const value = input.value.trim().replace(",", ".");
        const [top, bottom] = value.split("/").map(Number);
        const example = FRACTION.test(value) && bottom ? ` (${value.replace(/\s+/g, "")} ≈ ${Number((top / bottom).toFixed(4))})` : "";
        hint.textContent = value === "" || Number.isFinite(Number(value)) ? ""
          : `Not a number: type it as a decimal, as in GATE${example}. As it is, it counts as not answered.`;
      };
      checkNumber();
      input.addEventListener("input", () => {
        const value = input.value.trim().replace(",", ".");
        response.selected = value === "" ? null : value;
        checkNumber();
        changed(id);
      });
      input.addEventListener("keydown", (event) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
          return;
        }
        if (event.key === "Enter") {
          // Save & next without the mouse; on the last question only save (submitting stays a click on Submit test)
          event.preventDefault();
          if (index < ids.length - 1) {
            go(index + 1);
          } else {
            flush();
          }
        } else if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && input.value === "") {
          // the box has the focus: while it is empty, ← → still change the question
          event.preventDefault();
          go(index + (event.key === "ArrowRight" ? 1 : -1));
        }
      });
    } else {
      const nodes = new Map();
      const sync = () => nodes.forEach((node, label) => {
        node.setAttribute("aria-checked", String(chosen.has(label)));
        node.classList.toggle("selected", chosen.has(label));
      });
      options = el("div", { class: "options", role: single ? "radiogroup" : "group", "aria-label": single ? "Choose one option" : "Choose one or more options" },
        question.options.map((option) => {
          const node = el("div", { class: "option", role: single ? "radio" : "checkbox", tabindex: "0" },
            el("span", { class: "option-label", text: option.label }), blocks(question, option.blocks));
          const pick = () => {
            if (single) {
              const was = chosen.has(option.label);
              chosen.clear();
              if (!was) {
                chosen.add(option.label);
              }
            } else if (chosen.has(option.label)) {
              chosen.delete(option.label);
            } else {
              chosen.add(option.label);
            }
            response.selected = chosen.size ? [...chosen].sort() : null;
            sync();
            changed(id);
          };
          node.addEventListener("click", (event) => {
            if (!event.target.closest("a")) {
              pick();
            }
          });
          node.addEventListener("keydown", (event) => {
            if (event.key === " " || event.key === "Enter") {
              event.preventDefault();
              pick();
            }
          });
          nodes.set(option.label, node);
          return node;
        }));
      sync();
    }
    const kind = { mcq_single: "MCQ: one correct option", mcq_multiple: "MSQ: one or more correct options", numerical: "NAT: type a number" }[question.question_type];
    card.replaceChildren(
      el("div", { class: "qmeta" },
        el("strong", { text: `Question ${index + 1} of ${ids.length}` }),
        sectionOf[index] && test.sections.length > 1 ? el("span", { class: "chip", text: sectionOf[index] }) : null,
        el("span", { class: "chip", text: TYPE_LABELS[question.question_type] || question.question_type, title: kind }),
        el("span", { class: "muted", text: marksLine(question) })),
      el("div", { class: "stem" }, blocks(question, question.content.blocks)),
      numerical ? el("div", { class: "numeric" }, el("label", { class: "field" }, el("span", { text: "Your answer (a number)" }), input), hint) : options,
      el("div", { class: "test-buttons" },
        el("button", { class: "btn", type: "button", disabled: index === 0, onclick: () => go(index - 1) }, "← Previous"),
        el("button", { class: "btn btn-ghost", type: "button", onclick: () => {
          response.selected = null;
          chosen.clear();
          if (input) {
            input.value = "";
            hint.textContent = "";
          }
          card.querySelectorAll(".option").forEach((node) => { node.classList.remove("selected"); node.setAttribute("aria-checked", "false"); });
          changed(id);
          focusAnswer(input);
        } }, "Clear response"),
        el("button", { class: "btn btn-review", type: "button", onclick: () => {
          response.marked = !response.marked;
          changed(id);
          if (response.marked && index < ids.length - 1) {
            go(index + 1);
          } else {
            show();
          }
        } }, response.marked ? "Unmark review" : "Mark for review & next"),
        el("button", { class: "btn btn-primary", type: "button", onclick: () => (index < ids.length - 1 ? go(index + 1) : confirmSubmit()) },
          index < ids.length - 1 ? "Save & next →" : "Save & finish")));
    answerInput = input;
    focusAnswer(input);
  }

  function confirmSubmit() {
    const left = ids.filter((id) => !answered(id)).length;
    const marked = ids.filter((id) => responses[id].marked).length;
    const submitNow = el("button", { class: "btn btn-primary", type: "button", onclick: () => submit(false) }, "Submit now");
    replace(submitArea, el("div", { class: "banner warn submit-confirm", role: "alertdialog", "aria-label": "Submit the test?" },
      el("p", {}, el("strong", { text: "Submit the test?" }),
        ` ${ids.length - left} of ${ids.length} answered${left ? `, ${left} not answered` : ""}${marked ? `, ${marked} marked for review` : ""}. `
        + "You cannot change answers after this."),
      el("div", { class: "actions" }, submitNow, el("button", { class: "btn", type: "button", onclick: () => replace(submitArea) }, "Keep going"))));
    submitNow.focus();
  }

  async function submit(timeUp) {
    if (ended) {
      return;
    }
    ended = true;
    clearInterval(tick);
    clearTimeout(saveTimer);
    document.removeEventListener("keydown", onKey);
    responses[ids[index]].time_ms += Date.now() - shownAt;
    replace(submitArea, el("div", { class: "banner", role: "status" }, loading(timeUp ? "Time is up: submitting your answers…" : "Submitting…")));
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        onSubmitted(await api.submitTest(test.id, responses), timeUp);
        return;
      } catch (error) {
        if (attempt === 2) {
          ended = false;
          replace(submitArea, errorBanner(error, app.reconnect), el("button", { class: "btn btn-primary", type: "button", onclick: () => submit(timeUp) }, "Try again"));
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
  }

  function updateClock() {
    if (deadline === null) {
      timer.textContent = "No time limit";
      return;
    }
    const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    const hours = Math.floor(left / 3600);
    timer.textContent = `${hours ? `${hours}:${String(Math.floor((left % 3600) / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}` : clock(left)} left`;
    timer.classList.toggle("low", left <= 300);
    if (left === 0) {
      submit(true);
    }
  }

  function onKey(event) {
    const target = event.target;
    if (event.altKey || event.ctrlKey || event.metaKey || (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) {
      return;
    }
    // after a click elsewhere on a NAT question, a typed number still goes into its answer box (the key carries on there)
    if (answerInput && ANSWER_KEY.test(event.key) && focusAnswer(answerInput, true)) {
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault(); // else the key carries on into a NAT answer box the new question focuses
      go(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(index - 1);
    }
  }

  view.append(el("section", { class: "test-run" },
    el("header", { class: "test-head" },
      el("div", {}, el("h1", { text: testTitle(test) }), saved),
      el("div", { class: "test-stats" }, timer, el("button", { class: "btn btn-primary", type: "button", onclick: () => confirmSubmit() }, "Submit test"))),
    submitArea,
    el("div", { class: "run-body" }, card,
      el("aside", { class: "palette-wrap", "aria-label": "Questions" }, el("h2", { text: "Questions" }), palette, counts,
        el("p", { class: "legend muted" },
          el("span", { class: "dot answered" }), " answered ", el("span", { class: "dot not-answered" }), " not answered ",
          el("span", { class: "dot not-visited" }), " not visited ", el("span", { class: "dot marked" }), " marked for review")))));
  updateClock();
  tick = setInterval(updateClock, 1000);
  document.addEventListener("keydown", onKey);
  show();
  return () => {
    clearInterval(tick);
    document.removeEventListener("keydown", onKey);
    if (!ended) {
      leaveQuestion();
      flush();
    }
  };
}

function resultView(view, test, app, timeUp) {
  const result = test.result;
  const config = test.config || {};
  const wrongOrSkipped = result.questions.filter((entry) => entry.status === "wrong" || entry.status === "unanswered").map((entry) => entry.id);
  const allocation = config.allocation;
  append(view, [
    el("div", { class: "page-head" }, el("div", {}, el("a", { class: "back", href: hash("tests", { exam: test.exam }) }, "← Tests"),
      el("h1", { text: testTitle(test) }))),
    timeUp ? el("div", { class: "banner warn", role: "status" }, el("p", { text: "Time was up, so your answers were submitted." })) : null,
    result.removed ? el("div", { class: "banner info", role: "status" }, el("p", {
      text: `${result.removed} of this test's questions ${result.removed === 1 ? "was" : "were"} removed afterwards, with the questions you added and then `
        + `removed; the marks are for the ${result.questions.length} left.` })) : null,
    el("section", { class: "card" }, el("div", { class: "tiles" },
      el("div", { class: "tile" }, el("span", { class: "tile-value", text: `${result.score} / ${result.max_score}` }), el("span", { text: "marks" })),
      el("div", { class: "tile" }, el("span", { class: "tile-value", text: String(result.correct) }), el("span", { text: "correct" })),
      el("div", { class: "tile" }, el("span", { class: "tile-value", text: String(result.wrong) }), el("span", { text: "wrong" })),
      el("div", { class: "tile" }, el("span", { class: "tile-value", text: String(result.unanswered) }), el("span", { text: "not answered" })),
      el("div", { class: "tile" }, el("span", { class: "tile-value", text: percent(result.accuracy) }), el("span", { text: "accuracy" })),
      el("div", { class: "tile" }, el("span", { class: "tile-value", text: clock(Math.round(result.time_spent_ms / 1000)) }), el("span", { text: "time on questions" }))),
    el("div", { class: "actions" },
      wrongOrSkipped.length ? el("a", { class: "btn btn-primary", href: hash("run", { ids: wrongOrSkipped.slice(0, 100).join(","), title: "Test mistakes and skipped" }) },
        `Practise the ${wrongOrSkipped.length} wrong or skipped`) : null,
      el("a", { class: "btn", href: hash(`tests/${test.kind}`, { exam: test.exam }) }, "Another test like this"),
      el("a", { class: "btn btn-ghost", href: "#/notebook" }, "Error notebook"))),
    el("section", { class: "card" }, el("h2", { text: "By subject" }), el("div", { class: "table-wrap" }, el("table", { class: "data" },
      el("thead", {}, el("tr", {}, ["Subject", "Marks", "Of", "Correct", "Wrong", "Not answered"].map((name) => el("th", { scope: "col", text: name })))),
      el("tbody", {}, result.by_subject.map((entry) => el("tr", {},
        el("th", { scope: "row", text: entry.subject }), el("td", { class: "num", text: String(entry.score) }), el("td", { class: "num", text: String(entry.max) }),
        el("td", { class: "num", text: String(entry.correct) }), el("td", { class: "num", text: String(entry.wrong) }),
        el("td", { class: "num", text: String(entry.unanswered) }))))))),
    allocation ? el("details", { class: "card" }, el("summary", { text: `GATE weightage of this mock (${config.years ? `${config.years[0]}–${config.years[1]} papers` : "past papers"})` }),
      el("div", { class: "table-wrap" }, el("table", { class: "data" },
        el("thead", {}, el("tr", {}, ["Subject", "Marks in this mock", "GATE average"].map((name) => el("th", { scope: "col", text: name })))),
        el("tbody", {}, allocation.subjects.map((entry) => el("tr", {}, el("th", { scope: "row", text: entry.subject }),
          el("td", { class: "num", text: String(entry.marks) }), el("td", { class: "num", text: String(entry.target) }))))))) : null,
    el("section", { class: "card" }, el("h2", { text: "Questions" }),
      el("ol", { class: "result-list" }, result.questions.map((entry, i) => reviewItem({
        id: entry.id, number: `Q${i + 1}`, status: entry.status, selected: entry.selected, attemptId: entry.attempt_id,
        extras: [
          el("span", { class: "result-marks", text: entry.awarded > 0 ? `+${entry.awarded}` : entry.awarded < 0 ? `${Number(entry.awarded).toFixed(2)}` : "0" }),
          el("span", { class: "muted small", text: entry.subject || "" }),
          entry.marked ? el("span", { class: "chip", text: "marked for review" }) : null],
      }, { app }))))]);
}

export async function renderTest(view, { args, app }) {
  const id = args[0];
  view.appendChild(loading());
  let test;
  try {
    test = await api.test(id);
  } catch (error) {
    view.replaceChildren(error.status === 404 ? emptyState("There is no such test.", el("a", { class: "btn", href: "#/tests" }, "Tests")) : errorBanner(error, app.reconnect));
    return null;
  }
  if (!view.isConnected) {
    return null;
  }
  view.replaceChildren();
  let cleanup = null;
  const showResult = (submitted, timeUp) => {
    if (cleanup) {
      cleanup = null;
    }
    view.replaceChildren();
    window.scrollTo(0, 0);
    resultView(view, submitted, app, timeUp);
  };
  if (test.state === "submitted") {
    resultView(view, test, app, false);
    return null;
  }
  const run = (current) => {
    view.replaceChildren();
    cleanup = runner(view, current, app, showResult);
  };
  if (test.state === "new") {
    intro(view, test, app, run);
  } else {
    run(test);
  }
  return () => {
    if (cleanup) {
      cleanup();
    }
  };
}
