// Small DOM helpers. Text from questions and from the worker is always set as text, never parsed as HTML, and no
// style attribute is ever written (the page's Content Security Policy forbids inline styles).
import { api, servedByWorker, WorkerUnreachable } from "./api.js";

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

// Like node.replaceChildren(...), but skips null, undefined and false (the native call would show them as text).
export function replace(node, ...children) {
  node.replaceChildren();
  return append(node, children);
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

// Incognito display (set on the worker's admin page): exams are shown under an alias such as "Paper A", each
// question's year tag and topics wait behind an eye button, and addresses carry opaque codes instead of exam and paper
// names (exams and papers: a short hash; questions: the 16 hex digits of their id). Addresses in either form open.
const display = { incognito: false, exams: {} };
const codes = new Map(); // address code -> exam id or paper name
const shortIds = new Map(); // 16 hex digits -> full question id

function addressCode(text) {
  let value = 0x811c9dc5; // FNV-1a, 32 bits: short, stable, the same in every browser
  for (const byte of new TextEncoder().encode(text)) {
    value = Math.imul(value ^ byte, 0x01000193) >>> 0;
  }
  return value.toString(16).padStart(8, "0");
}

export function setDisplay(settings, exams) {
  display.incognito = Boolean(settings && settings.incognito);
  display.exams = (settings && settings.exams) || {};
  codes.clear();
  exams.forEach((exam) => {
    codes.set(addressCode(`exam:${exam.exam}`), exam.exam);
    (exam.papers || []).forEach((paper) => codes.set(addressCode(`paper:${paper}`), paper));
  });
}

export function incognito() {
  return display.incognito;
}

// The exam's name in navigation: its alias in incognito mode
export function examLabel(exam) {
  return display.incognito && display.exams[exam] ? display.exams[exam].alias : examName(exam);
}

// A paper as a title: "Paper A 2023 Set 1" in incognito mode, else its own name ("GATE CSE 2023 SET-1")
export function paperLabel(paper, exam) {
  if (!display.incognito || !paper) {
    return paper;
  }
  const year = (paper.match(/\d{4}/) || [""])[0];
  const rest = paper.replace(/^.*?\d{4}\s*/, "").trim().replace(/^SET[-\s]*(\d+)$/i, "Set $1");
  return [examLabel(exam || ""), year, rest].filter(Boolean).join(" ");
}

function shortId(id) {
  const cut = id.indexOf(":");
  if (cut < 0) {
    return id;
  }
  shortIds.set(id.slice(cut + 1), id);
  return id.slice(cut + 1);
}

function addressValue(key, value) {
  if (!display.incognito) {
    return value;
  }
  if (key === "exam") {
    return addressCode(`exam:${value}`);
  }
  if (key === "paper") {
    return addressCode(`paper:${value}`);
  }
  if (key === "id" || key === "at") {
    return shortId(value);
  }
  if (key === "ids") {
    return value.split(",").map(shortId).join(",");
  }
  return value;
}

export function examInAddress(exam) {
  return display.incognito ? addressCode(`exam:${exam}`) : exam;
}

export function examFromAddress(value) {
  return codes.get(value) || value;
}

export function rememberIds(found) {
  Object.entries(found || {}).forEach(([short, id]) => shortIds.set(short, id));
}

// An address's parameters in their real form (exam ids, paper names, full question ids), and the short question ids
// this browser has not seen yet (the worker resolves those: /api/ids).
export function readAddress(params) {
  const real = new URLSearchParams();
  const unknown = new Set();
  const full = (value) => {
    if (value.includes(":") || !/^[0-9a-f]{16}$/.test(value)) {
      return value;
    }
    if (!shortIds.has(value)) {
      unknown.add(value);
    }
    return shortIds.get(value) || value;
  };
  params.forEach((value, key) => {
    if (key === "exam" || key === "paper") {
      real.append(key, codes.get(value) || value);
    } else if (key === "id" || key === "at") {
      real.append(key, full(value));
    } else if (key === "ids") {
      real.append(key, value.split(",").map(full).join(","));
    } else {
      real.append(key, value);
    }
  });
  return { params: real, unknown: [...unknown] };
}

export function practiceHref(exam) {
  return `#/practice/${encodeURIComponent(examInAddress(exam))}`;
}

// An eye drawn as SVG (no inline style, so the page's Content Security Policy allows it); crossed out when "hide"
export function eyeIcon(crossed) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  Object.entries({ viewBox: "0 0 24 24", width: "18", height: "18", fill: "none", stroke: "currentColor", "stroke-width": "2",
    "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false", class: "eye-icon" })
    .forEach(([key, value]) => svg.setAttribute(key, value));
  const shapes = [["path", { d: "M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" }], ["circle", { cx: "12", cy: "12", r: "3" }]];
  if (crossed) {
    shapes.push(["path", { d: "M3 3l18 18" }]);
  }
  shapes.forEach(([tag, attributes]) => {
    const shape = document.createElementNS(ns, tag);
    Object.entries(attributes).forEach(([key, value]) => shape.setAttribute(key, value));
    svg.appendChild(shape);
  });
  return svg;
}

// An exam's papers by year, newest last: year -> [{paper, label ("Set 2" or "Paper"), count}].
export function papersByYear(exam) {
  const papers = Object.entries(exam.paper_counts || {}).length
    ? Object.entries(exam.paper_counts)
    : (exam.papers || []).map((paper) => [paper, undefined]);
  const byYear = new Map();
  papers.forEach(([paper, count]) => {
    const year = (paper.match(/\d{4}/) || ["Other"])[0];
    const rest = paper.replace(/^.*?\d{4}\s*/, "").trim();
    if (!byYear.has(year)) {
      byYear.set(year, []);
    }
    byYear.get(year).push({ paper, label: rest ? rest.replace(/^SET[-\s]*(\d+)$/i, "Set $1") : "Paper", count });
  });
  return byYear;
}

// The exam menu's pages (CP40B): #/exam/<exam>/topics, /subjects and /years.
export const BROWSE_VIEWS = [["topics", "Topic wise"], ["subjects", "Subject wise"], ["years", "Year wise"]];

export function browseHref(exam, kind, params) {
  return hash(`exam/${encodeURIComponent(examInAddress(exam))}/${kind}`, params);
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

// An address in the app: #/<path>?<params>. Takes an object or URLSearchParams; empty values are left out, and in
// incognito mode exams, papers and question ids are written as codes.
export function hash(path, params) {
  const search = new URLSearchParams();
  const entries = params instanceof URLSearchParams ? [...params.entries()] : Object.entries(params || {});
  entries.forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, addressValue(key, String(value)));
    }
  });
  const text = search.toString();
  return `#/${path}${text ? `?${text}` : ""}`;
}

// Renders question blocks (text, math, images, tables, code) with the shared renderer.
export function blocks(question, list, tag) {
  const container = el(tag || "div", { class: "blocks" });
  const assets = Object.fromEntries((question.assets || []).map((asset) => [asset.id, asset]));
  window.QBankRender.renderBlocks(list || [], container, { assets, assetUrl: (asset) => api.assetUrl(question.exam, asset), loadImage });
  return container;
}

const imageCache = new Map(); // worker image URL -> promise of a blob: URL; images never change, so one copy per visit
const MAX_CACHED_IMAGES = 300;

function loadImage(url, image) {
  if (servedByWorker) {
    image.src = url; // same origin as the worker: a plain image request
    return;
  }
  let pending = imageCache.get(url);
  if (!pending) {
    pending = api.image(url).then((blob) => URL.createObjectURL(blob));
    imageCache.set(url, pending);
    pending.catch(() => imageCache.delete(url));
    if (imageCache.size > MAX_CACHED_IMAGES) {
      const [oldest, old] = imageCache.entries().next().value;
      imageCache.delete(oldest);
      old.then((objectUrl) => URL.revokeObjectURL(objectUrl), () => {});
    }
  }
  pending.then((objectUrl) => {
    image.src = objectUrl;
  }, () => {
    image.replaceWith(el("span", { class: "qb-missing", text: "[image not available]" }));
  });
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
