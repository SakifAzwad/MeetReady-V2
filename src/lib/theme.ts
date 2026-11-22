/*
 * The theme choice (Day 26, Part B). Three options: follow the device
 * ("system", the default), or always light, or always dark. Only an explicit
 * choice is stored, in localStorage, and only an explicit choice puts
 * data-theme on <html>. With no attribute the CSS follows
 * prefers-color-scheme by itself, so "system" keeps working with JavaScript
 * off and updates live when the device switches at sunset.
 *
 * Why the browser, not the database: the booking page has no login, and a
 * guest's choice is a property of their screen, not of an account. Why not a
 * cookie: the server would have to read it, which makes every static page
 * dynamic. The cost of localStorage is that the server can't know the choice,
 * so a tiny script in <head> applies it before the first paint (THEME_SCRIPT).
 */

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_STORAGE_KEY = "theme";

/** The page background of each theme: also the browser's toolbar colour (theme-color). */
export const THEME_COLORS = { light: "#f5f7fb", dark: "#0f1424" } as const;

export const isTheme = (value: unknown): value is Theme => THEMES.includes(value as Theme);

/**
 * Runs in <head> before the body is parsed, so the first paint already has the
 * right colours (no flash of the wrong theme). Plain ES5, no imports, wrapped in
 * try: localStorage throws in some private modes and sandboxed frames, and then
 * the page simply follows the device. theme-color tags may come after this
 * script (Next.js places metadata), so they're updated once the document is
 * parsed.
 */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t!=="light"&&t!=="dark")return;document.documentElement.setAttribute("data-theme",t);var c=t==="dark"?${JSON.stringify(THEME_COLORS.dark)}:${JSON.stringify(THEME_COLORS.light)};document.addEventListener("DOMContentLoaded",function(){var m=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<m.length;i++)m[i].setAttribute("content",c)})}catch(e){}})();`;
