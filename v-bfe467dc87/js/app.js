// QBank web app: connects to the local worker, then shows the page named in the address (#/practice, #/search, ...).
import { api, LOCAL_APP, loopbackPermission, servedByWorker, WORKER, WorkerUnreachable } from "./api.js";
import { applyTheme, clear, el, errorBanner, external } from "./ui.js";
import { renderAnalytics } from "./views/analytics.js";
import { renderDashboard } from "./views/dashboard.js";
import { renderHistory } from "./views/history.js";
import { renderPractice } from "./views/practice.js";
import { renderRun } from "./views/run.js";
import { renderSaved } from "./views/saved.js";
import { renderSearch } from "./views/search.js";
import { renderSessions } from "./views/sessions.js";
import { renderSettings } from "./views/settings.js";

const ROUTES = {
  "": renderDashboard,
  practice: renderPractice,
  run: renderRun,
  search: renderSearch,
  saved: renderSaved,
  history: renderHistory,
  sessions: renderSessions,
  analytics: renderAnalytics,
  settings: renderSettings,
};

const app = { connected: false, health: null, exams: [], settings: {}, reconnect: () => connect() };
const view = document.getElementById("view");
const status = document.getElementById("conn");
let cleanup = null;
let routeToken = 0;

function setStatus(kind, text) {
  status.className = `conn ${kind}`;
  status.textContent = text;
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const cut = raw.indexOf("?");
  const path = cut < 0 ? raw : raw.slice(0, cut);
  const parts = path.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  return { name: parts[0] || "", args: parts.slice(1), params: new URLSearchParams(cut < 0 ? "" : raw.slice(cut + 1)) };
}

function markNav(name) {
  document.querySelectorAll(".nav a").forEach((anchor) => {
    const active = anchor.dataset.route === name || (name === "run" && anchor.dataset.route === "practice") ||
      (name === "sessions" && anchor.dataset.route === "history");
    anchor.classList.toggle("active", active);
    if (active) {
      anchor.setAttribute("aria-current", "page");
    } else {
      anchor.removeAttribute("aria-current");
    }
  });
}

function showError(container, error) {
  if (error instanceof WorkerUnreachable) {
    setStatus("down", "Worker not answering");
  }
  container.appendChild(errorBanner(error, () => connect()));
}

async function route() {
  if (!app.connected) {
    return;
  }
  const { name, args, params } = parseHash();
  const token = ++routeToken;
  if (cleanup) {
    try {
      cleanup();
    } catch (error) {
      // a page that fails to clean up must not stop the next one
    }
    cleanup = null;
  }
  markNav(name);
  // Each page draws into its own element: a slow page that finishes after the user moved on draws into a detached
  // element (its code checks page.isConnected) instead of over the new page.
  const page = el("div", { class: "page" });
  view.replaceChildren(page);
  window.scrollTo(0, 0);
  const render = ROUTES[name];
  if (!render) {
    page.appendChild(el("div", { class: "empty" }, el("p", { text: "There is no such page." }), el("a", { href: "#/", class: "btn" }, "Dashboard")));
    return;
  }
  let result = null;
  try {
    result = (await render(page, { args, params, app })) || null;
  } catch (error) {
    if (token === routeToken) {
      showError(page, error);
    }
  }
  if (token === routeToken) {
    cleanup = result;
  } else if (typeof result === "function") {
    result();
  }
}

function connectScreen(kind, detail) {
  const steps = el("ol", { class: "steps" },
    el("li", {}, "Start the worker on this computer: ", el("code", { text: "qbank autostart start" })),
    el("li", {}, "Check it: ", el("code", { text: "qbank autostart status" })));
  const messages = {
    ask: [
      "QBank keeps every question and all your progress on this computer, in the QBank worker. This page only shows them.",
      "When you connect, the browser asks whether this site may use apps and services on this device. Choose Allow.",
    ],
    down: [`The QBank worker did not answer at ${WORKER}.`],
    denied: [
      "This browser is blocking this site from apps on this device, so it cannot reach the QBank worker.",
      "Open the site settings (the icon left of the address), set Local network access (or Apps on device) to Allow, then try again.",
    ],
    error: ["The QBank worker answered, but it is not ready:"],
  };
  routeToken += 1;
  if (cleanup) {
    cleanup();
    cleanup = null;
  }
  clear(view);
  markNav("");
  view.appendChild(el("section", { class: "card connect" },
    el("h1", { text: kind === "ask" ? "Connect to your QBank worker" : "Cannot reach the QBank worker" }),
    messages[kind].map((text) => el("p", { text })),
    detail ? el("p", {}, el("code", { text: detail })) : null,
    kind === "down" ? steps : null,
    kind === "down" && !servedByWorker
      ? el("p", { class: "muted", text: `If the worker is running, it may not accept this site's address (${location.origin}): it must be listed in [worker] allowed_origins of the worker's config.` })
      : null,
    el("div", { class: "actions" },
      el("button", { class: "btn btn-primary", type: "button", onclick: () => connect() }, kind === "ask" ? "Connect" : "Try again"),
      servedByWorker ? null : external(LOCAL_APP, "Open the copy served by the worker"))));
}

function remember(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    // storage turned off: the app still works, it just asks again next time
  }
}

function recall(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

async function connect() {
  setStatus("busy", "Connecting…");
  try {
    app.health = await api.health();
    [app.exams, app.settings] = await Promise.all([api.exams(), api.settings()]);
  } catch (error) {
    app.connected = false;
    if (error instanceof WorkerUnreachable) {
      const permission = await loopbackPermission();
      setStatus("down", permission === "denied" ? "Blocked by the browser" : "Worker not answering");
      connectScreen(permission === "denied" ? "denied" : "down");
    } else {
      setStatus("down", "Worker not ready");
      connectScreen("error", error.message);
    }
    return;
  }
  app.connected = true;
  remember("qbank.connected", "1");
  applyTheme(app.settings.theme);
  setStatus("ok", `Worker ${app.health.worker_version}`);
  status.title = `Connected to ${WORKER}`;
  await route();
}

async function start() {
  applyTheme(recall("qbank.theme"));
  window.addEventListener("hashchange", route);
  const permission = await loopbackPermission();
  if (permission === "granted" || (permission === "unsupported" && recall("qbank.connected"))) {
    await connect();
  } else if (permission === "denied") {
    setStatus("down", "Blocked by the browser");
    connectScreen("denied");
  } else {
    // First visit: the permission prompt must follow a click, so nothing is requested yet.
    setStatus("idle", "Not connected");
    connectScreen("ask");
  }
}

start();
