// Exam browser (CP40B): one exam's questions topic wise, subject wise or year wise, like the source site's exam menu.
// Topic wise uses the fine topics of each question (taxonomy/<exam>.json), with your own corrections included.
import { api } from "../api.js";
import {
  BROWSE_VIEWS, browseHref, el, emptyState, errorBanner, examLabel, hash, loading, papersByYear, practiceHref, replace, tabs,
} from "../ui.js";

function run(exam, params, from) {
  return hash("run", { exam, ...params, from });
}

function countLink(href, text, count) {
  return el("a", { href }, el("span", { text }), el("span", { class: "count", text: String(count) }));
}

async function topicsView(view, exam, params, app) {
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
  if (!data.subjects.length) {
    body.replaceChildren(emptyState("This exam has no topic list yet."));
    return;
  }
  const only = params.get("subject") || "";
  const subjects = data.subjects.filter((subject) => !only || subject.subject === only);
  const jump = el("nav", { class: "chips", "aria-label": "Subjects" },
    el("a", { class: only ? "chip-link" : "chip-link active", href: browseHref(exam.exam, "topics"), "aria-current": only ? false : "page" }, "All subjects"),
    data.subjects.map((subject) => el("a", { class: subject.subject === only ? "chip-link active" : "chip-link",
      href: browseHref(exam.exam, "topics", { subject: subject.subject }), "aria-current": subject.subject === only ? "page" : false }, subject.subject)));
  const finder = el("input", { type: "search", placeholder: "Find a topic, for example: stack, eigen, TCP", "aria-label": "Find a topic", autocomplete: "off" });
  const status = el("p", { class: "muted small", role: "status" });
  const cards = subjects.map((subject) => {
    const groups = new Map();
    subject.topics.forEach((topic) => {
      if (!groups.has(topic.group || "")) {
        groups.set(topic.group || "", []);
      }
      groups.get(topic.group || "").push(topic);
    });
    return el("section", { class: "card" },
      el("div", { class: "card-head" },
        el("h2", { text: subject.subject }),
        subject.questions ? el("a", { class: "small", href: run(exam.exam, { subject: subject.subject }, "topics") }, `All ${subject.questions} questions of the subject`) : null),
      [...groups.entries()].map(([group, topics]) => el("div", { class: "topic-group" },
        group ? el("h3", { class: "group-name", text: group }) : null,
        el("ul", { class: "link-grid" }, topics.map((topic) => el("li", { dataset: { find: `${topic.name} ${group}`.toLowerCase() } },
          topic.count
            ? countLink(run(exam.exam, { topic: topic.id, title: topic.name }, "topics"), topic.name, topic.count)
            : el("span", { class: "link-empty", title: "No question has this topic yet" }, el("span", { text: topic.name }), el("span", { class: "count", text: "0" }))))))));
  });
  finder.addEventListener("input", () => {
    const words = finder.value.trim().toLowerCase();
    let shown = 0;
    cards.forEach((card) => {
      let inCard = 0;
      card.querySelectorAll(".topic-group").forEach((group) => {
        let inGroup = 0;
        group.querySelectorAll("li").forEach((item) => {
          item.hidden = Boolean(words) && !item.dataset.find.includes(words);
          inGroup += item.hidden ? 0 : 1;
        });
        group.hidden = !inGroup;
        inCard += inGroup;
      });
      card.hidden = !inCard;
      shown += inCard;
    });
    status.textContent = words ? `${shown} topic${shown === 1 ? "" : "s"} found.` : "";
  });
  replace(body,
    el("p", { class: "muted", text: data.classified
      ? `${data.classified} of ${data.questions} questions have topics; a question can have more than one. To correct a question's topics, open it and add or remove them.`
      : "No question has topics yet. They are added with: qbank topics import, then qbank index rebuild." }),
    jump,
    el("div", { class: "topic-tools" }, finder, status),
    cards.length ? cards : emptyState("There are no topics for this subject.", el("a", { class: "btn", href: browseHref(exam.exam, "topics") }, "All subjects")));
}

function subjectsView(view, exam) {
  const subjects = Object.entries(exam.subjects || {}).filter(([subject]) => subject !== "(none)");
  view.appendChild(el("section", { class: "card" }, el("div", { class: "table-wrap" }, el("table", { class: "data" },
    el("thead", {}, el("tr", {}, ["Subject", "Questions", ""].map((name) => el("th", { scope: "col", text: name })))),
    el("tbody", {}, subjects.map(([subject, count]) => el("tr", {},
      el("th", { scope: "row" }, el("a", { href: run(exam.exam, { subject }, "subjects") }, subject)),
      el("td", { class: "num", text: String(count) }),
      el("td", { class: "row-links" },
        el("a", { href: browseHref(exam.exam, "topics", { subject }) }, "Topics"),
        el("a", { href: run(exam.exam, { subject, random: 10 }, "subjects") }, "10 random")))))))));
}

function yearsView(view, exam) {
  const byYear = papersByYear(exam);
  view.appendChild(el("section", { class: "card" }, el("div", { class: "years" },
    Object.entries(exam.years || {}).reverse().map(([year, count]) => {
      const papers = byYear.get(year) || [];
      return el("div", { class: "year-row" },
        el("a", { class: "year", href: run(exam.exam, { year, title: `${examLabel(exam.exam)} ${year}` }, "years"), title: `All ${count} questions of ${year}` }, year),
        el("ul", { class: "link-grid" }, papers.map(({ paper, label, count: paperCount }) =>
          el("li", {}, countLink(run(exam.exam, { paper }, "years"), label, paperCount ?? "")))));
    }))));
}

export async function renderBrowse(view, { args, params, app }) {
  const exam = app.exams.find((entry) => entry.exam === args[0]);
  if (!exam) {
    view.appendChild(emptyState("There is no such exam.", el("a", { class: "btn", href: "#/practice" }, "Practice")));
    return;
  }
  const kind = BROWSE_VIEWS.some(([key]) => key === args[1]) ? args[1] : "topics";
  view.append(
    el("div", { class: "page-head" },
      el("div", {},
        el("a", { href: practiceHref(exam.exam), class: "back" }, `← ${examLabel(exam.exam)} practice`),
        el("h1", { text: `${examLabel(exam.exam)} · ${BROWSE_VIEWS.find(([key]) => key === kind)[1]}` })),
      el("p", { class: "muted", text: `${exam.question_count} questions` })),
    tabs(BROWSE_VIEWS.map(([key, text]) => [browseHref(exam.exam, key), text, key]), kind));
  if (kind === "subjects") {
    subjectsView(view, exam);
  } else if (kind === "years") {
    yearsView(view, exam);
  } else {
    await topicsView(view, exam, params, app);
  }
}
