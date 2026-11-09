// Tests (CP40D): build a topic test, a subject test or a full mock (GATE weightage), choose the time, and see your tests.
// Questions come from the PYQs and your mock questions; a test is taken in GATE style on #/test/<id>.
import { api } from "../api.js";
import { el, emptyState, errorBanner, examLabel, hash, loading, replace, when } from "../ui.js";

export const KIND_NAMES = { topics: "Topic test", subjects: "Subject test", full: "Full mock test" };
const COUNTS = [10, 20, 30, 50, 65];
const PRESETS = [15, 30, 60, 90, 120, 180];

export function testTitle(test) {
  const config = test.config || {};
  const what = test.kind === "topics" ? (config.topics || []).map((topic) => topic.name)
    : test.kind === "subjects" ? config.subjects || [] : [];
  const detail = what.length > 3 ? `${what.slice(0, 3).join(", ")} and ${what.length - 3} more` : what.join(", ");
  return `${KIND_NAMES[test.kind] || "Test"} · ${examLabel(test.exam)}${detail ? ` · ${detail}` : ""}`;
}

function pickExam(app, params) {
  const wanted = params.get("exam") || app.settings.default_exam;
  return app.exams.find((exam) => exam.exam === wanted) || app.exams[0];
}

function examSwitch(app, exam, kind) {
  if (app.exams.length < 2) {
    return null;
  }
  const picker = el("select", { "aria-label": "Exam" },
    app.exams.map((entry) => el("option", { value: entry.exam, text: examLabel(entry.exam), selected: entry.exam === exam.exam })));
  picker.addEventListener("change", () => {
    location.hash = hash(`tests${kind ? `/${kind}` : ""}`, { exam: picker.value });
  });
  return el("label", { class: "field inline" }, el("span", { text: "Exam" }), picker);
}

// The options every test shares: how many questions, from which bank, how long, and unanswered first
function optionsPanel(kind, defaults) {
  const count = el("select", { name: "count", "aria-label": "Number of questions" },
    COUNTS.map((n) => el("option", { value: String(n), text: `${n} questions`, selected: n === 20 })),
    el("option", { value: "custom", text: "Custom number" }));
  const customCount = el("input", { type: "number", min: "1", max: "100", value: "25", hidden: true, "aria-label": "Custom number of questions" });
  count.addEventListener("change", () => {
    customCount.hidden = count.value !== "custom";
  });
  const pyq = el("input", { type: "checkbox", checked: true });
  const mock = el("input", { type: "checkbox", checked: true });
  const timeChoice = el("select", { "aria-label": "Time" },
    el("option", { value: "suggested", text: kind === "full" ? `${defaults.minutes} minutes (as in GATE)` : "Suggested: 1.8 minutes per mark, as in GATE",
      selected: true }),
    PRESETS.filter((minutes) => kind !== "full" || minutes !== defaults.minutes).map((minutes) => el("option", { value: String(minutes), text: `${minutes} minutes` })),
    el("option", { value: "custom", text: "Custom minutes" }),
    el("option", { value: "none", text: "No time limit" }));
  const customTime = el("input", { type: "number", min: "1", max: "600", value: "45", hidden: true, "aria-label": "Custom minutes" });
  timeChoice.addEventListener("change", () => {
    customTime.hidden = timeChoice.value !== "custom";
  });
  const unseen = el("input", { type: "checkbox", checked: true });
  const panel = el("fieldset", { class: "card test-options" }, el("legend", { text: "Test settings" }),
    kind === "full" ? null : el("div", { class: "option-row" }, el("span", { class: "option-name", text: "Questions" }), count, customCount),
    el("div", { class: "option-row" }, el("span", { class: "option-name", text: "From" }),
      el("label", { class: "check" }, pyq, "Previous year questions"), el("label", { class: "check" }, mock, "Mock questions")),
    el("div", { class: "option-row" }, el("span", { class: "option-name", text: "Time" }), timeChoice, customTime),
    el("div", { class: "option-row" }, el("span", { class: "option-name", text: "" }),
      el("label", { class: "check" }, unseen, "Questions I have not answered yet come first")));
  panel.read = () => {
    const body = { origins: [pyq.checked && "pyq", mock.checked && "mock"].filter(Boolean), prefer_unseen: unseen.checked };
    if (kind !== "full") {
      body.count = count.value === "custom" ? Number(customCount.value) : Number(count.value);
    }
    if (timeChoice.value === "none") {
      body.minutes = null;
    } else if (timeChoice.value === "custom") {
      body.minutes = Number(customTime.value);
    } else if (timeChoice.value !== "suggested") {
      body.minutes = Number(timeChoice.value);
    } else if (kind === "full") {
      body.minutes = defaults.minutes;
    }
    return body;
  };
  return panel;
}

function startButton(app, exam, kind, panel, chosen, status) {
  const button = el("button", { class: "btn btn-primary btn-large", type: "button" }, "Start the test");
  button.addEventListener("click", async () => {
    const body = { exam: exam.exam, kind, ...panel.read(), ...chosen() };
    if (!body.origins.length) {
      status.textContent = "Choose previous year questions, mock questions, or both.";
      return;
    }
    if (kind !== "full" && !(body.count >= 1 && body.count <= 100)) {
      status.textContent = "The number of questions must be 1 to 100.";
      return;
    }
    if (body.minutes !== undefined && body.minutes !== null && !(body.minutes >= 1 && body.minutes <= 600)) {
      status.textContent = "The time must be 1 to 600 minutes.";
      return;
    }
    if ((kind === "topics" && !body.topics.length) || (kind === "subjects" && !body.subjects.length)) {
      status.textContent = kind === "topics" ? "Choose at least one topic." : "Choose at least one subject.";
      return;
    }
    button.disabled = true;
    status.textContent = "Picking the questions…";
    try {
      const test = await api.createTest(body);
      location.hash = `#/test/${test.id}`;
    } catch (error) {
      status.textContent = error.message;
      button.disabled = false;
    }
  });
  return button;
}

async function topicBuilder(view, app, exam) {
  const body = el("div", {}, loading("Loading topics…"));
  view.appendChild(body);
  let data;
  try {
    data = await api.examTopics(exam.exam);
  } catch (error) {
    body.replaceChildren(errorBanner(error, app.reconnect));
    return;
  }
  if (!view.isConnected) {
    return;
  }
  const chosen = new Map();
  const tally = el("strong", { role: "status" });
  const finder = el("input", { type: "search", placeholder: "Find a topic, for example: stack, eigen, TCP", "aria-label": "Find a topic", autocomplete: "off" });
  const sync = () => {
    const total = [...chosen.values()].reduce((sum, topic) => sum + topic.count, 0);
    tally.textContent = chosen.size ? `${chosen.size} topic${chosen.size === 1 ? "" : "s"} chosen (${total} questions)` : "No topic chosen yet";
  };
  const cards = data.subjects.map((subject) => {
    const boxes = [];
    const all = el("input", { type: "checkbox", "aria-label": `All topics of ${subject.subject}` });
    const groups = new Map();
    subject.topics.forEach((topic) => {
      if (!groups.has(topic.group || "")) {
        groups.set(topic.group || "", []);
      }
      groups.get(topic.group || "").push(topic);
    });
    const card = el("section", { class: "card topic-pick" },
      el("div", { class: "card-head" }, el("h2", { text: subject.subject }), el("label", { class: "check small" }, all, "All")),
      [...groups.entries()].map(([group, topics]) => el("div", { class: "topic-group" },
        group ? el("h3", { class: "group-name", text: group }) : null,
        el("ul", { class: "pick-grid" }, topics.map((topic) => {
          const box = el("input", { type: "checkbox", value: topic.id, disabled: !topic.count });
          boxes.push(box);
          box.addEventListener("change", () => {
            if (box.checked) {
              chosen.set(topic.id, topic);
            } else {
              chosen.delete(topic.id);
            }
            all.checked = boxes.filter((item) => !item.disabled).every((item) => item.checked);
            sync();
          });
          return el("li", { dataset: { find: `${topic.name} ${group} ${subject.subject}`.toLowerCase() } },
            el("label", { class: topic.count ? "pick" : "pick empty" }, box, el("span", { text: topic.name }), el("span", { class: "count", text: String(topic.count) })));
        })))));
    all.addEventListener("change", () => {
      boxes.filter((box) => !box.disabled).forEach((box) => {
        box.checked = all.checked;
        box.dispatchEvent(new Event("change"));
      });
    });
    return card;
  });
  finder.addEventListener("input", () => {
    const words = finder.value.trim().toLowerCase();
    cards.forEach((card) => {
      let shown = 0;
      card.querySelectorAll("li").forEach((item) => {
        item.hidden = Boolean(words) && !item.dataset.find.includes(words);
        shown += item.hidden ? 0 : 1;
      });
      card.querySelectorAll(".topic-group").forEach((group) => {
        group.hidden = ![...group.querySelectorAll("li")].some((item) => !item.hidden);
      });
      card.hidden = !shown;
    });
  });
  const panel = optionsPanel("topics", {});
  const status = el("p", { class: "muted", role: "status" });
  replace(body,
    el("div", { class: "sticky-bar" }, tally, startButton(app, exam, "topics", panel, () => ({ topics: [...chosen.keys()] }), status), status),
    panel,
    el("div", { class: "topic-tools" }, finder),
    cards);
  sync();
}

function subjectBuilder(view, app, exam) {
  const subjects = Object.entries(exam.subjects || {}).filter(([subject]) => subject !== "(none)");
  const chosen = new Set();
  const tally = el("strong", { role: "status" });
  const sync = () => {
    const total = subjects.filter(([subject]) => chosen.has(subject)).reduce((sum, [, count]) => sum + count, 0);
    tally.textContent = chosen.size ? `${chosen.size} subject${chosen.size === 1 ? "" : "s"} chosen (${total} questions)` : "No subject chosen yet";
  };
  const boxes = subjects.map(([subject, count]) => {
    const box = el("input", { type: "checkbox", value: subject });
    box.addEventListener("change", () => {
      if (box.checked) {
        chosen.add(subject);
      } else {
        chosen.delete(subject);
      }
      sync();
    });
    return el("li", {}, el("label", { class: "pick" }, box, el("span", { text: subject }), el("span", { class: "count", text: String(count) })));
  });
  const all = el("input", { type: "checkbox" });
  all.addEventListener("change", () => {
    view.querySelectorAll(".subject-pick input").forEach((box) => {
      box.checked = all.checked;
      box.dispatchEvent(new Event("change"));
    });
  });
  const panel = optionsPanel("subjects", {});
  const status = el("p", { class: "muted", role: "status" });
  view.append(
    el("div", { class: "sticky-bar" }, tally, startButton(app, exam, "subjects", panel, () => ({ subjects: [...chosen] }), status), status),
    panel,
    el("section", { class: "card" },
      el("div", { class: "card-head" }, el("h2", { text: "Subjects" }), el("label", { class: "check small" }, all, "All")),
      el("p", { class: "muted small", text: "Questions are spread evenly over the subjects you choose." }),
      el("ul", { class: "pick-grid subject-pick" }, boxes)));
  sync();
}

async function fullBuilder(view, app, exam) {
  const body = el("div", {}, loading("Working out the GATE weightage…"));
  view.appendChild(body);
  let plan;
  try {
    plan = await api.blueprint(exam.exam, ["pyq", "mock"]);
  } catch (error) {
    body.replaceChildren(errorBanner(error, app.reconnect));
    return;
  }
  if (!view.isConnected) {
    return;
  }
  if (!plan.available) {
    replace(body, emptyState(`A full mock cannot be made yet: ${plan.reason}.`));
    return;
  }
  const example = Object.fromEntries(plan.example.subjects.map((entry) => [entry.subject, entry]));
  const panel = optionsPanel("full", { minutes: plan.minutes });
  const status = el("p", { class: "muted", role: "status" });
  replace(body,
    el("section", { class: "card" },
      el("h2", { text: `${plan.questions} questions · ${plan.marks} marks · ${plan.minutes} minutes` }),
      el("p", { text: `Subjects get the marks they had in the GATE papers of ${plan.years[0]}–${plan.years[1]} (${plan.papers.length} papers), `
        + `each within ${plan.tolerance} marks (never more than ${plan.max_tolerance}). Every mock draws new questions, unanswered ones first, `
        + "spread over each subject's topics. General Aptitude comes first, as in GATE." }),
      el("div", { class: "table-wrap" }, el("table", { class: "data" },
        el("thead", {}, el("tr", {}, ["Subject", "GATE marks (average)", "1-mark", "2-mark", "In the bank"].map((name) => el("th", { scope: "col", text: name })))),
        el("tbody", {}, plan.subjects.map((entry) => el("tr", {},
          el("th", { scope: "row", text: entry.subject }),
          el("td", { class: "num", text: String(entry.target) }),
          el("td", { class: "num", text: String((example[entry.subject] || {}).one ?? "") }),
          el("td", { class: "num", text: String((example[entry.subject] || {}).two ?? "") }),
          el("td", { class: "num", text: `${entry.available[1] || 0} + ${entry.available[2] || 0}` }))))))),
    panel,
    el("div", { class: "actions" }, startButton(app, exam, "full", panel, () => ({}), status), status));
}

async function home(view, app, exam) {
  const kinds = [
    ["topics", "Topic test", "Choose topics, as on Topic wise; questions are spread evenly over them."],
    ["subjects", "Subject test", "Choose subjects; random questions from them, spread evenly."],
    ["full", "Full mock test", "65 questions, 100 marks, 3 hours, with GATE's subject weightage."],
  ];
  view.append(
    el("div", { class: "grid" }, kinds.map(([kind, title, text]) => el("a", { class: "card exam-card", href: hash(`tests/${kind}`, { exam: exam.exam }) },
      el("h2", { text: title }), el("p", { class: "muted", text })))),
    el("p", { class: "muted small", text: "Tests run as in GATE: answers stay hidden until you submit, the clock counts down and submits at zero, "
      + "and a wrong MCQ loses a third of its marks (MSQ and NAT lose nothing). Your answers count in history and analytics." }));
  const list = el("section", { class: "card" }, el("h2", { text: "Your tests" }), loading());
  view.appendChild(list);
  let tests;
  try {
    tests = await api.tests();
  } catch (error) {
    list.replaceChildren(el("h2", { text: "Your tests" }), errorBanner(error, app.reconnect));
    return;
  }
  if (!tests.length) {
    replace(list, el("h2", { text: "Your tests" }), el("p", { class: "muted", text: "No tests yet." }));
    return;
  }
  replace(list, el("h2", { text: "Your tests" }), el("div", { class: "table-wrap" }, el("table", { class: "data" },
    el("thead", {}, el("tr", {}, ["Test", "Questions", "Time", "Created", "Result", ""].map((name) => el("th", { scope: "col", text: name })))),
    el("tbody", {}, tests.map((test) => {
      const remove = el("button", { class: "btn btn-ghost btn-small", type: "button" }, "Delete");
      let armed = null;
      remove.addEventListener("click", async () => {
        if (!armed) {
          remove.textContent = "Delete? Click again";
          armed = setTimeout(() => { armed = null; remove.textContent = "Delete"; }, 4000);
          return;
        }
        clearTimeout(armed);
        await api.deleteTest(test.id).catch(() => {});
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      });
      const result = test.state === "submitted" ? `${test.score} / ${test.max_score}` : { new: "Not started", running: "In progress", time_up: "Time up, not submitted" }[test.state];
      return el("tr", {},
        el("th", { scope: "row" }, el("a", { href: `#/test/${test.id}` }, testTitle(test))),
        el("td", { class: "num", text: String(test.question_count) }),
        el("td", { class: "num", text: test.minutes ? `${test.minutes} min` : "No limit" }),
        el("td", { text: when(test.created_at) }),
        el("td", { text: result }),
        el("td", { class: "row-links" }, el("a", { href: `#/test/${test.id}` }, test.state === "submitted" ? "Result" : test.state === "new" ? "Start" : "Resume"), remove));
    })))));
}

export async function renderTests(view, { args, params, app }) {
  const kind = ["topics", "subjects", "full"].includes(args[0]) ? args[0] : "";
  const exam = pickExam(app, params);
  if (!exam) {
    view.appendChild(emptyState("The worker has no question index yet."));
    return;
  }
  view.append(el("div", { class: "page-head" },
    el("div", {}, kind ? el("a", { class: "back", href: hash("tests", { exam: exam.exam }) }, "← Tests") : null,
      el("h1", { text: kind ? `${KIND_NAMES[kind]} · ${examLabel(exam.exam)}` : "Tests" })),
    examSwitch(app, exam, kind)));
  if (kind === "topics") {
    await topicBuilder(view, app, exam);
  } else if (kind === "subjects") {
    subjectBuilder(view, app, exam);
  } else if (kind === "full") {
    await fullBuilder(view, app, exam);
  } else {
    await home(view, app, exam);
  }
}
