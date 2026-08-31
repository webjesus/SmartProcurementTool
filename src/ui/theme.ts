export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "spt.theme";

export function normalizeThemePreference(
  value: string | null | undefined
): ThemePreference {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : "system";
}

export function resolveTheme(
  preference: ThemePreference,
  systemDark: boolean
): ResolvedTheme {
  return preference === "system"
    ? systemDark
      ? "dark"
      : "light"
    : preference;
}

export const THEME_BOOTSTRAP_SCRIPT = `(() => {
  try {
    const stored = localStorage.getItem("${THEME_STORAGE_KEY}");
    const preference = stored === "light" || stored === "dark" ? stored : "system";
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const resolved = preference === "system" ? (systemDark ? "dark" : "light") : preference;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themePreference = preference;
  } catch {
    document.documentElement.dataset.theme = "light";
    document.documentElement.dataset.themePreference = "system";
  }
})();`;
