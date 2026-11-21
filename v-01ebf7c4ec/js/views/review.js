// The question review list, shared by a test's result (CP40D) and a practice session's summary: one row per question
// with its status; opening a row shows the question with your answer and the right one marked, the solution and the
// reasoning, with "Add to error notebook" when it went wrong or was not answered.
import { api } from "../api.js";
import { answerText, blocks, el, errorBanner, hash, loading, replace } from "../ui.js";
import { mistakeForm } from "./notebook.js";

export const STATUS_TEXT = {
  correct: "Correct", wrong: "Wrong", unanswered: "Not answered", revealed: "Answer shown", ungraded: "No answer key", missing: "No longer in the bank",
};
const NOTEBOOK_STATUSES = new Set(["wrong", "unanswered", "revealed"]);

function yourAnswer(selected) {
  if (selected === null || selected === undefined || (Array.isArray(selected) && !selected.length)) {
    return "not answered";
  }
  return Array.isArray(selected) ? selected.join(", ") : String(selected);
}

// entry: {id, number (shown first), status, selected (your answer: option labels or a number; null when none),
// attemptId, extras (more nodes for the row)}. load(id): the question record (default: asked from the worker).
// newTab: "Open in practice" opens a new tab (the practice summary is not kept, a test's result is).
export function reviewItem(entry, { app, load, newTab }) {
  const details = el("details", { class: `result-item ${entry.status}` },
    el("summary", {},
      el("span", { class: "result-number", text: entry.number }),
      el("span", { class: `status-chip ${entry.status}`, text: STATUS_TEXT[entry.status] || entry.status }),
      entry.extras || []));
  details.addEventListener("toggle", async () => {
    if (!details.open || details.dataset.loaded) {
      return;
    }
    details.dataset.loaded = "1";
    const body = el("div", { class: "result-body" }, loading());
    details.appendChild(body);
    try {
      const question = load ? await load(entry.id) : (await api.question(entry.id)).question;
      const right = new Set((question.answer || {}).correct_labels || []);
      const mine = new Set(Array.isArray(entry.selected) ? entry.selected : []);
      const notebook = el("div");
      replace(body,
        el("div", { class: "stem" }, blocks(question, question.content.blocks)),
        question.options.length ? el("div", { class: "options review" }, question.options.map((option) => el("div", {
          class: `option${right.has(option.label) ? " correct" : ""}${mine.has(option.label) && !right.has(option.label) ? " wrong" : ""}${mine.has(option.label) ? " selected" : ""}`,
        }, el("span", { class: "option-label", text: option.label }), blocks(question, option.blocks)))) : null,
        el("p", {}, "Your answer: ", el("b", { text: yourAnswer(entry.selected) }),
          " · Correct answer: ", el("b", { text: answerText(question, question.answer) })),
        question.explanation && question.explanation.blocks.length ? el("div", { class: "explanation" }, el("h3", { text: "Solution" }), blocks(question, question.explanation.blocks))
          : el("p", { class: "muted", text: "No solution was given with this question." }),
        question.reasoning ? el("div", { class: "explanation" }, el("h3", { text: "Reasoning" }), blocks(question, question.reasoning.blocks)) : null,
        el("div", { class: "actions" },
          el("a", { class: "btn btn-ghost btn-small", href: hash("run", { id: entry.id }), ...(newTab ? { target: "_blank", rel: "noopener" } : {}) },
            newTab ? "Open in practice ↗" : "Open in practice"),
          NOTEBOOK_STATUSES.has(entry.status) ? el("button", { class: "btn btn-small", type: "button", onclick: () => {
            const form = mistakeForm({ questionId: entry.id, attemptId: entry.attemptId, onSaved: () => replace(notebook, el("p", { class: "muted", text: "Added to your error notebook." })),
              onCancel: () => replace(notebook) });
            replace(notebook, form);
            form.focusFirst();
          } }, "Add to error notebook") : null),
        notebook);
    } catch (error) {
      replace(body, errorBanner(error, app.reconnect));
    }
  });
  return el("li", {}, details);
}
