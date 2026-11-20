// My questions (CP40D, CP40F): the questions you added, by topic or as a list a page at a time, each to view in full,
// edit or remove; and their history: the batches you added them in (an upload, a day of typed questions, or questions
// added before batches were recorded), each removable at once. Removing questions removes everything that refers to
// them (answers, notebook entries, notes, bookmarks, favourites, topic corrections, practice sessions left empty; tests
// are scored again without them); a preview says exactly what will go before anything does.
import { api } from "../api.js";
import { answerText, append, blocks, el, emptyState, errorBanner, examLabel, hash, loading, pager, replace, TYPE_LABELS, when } from "../ui.js";
import { testTitle } from "./tests.js";

const PER_PAGE = 50;
const BANKS = [["", "Mock and PYQ"], ["mock", "Mock questions"], ["pyq", "Previous year questions (PYQ)"]];
const KIND_LABELS = { upload: "Uploaded file", typed: "Typed in the form", earlier: "Earlier upload" };
let notice = null; // a message for the next page shown, after a removal
let selection = { key: "", ids: new Set() }; // ticks, kept across the pages of one list

const plural = (count, one, many) => `${count} ${count === 1 ? one : many || `${one}s`}`;

// A question as it will look (the preview the worker returns, or a stored question)
export function questionPreview(question) {
  const meta = [question.origin === "mock" ? "Mock" : "PYQ", question.paper && `${question.paper} · Q${question.question_number}`, question.subject,
    TYPE_LABELS[question.question_type], `${question.marks.positive} mark${question.marks.positive === 1 ? "" : "s"}`].filter(Boolean);
  return el("div", { class: "qpreview" },
    el("p", { class: "muted small", text: meta.join(" · ") + (question.topics && question.topics.length ? ` · Topics: ${question.topics.join(", ")}` : "") }),
    el("div", { class: "stem" }, blocks(question, question.content.blocks)),
    question.options.length ? el("ol", { class: "preview-options" }, question.options.map((option) =>
      el("li", { class: (question.answer.correct_labels || []).includes(option.label) ? "is-answer" : "" },
        el("span", { class: "option-label", text: option.label }), blocks(question, option.blocks)))) : null,
    el("p", {}, "Answer: ", el("b", { text: answerText(question, question.answer) })),
    question.explanation ? el("div", { class: "explanation" }, el("h3", { text: "Solution" }), blocks(question, question.explanation.blocks)) : null,
    question.reasoning ? el("div", { class: "explanation" }, el("h3", { text: "Reasoning" }), blocks(question, question.reasoning.blocks)) : null);
}

function showNotice() {
  const shown = notice ? el("div", { class: "banner banner-good", role: "status" }, el("p", { text: notice })) : null;
  notice = null;
  return shown;
}

// -- removing: first what it would remove, then on confirmation the removal itself ---------------------------------------
function impactList(impact) {
  const data = impact.user_data;
  const lines = [
    [data.attempts, plural(data.attempts, "answer"), "from your history and analytics"],
    [data.sessions, plural(data.sessions, "practice session"), "left with no answers"],
    [data.notebook, plural(data.notebook, "error notebook entry", "error notebook entries"), ""],
    [data.notes, plural(data.notes, "note"), ""],
    [data.bookmarks, plural(data.bookmarks, "bookmark"), ""],
    [data.favorites, plural(data.favorites, "favourite"), ""],
    [data.topic_edits, plural(data.topic_edits, "topic correction"), ""],
  ].filter(([count]) => count);
  const tests = impact.tests.map((test) => {
    const what = test.action === "delete" ? "all its questions: the test is deleted"
      : test.action === "rescore" ? `scored again on the other ${test.left}` : `the other ${test.left} stay`;
    return el("li", {}, el("b", { text: testTitle(test) }), ` (${test.state === "submitted" ? "submitted" : "not submitted"}): `,
      `${test.removed} of its ${test.questions} questions; ${what}`);
  });
  return [
    lines.length
      ? el("div", {}, el("p", { text: "This also removes:" }), el("ul", {}, lines.map(([, count, rest]) => el("li", { text: rest ? `${count} ${rest}` : count }))))
      : el("p", { text: "Nothing else refers to them: no answers, notebook entries, notes or bookmarks." }),
    tests.length ? el("div", {}, el("p", { text: "Tests with these questions:" }), el("ul", {}, tests)) : null,
    impact.batches.length > 1 || (impact.batches.length === 1 && impact.batches[0].left)
      ? el("p", { class: "muted small", text: `From ${impact.batches.map((batch) => `${batch.name} (${batch.removed}${batch.left ? `, ${batch.left} left` : ", all"})`).join("; ")}.` })
      : null,
    el("p", { class: "muted small", text: "Topics stay in the topic list. Backups keep a copy of what is removed." }),
  ];
}

// slot: where the preview goes; request: {ids} or {batch, exam}; what: e.g. "the 3 selected questions"
function removal(slot, request, what, app, done) {
  replace(slot, loading("Checking what this removes…"));
  api.removeQuestions({ ...request, dry_run: true }).then((impact) => {
    if (!slot.isConnected) {
      return;
    }
    const go = el("button", { class: "btn btn-danger-solid", type: "button" }, `Remove ${plural(impact.questions, "question")}`);
    const status = el("span", { class: "muted small", role: "status" });
    go.addEventListener("click", async () => {
      go.disabled = true;
      status.textContent = "Removing…";
      try {
        const result = await api.removeQuestions(request);
        notice = `Removed ${plural(result.questions, "question")}${result.batch ? ` (${result.batch.name})` : ""}`
          + `${result.user_data.attempts ? `, ${plural(result.user_data.attempts, "answer")}` : ""}`
          + `${result.user_data.notebook ? `, ${plural(result.user_data.notebook, "notebook entry", "notebook entries")}` : ""}`
          + `${result.tests.length ? `; ${plural(result.tests.length, "test")} changed` : ""}.`;
        await app.refreshExams();
        done();
      } catch (error) {
        go.disabled = false;
        status.textContent = "";
        replace(slot, errorBanner(error, app.reconnect));
      }
    });
    replace(slot, el("div", { class: "banner warn removal", role: "alertdialog", "aria-label": "Remove questions?" },
      el("p", {}, el("strong", { text: `Remove ${what}?` }), " This cannot be undone here."),
      impactList(impact),
      el("div", { class: "actions" }, go, el("button", { class: "btn", type: "button", onclick: () => replace(slot) }, "Cancel"), status)));
    go.focus();
  }, (error) => replace(slot, errorBanner(error, app.reconnect)));
}

// -- my questions --------------------------------------------------------------------------------------------------------
function preferredExam(app, params) {
  const withMine = app.exams.filter((exam) => exam.authored);
  const wanted = params.get("exam") || app.settings.default_exam;
  return (withMine.find((exam) => exam.exam === wanted) || withMine[0] || {}).exam;
}

export async function mineView(view, app, params) {
  const exam = preferredExam(app, params);
  if (!exam) {
    view.append(emptyState("You have not added any questions yet.", el("a", { class: "btn btn-primary", href: "#/add" }, "Upload a file")));
    return;
  }
  const values = { exam, bank: params.get("bank") || "", batch: params.get("batch") || "", q: params.get("q") || "" };
  const listing = params.get("view") === "list" || params.get("topic") || params.get("subject");
  const form = el("form", { class: "card search-form" },
    el("label", { class: "field" }, el("span", { text: "Exam" }),
      el("select", { name: "exam" }, app.exams.filter((item) => item.authored).map((item) =>
        el("option", { value: item.exam, text: `${examLabel(item.exam)} (${item.authored})`, selected: item.exam === exam })))),
    el("label", { class: "field" }, el("span", { text: "Bank" }),
      el("select", { name: "bank" }, BANKS.map(([value, text]) => el("option", { value, text, selected: value === values.bank })))),
    el("label", { class: "field grow" }, el("span", { text: "Words" }), el("input", { type: "search", name: "q", value: values.q, autocomplete: "off" })),
    el("button", { class: "btn btn-primary", type: "submit" }, "Show"));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const chosen = Object.fromEntries(new FormData(form));
    // a topic or a batch belongs to one exam: another exam starts again from its topics
    const keep = chosen.exam === exam ? Object.fromEntries(["view", "topic", "subject", "title", "batch"].map((key) => [key, params.get(key) || ""])) : {};
    location.hash = hash("add/mine", { ...keep, ...chosen });
  });
  form.querySelectorAll("select").forEach((node) => node.addEventListener("change", () => form.requestSubmit()));
  const base = { exam, bank: values.bank, batch: values.batch, q: values.q };
  const switcher = el("nav", { class: "chips", "aria-label": "Show" },
    el("a", { class: listing ? "chip-link" : "chip-link active", href: hash("add/mine", base), "aria-current": listing ? false : "page" }, "By topic"),
    el("a", { class: listing && !params.get("topic") && !params.get("subject") ? "chip-link active" : "chip-link", href: hash("add/mine", { ...base, view: "list" }),
      "aria-current": listing && !params.get("topic") && !params.get("subject") ? "page" : false }, "All as a list"));
  const batchChip = el("span");
  const body = el("div", {}, loading());
  append(view, [showNotice(), form, switcher, batchChip, body]);
  if (values.batch) {
    api.myBatches({ exam }).then((list) => {
      const batch = list.find((item) => item.id === values.batch);
      replace(batchChip, el("p", { class: "batch-filter" }, "Only the batch ", el("b", { text: batch ? batch.name : values.batch }),
        batch ? ` (${KIND_LABELS[batch.kind] || batch.kind}, ${when(batch.created_at)})` : "",
        el("a", { class: "btn btn-ghost btn-small", href: hash("add/mine", { ...base, batch: "", view: listing ? "list" : "" }) }, "Show all batches")));
    }, () => {});
  }
  if (listing) {
    await listView(body, app, params, base);
  } else {
    await topicsView(body, app, base);
  }
}

async function topicsView(body, app, base) {
  let data;
  try {
    data = await api.myTopics(base);
  } catch (error) {
    replace(body, errorBanner(error, app.reconnect));
    return;
  }
  if (!body.isConnected) {
    return;
  }
  if (!data.total) {
    replace(body, emptyState(base.batch || base.bank || base.q ? "None of your questions match." : "You have not added questions to this exam yet.",
      el("a", { class: "btn btn-primary", href: "#/add" }, "Upload a file")));
    return;
  }
  const listHref = (extra) => hash("add/mine", { ...base, view: "list", ...extra });
  const link = (href, label, count, extra) => el("a", { href }, el("span", {}, label, extra || null), el("span", { class: "count", text: String(count) }));
  replace(body,
    el("p", { class: "muted", text: `${plural(data.total, "question")} you added. Open a topic to see its questions, view each in full, edit or remove them. `
      + "A question with several topics is counted under each." }),
    data.subjects.map((subject) => {
      const groups = new Map();
      subject.topics.forEach((topic) => {
        if (!groups.has(topic.group || "")) {
          groups.set(topic.group || "", []);
        }
        groups.get(topic.group || "").push(topic);
      });
      return el("section", { class: "card" },
        el("div", { class: "card-head" }, el("h2", { text: subject.subject }),
          subject.questions ? el("a", { class: "small", href: listHref({ subject: subject.subject, title: subject.subject }) },
            `All ${plural(subject.questions, "question")} of yours in this subject`) : null),
        [...groups.entries()].map(([group, topics]) => el("div", { class: "topic-group" },
          el("h3", { class: "group-name", text: group || (topics.every((topic) => topic.mine) ? "Your topics" : "Other topics") }),
          el("ul", { class: "link-grid" }, topics.map((topic) => el("li", {},
            link(listHref({ topic: topic.id, title: topic.name }), topic.name, topic.count,
              topic.mine ? el("span", { class: "mine-tag", text: "yours" }) : null)))))),
        subject.no_topic ? el("div", { class: "topic-group" }, el("h3", { class: "group-name", text: "Without a topic" }),
          el("ul", { class: "link-grid" }, el("li", {},
            link(listHref({ topic: "none", subject: subject.subject, title: `${subject.subject} · no topic` }), "No topic", subject.no_topic)))) : null);
    }));
}

async function listView(body, app, params, base) {
  const filters = { ...base, topic: params.get("topic") || "", subject: params.get("subject") || "" };
  const page = Math.max(1, Number(params.get("page")) || 1);
  const key = JSON.stringify(filters);
  if (selection.key !== key) {
    selection = { key, ids: new Set() };
  }
  let found;
  try {
    found = await api.myQuestions({ ...filters, page, per_page: PER_PAGE });
  } catch (error) {
    replace(body, errorBanner(error, app.reconnect));
    return;
  }
  if (!body.isConnected) {
    return;
  }
  const here = (extra) => hash("add/mine", { ...filters, view: "list", title: params.get("title") || "", ...extra });
  if (!found.questions.length && page > 1 && found.pages) {
    location.hash = here({ page: found.pages }); // past the last page (after a removal): show the last one
    return;
  }
  const title = params.get("title") || (filters.topic ? "Topic" : filters.subject || "All your questions");
  const head = el("div", { class: "list-head" },
    el("a", { class: "back", href: hash("add/mine", base) }, "← By topic"),
    el("h2", { text: `${title} · ${plural(found.total, "question")}` }));
  if (!found.total) {
    replace(body, head, emptyState("None of your questions match.", el("a", { class: "btn", href: hash("add/mine", base) }, "By topic")));
    return;
  }
  const status = el("span", { class: "muted", role: "status" });
  const removeChosen = el("button", { class: "btn", type: "button" });
  const removeAll = el("button", { class: "btn btn-ghost", type: "button" }, `Remove all ${found.total}`);
  const panel = el("div");
  const pageBox = el("input", { type: "checkbox", "aria-label": "Select every question on this page" });
  const boxes = new Map();
  const sync = () => {
    status.textContent = `${found.pages > 1 ? `Page ${found.page} of ${found.pages}` : ""}${selection.ids.size ? `${found.pages > 1 ? " · " : ""}${selection.ids.size} selected` : ""}`;
    removeChosen.textContent = selection.ids.size ? `Remove ${selection.ids.size} selected` : "Remove selected";
    removeChosen.disabled = !selection.ids.size;
    pageBox.checked = found.questions.every((item) => selection.ids.has(item.id));
  };
  pageBox.addEventListener("change", () => {
    found.questions.forEach((item) => {
      if (pageBox.checked) {
        selection.ids.add(item.id);
      } else {
        selection.ids.delete(item.id);
      }
      boxes.get(item.id).checked = pageBox.checked;
    });
    sync();
  });
  const refresh = () => {
    selection = { key: "", ids: new Set() };
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  };
  removeChosen.addEventListener("click", () => removal(panel, { ids: [...selection.ids] },
    selection.ids.size === 1 ? "the selected question" : `the ${selection.ids.size} selected questions`, app, refresh));
  removeAll.addEventListener("click", async () => {
    replace(panel, loading());
    try {
      const all = await api.myQuestions({ ...filters, ids_only: true });
      removal(panel, { ids: all.ids }, `all ${plural(all.ids.length, "question")} shown`, app, refresh);
    } catch (error) {
      replace(panel, errorBanner(error, app.reconnect));
    }
  });
  const pageIds = found.questions.map((item) => item.id);
  replace(body, head,
    el("div", { class: "actions mine-actions" }, el("label", { class: "check" }, pageBox, "This page"), status, removeChosen, removeAll,
      el("a", { class: "btn btn-primary", href: hash("run", { ids: pageIds.join(","), title }) },
        found.pages > 1 ? `Practise this page (${pageIds.length})` : "Practise these")),
    panel,
    el("ol", { class: "qlist" }, found.questions.map((item) => {
      const box = el("input", { type: "checkbox", "aria-label": `Select ${item.paper} Q${item.question_number}` });
      box.checked = selection.ids.has(item.id);
      boxes.set(item.id, box);
      box.addEventListener("change", () => {
        if (box.checked) {
          selection.ids.add(item.id);
        } else {
          selection.ids.delete(item.id);
        }
        sync();
      });
      const full = el("div", { class: "mine-full", hidden: true });
      const rowPanel = el("div");
      const viewButton = el("button", { class: "btn btn-ghost btn-small", type: "button", "aria-expanded": "false" }, "View");
      viewButton.addEventListener("click", async () => {
        const open = full.hidden;
        full.hidden = !open;
        viewButton.setAttribute("aria-expanded", String(open));
        viewButton.textContent = open ? "Hide" : "View";
        if (open && !full.dataset.loaded) {
          full.dataset.loaded = "1";
          replace(full, loading());
          try {
            replace(full, questionPreview((await api.myQuestion(item.id)).question));
          } catch (error) {
            delete full.dataset.loaded;
            replace(full, errorBanner(error, app.reconnect));
          }
        }
      });
      return el("li", { class: "qlist-item mine-row" },
        el("div", { class: "qlist-head" }, box,
          el("a", { href: hash("run", { id: item.id }) }, el("strong", { text: `${item.paper} · Q${item.question_number}` })),
          el("span", { class: `chip ${item.bank === "MOCK" ? "chip-mock" : ""}`, text: item.bank }),
          el("span", { class: "chip", text: TYPE_LABELS[item.question_type] || item.question_type }),
          el("span", { class: "muted", text: [item.subject, item.topics.join(", ")].filter(Boolean).join(" · ") }),
          el("span", { class: "row-tools" }, viewButton,
            el("a", { class: "btn btn-ghost btn-small", href: hash("add/form", { id: item.id }) }, "Edit"),
            el("button", { class: "btn btn-ghost btn-small", type: "button", onclick: () => removal(rowPanel, { ids: [item.id] }, "this question", app, refresh) }, "Remove"))),
        el("p", { class: "qlist-preview", text: item.preview }),
        el("p", { class: "muted small", text: [`Added ${when(item.created_at)}`, item.updated_at !== item.created_at ? `changed ${when(item.updated_at)}` : "",
          item.batch ? `batch: ${item.batch.name}` : ""].filter(Boolean).join(" · ") }),
        rowPanel, full);
    })),
    pager(found.page, found.pages, (next) => { location.hash = here({ page: next }); }));
  sync();
}

// -- history: the batches you added questions in --------------------------------------------------------------------
export async function historyView(view, app, params) {
  const body = el("div", {}, loading());
  append(view, [showNotice(),
    el("p", { class: "muted", text: "Each upload is one batch, and the questions you type in the form make one batch per day. Questions added before "
      + "batches were recorded are grouped by the time they were added (one upload each). Removing a batch removes its questions and everything "
      + "that refers to them; you see what that is before anything goes." }),
    body]);
  let list;
  try {
    list = await api.myBatches(params.get("exam") ? { exam: params.get("exam") } : {});
  } catch (error) {
    replace(body, errorBanner(error, app.reconnect));
    return;
  }
  if (!body.isConnected) {
    return;
  }
  if (!list.length) {
    replace(body, emptyState("You have not added any questions yet.", el("a", { class: "btn btn-primary", href: "#/add" }, "Upload a file")));
    return;
  }
  const refresh = () => window.dispatchEvent(new HashChangeEvent("hashchange"));
  replace(body, el("ol", { class: "batch-list" }, list.map((batch) => {
    const panel = el("div");
    const removed = batch.added - batch.questions;
    const counts = [plural(batch.questions, "question"), removed > 0 ? `${batch.added} added, ${removed} removed since` : "",
      batch.skipped ? `${plural(batch.skipped, "duplicate")} skipped` : ""].filter(Boolean).join(" · ");
    const banks = Object.entries(batch.banks).map(([bank, count]) => `${bank} ${count}`).join(", ");
    const where = { exam: batch.exam, batch: batch.id };
    return el("li", { class: "card batch-row" },
      el("div", { class: "qlist-head" },
        el("strong", { text: batch.name }),
        el("span", { class: "chip", text: KIND_LABELS[batch.kind] || batch.kind }),
        el("span", { class: "muted", text: examLabel(batch.exam) }),
        el("span", { class: "muted small", text: when(batch.created_at) })),
      el("p", { class: "batch-counts", text: counts }),
      el("p", { class: "muted small", text: [banks, batch.kind !== "earlier" && batch.papers.length ? batch.papers.slice(0, 4).join("; ") : "",
        batch.subjects.slice(0, 4).join(", ")].filter(Boolean).join(" · ") }),
      el("div", { class: "actions" },
        el("a", { class: "btn btn-small", href: hash("add/mine", { ...where, view: "list" }) }, "View questions"),
        el("a", { class: "btn btn-ghost btn-small", href: hash("add/mine", where) }, "By topic"),
        el("button", { class: "btn btn-ghost btn-small", type: "button",
          onclick: () => removal(panel, { batch: batch.id, exam: batch.exam }, `the batch “${batch.name}” (${plural(batch.questions, "question")})`, app, refresh) },
        "Remove batch")),
      panel);
  })));
}
