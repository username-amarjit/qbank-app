// Add questions (CP40D): your own PYQs and mock questions, from an Excel, CSV or JSON file or typed into a form; My
// questions and History are in mine.js (CP40F). Uploads only add; a question identical to one already added is skipped.
// Mock questions need options, the answer, a solution and the reasoning; PYQs need the answer and the year.
// A topic name the topic list does not have becomes a new topic of the question's subject (CP40E), shown before adding.
// A question may be in several subjects, the first being its main one, and give the group of its topics; a group a
// subject does not have yet is created, or replaced by another, as chosen when checking (CP40G).
import { api } from "../api.js";
import {
  append, el, errorBanner, examLabel, hash, loading, replace, tabs,
} from "../ui.js";
import { historyView, mineView, questionPreview } from "./mine.js";

const SECTIONS = [["", "Upload a file"], ["form", "Type a question"], ["mine", "My questions"], ["history", "History"]];
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

// Groups are the same when their names are, ignoring case, spaces and punctuation (as the worker compares them)
const groupKey = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "") || String(name || "").toLowerCase().split(/\s+/).filter(Boolean).join(" ");
const isNewGroup = (newGroups, item) => Boolean(item.group) && (newGroups || []).some((group) => group.exam === item.exam
  && group.subject === item.subject && groupKey(group.group) === groupKey(item.group));
const groupText = (item, newGroups) => (item.group ? `, group ${item.group}${isNewGroup(newGroups, item) ? " (a new group: see below)" : ""}` : "");

// The topics the file or the form names that the topic list does not have yet (CP40E): they are created on adding, in
// the group given for them (CP40G).
function newTopicsBanner(topics, action, newGroups) {
  if (!topics || !topics.length) {
    return null;
  }
  return el("div", { class: "banner info" },
    el("p", { text: `${topics.length === 1 ? "A new topic" : `${topics.length} new topics`} will be added to the topic list when you ${action}:` }),
    el("ul", {}, topics.map((topic) => el("li", {}, el("b", { text: topic.name }), ` in ${topic.subject}`, groupText(topic, newGroups),
      topic.questions > 1 ? ` (${topic.questions} questions)` : ""))),
    el("p", { class: "muted small", text: "Meant an existing topic? Use its name exactly as on Topic wise (case and spacing do not matter), then check again." }));
}

// Your own topics that have no group and are given one (CP40G)
function fillsBanner(fills, action, newGroups) {
  if (!fills || !fills.length) {
    return null;
  }
  return el("div", { class: "banner info" },
    el("p", { text: `${fills.length === 1 ? "A topic of yours that has no group" : `${fills.length} topics of yours that have no group`} will be put in one when you ${action}:` }),
    el("ul", {}, fills.map((fill) => el("li", {}, el("b", { text: fill.name }), ` in ${fill.subject}`, groupText(fill, newGroups)))));
}

// The groups a subject does not have yet (CP40G). Each is created only as chosen here: create it, put its topics in one of
// the subject's groups instead, or leave them without a group. previous: the choices of the last check, kept.
let panels = 0;
function groupChoicesPanel(groups, previous) {
  if (!groups || !groups.length) {
    return { node: null, choices: () => [] };
  }
  panels += 1;
  const before = Object.fromEntries((previous || []).map((choice) => [`${choice.exam}|${choice.subject}|${groupKey(choice.group)}`, choice]));
  const rows = groups.map((group, number) => {
    const name = `new-group-${panels}-${number}`;
    const existing = group.existing || [];
    const earlier = before[`${group.exam}|${group.subject}|${groupKey(group.group)}`] || {};
    const action = earlier.action === "existing" && !existing.includes(earlier.use) ? "create" : earlier.action || "create";
    const pick = el("select", { "aria-label": `A group of ${group.subject} to put them in`, disabled: !existing.length },
      existing.length ? existing.map((value) => el("option", { value, text: value, selected: value === (earlier.use || group.similar) }))
        : el("option", { value: "", text: `${group.subject} has no groups yet` }));
    const radio = (value, ...label) => el("label", { class: "group-choice" },
      el("input", { type: "radio", name, value, checked: value === action, disabled: value === "existing" && !existing.length }), ...label);
    const who = [
      group.topics.length ? `the new topic${group.topics.length === 1 ? "" : "s"} ${group.topics.join(", ")}` : "",
      group.filled.length ? `your topic${group.filled.length === 1 ? "" : "s"} ${group.filled.join(", ")}, now without a group` : ""];
    const node = el("fieldset", { class: "group-new" },
      el("legend", {}, el("b", { text: group.group }), el("span", { class: "muted", text: ` · not a group of ${group.subject} yet` })),
      el("p", { class: "small", text: `For ${who.filter(Boolean).join(" and ")}.` }),
      group.similar ? el("p", { class: "small", text: `${group.subject} has a group named “${group.similar}”: a typing slip?` }) : null,
      group.elsewhere.length ? el("p", { class: "muted small", text: `${group.elsewhere.join(", ")} ${group.elsewhere.length === 1 ? "has" : "have"} a group of this `
        + "name: a new topic goes there when the question lists that subject too." }) : null,
      el("div", { class: "group-choices" },
        radio("create", "Create it"),
        radio("existing", "Put them in ", pick),
        radio("none", "No group")));
    pick.addEventListener("change", () => {
      node.querySelector("input[value=existing]").checked = true;
    });
    return { group, node, pick };
  });
  return {
    node: el("section", { class: "group-panel" },
      el("h3", { text: groups.length === 1 ? "A new group" : `${groups.length} new groups` }),
      el("p", { class: "muted small", text: "Not in the topic list yet. Choose what to do with each; your choice is used when you add." }),
      rows.map((row) => row.node)),
    choices: () => rows.map(({ group, node, pick }) => {
      const action = (node.querySelector("input[type=radio]:checked") || {}).value || "create";
      return { exam: group.exam, subject: group.subject, group: group.group, action, ...(action === "existing" ? { use: pick.value } : {}) };
    }),
  };
}

// What adding created besides the questions: new topics, new groups, groups given to your topics (CP40E, CP40G)
function topicChanges(result) {
  const topics = result.new_topics || [];
  const groups = result.new_groups || [];
  const fills = result.group_fills || [];
  return [
    topics.length ? el("p", { text: `New topic${topics.length === 1 ? "" : "s"} added to the topic list: `
      + `${topics.map((topic) => `${topic.name} (${[topic.subject, topic.group].filter(Boolean).join(" › ")})`).join(", ")}.` }) : null,
    groups.length ? el("p", { text: `New group${groups.length === 1 ? "" : "s"}: ${groups.map((group) => `${group.group} in ${group.subject}`).join(", ")}.` }) : null,
    fills.length ? el("p", { text: `Put in a group: ${fills.map((fill) => `${fill.name} › ${fill.group}`).join(", ")}.` }) : null];
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
          status.textContent = `Saved ${file.name}: seven sample questions (six mock, one PYQ, one of them in two subjects) to copy from.`;
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

  async function send(dryRun, groupChoices) {
    const file = pending;
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",", 2)[1] || "");
      reader.onerror = () => reject(new Error("The file could not be read."));
      reader.readAsDataURL(file);
    });
    return api.uploadQuestions({ name: file.name, data }, { bank: bank.value, exam: exam.value }, dryRun, groupChoices);
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
    const groups = groupChoicesPanel(report.new_groups);
    add.addEventListener("click", async () => {
      add.disabled = true;
      note.textContent = "Adding…";
      try {
        const done = await send(false, groups.choices());
        await app.refreshExams();
        const ids = done.rows.filter((row) => row.status === "new").map((row) => row.id);
        replace(results, el("section", { class: "card banner-good" },
          el("h2", { text: `Added ${done.added} question${done.added === 1 ? "" : "s"}.` }),
          topicChanges(done),
          done.counts.duplicate ? el("p", { text: `${done.counts.duplicate} skipped as duplicates.` }) : null,
          done.counts.error ? el("p", { text: `${done.counts.error} still need fixing: correct them in the file and upload it again (the rest will be skipped as duplicates).` }) : null,
          (done.batches || []).length ? el("p", { class: "muted", text: `Kept in History as the batch “${done.batches.map((batch) => batch.name).join("”, “")}”: `
            + "remove the whole upload there if it turns out wrong." }) : null,
          el("div", { class: "actions" },
            ids.length ? el("a", { class: "btn btn-primary", href: hash("run", { ids: ids.slice(0, 100).join(","), title: "Questions just added" }) }, "Practise them") : null,
            (done.batches || []).length === 1 ? el("a", { class: "btn", href: hash("add/mine", { exam: done.batches[0].exam, batch: done.batches[0].id, view: "list" }) },
              "See this batch") : null,
            el("a", { class: "btn", href: "#/add/mine" }, "My questions"),
            el("a", { class: "btn btn-ghost", href: "#/add/history" }, "History"))));
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
      newTopicsBanner(report.new_topics, "add these questions", report.new_groups),
      fillsBanner(report.group_fills, "add these questions", report.new_groups),
      groups.node,
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
  // the subjects: the main one, and the others the question is also in (CP40G)
  const [firstSubject, ...otherSubjects] = (cells.subject || "").split(";").map((part) => part.trim()).filter(Boolean);
  let main = firstSubject || "";
  let others = new Set(otherSubjects);
  let topicData = null; // the exam's topics, for the names of their groups
  const chosenSubjects = () => [main, ...[...others].filter((name) => name !== main)].filter(Boolean);
  const subjectSlot = el("label", { class: "field" });
  const alsoIn = el("details", { class: "also-in" });
  const alsoSlot = el("div", { class: "field" }, el("span", { text: "Also in (other subjects)" }), alsoIn);
  const topicHint = el("datalist", { id: "topic-names" });
  const groupHint = el("datalist", { id: "group-names" });
  const drawGroupHints = () => {
    const chosen = chosenSubjects();
    const subjects = topicData ? topicData.subjects.filter((subject) => chosen.includes(subject.subject)) : [];
    replace(groupHint, subjects.flatMap((subject) => [...new Set(subject.topics.map((topic) => topic.group).filter(Boolean))]
      .map((group) => el("option", { value: group, label: subject.subject }))));
  };
  const loadTopicHints = () => {
    const exam = fields.exam.value;
    api.examTopics(exam).then((topics) => {
      if (fields.exam.value !== exam) {
        return;
      }
      topicData = topics;
      replace(topicHint, topics.subjects.flatMap((subject) => subject.topics.map((topic) => el("option", { value: topic.name, label: subject.subject }))));
      drawGroupHints();
    }, () => {});
  };
  const alsoText = () => (others.size ? [...others].join(", ") : "None");
  const drawAlso = () => {
    const subjects = ((data.exams[fields.exam.value] || {}).subjects || []).filter((name) => name !== main);
    others = new Set([...others].filter((name) => subjects.includes(name)));
    replace(alsoIn, el("summary", { text: alsoText(), title: "A question in several subjects shows under each of them" }),
      el("div", { class: "also-list" },
        el("p", { class: "muted small", text: "It shows under each subject ticked here too. The main subject is where the full mock and analytics count it." }),
        subjects.map((name) => el("label", { class: "check" },
          el("input", { type: "checkbox", value: name, checked: others.has(name), onchange: (event) => {
            if (event.target.checked) {
              others.add(name);
            } else {
              others.delete(name);
            }
            alsoIn.querySelector("summary").textContent = alsoText();
            drawGroupHints();
          } }), name))));
  };
  const drawSubjects = () => {
    const subjects = (data.exams[fields.exam.value] || {}).subjects || [];
    main = subjects.includes(main) ? main : "";
    const select = el("select", { name: "subject" }, [["", "Choose…"], ...subjects.map((name) => [name, name])]
      .map(([value, label]) => el("option", { value, text: label, selected: value === main })));
    select.addEventListener("change", () => {
      main = select.value;
      others.delete(main);
      drawAlso();
      drawGroupHints();
    });
    subjectSlot.replaceChildren(el("span", { text: "Subject (main)" }), select);
    drawAlso();
    loadTopicHints();
  };
  // the subject list closes as a menu would: a click elsewhere, or Escape
  const closeAlso = (event) => {
    if (!alsoIn.isConnected) {
      document.removeEventListener("click", closeAlso);
    } else if (alsoIn.open && !alsoIn.contains(event.target)) {
      alsoIn.open = false;
    }
  };
  document.addEventListener("click", closeAlso);
  alsoIn.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && alsoIn.open) {
      alsoIn.open = false;
      alsoIn.querySelector("summary").focus();
    }
  });
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
      alsoSlot,
      text("topics", "Topics (separated by ;)", { list: "topic-names", placeholder: "e.g. Stacks; a new name adds a topic",
        title: "Pick names from the list, from any of the question's subjects; a name the list does not have becomes a new topic" }),
      text("group", "Group of the topics", { list: "group-names", placeholder: "e.g. Linear structures",
        title: "The group of a new topic, or of a topic of yours that has none: one for all the topics, or one per topic separated by ;" }),
      choice("type", "Type", [["MCQ", "MCQ: one correct option"], ["MSQ", "MSQ: one or more"], ["NAT", "NAT: a number"]], cells.type || "MCQ"),
      choice("marks", "Marks", [["1", "1"], ["2", "2"]], cells.marks || "1"),
      text("negative_marks", "Negative marks", { inputmode: "decimal", placeholder: "GATE rule" }),
      choice("difficulty", "Difficulty", [["", "—"], ["easy", "easy"], ["medium", "medium"], ["hard", "hard"]], cells.difficulty || ""),
      text("tags", "Tags (separated by ;)"),
      text("source", "Source (web address or note)")),
    topicHint,
    groupHint,
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
    main = "";
    others = new Set();
    topicData = null;
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
    found.subject = chosenSubjects().join("; ");
    if (found.type === "NAT") {
      "abcdef".split("").forEach((label) => {
        found[`option_${label}`] = "";
      });
    }
    return found;
  }

  // the choices for new groups made under the last preview (CP40G); without one, a new group is created
  let groups = groupChoicesPanel([]);

  function showProblems(result) {
    const action = editing ? "save" : "add this question";
    groups = groupChoicesPanel(result.new_groups, groups.choices());
    replace(check,
      result.errors && result.errors.length ? el("div", { class: "banner bad" }, el("p", { text: "Fix these first:" }),
        el("ul", {}, result.errors.map((error) => el("li", { text: error })))) : null,
      result.duplicate_of ? el("div", { class: "banner warn" }, el("p", { text: `This question is already added: ${result.duplicate_of}.` })) : null,
      newTopicsBanner(result.new_topics, action, result.new_groups),
      fillsBanner(result.group_fills, action, result.new_groups),
      groups.node,
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
    const choices = groups.choices();
    replace(check, loading(editing ? "Saving…" : "Adding…"));
    try {
      const result = editing ? await api.updateQuestion(editing, values(), choices) : await api.addQuestion(values(), choices);
      const saved = result.question;
      groups = groupChoicesPanel([]);
      await app.refreshExams();
      loadTopicHints();
      replace(check, el("div", { class: "banner banner-good" },
        el("p", { text: editing ? "Saved." : `Added as ${saved.paper} Q${saved.question_number}.` }),
        topicChanges(result),
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
  } else if (section === "history") {
    await historyView(body, app, params);
  } else {
    uploadView(body, app);
  }
}
