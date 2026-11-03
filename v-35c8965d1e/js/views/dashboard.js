// Dashboard (CP32): progress per exam, recent answers, activity, and where to go next.
import { api } from "../api.js";
import { bar, el, emptyState, errorBanner, examName, hash, percent, questionLabel, when } from "../ui.js";

function activity(days) {
  if (!days.length) {
    return el("p", { class: "muted", text: "No answers in the last 30 days." });
  }
  const byDay = new Map(days.map((day) => [day.day, day]));
  const most = Math.max(...days.map((day) => day.attempts));
  const today = new Date();
  const cells = [];
  for (let back = 29; back >= 0; back -= 1) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const day = byDay.get(key);
    const column = el("span", { class: "spark-col", title: `${key}: ${day ? `${day.attempts} answered, ${day.correct} correct` : "none"}` });
    const fill = el("span", { class: "spark-fill" });
    fill.style.height = `${day ? Math.max(8, (day.attempts / most) * 100) : 0}%`;
    column.appendChild(fill);
    cells.push(column);
  }
  return el("div", { class: "spark", role: "img", "aria-label": "Answers per day for the last 30 days" }, cells);
}

export async function renderDashboard(view, { app }) {
  view.appendChild(el("h1", { text: "Dashboard" }));
  if (!app.exams.length) {
    view.appendChild(emptyState("The worker has no question index yet. Run: qbank index rebuild"));
    return;
  }
  const examGrid = el("div", { class: "grid" });
  const recent = el("section", { class: "card" }, el("h2", { text: "Recent answers" }));
  const overall = el("section", { class: "card" }, el("h2", { text: "Last 30 days" }));
  view.append(examGrid, el("div", { class: "grid two" }, overall, recent));
  try {
    const [stats, history, ...perExam] = await Promise.all([api.analytics(), api.history({ limit: 8 }), ...app.exams.map((exam) => api.analytics(exam.exam))]);
    app.exams.forEach((exam, i) => {
      const done = perExam[i].questions_attempted;
      examGrid.appendChild(el("section", { class: "card exam-card" },
        el("h2", {}, el("a", { href: `#/practice/${encodeURIComponent(exam.exam)}`, text: examName(exam.exam) })),
        el("p", { class: "muted", text: `${done} of ${exam.question_count} questions answered · accuracy ${percent(perExam[i].accuracy)}` }),
        bar(done / exam.question_count),
        el("div", { class: "actions" },
          el("a", { class: "btn btn-primary", href: `#/practice/${encodeURIComponent(exam.exam)}` }, "Practice"),
          el("a", { class: "btn", href: hash("run", { exam: exam.exam, random: 10 }) }, "10 random"))));
    });
    overall.append(
      el("div", { class: "tiles" },
        el("div", { class: "tile" }, el("span", { class: "tile-value", text: String(stats.attempts) }), el("span", { text: "answers" })),
        el("div", { class: "tile" }, el("span", { class: "tile-value", text: String(stats.questions_attempted) }), el("span", { text: "questions" })),
        el("div", { class: "tile" }, el("span", { class: "tile-value", text: percent(stats.accuracy) }), el("span", { text: "accuracy" }))),
      activity(stats.last_30_days),
      el("p", {}, el("a", { href: "#/analytics" }, "Analytics"), " · ", el("a", { href: "#/analytics/weak" }, "Weak topics"), " · ",
        el("a", { href: "#/analytics/progress" }, "Exam progress")));
    if (!history.length) {
      recent.appendChild(emptyState("Nothing answered yet. Pick an exam above to start."));
    } else {
      recent.append(el("ul", { class: "recent" }, history.map((attempt) => el("li", {},
        el("span", { class: `mark ${attempt.is_correct === true ? "good" : attempt.is_correct === false ? "bad" : ""}`,
          text: attempt.is_correct === true ? "✓" : attempt.is_correct === false ? "✗" : "•", "aria-label": attempt.is_correct === true ? "correct" : attempt.is_correct === false ? "wrong" : "recorded" }),
        el("a", { href: hash("run", { id: attempt.question_id }) }, questionLabel(attempt.question)),
        el("span", { class: "muted small", text: when(attempt.attempted_at) })))),
      el("p", {}, el("a", { href: "#/history" }, "All history")));
    }
  } catch (error) {
    view.appendChild(errorBanner(error, app.reconnect));
  }
}
