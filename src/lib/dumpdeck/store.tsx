import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from "react";
import type { DuplicateDecisionDraft } from "./drafts";
import type { Photo, RemovedPhoto, Settings, Stage } from "./types";

type State = {
  stage: Stage;
  settings: Settings;
  photos: Photo[];
  shortlist: Photo[];
  kept: Photo[];
  finalOrder: Photo[];
  removed: RemovedPhoto[];
  duplicateDecisions: DuplicateDecisionDraft[];
  pinnedCoverId: string | null;
};

type Action =
  | { type: "setStage"; stage: Stage }
  | { type: "setSettings"; settings: Settings }
  | { type: "setPhotos"; photos: Photo[] }
  | { type: "removePhoto"; id: string }
  | { type: "setShortlist"; photos: Photo[] }
  | { type: "setKept"; photos: Photo[] }
  | { type: "setFinalOrder"; photos: Photo[] }
  | { type: "addRemoved"; entries: RemovedPhoto[] }
  | { type: "setDuplicateDecisions"; decisions: DuplicateDecisionDraft[] }
  | { type: "setPinnedCover"; id: string | null }
  | { type: "restorePhoto"; id: string }
  | { type: "clearRemoved" }
  | { type: "hydrate"; state: State }
  | { type: "reset" };

const initial: State = {
  stage: "setup",
  settings: { formats: ["portrait"], vibes: ["random"] },
  photos: [],
  shortlist: [],
  kept: [],
  finalOrder: [],
  removed: [],
  duplicateDecisions: [],
  pinnedCoverId: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "hydrate":
      return { ...initial, ...action.state, pinnedCoverId: action.state.pinnedCoverId ?? null };
    case "setStage":
      return { ...state, stage: action.stage };
    case "setSettings":
      return { ...state, settings: action.settings };
    case "setPhotos":
      return { ...state, photos: action.photos };
    case "removePhoto":
      return {
        ...state,
        photos: state.photos.filter((p) => p.id !== action.id),
        shortlist: state.shortlist.filter((p) => p.id !== action.id),
        kept: state.kept.filter((p) => p.id !== action.id),
        finalOrder: state.finalOrder.filter((p) => p.id !== action.id),
        pinnedCoverId: state.pinnedCoverId === action.id ? null : state.pinnedCoverId,
      };
    case "setShortlist":
      return { ...state, shortlist: action.photos };
    case "setKept":
      return { ...state, kept: action.photos };
    case "setFinalOrder":
      return { ...state, finalOrder: action.photos };
    case "addRemoved": {
      const existing = new Set(state.removed.map((r) => r.photo.id));
      const merged = [...state.removed, ...action.entries.filter((e) => !existing.has(e.photo.id))];
      return { ...state, removed: merged };
    }
    case "setDuplicateDecisions":
      return { ...state, duplicateDecisions: action.decisions };
    case "setPinnedCover":
      return { ...state, pinnedCoverId: action.id };
    case "restorePhoto": {
      const entry = state.removed.find((r) => r.photo.id === action.id);
      if (!entry) return state;
      const photo = entry.photo;
      const inPhotos = state.photos.some((p) => p.id === photo.id);
      const inShort = state.shortlist.some((p) => p.id === photo.id);
      return {
        ...state,
        photos: inPhotos ? state.photos : [...state.photos, photo],
        shortlist: inShort ? state.shortlist : [...state.shortlist, photo],
        removed: state.removed.filter((r) => r.photo.id !== action.id),
      };
    }
    case "clearRemoved":
      return { ...state, removed: [], duplicateDecisions: [] };
    case "reset":
      return { ...initial };
  }
}

const STORAGE_KEY = "dumpdeck:state:v3";

function persist(state: State) {
  try {
    const safe = {
      stage: state.stage === "upload" || state.stage === "setup" ? state.stage : "setup",
      settings: state.settings,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
  } catch {
    // Local persistence is best-effort; private browsing can block localStorage.
  }
}

function rehydrate(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initial;
    const saved = JSON.parse(raw);
    const settings = saved.settings ?? {};
    return {
      ...initial,
      settings: {
        formats:
          Array.isArray(settings.formats) && settings.formats.length
            ? settings.formats.slice(0, 3)
            : initial.settings.formats,
        vibes:
          Array.isArray(settings.vibes) && settings.vibes.length
            ? settings.vibes.slice(0, 3)
            : initial.settings.vibes,
      },
    };
  } catch {
    return initial;
  }
}

const Ctx = createContext<{ state: State; dispatch: React.Dispatch<Action> } | null>(null);

export function DumpDeckProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    dispatch({ type: "hydrate", state: rehydrate() });
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) persist(state);
  }, [hydrated, state.settings, state.stage]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDumpDeck() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDumpDeck outside provider");
  return ctx;
}
