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
        el("th", { scope: "row" }, practice && key !== "(none)" ? el("a", { href: practice(key, value) }, label(key)) : label(key)),
        el("td", { class: "num", text: String(value.attempts) }),
        el("td", { class: "num", text: String(value.questions) }),
        el("td", { class: "num", text: percent(value.accuracy) }),
        el("td", { class: "bar-cell" }, bar(value.accuracy, value.accuracy !== null && value.accuracy < 0.5 ? "low" : ""))))))));
}

function topicHref(entry, extra) {
  return hash("run", { exam: entry.exam, topic: entry.topic_id, title: entry.name, from: "topics", ...(extra || {}) });
}

// by_topic per topic of the topic list (CP40B), keyed by a readable name; the exam is named when there are several
function topicGroups(stats, exam) {
  return Object.fromEntries((stats.by_topic || []).map((entry) =>
    [`${exam ? "" : `${examName(entry.exam)} · `}${entry.subject} › ${entry.name}`, entry]));
}

function mistakeReasons(summary, exam) {
  if (!summary || !summary.entries) {
    return null;
  }
  const most = Math.max(1, ...summary.overall.map((row) => row.count));
  const link = (extra) => hash("notebook", { exam, ...extra });
  return el("section", { class: "card" }, el("h2", { text: "Why answers went wrong" }),
    el("p", { class: "muted", text: `From your error notebook: ${summary.entries} entr${summary.entries === 1 ? "y" : "ies"}, ${summary.open} not resolved yet.` }),
    summary.overall.length ? el("ul", { class: "reason-bars" }, summary.overall.map((row) => el("li", {},
      el("a", { href: link({ reason: row.reason }), text: row.label }), bar(row.count / most), el("span", { class: "count", text: String(row.count) })))) : null,
    Object.keys(summary.by_subject).length ? el("div", { class: "table-wrap" }, el("table", { class: "data" },
      el("thead", {}, el("tr", {}, ["Subject", "Most frequent reasons"].map((name) => el("th", { scope: "col", text: name })))),
      el("tbody", {}, Object.entries(summary.by_subject).map(([subject, rows]) => el("tr", {},
        el("th", { scope: "row" }, subject === "(none)" ? subject : el("a", { href: link({ subject }) }, subject)),
        el("td", { text: rows.slice(0, 3).map((row) => `${row.label} (${row.count})`).join(", ") })))))) : null,
    el("p", {}, el("a", { href: link({}) }, "Open the error notebook")));
}

function overview(body, stats, exam) {
  if (!stats.attempts) {
    body.appendChild(emptyState("No answers yet. Practise some questions and your results appear here.", el("a", { class: "btn btn-primary", href: "#/practice" }, "Practice")));
    append(body, [mistakeReasons(stats.mistake_reasons, exam)]);
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
    groupTable("By topic", topicGroups(stats, exam), (key) => key, (key, entry) => topicHref(entry)),
    groupTable("By year", stats.by_year, (key) => key, exam ? practice("year") : null),
    groupTable("By question type", stats.by_question_type, (key) => TYPE_NAMES[key] || key, exam ? practice("type") : null),
    mistakeReasons(stats.mistake_reasons, exam)]);
}

function weakTopics(body, stats, exam) {
  const subjects = Object.entries(stats.by_subject || {})
    .filter(([subject, value]) => subject !== "(none)" && value.attempts >= MIN_ATTEMPTS && value.accuracy !== null)
    .map(([subject, value]) => ({ label: subject, href: (extra) => hash("run", { exam, subject, ...(extra || {}) }), ...value }));
  const topics = Object.entries(topicGroups(stats, exam))
    .filter(([, value]) => value.attempts >= MIN_ATTEMPTS && value.accuracy !== null)
    .map(([label, value]) => ({ label, href: (extra) => topicHref(value, extra), ...value }));
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
        el("strong", { text: entry.label }),
        el("span", { class: "muted", text: `${percent(entry.accuracy)} of ${entry.attempts} answers` })),
      bar(entry.accuracy, entry.accuracy < 0.5 ? "low" : ""),
      el("div", { class: "actions" },
        el("a", { class: "btn", href: entry.href() }, "Practise"),
        el("a", { class: "btn btn-ghost", href: entry.href({ random: 10 }) }, "10 random")))))));
}

async function progress(body, stats, examInfo) {
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
  // Topics (CP40B): per subject, how many questions of each topic you have answered
  const topics = await api.examTopics(examInfo.exam);
  if (!topics.subjects.length || !body.isConnected) {
    return;
  }
  const mine = new Map((stats.by_topic || []).map((entry) => [entry.topic_id, entry]));
  body.appendChild(el("section", { class: "card" }, el("h2", { text: "Topics" }),
    el("p", { class: "muted", text: "Questions answered per topic. A question with two topics counts for both." }),
    topics.subjects.map((subject) => el("details", { class: "topic-progress" },
      el("summary", {}, subject.subject,
        el("span", { class: "muted small", text: `${subject.topics.filter((topic) => (mine.get(topic.id) || {}).questions).length} of ${subject.topics.length} topics started` })),
      el("div", { class: "table-wrap" }, el("table", { class: "data" },
        el("thead", {}, el("tr", {}, ["", "Answered", "Of", "Accuracy", ""].map((name) => el("th", { scope: "col", text: name })))),
        el("tbody", {}, subject.topics.map((topic) => {
          const entry = mine.get(topic.id) || {};
          const count = entry.questions || 0;
          return el("tr", {},
            el("th", { scope: "row" }, topic.count
              ? el("a", { href: hash("run", { exam: examInfo.exam, topic: topic.id, title: topic.name, from: "topics" }) }, topic.name)
              : topic.name),
            el("td", { class: "num", text: String(count) }),
            el("td", { class: "num", text: String(topic.count) }),
            el("td", { class: "num", text: percent(entry.accuracy ?? null) }),
            el("td", { class: "bar-cell" }, bar(topic.count ? count / topic.count : 0)));
        }))))))));
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
      await progress(body, stats, app.exams.find((entry) => entry.exam === exam));
    } else {
      overview(body, stats, exam);
    }
  } catch (error) {
    body.replaceChildren(errorBanner(error, app.reconnect));
  }
}
