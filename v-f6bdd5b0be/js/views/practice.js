// Practice chooser (CP31): pick an exam, then a paper, a subject, a year, a question type, or random questions.
import { browseHref, el, emptyState, examName, hash, papersByYear, TYPE_LABELS, TYPE_NAMES } from "../ui.js";

function examCard(exam) {
  const years = Object.keys(exam.years || {});
  return el("a", { class: "card exam-card", href: `#/practice/${encodeURIComponent(exam.exam)}` },
    el("h2", { text: examName(exam.exam) }),
    el("p", { class: "muted", text: `${exam.question_count} questions · ${years[0]}–${years[years.length - 1]}` }),
    el("p", { class: "muted small", text: `Dataset version ${exam.dataset_version}` }));
}

function section(title, description, body) {
  return el("section", { class: "card" }, el("h2", { text: title }), description ? el("p", { class: "muted", text: description }) : null, body);
}

function linkGrid(entries) {
  return el("ul", { class: "link-grid" }, entries.map(([href, text, count]) =>
    el("li", {}, el("a", { href }, el("span", { text }), count !== undefined ? el("span", { class: "count", text: String(count) }) : null))));
}

export function renderPractice(view, { args, app }) {
  const examId = args[0] || (app.exams.length === 1 ? app.exams[0].exam : app.settings.default_exam);
  const exam = app.exams.find((entry) => entry.exam === examId);
  if (!exam) {
    view.appendChild(el("h1", { text: "Practice" }));
    view.appendChild(app.exams.length
      ? el("div", { class: "grid" }, app.exams.map(examCard))
      : emptyState("The worker has no question index yet. Run: qbank index rebuild"));
    return;
  }
  const base = { exam: exam.exam };
  const byYear = new Map([...papersByYear(exam).entries()].map(([year, papers]) =>
    [year, papers.map(({ paper, label, count }) => [hash("run", { ...base, paper }), label, count])]));
  const subjects = Object.entries(exam.subjects || {}).filter(([subject]) => subject !== "(none)");
  const randomForm = el("form", { class: "inline-form" },
    el("label", { class: "field" }, el("span", { text: "Questions" }),
      el("select", { name: "count" }, [10, 20, 30, 50].map((n) => el("option", { value: String(n), text: String(n) })))),
    el("label", { class: "field" }, el("span", { text: "Subject" }),
      el("select", { name: "subject" }, el("option", { value: "", text: "Any subject" }), subjects.map(([subject]) => el("option", { value: subject, text: subject })))),
    el("label", { class: "field" }, el("span", { text: "Type" }),
      el("select", { name: "type" }, el("option", { value: "", text: "Any type" }),
        Object.keys(exam.question_types || {}).map((type) => el("option", { value: type, text: TYPE_NAMES[type] || type })))),
    el("button", { class: "btn btn-primary", type: "submit" }, "Start"));
  randomForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(randomForm);
    location.hash = hash("run", { ...base, random: data.get("count"), subject: data.get("subject"), type: data.get("type") });
  });

  view.append(
    el("div", { class: "page-head" },
      el("div", {}, app.exams.length > 1 ? el("a", { href: "#/practice", class: "back" }, "← All exams") : null, el("h1", { text: examName(exam.exam) })),
      el("p", { class: "muted", text: `${exam.question_count} questions, dataset version ${exam.dataset_version}` })),
    section("Random practice", "A fresh mix each time.", randomForm),
    section("Browse", exam.classified ? `Topic wise sorts ${exam.classified} questions into fine topics, for example Stacks, Eigenvalues or TCP.` : null,
      el("div", { class: "actions" },
        el("a", { class: "btn btn-primary", href: browseHref(exam.exam, "topics") }, "Topic wise"),
        el("a", { class: "btn", href: browseHref(exam.exam, "subjects") }, "Subject wise"),
        el("a", { class: "btn", href: browseHref(exam.exam, "years") }, "Year wise"))),
    section("Previous year papers", "Every question of a paper, in order.",
      el("div", { class: "years" }, [...byYear.entries()].reverse().map(([year, entries]) =>
        el("div", { class: "year-row" }, el("span", { class: "year", text: year }), linkGrid(entries))))),
    section("By subject", null, linkGrid(subjects.map(([subject, count]) => [hash("run", { ...base, subject }), subject, count]))),
    section("By year", "All papers of a year together.", linkGrid(Object.entries(exam.years || {}).reverse()
      .map(([year, count]) => [hash("run", { ...base, year }), year, count]))),
    section("By question type", null, linkGrid(Object.entries(exam.question_types || {})
      .map(([type, count]) => [hash("run", { ...base, type }), `${TYPE_NAMES[type] || type} (${TYPE_LABELS[type] || type})`, count]))));
}
