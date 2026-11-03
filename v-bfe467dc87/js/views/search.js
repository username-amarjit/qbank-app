// Search (CP32): full-text search with filters; results open in the player, which then steps through them.
import { api } from "../api.js";
import { el, emptyState, errorBanner, hash, loading, pager, questionList, replace, TYPE_NAMES } from "../ui.js";

const PER_PAGE = 20;

export async function renderSearch(view, { params, app }) {
  const values = Object.fromEntries(["q", "exam", "subject", "year", "type"].map((key) => [key, params.get(key) || ""]));
  const page = Math.max(1, Number(params.get("page")) || 1);
  const exam = app.exams.find((entry) => entry.exam === values.exam);
  const subjects = exam ? Object.keys(exam.subjects || {}) : [...new Set(app.exams.flatMap((entry) => Object.keys(entry.subjects || {})))].sort();
  const years = exam ? Object.keys(exam.years || {}) : [...new Set(app.exams.flatMap((entry) => Object.keys(entry.years || {})))].sort();
  const types = [...new Set(app.exams.flatMap((entry) => Object.keys(entry.question_types || {})))];

  const form = el("form", { class: "search-form", role: "search" },
    el("label", { class: "field grow" }, el("span", { text: "Words to find" }),
      el("input", { type: "search", name: "q", value: values.q, placeholder: "for example: deadlock, eigenvalue, B+ tree", autocomplete: "off" })),
    el("label", { class: "field" }, el("span", { text: "Exam" }),
      el("select", { name: "exam" }, el("option", { value: "", text: "All exams" }),
        app.exams.map((entry) => el("option", { value: entry.exam, selected: entry.exam === values.exam, text: entry.exam.toUpperCase().replace("-", " ") })))),
    el("label", { class: "field" }, el("span", { text: "Subject" }),
      el("select", { name: "subject" }, el("option", { value: "", text: "Any subject" }),
        subjects.filter((subject) => subject !== "(none)").map((subject) => el("option", { value: subject, selected: subject === values.subject, text: subject })))),
    el("label", { class: "field" }, el("span", { text: "Year" }),
      el("select", { name: "year" }, el("option", { value: "", text: "Any year" }),
        years.slice().reverse().map((year) => el("option", { value: year, selected: year === values.year, text: year })))),
    el("label", { class: "field" }, el("span", { text: "Type" }),
      el("select", { name: "type" }, el("option", { value: "", text: "Any type" }),
        types.map((type) => el("option", { value: type, selected: type === values.type, text: TYPE_NAMES[type] || type })))),
    el("button", { class: "btn btn-primary", type: "submit" }, "Search"));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    location.hash = hash("search", Object.fromEntries([...data.entries()].map(([key, value]) => [key, String(value).trim()])));
  });
  form.elements.exam.addEventListener("change", () => form.requestSubmit());

  const results = el("div", { class: "results" });
  view.append(el("h1", { text: "Search" }), el("section", { class: "card" }, form), results);
  if (!values.q && !values.exam && !values.subject && !values.year && !values.type) {
    results.appendChild(emptyState("Type some words, or choose a filter, to find questions."));
    form.elements.q.focus();
    return;
  }
  results.appendChild(loading("Searching…"));
  try {
    const filters = { q: values.q, exam: values.exam, subject: values.subject, year: values.year, type: values.type };
    const found = await (values.q ? api.search : api.questions)({ ...filters, page, per_page: PER_PAGE });
    replace(results,
      el("p", { class: "muted", role: "status", text: `${found.total} question${found.total === 1 ? "" : "s"} found.` }),
      found.total ? el("a", { class: "btn", href: hash("run", filters) }, "Practise all of them") : null,
      questionList(found.items, (item) => hash("run", { ...filters, at: item.id })),
      pager(found.page, found.pages, (next) => {
        location.hash = hash("search", { ...filters, page: next });
      }));
  } catch (error) {
    results.replaceChildren(errorBanner(error, app.reconnect));
  }
}
