/*
 * A fake customer website for the embed tests (Day 27): the page a host would
 * put MeetReady's snippet on. Plain Node, no dependencies. It runs on
 * 127.0.0.1, while the app runs on localhost: two different sites, so the
 * browser treats MeetReady's frame as third-party, exactly as on a real host's
 * site (no SameSite=Lax cookies, storage kept per site).
 *
 *   GET /site?mode=inline|popup|late&target=user/slug[&theme=dark]
 *       inline: the inline snippet; popup: the popup link; late: the inline
 *       element added by script after load (the way React or Vue add it)
 *   GET /__fake/health
 *
 * Every page lists the "meetready:booked" events it hears in <ol id="events">,
 * one JSON line each, so a test reads what a real site would receive.
 */
import http from "node:http";

const port = Number(process.env.FAKE_SITE_PORT ?? 3104);
const app = process.env.FAKE_SITE_APP_URL ?? "http://localhost:3100";

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page({ mode, target, theme }) {
  const themeAttr = theme ? ` data-meetready-theme="${escape(theme)}"` : "";
  const inline = `<div id="widget" data-meetready-inline="${escape(target)}"${themeAttr}></div>`;
  const body =
    mode === "popup"
      ? `<a id="book" href="${app}/${escape(target)}" data-meetready-popup="${escape(target)}"${themeAttr}>Book a meeting</a>`
      : mode === "late"
        ? `<div id="slot"></div><script>setTimeout(function(){document.getElementById("slot").innerHTML=${JSON.stringify(inline)}},300)</script>`
        : inline;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Ada's consulting</title>
<style>body{margin:0;padding:24px;font-family:system-ui,sans-serif;background:#fff;color:#111}</style>
</head>
<body>
<h1>Ada's consulting</h1>
<p>Book an intro call below.</p>
${body}
<h2>Events</h2>
<ol id="events"></ol>
<script>
document.addEventListener("meetready:booked", function (e) {
  var li = document.createElement("li");
  li.textContent = JSON.stringify(e.detail);
  document.getElementById("events").appendChild(li);
});
</script>
<script src="${app}/embed.js" async></script>
</body>
</html>`;
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname === "/__fake/health") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end('{"ok":true}');
    }
    if (url.pathname === "/site") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(
        page({
          mode: url.searchParams.get("mode") ?? "inline",
          target: url.searchParams.get("target") ?? "",
          theme: url.searchParams.get("theme"),
        }),
      );
    }
    // Includes /favicon.ico: an empty answer, so the browser logs no failed request.
    res.writeHead(url.pathname === "/favicon.ico" ? 204 : 404);
    res.end();
  })
  .listen(port, "127.0.0.1");
