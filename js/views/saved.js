// Saved questions (CP32): bookmarks, favourites and notes.
import { api } from "../api.js";
import { el, emptyState, errorBanner, hash, loading, pager, questionLabel, questionList, tabs, when } from "../ui.js";

const LISTS = [["bookmarks", "Bookmarks"], ["favorites", "Favourites"], ["notes", "Notes"]];

export async function renderSaved(view, { args, params, app }) {
  const kind = LISTS.some(([key]) => key === args[0]) ? args[0] : "bookmarks";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const body = el("div", {}, loading());
  view.append(el("h1", { text: "Saved" }), tabs(LISTS.map(([key, text]) => [`#/saved/${key}`, text, key]), kind), body);
  try {
    if (kind === "notes") {
      const notes = await api.notes();
      body.replaceChildren(notes.length
        ? el("ol", { class: "qlist" }, notes.map((note) => el("li", {},
          el("a", { class: "qlist-item", href: hash("run", { list: "notes", at: note.question_id }) },
            el("div", { class: "qlist-head" }, el("strong", { text: questionLabel(note.question) }),
              note.question && note.question.subject ? el("span", { class: "muted", text: note.question.subject }) : null,
              el("span", { class: "muted small", text: when(note.updated_at) })),
            el("p", { class: "note-text", text: note.body }),
            note.question ? el("p", { class: "qlist-preview", text: note.question.preview }) : null))))
        : emptyState("No notes yet. Use Note on any question to write one."));
      return;
    }
    const found = await api.questions({ list: kind, page, per_page: 50 });
    body.replaceChildren(
      found.total ? el("div", { class: "actions" },
        el("span", { class: "muted", text: `${found.total} question${found.total === 1 ? "" : "s"}` }),
        el("a", { class: "btn btn-primary", href: hash("run", { list: kind }) }, "Practise these")) : null,
      found.total ? questionList(found.items, (item) => hash("run", { list: kind, at: item.id }))
        : emptyState(`No ${kind === "favorites" ? "favourites" : "bookmarks"} yet. Use the buttons on any question to add some.`),
      pager(found.page, found.pages, (next) => {
        location.hash = hash(`saved/${kind}`, { page: next });
      }));
  } catch (error) {
    body.replaceChildren(errorBanner(error, app.reconnect));
  }
}
