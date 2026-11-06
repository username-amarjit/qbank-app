// History (CP32): every answer, newest first; can be limited to one practice session.
import { api } from "../api.js";
import { append, duration, el, emptyState, errorBanner, hash, loading, questionLabel, tabs, TYPE_LABELS, when } from "../ui.js";

const PAGE = 50;

export async function renderHistory(view, { params, app }) {
  const session = params.get("session");
  const table = el("tbody");
  const more = el("button", { class: "btn", type: "button", hidden: true }, "Show more");
  const body = el("div", {}, loading());
  append(view, [el("h1", { text: "History" }), tabs([["#/history", "Answers", "history"], ["#/sessions", "Practice sessions", "sessions"]], "history"),
    session ? el("p", { class: "muted" }, `Answers from practice session ${session}. `, el("a", { href: "#/history" }, "Show all")) : null, body]);
  let offset = 0;

  async function load() {
    more.disabled = true;
    const rows = await api.history({ limit: PAGE, offset, session_id: session });
    offset += rows.length;
    rows.forEach((attempt) => {
      const result = attempt.is_correct === true ? ["good", "✓", "correct"] : attempt.is_correct === false ? ["bad", "✗", "wrong"] : ["", "•", "recorded"];
      table.appendChild(el("tr", {},
        el("td", { class: "nowrap", text: when(attempt.attempted_at) }),
        el("td", {}, el("span", { class: `mark ${result[0]}`, text: result[1], "aria-label": result[2] })),
        el("td", {}, el("a", { href: hash("run", { id: attempt.question_id }) }, questionLabel(attempt.question)),
          attempt.question ? el("div", { class: "muted small clamp", text: attempt.question.preview }) : null),
        el("td", { class: "hide-small", text: attempt.subject || "–" }),
        el("td", { class: "hide-small", text: TYPE_LABELS[attempt.question_type] || attempt.question_type }),
        el("td", { class: "nowrap", text: attempt.time_spent_ms === null ? "–" : duration(attempt.time_spent_ms) })));
    });
    more.hidden = rows.length < PAGE;
    more.disabled = false;
    return rows.length;
  }

  more.addEventListener("click", () => load().catch((error) => body.appendChild(errorBanner(error, app.reconnect))));
  try {
    const count = await load();
    body.replaceChildren(count
      ? el("div", { class: "table-wrap" }, el("table", { class: "data" },
        el("thead", {}, el("tr", {}, ["When", "Result", "Question", "Subject", "Type", "Time"].map((name, i) =>
          el("th", { class: i === 3 || i === 4 ? "hide-small" : "", scope: "col", text: name })))), table))
      : emptyState("Nothing answered yet."), more);
  } catch (error) {
    body.replaceChildren(errorBanner(error, app.reconnect));
  }
}
