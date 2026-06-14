import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createContext, useContext, useState, useCallback } from "react";
import type { ReactNode } from "react";
import type { ThemeColors, Theme } from "../../theme";
import { DEFAULT_THEME, THEMES } from "../../theme";

const CONFIG_DIR = join(homedir(), ".agenticcoder");
const PREFERENCES_PATH = join(CONFIG_DIR, "preferences.json");

type SavedPreferences = {
  themeName?: string;
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
    // Ignore write failures
  }
}

function getInitialTheme(): Theme {
  const prefs = loadPreferences();
  if (prefs.themeName) {
    const found = THEMES.find((t) => t.name === prefs.themeName);
    if (found) return found;
  }
  return DEFAULT_THEME;
}

type ThemeContextValue = {
  colors: ThemeColors;
  currentTheme: Theme;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return value;
}

type ThemeProviderProps = {
  children: ReactNode;
};

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [currentTheme, setCurrentTheme] = useState<Theme>(getInitialTheme);

  const setTheme = useCallback((theme: Theme) => {
    setCurrentTheme(theme);
    savePreferences({ themeName: theme.name });
  }, []);

  return (
    <ThemeContext.Provider 
      value={{ colors: currentTheme.colors, currentTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};