// Exam browser (CP40B): one exam's questions topic wise, subject wise or year wise, like the source site's exam menu.
// Topic wise uses the fine topics of each question (taxonomy/<exam>.json), with your own corrections included, and the
// topics you added yourself (CP40E), which you can rename or delete here.
import { api } from "../api.js";
import {
  BROWSE_VIEWS, browseHref, el, emptyState, errorBanner, examLabel, hash, loading, papersByYear, practiceHref, replace, tabs,
} from "../ui.js";
import { renderTopicFind } from "./topicfind.js";

function run(exam, params, from) {
  return hash("run", { exam, ...params, from });
}

function countLink(href, text, count) {
  return el("a", { href }, el("span", { text }), el("span", { class: "count", text: String(count) }));
}

function topicLabel(topic) {
  return el("span", {}, topic.name, topic.mine ? el("span", { class: "mine-tag", text: "yours" }) : null);
}

// The form for a new topic or one of yours: name, group (one of the subject's groups or a new one) and what it covers.
function topicForm(exam, subject, topic, done, cancel) {
  const groups = [...new Set(subject.topics.map((item) => item.group).filter(Boolean))];
  const listId = `groups-${Math.random().toString(36).slice(2, 8)}`;
  const name = el("input", { type: "text", name: "name", required: true, maxlength: "80", autocomplete: "off", value: topic ? topic.name : "",
    placeholder: "e.g. Binomial and multinomial sums" });
  const group = el("input", { type: "text", name: "group", maxlength: "60", autocomplete: "off", list: listId, value: topic ? topic.group || "" : "",
    placeholder: groups.length ? `e.g. ${groups[0]}` : "optional" });
  const covers = el("input", { type: "text", name: "covers", maxlength: "300", autocomplete: "off", value: topic ? topic.covers || "" : "",
    placeholder: "optional: what questions of this topic ask" });
  const error = el("p", { class: "form-error", role: "alert" });
  const submit = el("button", { class: "btn btn-primary btn-small", type: "submit" }, topic ? "Save" : "Add topic");
  const extra = [];
  if (topic) {
    let armed = null;
    const remove = el("button", { class: "btn btn-small btn-danger", type: "button" }, "Delete topic");
    remove.addEventListener("click", async () => {
      if (!armed) {
        remove.textContent = topic.count
          ? `Delete? It comes off ${topic.count} question${topic.count === 1 ? "" : "s"}. Click again`
          : "Delete? Click again";
        armed = setTimeout(() => { armed = null; remove.textContent = "Delete topic"; }, 5000);
        return;
      }
      clearTimeout(armed);
      remove.disabled = true;
      try {
        await api.deleteTopic(exam.exam, topic.id);
        done(`Deleted ${topic.name}.`);
      } catch (failure) {
        remove.disabled = false;
        error.textContent = failure.message;
      }
    });
    extra.push(el("a", { class: "btn btn-small", href: browseHref(exam.exam, "find", { topic: topic.id }) }, "Find questions"), remove);
  }
  const form = el("form", { class: "topic-form" },
    el("h3", { text: topic ? `Your topic: ${topic.name}` : `New topic in ${subject.subject}` }),
    el("label", { class: "field" }, el("span", { text: "Name" }), name),
    el("label", { class: "field" }, el("span", { text: "Group" }), group),
    el("datalist", { id: listId }, groups.map((value) => el("option", { value }))),
    el("label", { class: "field" }, el("span", { text: "What it covers" }), covers),
    error,
    el("div", { class: "actions" }, submit, ...extra, el("button", { class: "btn btn-ghost btn-small", type: "button", onclick: cancel }, "Cancel")));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    error.textContent = "";
    const fields = { name: name.value, group: group.value, covers: covers.value };
    try {
      const saved = topic
        ? await api.updateTopic(exam.exam, topic.id, fields)
        : await api.createTopic(exam.exam, { ...fields, subject: subject.subject });
      done(topic ? `Saved ${saved.name}.` : `Added ${saved.name} to ${subject.subject}.`, topic ? null : saved);
    } catch (failure) {
      submit.disabled = false;
      error.textContent = failure.message;
    }
  });
  setTimeout(() => name.focus(), 0);
  return form;
}

async function topicsView(view, exam, params, app) {
  const body = el("div", {}, loading("Loading topics…"));
  view.appendChild(body);
  const only = params.get("subject") || "";

  async function load(notice) {
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
    draw(data, notice);
  }

  function draw(data, notice) {
    const subjects = data.subjects.filter((subject) => !only || subject.subject === only);
    const jump = el("nav", { class: "chips", "aria-label": "Subjects" },
      el("a", { class: only ? "chip-link" : "chip-link active", href: browseHref(exam.exam, "topics"), "aria-current": only ? false : "page" }, "All subjects"),
      data.subjects.map((subject) => el("a", { class: subject.subject === only ? "chip-link active" : "chip-link",
        href: browseHref(exam.exam, "topics", { subject: subject.subject }), "aria-current": subject.subject === only ? "page" : false }, subject.subject)));
    const finder = el("input", { type: "search", placeholder: "Find a topic, for example: stack, eigen, TCP", "aria-label": "Find a topic", autocomplete: "off" });
    const status = el("p", { class: "muted small", role: "status" });
    const cards = subjects.map((subject) => {
      const panel = el("div", { class: "topic-panel" });
      let open = null; // the button whose form is in the panel
      const toggle = (button, makeForm) => {
        if (open) {
          open.setAttribute("aria-expanded", "false");
        }
        if (open === button) {
          open = null;
          replace(panel);
          return;
        }
        open = button;
        button.setAttribute("aria-expanded", "true");
        replace(panel, makeForm(() => {
          open = null;
          button.setAttribute("aria-expanded", "false");
          replace(panel);
          button.focus();
        }));
      };
      const finished = (message, created) => load({ message, created });
      const groups = new Map();
      subject.topics.forEach((topic) => {
        if (!groups.has(topic.group || "")) {
          groups.set(topic.group || "", []);
        }
        groups.get(topic.group || "").push(topic);
      });
      const addButton = el("button", { type: "button", class: "btn btn-small", "aria-expanded": "false" }, "+ New topic");
      addButton.addEventListener("click", () => toggle(addButton, (cancel) => topicForm(exam, subject, null, finished, cancel)));
      return el("section", { class: "card" },
        el("div", { class: "card-head" },
          el("h2", { text: subject.subject }),
          el("div", { class: "card-tools" },
            subject.questions ? el("a", { class: "small", href: run(exam.exam, { subject: subject.subject }, "topics") }, `All ${subject.questions} questions of the subject`) : null,
            addButton)),
        [...groups.entries()].map(([group, topics]) => el("div", { class: "topic-group" },
          group ? el("h3", { class: "group-name", text: group }) : null,
          el("ul", { class: "link-grid" }, topics.map((topic) => {
            const link = topic.count
              ? el("a", { href: run(exam.exam, { topic: topic.id, title: topic.name }, "topics"), title: topic.covers || "" },
                topicLabel(topic), el("span", { class: "count", text: String(topic.count) }))
              : el("span", { class: "link-empty", title: topic.covers || "No question has this topic yet" }, topicLabel(topic), el("span", { class: "count", text: "0" }));
            const item = el("li", { class: topic.mine ? "my-topic" : "", dataset: { find: `${topic.name} ${group}`.toLowerCase() } }, link);
            if (topic.mine) {
              const edit = el("button", { type: "button", class: "topic-edit", "aria-expanded": "false", "aria-label": `Edit your topic ${topic.name}`,
                title: "Rename, find questions for it, or delete it" }, "✎");
              edit.addEventListener("click", () => toggle(edit, (cancel) => topicForm(exam, subject, topic, finished, cancel)));
              item.appendChild(edit);
            }
            return item;
          })))),
        panel);
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
        card.hidden = !inCard && Boolean(words);
        shown += inCard;
      });
      status.textContent = words ? `${shown} topic${shown === 1 ? "" : "s"} found.` : "";
    });
    replace(body,
      notice ? el("div", { class: "banner banner-good", role: "status" },
        el("p", { text: notice.message }),
        notice.created ? el("div", { class: "actions" },
          el("a", { class: "btn btn-primary btn-small", href: browseHref(exam.exam, "find", { topic: notice.created.id }) }, "Find questions for it"),
          el("span", { class: "muted small", text: "or add it to questions one at a time with + Topic in the player." })) : null) : null,
      el("p", { class: "muted", text: data.classified
        ? `${data.classified} of ${data.questions} questions have topics; a question can have more than one. To correct a question's topics, open it and add or remove them. A topic missing from the list? Add it with + New topic.`
        : "No question has topics yet. They are added with: qbank topics import, then qbank index rebuild." }),
      jump,
      el("div", { class: "topic-tools" }, finder, status),
      cards.length ? cards : emptyState("There are no topics for this subject.", el("a", { class: "btn", href: browseHref(exam.exam, "topics") }, "All subjects")));
    if (notice) {
      body.firstChild.scrollIntoView({ block: "nearest" });
    }
  }

  await load(null);
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
  if (args[1] === "find") {
    await renderTopicFind(view, exam, params, app);
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
