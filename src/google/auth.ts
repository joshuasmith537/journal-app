import { config } from "../config";
import { filterDriveFiles, isAccountabilityName } from "../journal/accountability";
import { DOC_MIME, FOLDER_MIME } from "../journal/sync";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}

interface TokenClient {
  requestAccessToken: (options?: { prompt?: string }) => void;
}

interface PickedFile {
  id: string;
  name: string;
  mimeType: string;
}

type Listener = (token: string | null, error?: string) => void;

let token: { value: string; expiresAt: number } | null = null;
let client: TokenClient | null = null;
const listeners = new Set<Listener>();
let scripts: Promise<void> | null = null;

export function currentToken(): string | null {
  if (!token || Date.now() >= token.expiresAt) return null;
  return token.value;
}

export function subscribeAuth(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function loadGoogle(): Promise<void> {
  scripts ??= Promise.all([
    loadScript("https://accounts.google.com/gsi/client"),
    loadScript("https://apis.google.com/js/api.js"),
  ]).then(
    () =>
      new Promise<void>((resolve, reject) => {
        const gapi = window.gapi;
        if (!gapi?.load || !window.google?.accounts?.oauth2) {
          reject(new Error("Google sign-in did not load"));
          return;
        }
        gapi.load("picker", () => resolve());
      }),
  );
  return scripts;
}

export function initAuth(): void {
  const google = window.google;
  if (!google?.accounts?.oauth2 || client) return;
  client = google.accounts.oauth2.initTokenClient({
    client_id: config.googleClientId,
    scope: DRIVE_SCOPE,
    callback: (response: TokenResponse) => {
      if (!response.access_token || response.error) {
        token = null;
        emit(null, response.error || "Sign-in failed");
        return;
      }
      const expiresIn = response.expires_in ?? 3600;
      token = { value: response.access_token, expiresAt: Date.now() + expiresIn * 1000 - 60_000 };
      if (typeof localStorage !== "undefined") localStorage.setItem(GRANTED_KEY, "1");
      emit(token.value);
    },
    error_callback: () => {
      emit(null, "Sign-in was cancelled");
    },
  });
}

const GRANTED_KEY = "journal-drive-granted";

/** Consent on the first grant only. Later sessions reuse the stored grant silently. */
export function authPrompt(previouslyGranted: boolean): "" | "consent" {
  return previouslyGranted ? "" : "consent";
}

export function requestToken(): void {
  if (!client) throw new Error("Google sign-in is not loaded");
  const granted = typeof localStorage !== "undefined" && localStorage.getItem(GRANTED_KEY) === "1";
  client.requestAccessToken({ prompt: authPrompt(granted) });
}

export function pickerParent(id: string | undefined, name: string | undefined): string | undefined {
  if (!id || (name && isAccountabilityName(name))) return undefined;
  return id;
}

export function openJournalPicker(accessToken: string, parent?: { id: string; name: string }): Promise<PickedFile[]> {
  return new Promise((resolve, reject) => {
    const google = window.google;
    if (!google?.picker) {
      reject(new Error("The file picker is not loaded"));
      return;
    }
    let settled = false;
    const finish = (files: PickedFile[]) => {
      if (settled) return;
      settled = true;
      resolve(filterDriveFiles(files));
    };
    let view = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMimeTypes(`${FOLDER_MIME},${DOC_MIME}`);
    const parentId = parent
      ? pickerParent(parent.id, parent.name)
      : pickerParent(config.journal.personalFolderId, "Personal");
    if (parentId) view = view.setParent(parentId);
    const picker = new google.picker.PickerBuilder()
      .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
      .setAppId(config.googleCloudProjectNumber)
      .setDeveloperKey(config.googlePickerApiKey)
      .setOAuthToken(accessToken)
      .setTitle("Choose Personal Journal files")
      .addView(view)
      .setCallback((data: { action?: string; docs?: PickedFile[] }) => {
        const action = data.action;
        if (action === google.picker.Action.PICKED || action === "picked") finish(data.docs ?? []);
        else if (action === google.picker.Action.CANCEL || action === "cancel") finish([]);
      })
      .build();
    picker.setVisible(true);
  });
}

function emit(next: string | null, error?: string): void {
  for (const listener of listeners) listener(next, error);
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(script);
  });
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: TokenResponse) => void;
            error_callback?: () => void;
          }) => TokenClient;
        };
      };
      picker: {
        Action: { PICKED: string; CANCEL: string };
        Feature: { MULTISELECT_ENABLED: string };
        ViewId: { DOCS: string };
        DocsView: new (viewId: string) => {
          setIncludeFolders: (value: boolean) => DocsView;
          setSelectFolderEnabled: (value: boolean) => DocsView;
          setMimeTypes: (value: string) => DocsView;
          setParent: (value: string) => DocsView;
        };
        PickerBuilder: new () => {
          enableFeature: (feature: string) => PickerBuilder;
          setAppId: (appId: string) => PickerBuilder;
          setDeveloperKey: (key: string) => PickerBuilder;
          setOAuthToken: (token: string) => PickerBuilder;
          setTitle: (title: string) => PickerBuilder;
          addView: (view: unknown) => PickerBuilder;
          setCallback: (callback: (data: { action?: string; docs?: PickedFile[] }) => void) => PickerBuilder;
          build: () => { setVisible: (visible: boolean) => void };
        };
      };
    };
    gapi?: { load: (name: string, callback: () => void) => void };
  }
}

type DocsView = {
  setIncludeFolders: (value: boolean) => DocsView;
  setSelectFolderEnabled: (value: boolean) => DocsView;
  setMimeTypes: (value: string) => DocsView;
  setParent: (value: string) => DocsView;
};

type PickerBuilder = {
  enableFeature: (feature: string) => PickerBuilder;
  setAppId: (appId: string) => PickerBuilder;
  setDeveloperKey: (key: string) => PickerBuilder;
  setOAuthToken: (token: string) => PickerBuilder;
  setTitle: (title: string) => PickerBuilder;
  addView: (view: unknown) => PickerBuilder;
  setCallback: (callback: (data: { action?: string; docs?: PickedFile[] }) => void) => PickerBuilder;
  build: () => { setVisible: (visible: boolean) => void };
};
