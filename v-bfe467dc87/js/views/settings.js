// Settings (CP32): stored by the worker with your progress, so they follow your data, not the browser.
import { api, WORKER } from "../api.js";
import { applyTheme, el, errorBanner, examName, when } from "../ui.js";

const SHORTCUTS = [
  ["1–9 or A–H", "choose an option"],
  ["Enter", "check the answer"],
  ["← →", "previous and next question"],
];

export function renderSettings(view, { app }) {
  const current = app.settings || {};
  const status = el("p", { class: "muted", role: "status" });
  const form = el("form", { class: "settings-form" },
    el("fieldset", {}, el("legend", { text: "Appearance" }),
      ["system", "light", "dark"].map((theme) => el("label", { class: "check" },
        el("input", { type: "radio", name: "theme", value: theme, checked: (current.theme || "system") === theme }),
        { system: "Same as the system", light: "Light", dark: "Dark" }[theme]))),
    el("fieldset", {}, el("legend", { text: "Practice" }),
      app.exams.length > 1 ? el("label", { class: "field" }, el("span", { text: "Exam to open first" }),
        el("select", { name: "default_exam" }, el("option", { value: "", text: "Ask each time" }),
          app.exams.map((exam) => el("option", { value: exam.exam, text: examName(exam.exam), selected: exam.exam === current.default_exam })))) : null,
      el("label", { class: "check" }, el("input", { type: "checkbox", name: "show_timer", checked: current.show_timer !== false }), "Show the time spent on each question"),
      el("label", { class: "check" }, el("input", { type: "checkbox", name: "shortcuts", checked: current.shortcuts !== false }), "Keyboard shortcuts")),
    el("div", { class: "actions" }, el("button", { class: "btn btn-primary", type: "submit" }, "Save"), status));
  form.querySelectorAll("input[name=theme]").forEach((input) => input.addEventListener("change", () => applyTheme(input.value)));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const values = { theme: data.get("theme"), show_timer: data.has("show_timer"), shortcuts: data.has("shortcuts") };
    if (form.elements.default_exam) {
      values.default_exam = data.get("default_exam") || null;
    }
    try {
      app.settings = await api.saveSettings(values);
      applyTheme(app.settings.theme);
      status.textContent = "Saved.";
    } catch (error) {
      status.replaceChildren(errorBanner(error, app.reconnect));
    }
  });

  const health = app.health || {};
  const index = health.index || {};
  view.append(
    el("h1", { text: "Settings" }),
    el("section", { class: "card" }, form),
    el("section", { class: "card" }, el("h2", { text: "Keyboard shortcuts" }),
      el("dl", { class: "pairs" }, SHORTCUTS.map(([keys, action]) => [el("dt", {}, el("kbd", { text: keys })), el("dd", { text: action })]))),
    el("section", { class: "card" }, el("h2", { text: "Worker" }),
      el("dl", { class: "pairs" },
        el("dt", { text: "Address" }), el("dd", { text: WORKER }),
        el("dt", { text: "Version" }), el("dd", { text: `worker ${health.worker_version || "–"}, crawler ${health.crawler_version || "–"}` }),
        el("dt", { text: "Question index" }), el("dd", { text: `built ${when(index.built_at)}` }),
        el("dt", { text: "Questions" }), el("dd", { text: Object.entries(index.questions || {}).map(([exam, count]) => `${examName(exam)}: ${count}`).join(", ") || "–" }),
        el("dt", { text: "Datasets" }), el("dd", { text: app.exams.map((exam) => `${exam.dataset_id}`).join(", ") || "–" })),
      el("p", { class: "muted", text: "Questions, answers, notes and settings stay on this computer, in the worker. This page stores only the colour theme and whether it has connected before." })));
}
