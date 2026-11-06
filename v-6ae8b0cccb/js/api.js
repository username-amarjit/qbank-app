// Talks to the QBank worker on this computer (http://127.0.0.1:7331). The worker holds the questions and your
// progress; this site holds none of them. On GitHub Pages the browser asks once for permission to reach apps on
// this device (Local Network Access); the copy the worker serves at /app/ is same-origin and needs no permission.

const PORT = 7331;
const LOCAL_ORIGINS = [`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`];

// The copy at http://127.0.0.1:<port>/app/ is served by the worker itself, whatever port it was given; it talks to
// its own origin. Anywhere else (GitHub Pages) the worker is expected on the default port.
export const servedByWorker = location.protocol === "http:" && ["127.0.0.1", "localhost"].includes(location.hostname) &&
  location.pathname.startsWith("/app/");
export const WORKER = servedByWorker ? location.origin : LOCAL_ORIGINS[0];
export const LOCAL_APP = `${LOCAL_ORIGINS[0]}/app/`;

export class WorkerError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class WorkerUnreachable extends Error {}

// 'granted', 'prompt', 'denied', or 'unsupported' (a browser without Local Network Access permissions).
// Only the granular name is queried: older Chrome versions crash on the legacy 'local-network-access' name.
export async function loopbackPermission() {
  if (servedByWorker) {
    return "granted";
  }
  if (!navigator.permissions || !navigator.permissions.query) {
    return "unsupported";
  }
  try {
    return (await navigator.permissions.query({ name: "loopback-network" })).state;
  } catch (error) {
    return "unsupported";
  }
}

async function call(method, path, body) {
  const init = { method, cache: "no-store", credentials: "omit", headers: {} };
  if (!servedByWorker) {
    init.mode = "cors";
    init.targetAddressSpace = "loopback";
  }
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(WORKER + path, init);
  } catch (error) {
    throw new WorkerUnreachable(`The QBank worker did not answer at ${WORKER}.`);
  }
  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }
  if (!response.ok) {
    const info = (data && data.error) || {};
    throw new WorkerError(response.status, info.code || "error", info.message || `The worker answered ${response.status}.`);
  }
  return data;
}

function query(params) {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, value);
    }
  });
  const text = search.toString();
  return text ? `?${text}` : "";
}

export const api = {
  health: () => call("GET", "/health"),
  exams: () => call("GET", "/api/exams").then((data) => data.exams),
  display: () => call("GET", "/api/display"),
  resolveIds: (shorts) => call("GET", "/api/ids" + query({ short: shorts.join(",") })).then((data) => data.ids),
  examTopics: (exam) => call("GET", `/api/exams/${encodeURIComponent(exam)}/topics`),
  editTopics: (id, change) => call("POST", `/api/questions/${encodeURIComponent(id)}/topics`, change),
  questions: (params) => call("GET", "/api/questions" + query(params)),
  search: (params) => call("GET", "/api/search" + query(params)),
  question: (id) => call("GET", `/api/questions/${encodeURIComponent(id)}`),
  random: (params) => call("GET", "/api/random" + query(params)).then((data) => data.questions),
  attempt: (body) => call("POST", "/api/attempts", body),
  bookmark: (id, on) => call("POST", "/api/bookmarks", { question_id: id, bookmarked: on }),
  favorite: (id, on) => call("POST", "/api/favorites", { question_id: id, favorite: on }),
  saveNote: (id, text) => call("POST", "/api/notes", { question_id: id, body: text }),
  notes: () => call("GET", "/api/notes").then((data) => data.notes),
  startSession: (body) => call("POST", "/api/sessions", body).then((data) => data.session_id),
  endSession: (id) => call("POST", `/api/sessions/${id}/end`, {}),
  sessions: (params) => call("GET", "/api/sessions" + query(params)).then((data) => data.sessions),
  history: (params) => call("GET", "/api/history" + query(params)).then((data) => data.attempts),
  analytics: (exam) => call("GET", "/api/analytics" + query({ exam })),
  mistakes: (params) => call("GET", "/api/mistakes" + query(params)),
  addMistake: (body) => call("POST", "/api/mistakes", body).then((data) => data.mistake),
  updateMistake: (id, changes) => call("PUT", `/api/mistakes/${encodeURIComponent(id)}`, changes).then((data) => data.mistake),
  deleteMistake: (id) => call("DELETE", `/api/mistakes/${encodeURIComponent(id)}`),
  settings: () => call("GET", "/api/settings").then((data) => data.settings),
  saveSettings: (values) => call("PUT", "/api/settings", values).then((data) => data.settings),
  assetUrl: (exam, asset) => `${WORKER}/assets/${encodeURIComponent(exam)}/${asset.path}`,
  // Images through fetch too: from an HTTPS page this is the request Local Network Access expects for 127.0.0.1,
  // and it is never mixed content. Images are named by SHA-256, so the browser cache can serve them for good.
  image: async (url) => {
    let response;
    try {
      response = await fetch(url, { mode: "cors", credentials: "omit", targetAddressSpace: "loopback" });
    } catch (error) {
      throw new WorkerUnreachable(`The QBank worker did not answer at ${WORKER}.`);
    }
    if (!response.ok) {
      throw new WorkerError(response.status, "image", `The worker answered ${response.status} for an image.`);
    }
    return response.blob();
  },
};
