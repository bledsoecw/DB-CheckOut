// Post-processes the exported web index.html with the viewport armor DB Cam
// Mobile ships (proven on the crew's iPhones). Without maximum-scale=1 /
// user-scalable=no, iOS Safari AUTO-ZOOMS the page when an input with a
// font under 16px is focused — and stays zoomed. A zoomed page splits the
// visual viewport from the layout viewport, which is exactly what broke the
// camera: preview letterboxed or running off the bottom of the screen, and
// tap targets landing away from their pixels. The fixed body stops iOS
// rubber-band panning of the page itself.
import { readFileSync, writeFileSync } from "node:fs";

const path = "public/index.html";
let html = readFileSync(path, "utf8");

html = html.replace(
  /<meta name="viewport"[^>]*\/?>/,
  '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />',
);

if (!html.includes("dbco-lock")) {
  html = html.replace(
    "</head>",
    '<style id="dbco-lock">body{position:fixed;inset:0;width:100%;overscroll-behavior:none}</style>\n</head>',
  );
}

writeFileSync(path, html);
console.log("public/index.html: viewport pinned, body locked");
