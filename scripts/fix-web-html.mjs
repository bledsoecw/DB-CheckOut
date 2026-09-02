// Post-processes the exported web index.html with the viewport armor DB Cam
// Mobile ships (proven on the crew's iPhones). Without maximum-scale=1 /
// user-scalable=no, iOS Safari AUTO-ZOOMS the page when an input with a
// font under 16px is focused — and stays zoomed. A zoomed page splits the
// visual viewport from the layout viewport, which is exactly what broke the
// camera: preview letterboxed or running off the bottom of the screen, and
// tap targets landing away from their pixels. The fixed body stops iOS
// rubber-band panning of the page itself.
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";

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

// Home-screen identity: the app installs as "DB Close Out" with the DB icon.
// assets/app-icon/icon.png is the single source (its SVG lives next to it);
// swap that file to change the icon everywhere.
copyFileSync("assets/app-icon/icon.png", "public/app-icon.png");
writeFileSync(
  "public/manifest.json",
  JSON.stringify(
    {
      name: "DB Close Out",
      short_name: "DB Close Out",
      start_url: "/",
      display: "standalone",
      background_color: "#1747A5",
      theme_color: "#143A75",
      icons: [{ src: "/app-icon.png", sizes: "1024x1024", type: "image/png", purpose: "any maskable" }],
    },
    null,
    2,
  ) + "\n",
);
html = html.replace(/<title>[^<]*<\/title>/, "<title>DB Close Out</title>");
if (!html.includes("apple-touch-icon")) {
  html = html.replace(
    "</head>",
    '<link rel="manifest" href="/manifest.json">\n' +
      '<link rel="apple-touch-icon" href="/app-icon.png">\n' +
      '<link rel="icon" type="image/png" href="/app-icon.png">\n' +
      '<meta name="apple-mobile-web-app-capable" content="yes">\n' +
      '<meta name="apple-mobile-web-app-title" content="DB Close Out">\n' +
      '<meta name="apple-mobile-web-app-status-bar-style" content="default">\n' +
      "</head>",
  );
}

writeFileSync(path, html);
console.log("public/index.html: viewport pinned, body locked, DB Close Out icon + manifest");
