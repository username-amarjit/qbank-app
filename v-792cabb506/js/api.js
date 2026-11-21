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
  // Your own topics (CP40E)
  createTopic: (exam, fields) => call("POST", `/api/exams/${encodeURIComponent(exam)}/topics`, fields).then((data) => data.topic),
  updateTopic: (exam, id, fields) => call("PUT", `/api/exams/${encodeURIComponent(exam)}/topics/${encodeURIComponent(id)}`, fields).then((data) => data.topic),
  deleteTopic: (exam, id) => call("DELETE", `/api/exams/${encodeURIComponent(exam)}/topics/${encodeURIComponent(id)}`),
  findForTopic: (exam, id, params) => call("GET", `/api/exams/${encodeURIComponent(exam)}/topics/${encodeURIComponent(id)}/find` + query(params)),
  tagTopic: (exam, id, changes) => call("POST", `/api/exams/${encodeURIComponent(exam)}/topics/${encodeURIComponent(id)}/questions`, changes),
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
  // Your own questions (CP40D)
  authoredFormat: () => call("GET", "/api/authored/format"),
  // groupChoices (CP40G): what to do with each new group, [{exam, subject, group, action: create|existing|none, use}]
  uploadQuestions: (file, defaults, dryRun, groupChoices) => call("POST", "/api/authored/upload",
    { file, defaults, dry_run: dryRun, group_choices: groupChoices || [] }),
  checkQuestion: (cells, id, groupChoices) => call("POST", "/api/authored/check", { cells, id, group_choices: groupChoices || [] }),
  addQuestion: (cells, groupChoices) => call("POST", "/api/authored", { cells, group_choices: groupChoices || [] }),
  myQuestions: (params) => call("GET", "/api/authored" + query(params)),
  myQuestion: (id) => call("GET", `/api/authored/${encodeURIComponent(id)}`),
  myTopics: (params) => call("GET", "/api/authored/topics" + query(params)),
  myBatches: (params) => call("GET", "/api/authored/batches" + query(params)).then((data) => data.batches),
  // {ids} or {batch, exam}; dry_run: true says what would go (CP40F)
  removeQuestions: (body) => call("POST", "/api/authored/delete", body),
  updateQuestion: (id, cells, groupChoices) => call("PUT", `/api/authored/${encodeURIComponent(id)}`, { cells, group_choices: groupChoices || [] }),
  // Tests (CP40D)
  blueprint: (exam, origins) => call("GET", "/api/tests/blueprint" + query({ exam, origins: origins.join(",") })),
  createTest: (body) => call("POST", "/api/tests", body).then((data) => data.test),
  tests: () => call("GET", "/api/tests").then((data) => data.tests),
  test: (id) => call("GET", `/api/tests/${encodeURIComponent(id)}`).then((data) => data.test),
  startTest: (id) => call("POST", `/api/tests/${encodeURIComponent(id)}/start`, {}).then((data) => data.test),
  saveResponses: (id, responses) => call("PUT", `/api/tests/${encodeURIComponent(id)}/responses`, { responses }),
  submitTest: (id, responses) => call("POST", `/api/tests/${encodeURIComponent(id)}/submit`, { responses }).then((data) => data.test),
  deleteTest: (id) => call("DELETE", `/api/tests/${encodeURIComponent(id)}`),
  // Export (CP40H): {exam, origins, by: subjects|topics|all, subjects?, topics?}; how many first, then the file
  exportCount: (body) => call("POST", "/api/export", { ...body, count_only: true }),
  // A file from the worker (the sample upload file, an export), as a blob and its name; with a body it is a POST
  download: async (path, body, fallbackName) => {
    const init = servedByWorker ? { cache: "no-store" } : { mode: "cors", credentials: "omit", cache: "no-store", targetAddressSpace: "loopback" };
    if (body !== undefined) {
      Object.assign(init, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    }
    let response;
    try {
      response = await fetch(WORKER + path, init);
    } catch (error) {
      throw new WorkerUnreachable(`The QBank worker did not answer at ${WORKER}.`);
    }
    if (!response.ok) {
      let problem = null;
      try {
        problem = (await response.json()).error;
      } catch (error) {
        problem = null;
      }
      throw new WorkerError(response.status, (problem && problem.code) || "download", (problem && problem.message) || `The worker answered ${response.status}.`);
    }
    const name = ((response.headers.get("Content-Disposition") || "").match(/filename="([^"]+)"/) || [])[1] || fallbackName || "download";
    return { blob: await response.blob(), name };
  },
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
