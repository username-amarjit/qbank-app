// Analytics (CP32): overview, weak topics and exam progress, from your answers stored by the worker.
import { api } from "../api.js";
import { append, bar, duration, el, emptyState, errorBanner, examName, hash, loading, percent, tabs, TYPE_NAMES } from "../ui.js";

const MIN_ATTEMPTS = 3;
const SECTIONS = [["", "Overview"], ["weak", "Weak topics"], ["progress", "Exam progress"]];

function examPicker(app, exam, section) {
  if (app.exams.length < 2) {
    return null;
  }
  const picker = el("select", { "aria-label": "Exam" },
    section === "progress" ? null : el("option", { value: "", text: "All exams", selected: !exam }),
    app.exams.map((entry) => el("option", { value: entry.exam, text: examName(entry.exam), selected: entry.exam === exam })));
  picker.addEventListener("change", () => {
    location.hash = hash(`analytics${section ? `/${section}` : ""}`, { exam: picker.value });
  });
  return el("label", { class: "field inline" }, el("span", { text: "Exam" }), picker);
}

function groupTable(title, groups, label, practice) {
  const rows = Object.entries(groups || {});
  if (!rows.length) {
    return null;
  }
  return el("section", { class: "card" }, el("h2", { text: title }),
    el("div", { class: "table-wrap" }, el("table", { class: "data" },
      el("thead", {}, el("tr", {}, ["", "Answers", "Questions", "Accuracy", ""].map((name) => el("th", { scope: "col", text: name })))),
      el("tbody", {}, rows.map(([key, value]) => el("tr", {},
        el("th", { scope: "row" }, practice && key !== "(none)" ? el("a", { href: practice(key) }, label(key)) : label(key)),
        el("td", { class: "num", text: String(value.attempts) }),
        el("td", { class: "num", text: String(value.questions) }),
        el("td", { class: "num", text: percent(value.accuracy) }),
        el("td", { class: "bar-cell" }, bar(value.accuracy, value.accuracy !== null && value.accuracy < 0.5 ? "low" : ""))))))));
}

function overview(body, stats, exam) {
  if (!stats.attempts) {
    body.appendChild(emptyState("No answers yet. Practise some questions and your results appear here.", el("a", { class: "btn btn-primary", href: "#/practice" }, "Practice")));
    return;
  }
  const practice = (field) => (value) => hash("run", { exam, [field]: value });
  append(body, [
    el("section", { class: "card" }, el("div", { class: "tiles" },
      el("div", { class: "tile" }, el("span", { class: "tile-value", text: String(stats.attempts) }), el("span", { text: "answers" })),
      el("div", { class: "tile" }, el("span", { class: "tile-value", text: String(stats.questions_attempted) }), el("span", { text: "different questions" })),
      el("div", { class: "tile" }, el("span", { class: "tile-value", text: percent(stats.accuracy) }), el("span", { text: "accuracy" })),
      el("div", { class: "tile" }, el("span", { class: "tile-value", text: duration(stats.time_spent_ms) }), el("span", { text: "time answering" })))),
    groupTable("By subject", stats.by_subject, (key) => key, exam ? practice("subject") : null),
    groupTable("By year", stats.by_year, (key) => key, exam ? practice("year") : null),
    groupTable("By question type", stats.by_question_type, (key) => TYPE_NAMES[key] || key, exam ? practice("type") : null)]);
}

function weakTopics(body, stats, exam) {
  const subjects = Object.entries(stats.by_subject || {})
    .filter(([subject, value]) => subject !== "(none)" && value.attempts >= MIN_ATTEMPTS && value.accuracy !== null)
    .map(([subject, value]) => ({ subject, topic: null, ...value }));
  const topics = (stats.by_topic || []).filter((value) => value.attempts >= MIN_ATTEMPTS && value.accuracy !== null);
  const weakest = [...topics, ...subjects].sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts).slice(0, 15);
  if (!weakest.length) {
    body.appendChild(emptyState(`Answer at least ${MIN_ATTEMPTS} questions in a subject to see how it compares.`,
      el("a", { class: "btn btn-primary", href: "#/practice" }, "Practice")));
    return;
  }
  body.appendChild(el("section", { class: "card" },
    el("p", { class: "muted", text: `Subjects and topics with at least ${MIN_ATTEMPTS} answers, lowest accuracy first.` }),
    el("ol", { class: "weak" }, weakest.map((entry) => el("li", {},
      el("div", { class: "weak-head" },
        el("strong", { text: entry.topic ? `${entry.subject} › ${entry.topic}` : entry.subject }),
        el("span", { class: "muted", text: `${percent(entry.accuracy)} of ${entry.attempts} answers` })),
      bar(entry.accuracy, entry.accuracy < 0.5 ? "low" : ""),
      el("div", { class: "actions" },
        el("a", { class: "btn", href: hash("run", { exam, subject: entry.subject, topic: entry.topic || "" }) }, "Practise"),
        el("a", { class: "btn btn-ghost", href: hash("run", { exam, subject: entry.subject, topic: entry.topic || "", random: 10 }) }, "10 random")))))));
}

function progress(body, stats, examInfo) {
  const answered = stats.questions_attempted;
  const subjects = Object.entries(examInfo.subjects || {}).filter(([subject]) => subject !== "(none)");
  const years = Object.entries(examInfo.years || {}).reverse();
  const done = (groups, key) => ((groups || {})[key] || {}).questions || 0;
  const table = (title, rows, groups, field) => el("section", { class: "card" }, el("h2", { text: title }),
    el("div", { class: "table-wrap" }, el("table", { class: "data" },
      el("thead", {}, el("tr", {}, ["", "Answered", "Of", "Accuracy", ""].map((name) => el("th", { scope: "col", text: name })))),
      el("tbody", {}, rows.map(([key, total]) => {
        const count = done(groups, key);
        return el("tr", {},
          el("th", { scope: "row" }, el("a", { href: hash("run", { exam: examInfo.exam, [field]: key }) }, key)),
          el("td", { class: "num", text: String(count) }),
          el("td", { class: "num", text: String(total) }),
          el("td", { class: "num", text: percent(((groups || {})[key] || {}).accuracy ?? null) }),
          el("td", { class: "bar-cell" }, bar(count / total)));
      })))));
  body.append(
    el("section", { class: "card" },
      el("h2", { text: examName(examInfo.exam) }),
      el("p", { text: `${answered} of ${examInfo.question_count} questions answered at least once (${percent(answered / examInfo.question_count, 1)}).` }),
      bar(answered / examInfo.question_count)),
    table("Subjects", subjects, stats.by_subject, "subject"),
    table("Years", years, stats.by_year, "year"));
}

export async function renderAnalytics(view, { args, params, app }) {
  const section = SECTIONS.some(([key]) => key === (args[0] || "")) ? args[0] || "" : "";
  let exam = params.get("exam") || "";
  if (section === "progress" && !app.exams.some((entry) => entry.exam === exam)) {
    exam = app.settings.default_exam && app.exams.some((entry) => entry.exam === app.settings.default_exam) ? app.settings.default_exam : (app.exams[0] || {}).exam;
  }
  const body = el("div", {}, loading());
  view.append(
    el("div", { class: "page-head" }, el("h1", { text: "Analytics" }), examPicker(app, exam, section)),
    tabs(SECTIONS.map(([key, text]) => [hash(`analytics${key ? `/${key}` : ""}`, { exam }), text, key]), section),
    body);
  if (section === "progress" && !exam) {
    body.replaceChildren(emptyState("The worker has no exams yet."));
    return;
  }
  try {
    const stats = await api.analytics(exam || undefined);
    body.replaceChildren();
    if (section === "weak") {
      weakTopics(body, stats, exam);
    } else if (section === "progress") {
      progress(body, stats, app.exams.find((entry) => entry.exam === exam));
    } else {
      overview(body, stats, exam);
    }
  } catch (error) {
    body.replaceChildren(errorBanner(error, app.reconnect));
  }
}
