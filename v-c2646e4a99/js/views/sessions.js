// Practice sessions (CP32): each session with its answers, accuracy and time; open its answers or repeat it.
import { api } from "../api.js";
import { duration, el, emptyState, errorBanner, examName, hash, loading, percent, tabs, when } from "../ui.js";

function describe(session) {
  const filters = session.filters || {};
  if (filters.title) {
    return filters.title;
  }
  const parts = [filters.paper, filters.subject, filters.year, filters.list && `Saved: ${filters.list}`, filters.q && `Search: ${filters.q}`].filter(Boolean);
  return parts.join(" · ") || (session.exam ? examName(session.exam) : "Mixed questions");
}

export async function renderSessions(view, { app }) {
  const body = el("div", {}, loading());
  view.append(el("h1", { text: "History" }), tabs([["#/history", "Answers", "history"], ["#/sessions", "Practice sessions", "sessions"]], "sessions"), body);
  try {
    const sessions = await api.sessions({ limit: 100 });
    if (!sessions.length) {
      body.replaceChildren(emptyState("No practice sessions yet. A session starts with your first answer in a practice set."));
      return;
    }
    body.replaceChildren(el("ol", { class: "qlist" }, sessions.map((session) => {
      const filters = session.filters || {};
      const repeat = Object.fromEntries(Object.entries(filters).filter(([key]) => key !== "at"));
      if (filters.mode === "random" && filters.n) {
        // a random set repeats as a fresh draw with the same filters, not the same questions
        ["ids", "title", "mode", "n"].forEach((key) => delete repeat[key]);
        repeat.random = filters.n;
      }
      return el("li", {}, el("div", { class: "qlist-item" },
        el("div", { class: "qlist-head" },
          el("strong", { text: describe(session) }),
          el("span", { class: "chip", text: session.mode }),
          session.exam ? el("span", { class: "muted", text: examName(session.exam) }) : null,
          el("span", { class: "muted small", text: when(session.started_at) })),
        el("p", { class: "muted", text: `${session.attempts} answer${session.attempts === 1 ? "" : "s"} · ${session.questions} question${session.questions === 1 ? "" : "s"} · accuracy ${percent(session.accuracy)} · ${duration(session.time_spent_ms)} answering${session.ended_at ? "" : " · not finished"}` }),
        el("div", { class: "actions" },
          session.attempts ? el("a", { class: "btn", href: hash("history", { session: session.id }) }, "Answers") : null,
          Object.keys(repeat).length ? el("a", { class: "btn btn-ghost", href: hash("run", repeat) }, "Practise again") : null)));
    })));
  } catch (error) {
    body.replaceChildren(errorBanner(error, app.reconnect));
  }
}
