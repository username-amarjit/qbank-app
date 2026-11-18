// Find questions for a topic (CP40E): search the exam's questions by words, tick the ones that belong to the topic and
// save. A tick starts as the question's current topics, so unticking takes the topic off a question. Ticks are kept
// across pages until you save.
import { api } from "../api.js";
import { browseHref, el, emptyState, errorBanner, examLabel, hash, loading, pager, questionLabel, replace, TYPE_LABELS } from "../ui.js";

const PER_PAGE = 50;
const SMALL_WORDS = new Set(["a", "an", "and", "are", "as", "at", "by", "for", "from", "in", "into", "is", "it", "of", "on", "or", "the", "to", "with"]);
const ALL = "*";

function defaultWords(name) {
  return name.split(/[^\p{L}\p{N}]+/u).filter((word) => word && !SMALL_WORDS.has(word.toLowerCase())).join(" ");
}

export async function renderTopicFind(view, exam, params, app) {
  const topicId = params.get("topic") || "";
  view.appendChild(loading("Loading the topic…"));
  let list;
  try {
    list = await api.examTopics(exam.exam);
  } catch (error) {
    view.replaceChildren(errorBanner(error, app.reconnect));
    return;
  }
  if (!view.isConnected) {
    return;
  }
  const topic = list.subjects.flatMap((subject) => subject.topics.map((item) => ({ ...item, subject: subject.subject }))).find((item) => item.id === topicId);
  const back = el("a", { href: browseHref(exam.exam, "topics", topic ? { subject: topic.subject } : {}), class: "back" }, `← ${examLabel(exam.exam)} · Topic wise`);
  if (!topic) {
    view.replaceChildren(back, emptyState("There is no such topic.", el("a", { class: "btn", href: browseHref(exam.exam, "topics") }, "Topic wise")));
    return;
  }

  const changes = new Map(); // question id -> true (give it the topic) or false (take it off)
  let count = topic.count;
  let page = 1;
  let items = [];

  const countText = el("span");
  const drawCount = () => {
    countText.textContent = `${topic.subject}${topic.mine ? " · your topic" : ""} · on ${count} question${count === 1 ? "" : "s"}`;
  };
  drawCount();
  const words = el("input", { type: "search", name: "q", value: params.get("q") ?? defaultWords(topic.name), autocomplete: "off",
    placeholder: "Words in the question or its options" });
  const match = el("select", { name: "match" },
    el("option", { value: "any", text: "Any of the words, best matches first" }),
    el("option", { value: "all", text: "All of the words" }));
  const subject = el("select", { name: "subject" },
    el("option", { value: topic.subject, text: topic.subject }),
    el("option", { value: ALL, text: "All subjects" }),
    list.subjects.filter((entry) => entry.subject !== topic.subject).map((entry) => el("option", { value: entry.subject, text: entry.subject })));
  const results = el("div", { class: "find-results" });
  const summary = el("p", { class: "muted small", role: "status" });
  const barText = el("span", { role: "status" });
  const save = el("button", { class: "btn btn-primary", type: "button", disabled: true }, "Save");
  const undo = el("button", { class: "btn btn-ghost", type: "button", disabled: true }, "Undo changes");
  const bar = el("div", { class: "save-bar" }, barText, save, undo,
    el("a", { class: "btn btn-ghost", href: `${hash("run", { exam: exam.exam, topic: topic.id, title: topic.name, from: "topics" })}` }, "Practise this topic"));

  const wanted = (item) => (changes.has(item.id) ? changes.get(item.id) : item.tagged);
  function drawBar() {
    const adding = [...changes.values()].filter(Boolean).length;
    const removing = changes.size - adding;
    barText.textContent = changes.size
      ? [adding ? `${adding} to give this topic` : "", removing ? `${removing} to take it off` : ""].filter(Boolean).join(", ") + " (not saved yet)"
      : "No changes. Tick the questions that belong to this topic.";
    save.disabled = !changes.size;
    undo.disabled = !changes.size;
  }

  function row(item) {
    const box = el("input", { type: "checkbox", "aria-label": `${questionLabel(item)}: has the topic ${topic.name}` });
    box.checked = wanted(item);
    const line = el("label", { class: box.checked ? "find-row on" : "find-row" }, box,
      el("div", { class: "find-body" },
        el("div", { class: "qlist-head" },
          el("strong", { text: questionLabel(item) }),
          el("span", { class: "chip", text: TYPE_LABELS[item.question_type] || item.question_type }),
          item.origin === "mock" ? el("span", { class: "chip chip-mock", text: "Mock" }) : null,
          el("span", { class: "muted small", text: item.subject || "" }),
          item.tagged ? el("span", { class: "chip chip-good", text: "has it" }) : null,
          el("a", { class: "small", href: hash("run", { id: item.id }), target: "_blank", rel: "noopener" }, "Open ↗")),
        el("p", { class: "qlist-preview", text: item.preview || "" })));
    box.addEventListener("change", () => {
      if (box.checked === item.tagged) {
        changes.delete(item.id);
      } else {
        changes.set(item.id, box.checked);
      }
      line.classList.toggle("on", box.checked);
      drawBar();
    });
    return el("li", {}, line);
  }

  function setPage(on) {
    items.forEach((item) => {
      if (on === item.tagged) {
        changes.delete(item.id);
      } else {
        changes.set(item.id, on);
      }
    });
    drawResults();
    drawBar();
  }

  let pages = 0;
  let total = 0;
  function drawResults() {
    if (!items.length) {
      replace(results, emptyState(words.value.trim()
        ? "No question has these words. Try shorter words (a word also finds longer ones: “binom” finds “binomial”), any of the words, "
          + "or all subjects. Maths is searched as it is written in LaTeX, for example binom, sum, frac, log."
        : "No questions."));
      return;
    }
    replace(results,
      el("div", { class: "actions" },
        el("button", { class: "btn btn-small", type: "button", onclick: () => setPage(true) }, "Tick all on this page"),
        el("button", { class: "btn btn-small btn-ghost", type: "button", onclick: () => setPage(false) }, "Untick all on this page")),
      el("ol", { class: "find-list" }, items.map(row)),
      pager(page, pages, (next) => search(next)));
  }

  async function search(next) {
    page = next || 1;
    replace(results, loading("Searching…"));
    const chosen = subject.value;
    try {
      const found = await api.findForTopic(exam.exam, topic.id, {
        q: words.value.trim(), match: match.value, page, per_page: PER_PAGE,
        ...(chosen === ALL ? { all_subjects: "true" } : { subject: chosen }),
      });
      items = found.items;
      pages = found.pages;
      total = found.total;
      count = found.topic.count;
      drawCount();
    } catch (error) {
      replace(results, errorBanner(error, app.reconnect));
      return;
    }
    summary.textContent = `${total} question${total === 1 ? "" : "s"} found${pages > 1 ? `; page ${page} of ${pages}` : ""}.`;
    drawResults();
    if (next) {
      results.scrollIntoView({ block: "start" });
    }
  }

  save.addEventListener("click", async () => {
    save.disabled = true;
    const add = [...changes].filter(([, on]) => on).map(([id]) => id);
    const remove = [...changes].filter(([, on]) => !on).map(([id]) => id);
    try {
      const done = await api.tagTopic(exam.exam, topic.id, { add, remove });
      changes.clear();
      count = done.count;
      drawCount();
      await search(page);
      drawBar();
      barText.textContent = `Saved: ${[add.length ? `${add.length} given the topic` : "", remove.length ? `${remove.length} taken off` : ""].filter(Boolean).join(", ")}. `
        + `The topic is now on ${done.count} question${done.count === 1 ? "" : "s"}.`;
    } catch (error) {
      save.disabled = false;
      barText.textContent = error.message;
    }
  });
  undo.addEventListener("click", () => {
    changes.clear();
    drawResults();
    drawBar();
  });

  const form = el("form", { class: "card find-form" },
    el("label", { class: "field grow" }, el("span", { text: "Words" }), words),
    el("label", { class: "field" }, el("span", { text: "Match" }), match),
    el("label", { class: "field" }, el("span", { text: "Subject" }), subject),
    el("button", { class: "btn btn-primary", type: "submit" }, "Search"));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    search(1);
  });

  view.replaceChildren(
    el("div", { class: "page-head" },
      el("div", {}, back, el("h1", { text: `Find questions for “${topic.name}”` })),
      el("p", { class: "muted" }, countText)),
    el("p", { class: "muted", text: "Search the questions by words, tick the ones that belong to this topic, then save. "
      + "A ticked question already has the topic; untick it to take the topic off. Searching again keeps your ticks until you save." }),
    form, summary, results, bar);
  drawBar();
  await search(1);
}
