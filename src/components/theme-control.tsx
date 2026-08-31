"use client";

import { Check, Moon, Monitor, Palette, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import {
  THEME_STORAGE_KEY,
  normalizeThemePreference,
  resolveTheme,
  type ThemePreference
} from "@/ui/theme";

const options: Array<{
  value: ThemePreference;
  label: string;
  icon: typeof Sun;
}> = [
  { value: "light", label: "Hell", icon: Sun },
  { value: "dark", label: "Dunkel", icon: Moon },
  { value: "system", label: "System", icon: Monitor }
];

function applyTheme(preference: ThemePreference) {
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = resolveTheme(
    preference,
    systemDark
  );
  document.documentElement.dataset.themePreference = preference;
}

export function ThemeControl() {
  const [open, setOpen] = useState(false);
  const [preference, setPreference] = useState<ThemePreference>(() =>
    typeof window === "undefined"
      ? "system"
      : normalizeThemePreference(
          window.localStorage.getItem(THEME_STORAGE_KEY)
        )
  );

  useEffect(() => {
    applyTheme(preference);

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = () => {
      if (
        normalizeThemePreference(
          window.localStorage.getItem(THEME_STORAGE_KEY)
        ) === "system"
      ) {
        applyTheme("system");
      }
    };
    media.addEventListener("change", updateSystemTheme);
    return () => media.removeEventListener("change", updateSystemTheme);
  }, [preference]);

  function choose(next: ThemePreference) {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
    setPreference(next);
    applyTheme(next);
    setOpen(false);
  }

  return (
    <div className="theme-control">
      <button
        type="button"
        className="shell-icon-button"
        aria-label="Darstellung"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Palette size={18} />
      </button>
      {open ? (
        <div className="theme-menu" role="menu" aria-label="Farbschema">
          {options.map(({ value, label, icon: Icon }) => (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={preference === value}
              key={value}
              onClick={() => choose(value)}
            >
              <Icon size={16} />
              <span>{label}</span>
              {preference === value ? <Check size={15} /> : <i />}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
