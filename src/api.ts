// Jembatan ke Rust lewat Tauri command. Di luar Tauri (misalnya `npm run dev`
// di browser biasa) dipakai data contoh, supaya tampilan bisa dikembangkan tanpa Mac.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type PresetMode = "clean" | "dock_only";

export interface PresetApp {
  bundle_id: string;
  name: string;
  order: number;
  auto_open: boolean;
}

export interface Preset {
  id: string;
  name: string;
  mode: PresetMode;
  apps: PresetApp[];
}

export interface LoadedPresets {
  presets: Preset[];
  warning?: string;
}

export interface InstalledApp {
  bundle_id: string;
  name: string;
  path: string;
  icon?: string;
}

export interface Settings {
  exclusions: string[];
  quit_timeout_ms: number;
  welcome_seen: boolean;
  selected_preset: string | null;
}

export type Step = "snapshot" | "close_apps" | "wait_for_quit" | "replace_dock" | "open_apps";

export interface Progress {
  step: Step;
  index: number;
  total: number;
  status: "started" | "done" | "failed";
  label: string;
  detail?: string;
}

export interface RunSummary {
  preset_name: string;
  mode: PresetMode;
  closed: string[];
  opened: string[];
  still_running: string[];
  open_failed: string[];
  missing: string[];
  dock_changed: boolean;
  dock_error?: string;
  duration_ms: number;
}

export interface UndoSummary {
  dock_restored: boolean;
  reopened: string[];
  open_failed: string[];
}

export interface Status {
  busy: boolean;
  can_undo: boolean;
  has_backup: boolean;
  data_dir: string;
}

export const MODE_LABEL: Record<PresetMode, string> = {
  clean: "Bersih total",
  dock_only: "Ganti dock saja",
};

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Gabungkan nama: "A", "A dan B", "A, B, dan C". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} dan ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, dan ${names[names.length - 1]}`;
}

/** Kalimat ringkasan, sama dengan RunSummary::sentence di Rust. */
export function summarySentence(s: RunSummary): string {
  const parts: string[] = [];
  if (s.mode === "clean") parts.push(`${s.closed.length} app ditutup, ${s.opened.length} dibuka.`);
  else if (s.dock_changed) parts.push("Dock sudah diganti.");
  if (s.still_running.length)
    parts.push(`${joinNames(s.still_running)} masih terbuka karena ada pekerjaan belum disimpan.`);
  if (s.missing.length) parts.push(`${joinNames(s.missing)} tidak ditemukan dan dilewati.`);
  if (s.open_failed.length) parts.push(`${joinNames(s.open_failed)} gagal dibuka.`);
  if (s.dock_error) parts.push(`Dock tidak diubah: ${s.dock_error}`);
  return parts.join(" ");
}

export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}

// ---- Perintah ---------------------------------------------------------

export const api = {
  scanApps: () => call<InstalledApp[]>("scan_apps"),
  listPresets: () => call<LoadedPresets>("list_presets"),
  savePreset: (preset: Preset) => call<Preset[]>("save_preset", { preset }),
  deletePreset: (id: string) => call<Preset[]>("delete_preset", { id }),
  presetFromCurrent: (name: string) => call<Preset>("preset_from_current", { name }),
  getSettings: () => call<Settings>("get_settings"),
  saveSettings: (settings: Settings) => call<Settings>("save_settings", { settings }),
  runPreset: (id: string) => call<RunSummary>("run_preset", { id }),
  undoLast: () => call<UndoSummary>("undo_last"),
  restoreOriginalDock: () => call<void>("restore_original_dock"),
  status: () => call<Status>("app_status"),
  resizePanel: (height: number) => call<void>("resize_panel", { height }),
  hidePanel: () => call<void>("hide_panel"),
  openSettings: () => call<void>("open_settings"),
  quit: () => call<void>("quit_app"),
};

export function on<T>(event: string, handler: (payload: T) => void): () => void {
  if (!isTauri) return mockOn(event, handler as (p: unknown) => void);
  let unlisten: UnlistenFn | undefined;
  let cancelled = false;
  listen<T>(event, (e) => handler(e.payload)).then((u) => {
    if (cancelled) u();
    else unlisten = u;
  });
  return () => {
    cancelled = true;
    unlisten?.();
  };
}

function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri) return invoke<T>(cmd, args);
  return mock(cmd, args) as Promise<T>;
}

// ---- Data contoh untuk browser ----------------------------------------

const mockListeners = new Map<string, Set<(p: unknown) => void>>();

function mockOn(event: string, handler: (p: unknown) => void) {
  if (!mockListeners.has(event)) mockListeners.set(event, new Set());
  mockListeners.get(event)!.add(handler);
  return () => mockListeners.get(event)?.delete(handler);
}

function mockEmit(event: string, payload: unknown) {
  mockListeners.get(event)?.forEach((h) => h(payload));
}

const demoApps: InstalledApp[] = [
  ["com.anthropic.claudefordesktop", "Claude"],
  ["com.figma.Desktop", "Figma"],
  ["com.tinyspeck.slackmacgap", "Slack"],
  ["notion.id", "Notion"],
  ["com.linear", "Linear"],
  ["com.apple.Safari", "Safari"],
  ["com.apple.Music", "Music"],
  ["com.spotify.client", "Spotify"],
  ["com.apple.TextEdit", "TextEdit"],
  ["com.microsoft.VSCode", "Visual Studio Code"],
].map(([bundle_id, name]) => ({ bundle_id, name, path: `/Applications/${name}.app` }));

const pa = (bundle_id: string, name: string, order: number, auto_open: boolean): PresetApp => ({
  bundle_id,
  name,
  order,
  auto_open,
});

let demoPresets: Preset[] = [
  {
    id: "kerja",
    name: "Kerja",
    mode: "clean",
    apps: [
      pa("com.anthropic.claudefordesktop", "Claude", 1, true),
      pa("com.figma.Desktop", "Figma", 2, true),
      pa("com.tinyspeck.slackmacgap", "Slack", 3, true),
      pa("notion.id", "Notion", 4, false),
      pa("com.linear", "Linear", 5, false),
    ],
  },
  { id: "desain", name: "Desain", mode: "clean", apps: [pa("com.figma.Desktop", "Figma", 1, true)] },
  { id: "santai", name: "Santai", mode: "dock_only", apps: [pa("com.spotify.client", "Spotify", 1, true)] },
  { id: "menulis", name: "Menulis", mode: "clean", apps: [pa("notion.id", "Notion", 1, true)] },
];

let demoSettings: Settings = {
  exclusions: ["com.1password.1password"],
  quit_timeout_ms: 5000,
  welcome_seen: new URLSearchParams(location.search).get("welcome") !== "1",
  selected_preset: "kerja",
};

let demoCanUndo = false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mock(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
  switch (cmd) {
    case "scan_apps":
      return demoApps;
    case "list_presets":
      return { presets: demoPresets };
    case "save_preset": {
      const p = structuredClone(args.preset as Preset);
      if (!p.id) p.id = `p${Date.now().toString(16)}`;
      p.apps.sort((a, b) => a.order - b.order).forEach((a, i) => (a.order = i + 1));
      const i = demoPresets.findIndex((x) => x.id === p.id);
      demoPresets = i >= 0 ? demoPresets.map((x) => (x.id === p.id ? p : x)) : [...demoPresets, p];
      mockEmit("presets-changed", demoPresets);
      return demoPresets;
    }
    case "delete_preset":
      demoPresets = demoPresets.filter((p) => p.id !== args.id);
      mockEmit("presets-changed", demoPresets);
      return demoPresets;
    case "preset_from_current":
      return {
        id: `p${Date.now().toString(16)}`,
        name: args.name,
        mode: "clean",
        apps: [pa("com.apple.Safari", "Safari", 1, true), pa("notion.id", "Notion", 2, false)],
      };
    case "get_settings":
      return demoSettings;
    case "save_settings":
      demoSettings = args.settings as Settings;
      mockEmit("settings-changed", demoSettings);
      return demoSettings;
    case "run_preset": {
      const preset = demoPresets.find((p) => p.id === args.id)!;
      const steps: [Step, string][] =
        preset.mode === "clean"
          ? [
              ["snapshot", "Memotret kondisi sekarang"],
              ["close_apps", "Menutup app di luar preset"],
              ["wait_for_quit", "Menunggu app menutup diri"],
              ["replace_dock", "Mengganti isi dock"],
              ["open_apps", "Membuka app"],
            ]
          : [
              ["snapshot", "Memotret kondisi sekarang"],
              ["replace_dock", "Mengganti isi dock"],
            ];
      for (const [i, [step, label]] of steps.entries()) {
        mockEmit("run-progress", { step, index: i + 1, total: steps.length, status: "started", label });
        await sleep(450);
        mockEmit("run-progress", { step, index: i + 1, total: steps.length, status: "done", label });
      }
      demoCanUndo = true;
      return {
        preset_name: preset.name,
        mode: preset.mode,
        closed: preset.mode === "clean" ? ["Safari", "Music", "Spotify", "TextEdit"] : [],
        opened: preset.mode === "clean" ? ["Claude", "Slack"] : [],
        still_running: preset.mode === "clean" ? ["Figma"] : [],
        open_failed: [],
        missing: [],
        dock_changed: true,
        duration_ms: 2400,
      } satisfies RunSummary;
    }
    case "undo_last":
      demoCanUndo = false;
      return { dock_restored: true, reopened: ["Safari", "Music", "Spotify"], open_failed: [] };
    case "restore_original_dock":
      await sleep(400);
      return undefined;
    case "app_status":
      return { busy: false, can_undo: demoCanUndo, has_backup: true, data_dir: "~/Library/Application Support/Docky" };
    default:
      return undefined;
  }
}
