// Runs in <head> before the page paints (app/layout.tsx): puts the saved theme on <html>, so the page never
// flashes the wrong colours. Same key and rules as lib/theme.ts. Kept out of that "use client" file so the
// server layout can read the text.
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("theme");var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light"}catch(e){}})()`;
