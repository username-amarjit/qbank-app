// Export (CP40H): questions as a JSON file in the upload format, chosen by subject, by topic, or all of an exam, from the
// bank's PYQs and the questions you added. Subject wise and Topic wise link here with one subject ticked (?subject=), and
// a topic can be given as ?topic=, so a single subject or topic is a click away.
import { api } from "../api.js";
import { el, emptyState, errorBanner, examLabel, hash, loading, replace, saveFile } from "../ui.js";

const MODES = [["subjects", "By subject"], ["topics", "By topic"], ["all", "Everything"]];
const plural = (count, one) => `${count} ${one}${count === 1 ? "" : "s"}`;
const sizeText = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export async function exportView(view, app, params) {
  if (!app.exams.length) {
    view.appendChild(emptyState("There are no questions to export yet."));
    return;
  }
  const exam = app.exams.find((entry) => entry.exam === params.get("exam"))
    || app.exams.find((entry) => entry.exam === app.settings.default_exam) || app.exams[0];
  const preset = { subject: params.get("subject") || "", topic: params.get("topic") || "" };
  const chosenSubjects = new Set(preset.subject ? [preset.subject] : []);
  const chosenTopics = new Set(preset.topic ? [preset.topic] : []);
  let by = preset.topic ? "topics" : MODES.some(([mode]) => mode === params.get("by")) ? params.get("by") : "subjects";

  const examPicker = el("select", { "aria-label": "Exam" },
    app.exams.map((entry) => el("option", { value: entry.exam, text: examLabel(entry.exam), selected: entry.exam === exam.exam })));
  examPicker.addEventListener("change", () => {
    location.hash = hash("add/export", { exam: examPicker.value, by });
  });
  const pyq = el("input", { type: "checkbox", checked: true });
  const mock = el("input", { type: "checkbox", checked: true });
  const radios = MODES.map(([mode, text]) => el("label", { class: "check" },
    el("input", { type: "radio", name: "export-by", value: mode, checked: mode === by }), text));
  const summary = el("strong", { role: "status" });
  const download = el("button", { class: "btn btn-primary", type: "button", disabled: true }, "Download JSON");
  const status = el("p", { class: "muted small", role: "status" });
  const subjectPanel = subjectPicker();
  const topicPanel = el("div");
  const allPanel = el("section", { class: "card" },
    el("p", { text: `Every question of ${examLabel(exam.exam)} from the banks ticked above, in one file.` }),
    el("p", { class: "muted small", text: "About 1 KB a question, so even a whole exam is a few MB." }));
  let topicsLoaded = false;

  const request = () => ({ exam: exam.exam, origins: [pyq.checked && "pyq", mock.checked && "mock"].filter(Boolean), by,
    ...(by === "subjects" ? { subjects: [...chosenSubjects] } : by === "topics" ? { topics: [...chosenTopics] } : {}) });

  // how many questions the choice takes, asked again (shortly after the last change) whenever it changes
  let asked = 0;
  let timer = null;
  function refresh() {
    clearTimeout(timer);
    const body = request();
    const missing = !body.origins.length ? "Choose previous year questions, mock questions, or both."
      : by === "subjects" && !body.subjects.length ? "Choose one or more subjects."
        : by === "topics" && !body.topics.length ? "Choose one or more topics." : "";
    download.disabled = true;
    asked += 1;
    if (missing) {
      summary.textContent = missing;
      return;
    }
    const ticket = asked;
    summary.textContent = "Counting…";
    timer = setTimeout(async () => {
      try {
        const found = await api.exportCount(body);
        if (ticket !== asked) {
          return;
        }
        summary.textContent = found.count
          ? `${plural(found.count, "question")}: ${found.pyq} PYQ, ${found.mock} mock${found.yours ? ` (${found.yours} added by you)` : ""}`
            + ` · about ${sizeText(found.bytes)}${found.figures ? ` · ${found.figures} with [figure] for an image` : ""}`
          : "No questions match: choose other subjects or topics, or both banks.";
        download.disabled = !found.count;
      } catch (error) {
        if (ticket === asked) {
          summary.textContent = error.message;
        }
      }
    }, 250);
  }

  function draw() {
    subjectPanel.hidden = by !== "subjects";
    topicPanel.hidden = by !== "topics";
    allPanel.hidden = by !== "all";
    if (by === "topics" && !topicsLoaded) {
      topicsLoaded = true;
      topicPicker(topicPanel);
    }
    refresh();
  }

  function subjectPicker() {
    const subjects = Object.entries(exam.subjects || {}).filter(([subject]) => subject !== "(none)");
    const all = el("input", { type: "checkbox", checked: subjects.length > 0 && subjects.every(([subject]) => chosenSubjects.has(subject)) });
    const boxes = subjects.map(([subject]) => {
      const box = el("input", { type: "checkbox", value: subject, checked: chosenSubjects.has(subject) });
      box.addEventListener("change", () => {
        if (box.checked) {
          chosenSubjects.add(subject);
        } else {
          chosenSubjects.delete(subject);
        }
        all.checked = boxes.every((item) => item.checked);
        refresh();
      });
      return box;
    });
    all.addEventListener("change", () => {
      boxes.forEach((box) => {
        box.checked = all.checked;
        if (all.checked) {
          chosenSubjects.add(box.value);
        } else {
          chosenSubjects.delete(box.value);
        }
      });
      refresh();
    });
    return el("section", { class: "card" },
      el("div", { class: "card-head" }, el("h2", { text: "Subjects" }), el("label", { class: "check small" }, all, "All")),
      el("p", { class: "muted small", text: "One or more. A question of yours in several subjects comes with any of them. The counts are of all questions, PYQ and mock." }),
      el("ul", { class: "pick-grid" }, subjects.map(([subject, count], index) => el("li", {},
        el("label", { class: "pick" }, boxes[index], el("span", { text: subject }), el("span", { class: "count", text: String(count) }))))));
  }

  async function topicPicker(target) {
    replace(target, loading("Loading topics…"));
    let data;
    try {
      data = await api.examTopics(exam.exam);
    } catch (error) {
      topicsLoaded = false;
      replace(target, errorBanner(error, app.reconnect));
      return;
    }
    if (!target.isConnected) {
      return;
    }
    const finder = el("input", { type: "search", placeholder: "Find a topic, for example: stack, eigen, TCP", "aria-label": "Find a topic", autocomplete: "off" });
    const cards = data.subjects.map((subject) => {
      const boxes = [];
      const all = el("input", { type: "checkbox", "aria-label": `All topics of ${subject.subject}` });
      const syncAll = () => {
        const usable = boxes.filter((box) => !box.disabled);
        all.checked = usable.length > 0 && usable.every((box) => box.checked);
      };
      const groups = new Map();
      subject.topics.forEach((topic) => {
        if (!groups.has(topic.group || "")) {
          groups.set(topic.group || "", []);
        }
        groups.get(topic.group || "").push(topic);
      });
      const card = el("section", { class: "card topic-pick" },
        el("div", { class: "card-head" }, el("h2", { text: subject.subject }), el("label", { class: "check small" }, all, "All")),
        [...groups.entries()].map(([group, topics]) => el("div", { class: "topic-group" },
          group ? el("h3", { class: "group-name", text: group }) : null,
          el("ul", { class: "pick-grid" }, topics.map((topic) => {
            const box = el("input", { type: "checkbox", value: topic.id, disabled: !topic.count, checked: chosenTopics.has(topic.id) });
            boxes.push(box);
            box.addEventListener("change", () => {
              if (box.checked) {
                chosenTopics.add(topic.id);
              } else {
                chosenTopics.delete(topic.id);
              }
              syncAll();
              refresh();
            });
            return el("li", { dataset: { find: `${topic.name} ${group} ${subject.subject}`.toLowerCase() } },
              el("label", { class: topic.count ? "pick" : "pick empty" }, box, el("span", { text: topic.name }), el("span", { class: "count", text: String(topic.count) })));
          })))));
      all.addEventListener("change", () => {
        boxes.filter((box) => !box.disabled).forEach((box) => {
          box.checked = all.checked;
          if (all.checked) {
            chosenTopics.add(box.value);
          } else {
            chosenTopics.delete(box.value);
          }
        });
        refresh();
      });
      syncAll();
      return card;
    });
    finder.addEventListener("input", () => {
      const words = finder.value.trim().toLowerCase();
      cards.forEach((card) => {
        let shown = 0;
        card.querySelectorAll("li").forEach((item) => {
          item.hidden = Boolean(words) && !item.dataset.find.includes(words);
          shown += item.hidden ? 0 : 1;
        });
        card.querySelectorAll(".topic-group").forEach((group) => {
          group.hidden = ![...group.querySelectorAll("li")].some((item) => !item.hidden);
        });
        card.hidden = !shown;
      });
    });
    replace(target, el("div", { class: "topic-tools" }, finder), cards);
    const given = preset.topic && [...target.querySelectorAll("input[type=checkbox]")].find((box) => box.value === preset.topic);
    if (given) {
      given.closest("li").scrollIntoView({ block: "center" });
    }
  }

  pyq.addEventListener("change", refresh);
  mock.addEventListener("change", refresh);
  radios.forEach((label) => label.querySelector("input").addEventListener("change", (event) => {
    by = event.target.value;
    draw();
  }));
  download.addEventListener("click", async () => {
    const body = request();
    download.disabled = true;
    status.textContent = "Preparing the file…";
    try {
      const file = await api.download("/api/export", body, `qbank-export-${new Date().toISOString().slice(0, 10)}.json`);
      saveFile(file.blob, file.name);
      status.textContent = `Saved ${file.name} (${sizeText(file.blob.size)}).`;
    } catch (error) {
      status.textContent = error.message;
    }
    download.disabled = false;
  });

  view.append(
    el("fieldset", { class: "card test-options export-options" },
      el("legend", { text: "Export questions" }),
      el("p", { class: "muted", text: "A JSON file in the upload format: each question with its subjects, topics and group, options, answer, solution "
        + "and reasoning, and its id. The bank's questions that have a figure get [figure] in its place, as the format has no images. "
        + "Uploading the file again only adds: your questions in it are skipped as duplicates, and the bank's PYQs are refused." }),
      app.exams.length > 1 ? el("div", { class: "option-row" }, el("span", { class: "option-name", text: "Exam" }), examPicker) : null,
      el("div", { class: "option-row" }, el("span", { class: "option-name", text: "From" }),
        el("label", { class: "check" }, pyq, "Previous year questions"), el("label", { class: "check" }, mock, "Mock questions")),
      el("div", { class: "option-row", role: "radiogroup", "aria-label": "Which questions" },
        el("span", { class: "option-name", text: "Which" }), radios)),
    el("div", { class: "sticky-bar" }, summary, download, status),
    subjectPanel, topicPanel, allPanel);
  draw();
}
