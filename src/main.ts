import "./styles.css";
import { isConfigured, config } from "./config";
import { kvGet, kvSet } from "./db";
import { currentToken, initAuth, loadGoogle, openJournalPicker, pickerParent, requestToken, subscribeAuth } from "./google/auth";
import { GoogleDrive } from "./google/client";
import { cacheWarning, parseJournal } from "./journal/parse";
import { filterDriveFiles } from "./journal/accountability";
import { DOC_MIME, type DriveFile, monthCreateMessage, nextCreateStep, publishEntry, yearPickerWasOpened } from "./journal/sync";
import {
  MOODS,
  type JournalEntry,
  type Mood,
  docTitle,
  entryFromDraft,
  entryIdentity,
  formatDateLine,
  formatHashtags,
  formatInfoLine,
  stripDocsControls,
} from "./journal/text";
import { chooseWeather, lookupWeather } from "./weather";

interface Draft {
  title: string;
  body: string;
  mood: Mood | null;
  moodWords: string;
  place: string;
  moodTags: string;
  topicTags: string;
  weather: string | null;
  updatedAt: string;
}

interface QueuedEntry {
  id: string;
  at: string;
  title: string;
  mood: Mood;
  moodWords: string;
  place: string;
  weather: string | null;
  body: string;
  moodTags: string[];
  topicTags: string[];
}

interface CachedEntry extends QueuedEntry {
  docId: string;
  status: JournalEntry["status"];
  dateLine: string;
}

interface ViewEntry {
  id: string;
  sync: "draft" | "pending" | "synced";
  at: number;
  title: string;
  mood: string;
  moodWords: string;
  place: string;
  weather: string | null;
  body: string;
  tags: string;
  status: string;
  dateLine: string;
}

type Route = { name: "write" } | { name: "entries" } | { name: "entry"; id: string };
type Confirm =
  | { kind: "grant"; label: string }
  | {
      kind: "create";
      summary: string;
      message: string;
      parentId: string;
      parentName: string;
      createYearOnly?: boolean;
    }
  | null;

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("Missing app root");

const state: {
  draft: Draft;
  queue: QueuedEntry[];
  cache: CachedEntry[];
  picked: DriveFile[];
  route: Route;
  note: string;
  readNote: string;
  confirm: Confirm;
  googleReady: boolean;
  syncedFrom: Map<string, { at: string; title: string }>;
} = {
  draft: emptyDraft(),
  queue: [],
  cache: [],
  picked: [],
  route: parseRoute(),
  note: "",
  readNote: "",
  confirm: null,
  googleReady: false,
  syncedFrom: new Map(),
};

let chain: Promise<void> = Promise.resolve();

function keepChain(task: () => Promise<void>): void {
  chain = chain.then(task).catch((err: unknown) => {
    state.note = err instanceof Error ? err.message : "Something went wrong. The entry is still on this device.";
    setNote();
  });
}
let dateNode: HTMLElement | null = null;
let weatherNode: HTMLElement | null = null;
let noteNode: HTMLElement | null = null;
let saveTimer = 0;
let weatherTimer = 0;
let weatherGeneration = 0;

void boot();

async function boot(): Promise<void> {
  try {
    state.draft = (await kvGet<Draft>("draft")) ?? emptyDraft();
    state.queue = (await kvGet<QueuedEntry[]>("queue")) ?? [];
    state.cache = (await kvGet<CachedEntry[]>("cache")) ?? [];
    state.picked = filterDriveFiles((await kvGet<DriveFile[]>("picked")) ?? []);
  } catch {
    state.note = "Local storage is unavailable. Entries stay in memory for this visit.";
  }
  paint();
  tick();
  window.setInterval(tick, 15000);
  void refreshWeather();
  window.addEventListener("hashchange", () => {
    state.route = parseRoute();
    paint();
  });
  window.addEventListener("online", () => {
    keepChain(() => flush());
  });
  subscribeAuth((token, error) => {
    if (error) {
      state.note = error;
      paint();
      return;
    }
    if (token) keepChain(() => flush());
    paint();
  });
  if (isConfigured()) {
    loadGoogle()
      .then(() => {
        initAuth();
        state.googleReady = true;
        paint();
      })
      .catch(() => {
        state.note = "Google sign-in could not be loaded.";
        paint();
      });
  }
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController) window.location.reload();
    });
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  }
}

function onPublish(): void {
  if (!entryFromDraft(state.draft)) {
    state.note = "Add a title and choose a mood.";
    setNote();
    return;
  }
  const needsAuth = navigator.onLine && isConfigured() && state.googleReady && !currentToken();
  if (needsAuth) requestToken();
  keepChain(() => publishCurrentDraft());
  if (!needsAuth) keepChain(() => flush());
}

async function publishCurrentDraft(): Promise<void> {
  const cached = state.draft.weather;
  if (navigator.onLine) {
    state.note = "Getting weather…";
    setNote();
  }
  const fresh = navigator.onLine ? await lookupWeather(state.draft.place || "Chicago, IL", 5000) : null;
  state.draft.weather = chooseWeather(navigator.onLine, fresh, cached);
  const entry = entryFromDraft(state.draft);
  if (!entry) return;
  await finishPublish(entry);
}

async function finishPublish(entry: JournalEntry): Promise<void> {
  const item: QueuedEntry = {
    id: crypto.randomUUID(),
    at: entry.at.toISOString(),
    title: entry.title,
    mood: entry.mood,
    moodWords: entry.moodWords,
    place: entry.place,
    weather: entry.weather,
    body: entry.body,
    moodTags: entry.moodTags,
    topicTags: entry.topicTags,
  };
  state.queue.push(item);
  state.draft = emptyDraft();
  await kvSet("queue", state.queue);
  await kvSet("draft", state.draft);
  if (!navigator.onLine) state.note = "Saved on this device. It will sync when you are online and signed in.";
  else if (!isConfigured()) state.note = "Saved on this device. Add the Google keys in src/config.ts to sync.";
  else if (!currentToken()) state.note = "Saved on this device. Sign in to sync it.";
  else state.note = "Saved on this device. Syncing…";
  location.hash = `#/e/${encodeURIComponent(item.id)}`;
  state.route = parseRoute();
  paint();
  void refreshWeather();
}

async function flush(options?: { allowCreate?: boolean; createYearOnly?: boolean; yearPickerOpened?: boolean; personalPickerOpened?: boolean }): Promise<void> {
  if (!navigator.onLine || !currentToken() || !isConfigured()) return;
  const token = currentToken();
  if (!token) return;
  const drive = new GoogleDrive(token);
  let wrote = false;
  while (state.queue.length) {
    const item = state.queue[0];
    try {
      const result = await publishEntry(drive, queuedToEntry(item), {
        allowCreate: options?.allowCreate ?? false,
        createYearOnly: options?.createYearOnly ?? false,
        knownFiles: state.picked,
      });
      if (!result.ok && result.code === "pick-then-create") {
        const onYear = result.parentName !== "Personal";
        const step = nextCreateStep(result.parentName, {
          year: Boolean(options?.yearPickerOpened),
          personal: Boolean(options?.personalPickerOpened),
        });
        if (step === "confirm-month") {
          state.confirm = {
            kind: "create",
            summary: result.summary,
            parentId: result.parentId,
            parentName: result.parentName,
            message: monthCreateMessage(result.monthFolder, result.docTitle),
          };
          state.note = "";
          paint();
          return;
        }
        if (step === "confirm-year") {
          state.confirm = {
            kind: "create",
            summary: `Folder “${result.yearName}” inside Personal`,
            parentId: result.parentId,
            parentName: result.parentName,
            createYearOnly: true,
            message: `If you don't see folder “${result.yearName}” in Personal, create it. Then check that year for “${result.monthFolder}” or “${result.docTitle}”.`,
          };
          state.note = "";
          paint();
          return;
        }
        const parent = pickerParent(result.parentId, result.parentName);
        const picked = await openJournalPicker(token, parent ? { id: parent, name: result.parentName } : undefined);
        await remember(picked);
        await flush({ personalPickerOpened: true, yearPickerOpened: onYear });
        return;
      }
      if (!result.ok) {
        state.confirm = { kind: "grant", label: result.label };
        state.note = "";
        paint();
        return;
      }
      const queuedId = item.id;
      state.queue.shift();
      state.confirm = null;
      wrote = true;
      state.syncedFrom.set(queuedId, { at: item.at, title: item.title });
      await kvSet("queue", state.queue);
      await remember([{ id: result.docId, name: docTitle(new Date(item.at)), mimeType: DOC_MIME }]);
      options = { allowCreate: false };
    } catch (err) {
      const status = typeof err === "object" && err && "status" in err ? Number((err as { status: number }).status) : 0;
      state.note = status === 401 ? "Sign in again to sync." : "Could not sync. The entry is still saved on this device.";
      paint();
      return;
    }
  }
  await refreshCache(token);
  if (state.route.name === "entry") {
    const pendingView = state.syncedFrom.get(state.route.id);
    if (pendingView) {
      const identity = entryIdentity(new Date(pendingView.at), stripDocsControls(pendingView.title));
      const match = state.cache.find((entry) => entry.id.endsWith(identity));
      state.syncedFrom.delete(state.route.id);
      if (match) {
        location.hash = `#/e/${encodeURIComponent(match.id)}`;
        state.route = parseRoute();
      }
    }
  }
  if (wrote) state.note = "Synced to Drive.";
  paint();
}

async function refreshCache(token: string): Promise<void> {
  const drive = new GoogleDrive(token);
  const ids = new Set<string>();
  for (const year of Object.values(config.journal.years)) {
    for (const month of Object.values(year.months)) ids.add(month.docId);
  }
  for (const file of state.picked) {
    if (file.mimeType === DOC_MIME && file.name.startsWith("Personal Journal")) ids.add(file.id);
  }
  const next: CachedEntry[] = [];
  let staleDocs = 0;
  let skippedEntries = 0;
  for (const docId of ids) {
    try {
      const doc = await drive.getDocument(docId);
      const parsed = parseJournal(doc.text);
      skippedEntries += parsed.skipped;
      parsed.entries.forEach((entry, index) => next.push(toCached(docId, index, entry)));
    } catch {
      staleDocs += 1;
      next.push(...state.cache.filter((entry) => entry.docId === docId));
    }
  }
  state.cache = next;
  state.readNote = cacheWarning(staleDocs, skippedEntries) ?? "";
  await kvSet("cache", state.cache);
}

async function chooseFiles(): Promise<void> {
  const token = currentToken();
  if (!token) {
    if (state.googleReady) requestToken();
    return;
  }
  const createParent = state.confirm?.kind === "create" ? state.confirm : null;
  const parentId = createParent ? pickerParent(createParent.parentId, createParent.parentName) : undefined;
  const picked = await openJournalPicker(
    token,
    parentId && createParent ? { id: parentId, name: createParent.parentName } : undefined,
  );
  await remember(picked);
  state.confirm = null;
  keepChain(() => flush({ yearPickerOpened: yearPickerWasOpened(createParent), personalPickerOpened: true }));
}

async function remember(files: DriveFile[]): Promise<void> {
  const merged = new Map(state.picked.map((file) => [file.id, file]));
  for (const file of filterDriveFiles(files)) merged.set(file.id, file);
  state.picked = [...merged.values()];
  await kvSet("picked", state.picked);
}

function paint(): void {
  const signedIn = Boolean(currentToken());
  const main = h("main", { id: "main" }, confirmBanner(), routeView());
  app?.replaceChildren(
    h("header", { class: "top" },
      h("div", null, h("p", { class: "eyebrow" }, "Personal"), h("h1", null, "Journal")),
      h("button", { type: "button", class: "text-btn", id: "auth" }, signedIn ? "Signed in" : "Sign in"),
    ),
    h("nav", { class: "tabs", "aria-label": "Sections" },
      tab("Write", "/write", state.route.name === "write"),
      tab("Past", "/entries", state.route.name !== "write"),
    ),
    main,
    h("p", { id: "note", class: "note", role: "status" }, [state.note, state.readNote].filter(Boolean).join(" ")),
  );
  noteNode = document.querySelector("#note");
  dateNode = document.querySelector(".dateline");
  weatherNode = document.querySelector(".weather");
  document.querySelector("#auth")?.addEventListener("click", () => {
    if (!isConfigured()) {
      state.note = "Add the Google keys in src/config.ts first.";
      setNote();
      return;
    }
    if (!state.googleReady) {
      state.note = "Google sign-in is still loading.";
      setNote();
      return;
    }
    requestToken();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-nav]").forEach((button) => {
    button.addEventListener("click", () => {
      location.hash = button.dataset.nav ?? "#/write";
    });
  });
  bindRoute();
}

function bindRoute(): void {
  document.querySelector("#publish")?.addEventListener("click", onPublish);
  document.querySelector("#grant")?.addEventListener("click", () => {
    void chooseFiles().catch((err: unknown) => {
      state.note = err instanceof Error ? err.message : "Could not open the file picker.";
      setNote();
    });
  });
  document.querySelector("#create-doc")?.addEventListener("click", () => {
    const yearOnly = state.confirm?.kind === "create" && state.confirm.createYearOnly;
    state.confirm = null;
    keepChain(() => flush(yearOnly ? { createYearOnly: true, personalPickerOpened: true } : { allowCreate: true, yearPickerOpened: true }));
  });
  document.querySelector("#back")?.addEventListener("click", () => {
    location.hash = "#/entries";
  });
  document.querySelectorAll<HTMLButtonElement>("[data-open]").forEach((button) => {
    button.addEventListener("click", () => {
      location.hash = `#/e/${encodeURIComponent(button.dataset.open ?? "")}`;
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-mood]").forEach((button) => {
    button.addEventListener("click", () => selectMood(button.dataset.mood as Mood));
  });
  const bind = (id: string, apply: (value: string) => void, weather = false) => {
    const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`);
    field?.addEventListener("input", () => {
      apply(field.value);
      state.draft.updatedAt = new Date().toISOString();
      scheduleSave();
      if (weather) scheduleWeather();
    });
  };
  bind("title", (value) => {
    state.draft.title = value;
  });
  bind("body", (value) => {
    state.draft.body = value;
  });
  bind("mood-words", (value) => {
    state.draft.moodWords = value;
  });
  bind("place", (value) => {
    state.draft.place = value;
  }, true);
  bind("mood-tags", (value) => {
    state.draft.moodTags = value;
  });
  bind("topic-tags", (value) => {
    state.draft.topicTags = value;
  });
}

function routeView(): HTMLElement {
  if (state.route.name === "entries") return listView();
  if (state.route.name === "entry") return detailView(state.route.id);
  return writeView();
}

function writeView(): HTMLElement {
  const draft = state.draft;
  return h("section", { class: "write" },
    h("p", { class: "dateline" }, formatDateLine(new Date())),
    h("label", { class: "field" }, h("span", null, "Place"), h("input", { id: "place", value: draft.place, autocomplete: "off" })),
    h("p", { class: "weather" }, draft.weather ?? (navigator.onLine ? "Loading weather…" : "Weather unavailable")),
    h("label", { class: "field" }, h("span", null, "Title"), h("input", { id: "title", class: "title-input", value: draft.title, autocomplete: "off" })),
    h("div", { class: "moods", role: "radiogroup", "aria-label": "Mood" }, ...MOODS.map((mood) => moodButton(mood, draft.mood === mood))),
    h("label", { class: "field" }, h("span", null, "Mood words"), h("input", { id: "mood-words", value: draft.moodWords, placeholder: "a few words", autocomplete: "off" })),
    h("label", { class: "field" }, h("span", null, "Entry"), h("textarea", { id: "body", value: draft.body })),
    h("label", { class: "field" }, h("span", null, "Mood tags"), h("input", { id: "mood-tags", value: draft.moodTags, placeholder: "calm", autocomplete: "off" })),
    h("label", { class: "field" }, h("span", null, "Topic tags"), h("input", { id: "topic-tags", value: draft.topicTags, placeholder: "topic", autocomplete: "off" })),
    h("button", { type: "button", id: "publish", class: "publish" }, "Publish"),
    h("p", { class: "fine" }, "Saved on this device until you publish. Publishing appends to your Personal Journal doc."),
    isConfigured() ? null : h("p", { class: "fine" }, "Sync needs the Google keys in src/config.ts."),
  );
}

function listView(): HTMLElement {
  const entries = viewEntries();
  if (!entries.length) return h("section", { class: "empty" }, h("p", null, "No entries yet."));
  return h("section", { class: "list" }, ...entries.map((entry) =>
    h("button", { type: "button", class: "card", "data-open": entry.id },
      h("span", { class: "card-date" }, entry.sync === "draft" ? "Draft" : entry.dateLine),
      h("span", { class: "card-title" }, `${entry.title || "Untitled"}${entry.mood ? `  ${entry.mood}` : ""}`),
      entry.body ? h("span", { class: "card-body" }, entry.body.split("\n").find((line) => line.trim()) ?? "") : null,
      entry.sync === "pending" ? h("span", { class: "badge" }, "Waiting to sync") : null,
    ),
  ));
}

function detailView(id: string): HTMLElement {
  const entry = viewEntries().find((item) => item.id === id);
  if (!entry) return h("section", { class: "empty" }, h("p", null, "That entry is not on this device."), h("button", { type: "button", id: "back", class: "text-btn" }, "Back"));
  const label = entry.sync === "draft" ? "Draft" : entry.sync === "pending" ? "Waiting to sync" : "In Drive";
  return h("article", { class: "detail" },
    h("button", { type: "button", id: "back", class: "text-btn" }, "Back"),
    h("p", { class: "dateline" }, entry.dateLine),
    h("h2", null, `${entry.title || "Untitled"}${entry.mood ? `  ${entry.mood}` : ""}`),
    entry.moodWords ? h("p", { class: "mood-line" }, `Mood: ${entry.moodWords}`) : null,
    h("p", { class: "info-line" }, formatInfoLine(new Date(entry.at), entry.place, entry.weather)),
    entry.body ? h("p", { class: "body" }, entry.body) : null,
    entry.tags ? h("p", { class: "tags" }, entry.tags) : null,
    h("p", { class: "status-line" }, entry.status),
    h("p", { class: "badge" }, label),
  );
}

function confirmBanner(): HTMLElement | null {
  if (!state.confirm) return null;
  if (state.confirm.kind === "grant") {
    return h("div", { class: "banner" },
      h("p", null, `Grant “${state.confirm.label}” so the entry can be appended.`),
      h("button", { type: "button", id: "grant" }, "Choose files"),
    );
  }
  return h("div", { class: "banner" },
    h("p", null, state.confirm.message),
    h("p", { class: "plan" }, state.confirm.summary),
    h("div", { class: "row" },
      h("button", { type: "button", id: "create-doc" }, "Create"),
      h("button", { type: "button", id: "grant", class: "secondary" }, "Choose existing"),
    ),
  );
}

function viewEntries(): ViewEntry[] {
  const entries: ViewEntry[] = [];
  if (!draftEmpty(state.draft)) {
    const at = Date.parse(state.draft.updatedAt) || Date.now();
    entries.push({
      id: "draft",
      sync: "draft",
      at,
      title: state.draft.title,
      mood: state.draft.mood ?? "",
      moodWords: state.draft.moodWords,
      place: state.draft.place,
      weather: state.draft.weather,
      body: state.draft.body,
      tags: formatHashtags(splitTags(state.draft.moodTags), splitTags(state.draft.topicTags)) ?? "",
      status: "Draft",
      dateLine: "Draft",
    });
  }
  for (const item of state.queue) entries.push(queuedView(item));
  for (const item of state.cache) {
    entries.push({
      id: item.id,
      sync: "synced",
      at: Date.parse(item.at),
      title: item.title,
      mood: item.mood,
      moodWords: item.moodWords,
      place: item.place,
      weather: item.weather,
      body: item.body,
      tags: formatHashtags(item.moodTags, item.topicTags) ?? "",
      status: `Journal: ${docTitle(new Date(item.at)).replace("Personal Journal \u2013 ", "")} \u00b7 ${item.status}`,
      dateLine: item.dateLine,
    });
  }
  return entries.sort((a, b) => b.at - a.at);
}

function queuedView(item: QueuedEntry): ViewEntry {
  const at = new Date(item.at);
  return {
    id: item.id,
    sync: "pending",
    at: at.getTime(),
    title: item.title,
    mood: item.mood,
    moodWords: item.moodWords,
    place: item.place,
    weather: item.weather,
    body: item.body,
    tags: formatHashtags(item.moodTags, item.topicTags) ?? "",
    status: `Journal: ${docTitle(at).replace("Personal Journal \u2013 ", "")} \u00b7 Published`,
    dateLine: formatDateLine(at),
  };
}

function toCached(docId: string, index: number, entry: JournalEntry): CachedEntry {
  return {
    id: `${docId}:${index}:${entryIdentity(entry.at, entry.title)}`,
    docId,
    at: entry.at.toISOString(),
    title: entry.title,
    mood: entry.mood,
    moodWords: entry.moodWords,
    place: entry.place,
    weather: entry.weather,
    body: entry.body,
    moodTags: entry.moodTags,
    topicTags: entry.topicTags,
    status: entry.status,
    dateLine: formatDateLine(entry.at),
  };
}

function queuedToEntry(item: QueuedEntry): JournalEntry {
  return { ...item, at: new Date(item.at), status: "Published" };
}

function splitTags(value: string): string[] {
  return value.split(/[\s,]+/).map((part) => part.trim()).filter(Boolean);
}

function selectMood(mood: Mood): void {
  state.draft.mood = mood;
  state.draft.updatedAt = new Date().toISOString();
  document.querySelectorAll<HTMLButtonElement>("[data-mood]").forEach((button) => {
    const on = button.dataset.mood === mood;
    button.setAttribute("aria-checked", on ? "true" : "false");
    button.classList.toggle("selected", on);
  });
  scheduleSave();
}

function scheduleSave(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void kvSet("draft", state.draft);
  }, 300);
}

function scheduleWeather(): void {
  window.clearTimeout(weatherTimer);
  weatherTimer = window.setTimeout(() => {
    void refreshWeather();
  }, 600);
}

async function refreshWeather(): Promise<void> {
  const generation = ++weatherGeneration;
  const line = navigator.onLine ? await lookupWeather(state.draft.place || "Chicago, IL") : null;
  if (generation !== weatherGeneration) return;
  state.draft.weather = line;
  if (weatherNode && state.route.name === "write") weatherNode.textContent = line ?? "Weather unavailable";
  void kvSet("draft", state.draft);
}

function tick(): void {
  if (dateNode && state.route.name === "write") dateNode.textContent = formatDateLine(new Date());
}

function setNote(): void {
  if (noteNode) noteNode.textContent = state.note;
  else paint();
}

function parseRoute(): Route {
  const hash = location.hash.replace(/^#/, "");
  if (hash.startsWith("/e/")) return { name: "entry", id: decodeURIComponent(hash.slice(3)) };
  if (hash.startsWith("/entries")) return { name: "entries" };
  return { name: "write" };
}

function draftEmpty(draft: Draft): boolean {
  return !draft.title.trim() && !draft.body.trim() && !draft.mood && !draft.moodWords.trim() && !draft.moodTags.trim() && !draft.topicTags.trim();
}

function emptyDraft(): Draft {
  return {
    title: "",
    body: "",
    mood: null,
    moodWords: "",
    place: "Chicago, IL",
    moodTags: "",
    topicTags: "",
    weather: null,
    updatedAt: new Date(0).toISOString(),
  };
}

function tab(label: string, hash: string, current: boolean): HTMLButtonElement {
  return h("button", {
    type: "button",
    class: current ? "tab current" : "tab",
    "data-nav": `#${hash}`,
    ...(current ? { "aria-current": "page" } : {}),
  }, label);
}

function moodButton(mood: Mood, selected: boolean): HTMLButtonElement {
  const names: Record<Mood, string> = { "😞": "Very low", "😕": "Low", "😐": "Neutral", "🙂": "Good", "😄": "Great" };
  return h("button", {
    type: "button",
    class: selected ? "mood selected" : "mood",
    role: "radio",
    "aria-checked": selected ? "true" : "false",
    "aria-label": names[mood],
    "data-mood": mood,
  }, mood);
}

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string> | null,
  ...children: Array<Node | string | null | undefined | false>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (key === "class") node.className = value;
      else node.setAttribute(key, value);
    }
  }
  if (tag === "textarea" && props && "value" in props) node.textContent = props.value;
  if ((tag === "input" || tag === "textarea") && node instanceof HTMLInputElement) {
    const value = props?.value;
    if (value !== undefined) node.value = value;
  }
  if (tag === "textarea" && node instanceof HTMLTextAreaElement && props?.value !== undefined) node.value = props.value;
  for (const child of children) {
    if (child === null || child === undefined || child === false || child === "") continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}
