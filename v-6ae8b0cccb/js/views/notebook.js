// Error notebook (CP40A): for any question, why it went wrong and the point to remember, reviewed by exam, year and
// question number (or by topic), filtered, practised again, and exported for revision. Kept by the worker in user.sqlite.
import { api } from "../api.js";
import {
  answerText, bar, el, emptyState, errorBanner, examName, hash, loading, questionLabel, replace, when,
} from "../ui.js";

// The worker accepts exactly these reasons; the order is the order shown
export const MISTAKE_REASONS = [
  ["concept_unknown", "Concept not known"],
  ["concept_misunderstood", "Concept misunderstood"],
  ["misread", "Misread the question"],
  ["calculation", "Calculation slip"],
  ["careless", "Careless mistake"],
  ["formula", "Formula forgotten"],
  ["time", "Ran out of time"],
  ["guessed", "Guessed"],
  ["other", "Other"],
];
const REASON_LABEL = Object.fromEntries(MISTAKE_REASONS);
const MAX_TEXT = 5000;
const MAX_RUN = 100;

export function reasonChips(reasons) {
  return reasons.length ? el("span", { class: "reason-chips" }, reasons.map((reason) => el("span", { class: "reason-chip", text: REASON_LABEL[reason] || reason }))) : null;
}

export function entryText(entry) {
  return [
    reasonChips(entry.reasons),
    entry.what_went_wrong ? el("p", { class: "mistake-text" }, el("strong", { text: "What went wrong: " }), entry.what_went_wrong) : null,
    entry.remember ? el("p", { class: "mistake-text mistake-remember" }, el("strong", { text: "Remember: " }), entry.remember) : null,
  ];
}

// A new entry (questionId, and attemptId when it explains a wrong answer), or changes to an existing one (entry).
export function mistakeForm({ entry, questionId, attemptId, onSaved, onCancel }) {
  const chosen = new Set(entry ? entry.reasons : []);
  const what = el("textarea", { rows: "2", maxlength: String(MAX_TEXT), placeholder: "for example: took the page size as 2 KB instead of 4 KB" });
  const remember = el("textarea", { rows: "2", maxlength: String(MAX_TEXT), placeholder: "for example: read the units in the question twice" });
  what.value = entry ? entry.what_went_wrong : "";
  remember.value = entry ? entry.remember : "";
  const status = el("span", { class: "muted small", role: "status" });
  const save = el("button", { class: "btn btn-primary btn-small", type: "submit" }, entry ? "Save changes" : "Add to notebook");
  const form = el("form", { class: "mistake-form" },
    el("fieldset", { class: "reason-picker" }, el("legend", { text: "Why did it go wrong?" }),
      MISTAKE_REASONS.map(([code, label]) => el("label", { class: "reason-choice" },
        el("input", { type: "checkbox", value: code, checked: chosen.has(code) }), el("span", { text: label })))),
    el("label", { class: "field" }, el("span", { text: "What went wrong" }), what),
    el("label", { class: "field" }, el("span", { text: "Point to remember" }), remember),
    el("div", { class: "actions" }, save,
      onCancel ? el("button", { class: "btn btn-ghost btn-small", type: "button", onclick: onCancel }, "Cancel") : null,
      status));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = { reasons: [...form.querySelectorAll(".reason-choice input:checked")].map((input) => input.value),
      what_went_wrong: what.value, remember: remember.value };
    if (!body.reasons.length && !body.what_went_wrong.trim() && !body.remember.trim()) {
      status.textContent = "Choose a reason or write something first.";
      return;
    }
    save.disabled = true;
    status.textContent = "Saving…";
    try {
      const saved = entry
        ? await api.updateMistake(entry.id, body)
        : await api.addMistake({ question_id: questionId, attempt_id: attemptId ?? undefined, ...body });
      onSaved(saved);
    } catch (error) {
      status.textContent = error.message;
      save.disabled = false;
    }
  });
  form.focusFirst = () => form.querySelector("input").focus();
  return form;
}

function entryLabel(entry) {
  return entry.question ? questionLabel(entry.question) : `${entry.paper || examName(entry.exam)} · Q${entry.question_number}`;
}

function practiseHref(ids, at) {
  const list = ids.slice(0, MAX_RUN);
  return list.includes(at) ? hash("run", { ids: list.join(","), at, title: "Error notebook" }) : hash("run", { id: at });
}

function entryCard(entry, ids, redraw, app) {
  const card = el("article", { class: entry.resolved ? "mistake resolved" : "mistake" });
  let confirming = null;

  async function change(work) {
    try {
      await work();
    } catch (error) {
      card.appendChild(errorBanner(error, app.reconnect));
    }
  }

  function draw() {
    const del = el("button", { class: "btn btn-ghost btn-small", type: "button" }, "Delete");
    del.addEventListener("click", () => {
      if (!confirming) {
        del.textContent = "Delete? Click again";
        confirming = setTimeout(() => {
          confirming = null;
          del.textContent = "Delete";
        }, 4000);
        return;
      }
      clearTimeout(confirming);
      change(async () => {
        await api.deleteMistake(entry.id);
        redraw({ removed: entry.id });
      });
    });
    replace(card,
      el("div", { class: "mistake-head" },
        el("a", { href: practiseHref(ids, entry.question_id), class: "mistake-label" }, entryLabel(entry)),
        entry.subject ? el("span", { class: "muted small", text: entry.subject }) : null,
        entry.topics.map((topic) => el("span", { class: "chip", text: topic.name })),
        entry.resolved ? el("span", { class: "chip chip-good", text: "Resolved" }) : null),
      entry.question
        ? el("p", { class: "qlist-preview", text: entry.question.preview || "" })
        : el("p", { class: "muted small", text: "This question is no longer in the dataset; the entry is kept." }),
      entryText(entry),
      el("div", { class: "mistake-foot" },
        el("span", { class: "muted small", text: `Written ${when(entry.created_at)}${entry.resolved ? ` · resolved ${when(entry.resolved_at)}` : ""}` }),
        el("span", { class: "mistake-actions" },
          el("button", { class: "btn btn-ghost btn-small", type: "button", onclick: () => edit() }, "Edit"),
          el("button", { class: "btn btn-ghost btn-small", type: "button", onclick: () => change(async () => {
            entry = await api.updateMistake(entry.id, { resolved: !entry.resolved });
            redraw({ changed: entry });
          }) }, entry.resolved ? "Reopen" : "Mark resolved"),
          del)));
  }

  function edit() {
    const form = mistakeForm({ entry, onSaved: (saved) => {
      entry = saved;
      redraw({ changed: saved });
    }, onCancel: () => draw() });
    replace(card, el("div", { class: "mistake-head" }, el("strong", { text: entryLabel(entry) })), form);
    form.focusFirst();
  }

  draw();
  return card;
}

function groupByPaper(entries, ids, redraw, app) {
  const exams = new Map();
  entries.forEach((entry) => {
    const exam = exams.get(entry.exam) || new Map();
    exams.set(entry.exam, exam);
    const year = String(entry.year ?? "Other");
    exam.set(year, [...(exam.get(year) || []), entry]);
  });
  return [...exams.entries()].map(([exam, years]) => el("section", { class: "notebook-group" },
    el("h2", { text: `${examName(exam)} (${[...years.values()].reduce((sum, list) => sum + list.length, 0)})` }),
    [...years.entries()].map(([year, list]) => el("div", { class: "notebook-year" },
      el("h3", { text: `${year} (${list.length})` }),
      list.map((entry) => entryCard(entry, ids, redraw, app))))));
}

function groupByTopic(entries, ids, redraw, app) {
  const exams = new Map();
  entries.forEach((entry) => {
    const exam = exams.get(entry.exam) || new Map();
    exams.set(entry.exam, exam);
    (entry.topics.length ? entry.topics : [{ id: "", name: "No topic", subject: entry.subject || "Other" }]).forEach((topic) => {
      const key = `${topic.subject} › ${topic.name}`;
      exam.set(key, [...(exam.get(key) || []), entry]);
    });
  });
  return [...exams.entries()].map(([exam, topics]) => el("section", { class: "notebook-group" },
    el("h2", { text: examName(exam) }),
    el("p", { class: "muted small", text: "A question with several topics is listed under each of them." }),
    [...topics.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([topic, list]) => el("div", { class: "notebook-year" },
      el("h3", { text: `${topic} (${list.length})` }),
      list.map((entry) => entryCard(entry, ids, redraw, app))))));
}

function reasonSummary(entries) {
  const counts = new Map();
  entries.forEach((entry) => entry.reasons.forEach((reason) => counts.set(reason, (counts.get(reason) || 0) + 1)));
  if (!counts.size) {
    return null;
  }
  const most = Math.max(...counts.values());
  const rows = MISTAKE_REASONS.filter(([code]) => counts.has(code)).sort(([a], [b]) => counts.get(b) - counts.get(a));
  return el("section", { class: "card" }, el("h2", { text: "Most frequent reasons" }),
    el("ul", { class: "reason-bars" }, rows.map(([code, label]) => el("li", {},
      el("a", { href: "", "data-reason": code, text: label }), bar(counts.get(code) / most), el("span", { class: "count", text: String(counts.get(code)) })))));
}

function markdown(entries, describeFilters) {
  const lines = ["# Error notebook", "", `Exported ${when(new Date().toISOString())}. ${entries.length} entr${entries.length === 1 ? "y" : "ies"}${describeFilters ? `; ${describeFilters}` : ""}.`];
  let exam = null;
  let year = null;
  const quote = (text) => String(text).trim().split(/\r?\n/).map((line) => `> ${line}`).join("\n");
  entries.forEach((entry) => {
    if (entry.exam !== exam) {
      exam = entry.exam;
      year = null;
      lines.push("", `## ${examName(exam)}`);
    }
    if (entry.year !== year) {
      year = entry.year;
      lines.push("", `### ${year ?? "Other"}`);
    }
    lines.push("", `#### ${entryLabel(entry)}${entry.subject ? ` (${entry.subject})` : ""}${entry.resolved ? " [resolved]" : ""}`, "");
    if (entry.topics.length) {
      lines.push(`Topics: ${entry.topics.map((topic) => topic.name).join(", ")}  `);
    }
    if (entry.reasons.length) {
      lines.push(`Reasons: ${entry.reasons.map((reason) => REASON_LABEL[reason] || reason).join(", ")}  `);
    }
    lines.push(`Written: ${when(entry.created_at)}${entry.resolved ? `; resolved ${when(entry.resolved_at)}` : ""}`);
    if (entry.question && entry.question.text) {
      lines.push("", "Question:", "", quote(entry.question.text), "", `Answer: ${answerText(entry.question, entry.question.answer)}`);
    }
    if (entry.what_went_wrong) {
      lines.push("", `**What went wrong:** ${entry.what_went_wrong}`);
    }
    if (entry.remember) {
      lines.push("", `**Remember:** ${entry.remember}`);
    }
  });
  return lines.join("\n") + "\n";
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const anchor = el("a", { href: url, download: name, hidden: true });
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function renderNotebook(view, { params, app }) {
  const values = Object.fromEntries(["exam", "year", "subject", "topic", "reason", "q", "group"].map((key) => [key, params.get(key) || ""]));
  const onlyOpen = params.get("open") === "1";
  const exam = app.exams.find((entry) => entry.exam === values.exam);
  const pick = (entries) => [...new Set(entries)];
  const years = pick(exam ? Object.keys(exam.years || {}) : app.exams.flatMap((entry) => Object.keys(entry.years || {}))).sort().reverse();
  const subjects = pick(exam ? Object.keys(exam.subjects || {}) : app.exams.flatMap((entry) => Object.keys(entry.subjects || {})))
    .filter((subject) => subject !== "(none)").sort();
  const option = (value, text, current) => el("option", { value, text, selected: String(value) === String(current) });
  const topicSelect = el("select", { name: "topic", disabled: !exam }, option("", exam ? "Any topic" : "Choose an exam first", values.topic),
    values.topic ? option(values.topic, values.topic, values.topic) : null);
  const form = el("form", { class: "search-form notebook-filters" },
    el("label", { class: "field" }, el("span", { text: "Exam" }),
      el("select", { name: "exam" }, option("", "All exams", values.exam), app.exams.map((entry) => option(entry.exam, examName(entry.exam), values.exam)))),
    el("label", { class: "field" }, el("span", { text: "Year" }),
      el("select", { name: "year" }, option("", "Any year", values.year), years.map((year) => option(year, year, values.year)))),
    el("label", { class: "field" }, el("span", { text: "Subject" }),
      el("select", { name: "subject" }, option("", "Any subject", values.subject), subjects.map((subject) => option(subject, subject, values.subject)))),
    el("label", { class: "field" }, el("span", { text: "Topic" }), topicSelect),
    el("label", { class: "field" }, el("span", { text: "Reason" }),
      el("select", { name: "reason" }, option("", "Any reason", values.reason), MISTAKE_REASONS.map(([code, label]) => option(code, label, values.reason)))),
    el("label", { class: "field grow" }, el("span", { text: "Words in your notes" }),
      el("input", { type: "search", name: "q", value: values.q, autocomplete: "off" })),
    el("label", { class: "field" }, el("span", { text: "Group by" }),
      el("select", { name: "group" }, option("", "Year and paper", values.group), option("topic", "Topic", values.group))),
    el("label", { class: "check" }, el("input", { type: "checkbox", name: "open", value: "1", checked: onlyOpen }), "Only not resolved"),
    el("button", { class: "btn btn-primary", type: "submit" }, "Show"));
  const submit = () => {
    const data = new FormData(form);
    location.hash = hash("notebook", Object.fromEntries([...data.entries()].map(([key, value]) => [key, String(value).trim()])));
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit();
  });
  form.elements.exam.addEventListener("change", () => {
    topicSelect.value = "";
    form.elements.year.value = "";
    form.elements.subject.value = "";
    submit();
  });
  ["year", "subject", "topic", "reason", "group", "open"].forEach((name) => form.elements[name].addEventListener("change", submit));
  if (exam) {
    api.examTopics(exam.exam).then((data) => {
      replace(topicSelect, option("", "Any topic", values.topic),
        data.subjects.map((subject) => el("optgroup", { label: subject.subject },
          subject.topics.map((topic) => option(topic.id, topic.name, values.topic)))));
    }, () => {});
  }

  const head = el("div", { class: "page-head" }, el("h1", { text: "Error notebook" }));
  const tools = el("div", { class: "actions notebook-actions" });
  const summary = el("div");
  const body = el("div", {}, loading());
  view.append(head,
    el("p", { class: "muted", text: "Why answers went wrong and what to remember. Add an entry from any question: after a wrong answer, or with the Notebook button." }),
    el("section", { class: "card no-print" }, form), tools, summary, body);

  const query = { exam: values.exam, year: values.year, subject: values.subject, topic: exam ? values.topic : "", reason: values.reason,
    q: values.q, resolved: onlyOpen ? "false" : "" };
  let entries;
  try {
    entries = (await api.mistakes(query)).mistakes;
  } catch (error) {
    body.replaceChildren(errorBanner(error, app.reconnect));
    return;
  }
  if (!view.isConnected) {
    return;
  }
  const filtered = Object.values(query).some(Boolean);

  function draw() {
    const ids = [...new Set(entries.map((entry) => entry.question_id))];
    replace(tools,
      el("span", { class: "muted", role: "status", text: `${entries.length} entr${entries.length === 1 ? "y" : "ies"}, ${ids.length} question${ids.length === 1 ? "" : "s"}` }),
      ids.length ? el("a", { class: "btn btn-primary", href: hash("run", { ids: ids.slice(0, MAX_RUN).join(","), title: "Error notebook" }) },
        ids.length > MAX_RUN ? `Practise the first ${MAX_RUN}` : "Practise these") : null,
      entries.length ? el("button", { class: "btn", type: "button", onclick: async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
          const full = (await api.mistakes({ ...query, full: "true" })).mistakes;
          const described = [values.exam && examName(values.exam), values.year, values.subject, values.reason && REASON_LABEL[values.reason],
            values.q && `"${values.q}"`, onlyOpen && "not resolved"].filter(Boolean).join(", ");
          download(`error-notebook-${new Date().toISOString().slice(0, 10)}.md`, markdown(full, described));
        } catch (error) {
          tools.appendChild(errorBanner(error, app.reconnect));
        } finally {
          button.disabled = false;
        }
      } }, "Export Markdown") : null,
      entries.length ? el("button", { class: "btn", type: "button", onclick: () => window.print() }, "Print") : null);
    replace(summary, reasonSummary(entries));
    summary.querySelectorAll("a[data-reason]").forEach((anchor) => {
      anchor.href = hash("notebook", { ...values, open: onlyOpen ? "1" : "", reason: anchor.dataset.reason });
    });
    if (!entries.length) {
      replace(body, emptyState(filtered ? "No entries match these filters." : "No entries yet. After a wrong answer, choose \"Add to error notebook\".",
        filtered ? el("a", { class: "btn", href: "#/notebook" }, "Show all entries") : el("a", { class: "btn btn-primary", href: "#/practice" }, "Practice")));
      return;
    }
    replace(body, values.group === "topic" ? groupByTopic(entries, ids, redraw, app) : groupByPaper(entries, ids, redraw, app));
  }

  function redraw({ removed, changed }) {
    if (removed !== undefined) {
      entries = entries.filter((entry) => entry.id !== removed);
    }
    if (changed) {
      entries = entries.map((entry) => (entry.id === changed.id ? changed : entry));
      if (onlyOpen && changed.resolved) {
        entries = entries.filter((entry) => entry.id !== changed.id);
      }
    }
    draw();
  }

  draw();
}
