// Small DOM helpers. Text from questions and from the worker is always set as text, never parsed as HTML, and no
// style attribute is ever written (the page's Content Security Policy forbids inline styles).
import { api, WorkerUnreachable } from "./api.js";

export function applyTheme(theme) {
  if (theme === "light" || theme === "dark") {
    document.documentElement.dataset.theme = theme;
  } else {
    delete document.documentElement.dataset.theme;
  }
  try {
    localStorage.setItem("qbank.theme", theme || "system");
  } catch (error) {
    // storage turned off: the theme still applies for this visit
  }
}

export function errorBanner(error, reconnect) {
  if (error instanceof WorkerUnreachable) {
    return el("div", { class: "banner bad", role: "alert" },
      el("p", { text: "Lost the connection to the QBank worker on this computer." }),
      reconnect ? el("button", { class: "btn btn-primary", type: "button", onclick: reconnect }, "Reconnect") : null);
  }
  return el("div", { class: "banner bad", role: "alert" }, el("p", { text: (error && error.message) || String(error) }));
}

export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === false) {
      return;
    }
    if (key === "class") {
      node.className = value;
    } else if (key === "text") {
      node.textContent = value;
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2), value);
    } else if (key === "dataset") {
      Object.assign(node.dataset, value);
    } else {
      node.setAttribute(key, value === true ? "" : String(value));
    }
  });
  append(node, children);
  return node;
}

export function append(node, children) {
  children.flat(Infinity).forEach((child) => {
    if (child === null || child === undefined || child === false) {
      return;
    }
    node.appendChild(typeof child === "string" || typeof child === "number" ? document.createTextNode(String(child)) : child);
  });
  return node;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

export function link(href, text, attrs) {
  return el("a", { href, ...(attrs || {}) }, text);
}

export function external(href, text) {
  return el("a", { href, target: "_blank", rel: "noopener noreferrer", class: "external" }, text);
}

// A bar whose length is set through the CSS object model, which the Content Security Policy allows.
export function bar(fraction, kind) {
  const fill = el("span", { class: "bar-fill" + (kind ? ` ${kind}` : "") });
  fill.style.width = `${Math.max(0, Math.min(1, fraction || 0)) * 100}%`;
  return el("span", { class: "bar", role: "presentation" }, fill);
}

export function examName(exam) {
  return String(exam || "").split("-").map((part) => part.toUpperCase()).join(" ");
}

export const TYPE_LABELS = { mcq_single: "MCQ", mcq_multiple: "MSQ", numerical: "NAT" };
export const TYPE_NAMES = { mcq_single: "Multiple choice (one answer)", mcq_multiple: "Multiple select", numerical: "Numerical answer" };

export function percent(value, digits) {
  return value === null || value === undefined ? "–" : `${(value * 100).toFixed(digits === undefined ? 0 : digits)}%`;
}

export function duration(ms) {
  if (!ms) {
    return "0s";
  }
  const seconds = Math.round(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) {
    return `${hours}h ${minutes}m`;
  }
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

export function clock(seconds) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function when(iso) {
  if (!iso) {
    return "–";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function marksText(marks) {
  if (!marks || marks.positive === null || marks.positive === undefined) {
    return null;
  }
  const negative = marks.negative ? ` / −${Number(marks.negative).toFixed(2).replace(/\.?0+$/, "")}` : "";
  return `${marks.positive} mark${marks.positive === 1 ? "" : "s"}${negative}`;
}

export function questionLabel(item) {
  if (!item) {
    return "Question no longer in the dataset";
  }
  return `${item.paper || examName(item.exam)} · Q${item.question_number}`;
}

export function hash(path, params) {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, value);
    }
  });
  const text = search.toString();
  return `#/${path}${text ? `?${text}` : ""}`;
}

// Renders question blocks (text, math, images, tables, code) with the shared renderer.
export function blocks(question, list, tag) {
  const container = el(tag || "div", { class: "blocks" });
  const assets = Object.fromEntries((question.assets || []).map((asset) => [asset.id, asset]));
  window.QBankRender.renderBlocks(list || [], container, { assets, assetUrl: (asset) => api.assetUrl(question.exam, asset) });
  return container;
}

export function answerText(question, answer) {
  answer = answer || question.answer || {};
  if (answer.status !== "known") {
    return "The source gives no answer for this question.";
  }
  if (question.question_type === "numerical") {
    const range = answer.numeric_range;
    if (range && range[0] !== range[1]) {
      return `${range[0]} to ${range[1]}`;
    }
    return String(range ? range[0] : answer.numeric_value !== null ? answer.numeric_value : answer.raw);
  }
  return (answer.correct_labels || []).join(", ") || answer.raw || "–";
}

export function emptyState(text, action) {
  return el("div", { class: "empty" }, el("p", { text }), action || null);
}

export function loading(text) {
  return el("div", { class: "loading", role: "status" }, el("span", { class: "spinner", "aria-hidden": "true" }), text || "Loading…");
}

export function tabs(items, current) {
  return el("nav", { class: "tabs", "aria-label": "Sections" },
    items.map(([href, text, key]) => el("a", { href, class: key === current ? "active" : "", "aria-current": key === current ? "page" : false }, text)));
}

export function questionList(items, hrefFor, extra) {
  if (!items.length) {
    return emptyState("No questions here yet.");
  }
  return el("ol", { class: "qlist" }, items.map((item) => el("li", {},
    el("a", { href: hrefFor(item), class: "qlist-item" },
      el("div", { class: "qlist-head" },
        el("strong", { text: questionLabel(item) }),
        el("span", { class: "chip", text: TYPE_LABELS[item.question_type] || item.question_type }),
        item.subject ? el("span", { class: "muted", text: item.subject + (item.topic ? ` › ${item.topic}` : "") }) : null),
      el("p", { class: "qlist-preview", text: item.preview || "" }),
      extra ? extra(item) : null))));
}

export function pager(page, pages, onPage) {
  if (pages <= 1) {
    return null;
  }
  return el("div", { class: "pager" },
    el("button", { class: "btn", type: "button", disabled: page <= 1, onclick: () => onPage(page - 1) }, "← Previous"),
    el("span", { class: "muted", text: `Page ${page} of ${pages}` }),
    el("button", { class: "btn", type: "button", disabled: page >= pages, onclick: () => onPage(page + 1) }, "Next →"));
}

export function select(name, label, options, value, onchange) {
  return el("label", { class: "field" }, el("span", { text: label }),
    el("select", { name, onchange },
      options.map(([optionValue, text]) => el("option", { value: optionValue, selected: String(optionValue) === String(value ?? "") }, text))));
}
