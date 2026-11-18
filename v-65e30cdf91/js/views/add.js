// Add questions (CP40D): your own PYQs and mock questions, from an Excel, CSV or JSON file or typed into a form, and the
// list of the questions you added (view, edit, delete). Uploads only add; a question identical to one already added is
// skipped. Mock questions need options, the answer, a solution and the reasoning; PYQs need the answer and the year.
// A topic name the topic list does not have becomes a new topic of the question's subject (CP40E), shown before adding.
import { api } from "../api.js";
import {
  answerText, append, blocks, el, emptyState, errorBanner, examLabel, hash, loading, replace, tabs, TYPE_LABELS, when,
} from "../ui.js";

const SECTIONS = [["", "Upload a file"], ["form", "Type a question"], ["mine", "My questions"]];
const MAX_FILE = 6 * 1024 * 1024;
const BANKS = [["MOCK", "Mock questions"], ["PYQ", "Previous year questions (PYQ)"]];
let format = null; // the columns and each exam's subjects, from the worker; loaded once

async function loadFormat() {
  format = format || await api.authoredFormat();
  return format;
}

function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = el("a", { href: url, download: name, hidden: true });
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function examOptions(app, current) {
  return app.exams.map((exam) => el("option", { value: exam.exam, text: examLabel(exam.exam), selected: exam.exam === current }));
}

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

// The topics the file or the form names that the topic list does not have yet (CP40E): they are created on adding.
function newTopicsBanner(topics, action) {
  if (!topics || !topics.length) {
    return null;
  }
  return el("div", { class: "banner info" },
    el("p", { text: `${topics.length === 1 ? "A new topic" : `${topics.length} new topics`} will be added to the topic list when you ${action}:` }),
    el("ul", {}, topics.map((topic) => el("li", {}, el("b", { text: topic.name }), ` in ${topic.subject}`,
      topic.questions > 1 ? ` (${topic.questions} questions)` : ""))),
    el("p", { class: "muted small", text: "Meant an existing topic? Use its name exactly as on Topic wise (case and spacing do not matter), then check again." }));
}

// -- upload ----------------------------------------------------------------------------------------------------------
function columnsTable(columns) {
  return el("details", { class: "columns-help" }, el("summary", { text: "The columns, and how to write maths and code" }),
    el("div", { class: "table-wrap" }, el("table", { class: "data" },
      el("thead", {}, el("tr", {}, ["Column", "Required", "What it holds", "Example"].map((name) => el("th", { scope: "col", text: name })))),
      el("tbody", {}, columns.map((column) => el("tr", {},
        el("th", { scope: "row" }, el("code", { text: column.name })), el("td", { text: column.required }), el("td", { text: column.help }),
        el("td", {}, column.example ? el("code", { text: column.example }) : null)))))),
    el("ul", { class: "format-tips" },
      el("li", {}, el("code", { text: "$x^2$" }), " inline maths (LaTeX); ", el("code", { text: "$$\\frac{a}{b}$$" }), " maths on its own line"),
      el("li", {}, el("code", { text: "```" }), " on the lines before and after a block of code; ", el("code", { text: "**bold**" })),
      el("li", { text: "A new line in a cell (Alt+Enter in Excel) is kept. Write \\$ for a dollar sign that is not maths." }),
      el("li", { text: "Images cannot be uploaded: describe a figure in words, maths or a code block." })));
}

function uploadView(view, app) {
  const status = el("p", { class: "muted small", role: "status" });
  const templates = el("section", { class: "card" },
    el("h2", { text: "1. Fill in the template" }),
    el("p", { text: "One row per question. The Excel template is the easiest: it keeps maths, symbols and multi-line cells intact and has a "
      + "\"How to fill it in\" sheet. CSV (saved as CSV UTF-8) and JSON work too." }),
    el("div", { class: "actions" }, [["xlsx", "Excel template (.xlsx)", "btn-primary"], ["csv", "CSV", ""], ["json", "JSON", ""]].map(([kind, text, style]) =>
      el("button", { class: `btn ${style}`, type: "button", onclick: async () => {
        status.textContent = "Downloading…";
        try {
          const file = await api.download(`/api/authored/sample.${kind}`);
          save(file.blob, file.name);
          status.textContent = `Saved ${file.name}: six sample questions (five mock, one PYQ) to copy from.`;
        } catch (error) {
          status.textContent = error.message;
        }
      } }, text)), status),
    el("div", { class: "columns-slot" }, loading("Loading the column list…")));
  const bank = el("select", { name: "bank" }, BANKS.map(([value, text]) => el("option", { value, text })));
  const exam = el("select", { name: "exam" }, examOptions(app, app.settings.default_exam || (app.exams[0] || {}).exam));
  const input = el("input", { type: "file", accept: ".xlsx,.csv,.json,application/json,text/csv", "aria-label": "Question file" });
  const check = el("button", { class: "btn btn-primary", type: "submit", disabled: true }, "Check file");
  const results = el("div");
  const form = el("form", { class: "card upload-form" },
    el("h2", { text: "2. Upload it" }),
    el("p", { class: "muted", text: "Rows that leave bank or exam empty use these:" }),
    el("div", { class: "inline-form" },
      el("label", { class: "field" }, el("span", { text: "Bank" }), bank),
      el("label", { class: "field" }, el("span", { text: "Exam" }), exam),
      el("label", { class: "field grow" }, el("span", { text: "File (.xlsx, .csv or .json, up to 6 MB)" }), input),
      check));
  input.addEventListener("change", () => {
    check.disabled = !input.files.length;
    replace(results);
  });
  let pending = null;

  async function send(dryRun) {
    const file = pending;
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",", 2)[1] || "");
      reader.onerror = () => reject(new Error("The file could not be read."));
      reader.readAsDataURL(file);
    });
    return api.uploadQuestions({ name: file.name, data }, { bank: bank.value, exam: exam.value }, dryRun);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    pending = input.files[0];
    if (!pending) {
      return;
    }
    if (pending.size > MAX_FILE) {
      replace(results, errorBanner(new Error("The file is larger than 6 MB: split it into smaller files.")));
      return;
    }
    replace(results, loading("Checking every row…"));
    try {
      showCheck(await send(true));
    } catch (error) {
      replace(results, errorBanner(error, app.reconnect));
    }
  });

  function rowStatus(row) {
    const label = { new: "Ready", duplicate: "Duplicate", error: "Needs fixing" }[row.status];
    return el("span", { class: `status-chip ${row.status}`, text: label });
  }

  function showCheck(report) {
    const counts = report.counts;
    const add = el("button", { class: "btn btn-primary", type: "button", disabled: !counts.new },
      counts.new ? `Add ${counts.new} question${counts.new === 1 ? "" : "s"}` : "Nothing to add");
    const note = el("span", { class: "muted small", role: "status" });
    add.addEventListener("click", async () => {
      add.disabled = true;
      note.textContent = "Adding…";
      try {
        const done = await send(false);
        await app.refreshExams();
        const ids = done.rows.filter((row) => row.status === "new").map((row) => row.id);
        replace(results, el("section", { class: "card banner-good" },
          el("h2", { text: `Added ${done.added} question${done.added === 1 ? "" : "s"}.` }),
          (done.new_topics || []).length ? el("p", { text: `New topic${done.new_topics.length === 1 ? "" : "s"} added to the topic list: ${done.new_topics.map((topic) => topic.name).join(", ")}.` }) : null,
          done.counts.duplicate ? el("p", { text: `${done.counts.duplicate} skipped as duplicates.` }) : null,
          done.counts.error ? el("p", { text: `${done.counts.error} still need fixing: correct them in the file and upload it again (the rest will be skipped as duplicates).` }) : null,
          el("div", { class: "actions" },
            ids.length ? el("a", { class: "btn btn-primary", href: hash("run", { ids: ids.slice(0, 100).join(","), title: "Questions just added" }) }, "Practise them") : null,
            el("a", { class: "btn", href: "#/add/mine" }, "My questions"))));
        input.value = "";
        check.disabled = true;
      } catch (error) {
        add.disabled = false;
        note.textContent = error.message;
      }
    });
    replace(results, el("section", { class: "card" },
      el("h2", { text: `Checked ${report.file}` }),
      el("div", { class: "tiles" },
        el("div", { class: "tile" }, el("span", { class: "tile-value", text: String(counts.new) }), el("span", { text: "ready to add" })),
        el("div", { class: "tile" }, el("span", { class: "tile-value", text: String(counts.duplicate) }), el("span", { text: "duplicates (skipped)" })),
        el("div", { class: "tile" }, el("span", { class: "tile-value", text: String(counts.error) }), el("span", { text: "need fixing" }))),
      report.warnings.length ? el("div", { class: "banner warn" }, el("ul", {}, report.warnings.map((warning) => el("li", { text: warning })))) : null,
      newTopicsBanner(report.new_topics, "add these questions"),
      el("div", { class: "actions" }, add, note,
        counts.error ? el("span", { class: "muted small", text: "Rows that need fixing are not added; fix them in the file and upload it again." }) : null),
      el("ol", { class: "check-rows" }, report.rows.map((row) => el("li", { class: `check-row ${row.status}` },
        el("div", { class: "check-head" }, el("strong", { text: row.where }), rowStatus(row),
          row.label ? el("span", { class: "muted small", text: `${row.bank} · ${examLabel(row.exam)} · ${row.label}` }) : null,
          row.duplicate_of ? el("span", { class: "muted small", text: `same as ${row.duplicate_of}` }) : null),
        row.errors.length ? el("ul", { class: "problems" }, row.errors.map((error) => el("li", { text: error }))) : null,
        row.warnings.length ? el("ul", { class: "warnings" }, row.warnings.map((warning) => el("li", { text: warning }))) : null,
        row.preview ? lazyPreview(row.preview) : null)))));
  }

  view.append(templates, form, results);
  loadFormat().then((data) => {
    templates.querySelector(".columns-slot").replaceChildren(columnsTable(data.columns));
  }, (error) => templates.querySelector(".columns-slot").replaceChildren(errorBanner(error, app.reconnect)));
}

function lazyPreview(question) {
  const details = el("details", { class: "preview-toggle" }, el("summary", { text: "Preview" }));
  details.addEventListener("toggle", () => {
    if (details.open && details.children.length === 1) {
      details.appendChild(questionPreview(question));
    }
  }, { once: false });
  return details;
}

// -- one question, typed in ------------------------------------------------------------------------------------------
async function formView(view, app, params) {
  const editing = params.get("id");
  view.appendChild(loading());
  let data;
  let cells = {};
  try {
    data = await loadFormat();
    if (editing) {
      cells = (await api.myQuestion(editing)).cells;
    }
  } catch (error) {
    view.replaceChildren(errorBanner(error, app.reconnect));
    return;
  }
  if (!view.isConnected) {
    return;
  }
  view.replaceChildren();
  const fields = {};
  const helpOf = Object.fromEntries(data.columns.map((column) => [column.name, column.help]));
  const text = (name, label, attrs) => {
    fields[name] = el("input", { type: "text", name, value: cells[name] || "", autocomplete: "off", ...(attrs || {}) });
    return el("label", { class: "field" }, el("span", { text: label }), fields[name]);
  };
  const area = (name, label, rows) => {
    fields[name] = el("textarea", { name, rows: String(rows || 3), placeholder: helpOf[name] || "" });
    fields[name].value = cells[name] || "";
    return el("label", { class: "field wide" }, el("span", { text: label }), fields[name]);
  };
  const choice = (name, label, options, current) => {
    fields[name] = el("select", { name }, options.map(([value, textValue]) => el("option", { value, text: textValue, selected: String(value) === String(current) })));
    return el("label", { class: "field" }, el("span", { text: label }), fields[name]);
  };
  const examId = cells.exam || app.settings.default_exam || (app.exams[0] || {}).exam;
  const subjectSlot = el("span");
  const topicHint = el("datalist", { id: "topic-names" });
  const loadTopicHints = () => {
    api.examTopics(fields.exam.value).then((topics) => replace(topicHint,
      topics.subjects.flatMap((subject) => subject.topics.map((topic) => el("option", { value: topic.name, label: subject.subject })))), () => {});
  };
  const drawSubjects = () => {
    const subjects = (data.exams[fields.exam.value] || {}).subjects || [];
    subjectSlot.replaceChildren(choice("subject", "Subject", [["", "Choose…"], ...subjects.map((name) => [name, name])], cells.subject || ""));
    loadTopicHints();
  };
  const optionsBox = el("div", { class: "form-options" }, "ABCDEF".split("").map((label) => area(`option_${label.toLowerCase()}`, `Option ${label}`, 2)));
  const check = el("div", { class: "form-check" });
  const form = el("form", { class: "card question-form" },
    el("div", { class: "form-grid" },
      choice("bank", "Bank", BANKS, cells.bank || "MOCK"),
      choice("exam", "Exam", app.exams.map((exam) => [exam.exam, examLabel(exam.exam)]), examId),
      text("paper", "Paper or mock set", { placeholder: "e.g. Mock Test 1" }),
      text("year", "Year (PYQ)", { inputmode: "numeric", placeholder: "e.g. 2027" }),
      text("question_number", "Question number", { inputmode: "numeric", placeholder: "next free" }),
      subjectSlot,
      text("topics", "Topics (separated by ;)", { list: "topic-names", placeholder: "e.g. Stacks; a new name adds a topic",
        title: "Pick names from the list; a name the list does not have becomes a new topic of the question's subject" }),
      choice("type", "Type", [["MCQ", "MCQ: one correct option"], ["MSQ", "MSQ: one or more"], ["NAT", "NAT: a number"]], cells.type || "MCQ"),
      choice("marks", "Marks", [["1", "1"], ["2", "2"]], cells.marks || "1"),
      text("negative_marks", "Negative marks", { inputmode: "decimal", placeholder: "GATE rule" }),
      choice("difficulty", "Difficulty", [["", "—"], ["easy", "easy"], ["medium", "medium"], ["hard", "hard"]], cells.difficulty || ""),
      text("tags", "Tags (separated by ;)"),
      text("source", "Source (web address or note)")),
    topicHint,
    area("question", "Question", 5),
    optionsBox,
    text("answer", "Answer", { placeholder: "MCQ: B · MSQ: A, C · NAT: 42 or 2.45 to 2.55" }),
    area("solution", "Solution (required for mock)", 5),
    area("reasoning", "Reasoning: the idea behind the solution (required for mock)", 3),
    el("p", { class: "muted small", text: "Maths in $...$ or $$...$$, code between ``` lines, **bold**. No images." }),
    el("div", { class: "actions" },
      el("button", { class: "btn", type: "button", onclick: () => preview() }, "Preview"),
      el("button", { class: "btn btn-primary", type: "submit" }, editing ? "Save changes" : "Add question"),
      editing ? el("a", { class: "btn btn-ghost", href: hash("run", { id: editing }) }, "Open in practice") : null),
    check);
  fields.option_a.parentElement.classList.add("option-field");
  const drawType = () => {
    optionsBox.hidden = fields.type.value === "NAT";
  };
  fields.exam.addEventListener("change", () => {
    cells.subject = "";
    drawSubjects();
  });
  fields.type.addEventListener("change", drawType);
  drawSubjects();
  drawType();

  function values() {
    const found = {};
    Object.entries(fields).forEach(([name, node]) => {
      found[name] = node.value;
    });
    found.subject = (form.querySelector("select[name=subject]") || {}).value || "";
    if (found.type === "NAT") {
      "abcdef".split("").forEach((label) => {
        found[`option_${label}`] = "";
      });
    }
    return found;
  }

  function showProblems(result) {
    replace(check,
      result.errors && result.errors.length ? el("div", { class: "banner bad" }, el("p", { text: "Fix these first:" }),
        el("ul", {}, result.errors.map((error) => el("li", { text: error })))) : null,
      result.duplicate_of ? el("div", { class: "banner warn" }, el("p", { text: `This question is already added: ${result.duplicate_of}.` })) : null,
      newTopicsBanner(result.new_topics, editing ? "save" : "add this question"),
      result.warnings && result.warnings.length ? el("div", { class: "banner warn" }, el("ul", {}, result.warnings.map((warning) => el("li", { text: warning })))) : null,
      result.preview ? el("section", { class: "card" }, el("h2", { text: "Preview" }), questionPreview(result.preview)) : null);
  }

  async function preview() {
    replace(check, loading("Checking…"));
    try {
      showProblems(await api.checkQuestion(values(), editing || undefined));
    } catch (error) {
      replace(check, errorBanner(error, app.reconnect));
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    replace(check, loading(editing ? "Saving…" : "Adding…"));
    try {
      const result = editing ? await api.updateQuestion(editing, values()) : await api.addQuestion(values());
      const saved = result.question;
      const created = result.new_topics || [];
      await app.refreshExams();
      loadTopicHints();
      replace(check, el("div", { class: "banner banner-good" },
        el("p", { text: editing ? "Saved." : `Added as ${saved.paper} Q${saved.question_number}.` }),
        created.length ? el("p", { text: `New topic${created.length === 1 ? "" : "s"} added to the topic list: ${created.map((topic) => topic.name).join(", ")}.` }) : null,
        el("div", { class: "actions" },
          el("a", { class: "btn btn-primary", href: hash("run", { id: saved.id }) }, "Open it"),
          editing ? null : el("button", { class: "btn", type: "button", onclick: () => {
            ["question", "option_a", "option_b", "option_c", "option_d", "option_e", "option_f", "answer", "solution", "reasoning", "question_number"]
              .forEach((name) => { fields[name].value = ""; });
            replace(check);
            fields.question.focus();
          } }, "Add another"),
          el("a", { class: "btn btn-ghost", href: "#/add/mine" }, "My questions"))),
      questionPreview(saved));
    } catch (error) {
      replace(check, errorBanner(error, app.reconnect));
    }
  });
  append(view, [editing ? el("p", { class: "muted", text: "Changing a question keeps your answers, notes and topics with it." }) : null, form]);
}

// -- my questions ----------------------------------------------------------------------------------------------------
async function mineView(view, app, params) {
  const values = { exam: params.get("exam") || "", bank: params.get("bank") || "", q: params.get("q") || "" };
  const form = el("form", { class: "card search-form" },
    el("label", { class: "field" }, el("span", { text: "Exam" }),
      el("select", { name: "exam" }, el("option", { value: "", text: "All exams" }), examOptions(app, values.exam))),
    el("label", { class: "field" }, el("span", { text: "Bank" }),
      el("select", { name: "bank" }, [["", "Mock and PYQ"], ...BANKS].map(([value, text]) => el("option", { value, text, selected: value === values.bank })))),
    el("label", { class: "field grow" }, el("span", { text: "Words" }), el("input", { type: "search", name: "q", value: values.q, autocomplete: "off" })),
    el("button", { class: "btn btn-primary", type: "submit" }, "Show"));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    location.hash = hash("add/mine", Object.fromEntries(new FormData(form)));
  });
  form.querySelectorAll("select").forEach((node) => node.addEventListener("change", () => form.requestSubmit()));
  const body = el("div", {}, loading());
  view.append(form, body);
  let found;
  try {
    found = await api.myQuestions(values);
  } catch (error) {
    body.replaceChildren(errorBanner(error, app.reconnect));
    return;
  }
  if (!view.isConnected) {
    return;
  }
  if (!found.total) {
    replace(body, emptyState(values.exam || values.bank || values.q ? "None of your questions match." : "You have not added any questions yet.",
      el("a", { class: "btn btn-primary", href: "#/add" }, "Upload a file")));
    return;
  }
  const chosen = new Set();
  const count = el("span", { class: "muted", role: "status" });
  const remove = el("button", { class: "btn", type: "button", disabled: true }, "Delete selected");
  let confirm = null;
  const all = el("input", { type: "checkbox", "aria-label": "Select all" });
  const sync = () => {
    count.textContent = `${found.total} question${found.total === 1 ? "" : "s"}${chosen.size ? `, ${chosen.size} selected` : ""}`;
    remove.disabled = !chosen.size;
    remove.textContent = "Delete selected";
    all.checked = chosen.size === found.questions.length;
    clearTimeout(confirm);
    confirm = null;
  };
  all.addEventListener("change", () => {
    found.questions.forEach((item) => (all.checked ? chosen.add(item.id) : chosen.delete(item.id)));
    body.querySelectorAll(".mine-row input[type=checkbox]").forEach((box) => { box.checked = all.checked; });
    sync();
  });
  remove.addEventListener("click", async () => {
    if (!confirm) {
      remove.textContent = `Delete ${chosen.size}? Click again`;
      confirm = setTimeout(sync, 4000);
      return;
    }
    clearTimeout(confirm);
    remove.disabled = true;
    try {
      await api.deleteQuestions([...chosen]);
      await app.refreshExams();
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    } catch (error) {
      body.prepend(errorBanner(error, app.reconnect));
      sync();
    }
  });
  const ids = found.questions.map((item) => item.id);
  replace(body,
    el("div", { class: "actions mine-actions" }, el("label", { class: "check" }, all, "All"), count, remove,
      el("a", { class: "btn btn-primary", href: hash("run", { ids: ids.slice(0, 100).join(","), title: "My questions" }) },
        ids.length > 100 ? "Practise the first 100" : "Practise these")),
    el("ol", { class: "qlist" }, found.questions.map((item) => {
      const box = el("input", { type: "checkbox", "aria-label": `Select ${item.paper} Q${item.question_number}` });
      box.addEventListener("change", () => {
        if (box.checked) {
          chosen.add(item.id);
        } else {
          chosen.delete(item.id);
        }
        sync();
      });
      return el("li", { class: "qlist-item mine-row" },
        el("div", { class: "qlist-head" }, box,
          el("a", { href: hash("run", { id: item.id }) }, el("strong", { text: `${item.paper} · Q${item.question_number}` })),
          el("span", { class: `chip ${item.bank === "MOCK" ? "chip-mock" : ""}`, text: item.bank }),
          el("span", { class: "chip", text: TYPE_LABELS[item.question_type] || item.question_type }),
          el("span", { class: "muted", text: [examLabel(item.exam), item.subject, item.topics.join(", ")].filter(Boolean).join(" · ") }),
          el("a", { class: "btn btn-ghost btn-small", href: hash("add/form", { id: item.id }) }, "Edit")),
        el("p", { class: "qlist-preview", text: item.preview }),
        el("p", { class: "muted small", text: `Added ${when(item.created_at)}${item.updated_at !== item.created_at ? ` · changed ${when(item.updated_at)}` : ""}` }));
    })));
  sync();
}

export async function renderAdd(view, { args, params, app }) {
  const section = SECTIONS.some(([key]) => key === (args[0] || "")) ? args[0] || "" : "";
  const body = el("div");
  view.append(
    el("div", { class: "page-head" }, el("h1", { text: "Add questions" })),
    el("p", { class: "muted", text: "Add previous year questions the bank is missing, or your own mock questions. Mock questions need the options, "
      + "the answer, a solution and the reasoning behind it. Once added they work like every other question: practice, topics, search, tests and analytics." }),
    tabs(SECTIONS.map(([key, text]) => [hash(`add${key ? `/${key}` : ""}`), text, key]), section),
    body);
  if (section === "form") {
    await formView(body, app, params);
  } else if (section === "mine") {
    await mineView(body, app, params);
  } else {
    uploadView(body, app);
  }
}
