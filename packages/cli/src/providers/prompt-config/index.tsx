import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createContext, useContext, useState, useCallback } from "react";
import type { ReactNode } from "react";
import { 
  DEFAULT_CHAT_MODEL_ID, 
  SUPPORTED_CHAT_MODELS,
  Mode,
  type ModeType,
  type SupportedChatModelId,
} from "@agenticcoder/shared";

const CONFIG_DIR = join(homedir(), ".agenticcoder");
const PREFERENCES_PATH = join(CONFIG_DIR, "preferences.json");

type SavedPreferences = {
  model?: string;
  mode?: string;
};

function loadPreferences(): SavedPreferences {
  try {
    return JSON.parse(readFileSync(PREFERENCES_PATH, "utf8")) as SavedPreferences;
  } catch {
    return {};
  }
}

function savePreferences(updates: Partial<SavedPreferences>) {
  try {
    const current = loadPreferences();
    const merged = { ...current, ...updates };
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(PREFERENCES_PATH, JSON.stringify(merged, null, 2), "utf8");
  } catch {
    // Ignore write failures — preference still works for current session
  }
}

function getInitialModel(): SupportedChatModelId {
  const prefs = loadPreferences();
  if (prefs.model) {
    const found = SUPPORTED_CHAT_MODELS.find((m) => m.id === prefs.model);
    if (found) return found.id;
  }
  return DEFAULT_CHAT_MODEL_ID;
}

function getInitialMode(): ModeType {
  const prefs = loadPreferences();
  if (prefs.mode === Mode.PLAN) return Mode.PLAN;
  return Mode.BUILD;
}

type PromptConfigContextValue = {
  mode: ModeType;
  toggleMode: () => void;
  setMode: (mode: ModeType) => void;
  model: SupportedChatModelId;
  setModel: (model: SupportedChatModelId) => void;
};

const PromptConfigContext = createContext<PromptConfigContextValue | null>(null);

export function usePromptConfig(): PromptConfigContextValue {
  const value = useContext(PromptConfigContext);
  if (!value) {
    throw new Error("usePromptConfig must be used within a PromptConfigProvider");
  }
  return value;
};

type PromptConfigProviderProps = {
  children: ReactNode;
};

export function PromptConfigProvider({ children }: PromptConfigProviderProps) {
  const [mode, setModeState] = useState<ModeType>(getInitialMode);
  const [model, setModelState] = useState<SupportedChatModelId>(getInitialModel);

  const setMode = useCallback((m: ModeType) => {
    setModeState(m);
    savePreferences({ mode: m });
  }, []);

  const setModel = useCallback((m: SupportedChatModelId) => {
    setModelState(m);
    savePreferences({ model: m });
  }, []);

  const toggleMode = useCallback(() => {
    setModeState((prev) => {
      const next = prev === Mode.BUILD ? Mode.PLAN : Mode.BUILD;
      savePreferences({ mode: next });
      return next;
    });
  }, []);

  return (
    <PromptConfigContext.Provider 
      value={{ 
        mode, 
        toggleMode, 
        setMode, 
        model, 
        setModel
    }}>
      {children}
    </PromptConfigContext.Provider>
  );
};