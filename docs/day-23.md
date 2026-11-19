# Day 23: The README for reviewers

**Result:**

- **The README now speaks to a reviewer first.** In order: what MeetReady is, the live link, a GIF of the AI
  assistant, six highlights (each linked to the day doc that defends it), screenshots, an architecture diagram, an
  AI features table, then setup, scripts, tests and the design notes.
- **Every image is made by a script.** `npm run shots` seeds a demo host, takes the screenshots and builds the GIF
  into `docs/images/`. After a UI change, one command retakes them all.
- **The Claude screenshot is yours to add.** It needs your Claude account, so the README has it commented out.
  Save it as `docs/images/claude.png` and remove the comment markers.
- **Tests:** no app code changed. The shots script passes, and typecheck, lint and format are green.

```
README.md                         # rewritten: highlights, screenshots, Mermaid diagram, AI table
docs/images/                      # booking-assistant.gif, booking-page.png, booking-phone.png, dashboard.png,
                                  # dashboard-assistants.png, bookings.png, consent.png
e2e/shots/readme.shots.ts         # seeds the demo data, takes the screenshots, builds the GIF
playwright.shots.config.ts        # the E2E setup (fake Google, fake Groq, fresh database), only the shots
package.json                      # npm run shots
```

## 1. Decisions

### Screenshots from a script, not by hand

- **Chosen:** a Playwright script on the E2E setup (production build, fresh database, fake Google and Groq). It
  seeds a host (`sakifazwad18`), three meeting types, three bookings this week (one with an AI brief, one booked
  through Claude) and a connected Claude, then captures each page at 2x.
- **Why:** screenshots by hand go stale the first time the UI changes, and nobody retakes them. They also tend to
  show real data: a real inbox, real guests. Seeded data is fictional (Ada Lovelace, Grace Hopper, Alan Turing)
  and the same on every run. The fake Groq makes the assistant answer the same way every time, so the GIF is
  repeatable too.
- **Trade-off:** the script writes rows straight into the database, so it has to follow schema changes. It
  breaks loudly when it doesn't (an insert fails), which is the right failure.

### A GIF, made from screenshots

- **Chosen:** while the guest types and picks, a loop takes page screenshots and records when each was taken.
  ffmpeg then turns them into a GIF where each frame lasts as long as it really did: 960 px wide, one shared
  palette, about 200 KB.
- **Why a GIF:** GitHub shows a GIF inline in a README. A video only plays inline if it's uploaded through an
  issue or PR comment, which can't be scripted. Why not Playwright's own video: see the first story.

### Highlights that point to proof

- **Chosen:** six one-paragraph highlights. Each claims one thing and links to the day doc that shows how it
  works and how it's tested.
- **Why:** a reviewer gives a README about a minute. A claim like "double booking can't happen" only counts if
  the next click shows the race test. The full list of design notes stays at the bottom for anyone who reads on.

### The diagram is Mermaid, in the README

- **Why:** GitHub renders Mermaid itself, so the diagram is text in the repo. It changes in the same commit as the
  code it describes, and there is no image to keep in sync. It groups the app, the data and the services, and the
  slot function sits in the middle, which is the point the text under it makes.

### The live address in the screenshots

- The E2E server runs on `http://localhost:3100`, and the dashboard prints the site's address. Before each host
  screenshot, the script replaces that text with `https://meetreadyv2.vercel.app`, so the images show what a real
  host sees. Only the text on the page changes, not the app.

## 2. Study points

- **Reproducible screenshots** are a small version of "infrastructure as code": the images are an output of the
  repo, not a manual artefact.
- **Fakes pay off again.** The fake Groq built for Day 20's tests is what makes a stable GIF of an AI feature
  possible.
- **A README is a product page.** The order follows the reader's questions: what is it, can I see it, why is it
  interesting, how does it fit together, how do I run it.

## 3. Stories (problems hit and how they were solved)

### The video that was never written

- **What happened:** the first version recorded the flow with Playwright's `recordVideo`. The test passed, but
  there was no video file and no error. Playwright needs its own ffmpeg build for video, the workspace had an
  older one, and copying that one into place didn't help.
- **What I did:** made the script fail when the video is missing, which confirmed the problem. Then replaced the
  video with a loop of page screenshots, each with its time, and built the GIF with the system ffmpeg, using each
  frame's real duration.
- **Lesson:** a passing step with no output is a failure that went unnoticed. Check that the output exists. For a
  small job, a pipeline I control (screenshots, then ffmpeg) is easier to trust than a bundled one I can't see into.

### The first screenshots gave the demo away

- **What happened:** the first set was correct but didn't look real. The consent page said "Signed in as
  host-2418b041@example.com", the MCP address started with `http://`, a New York guest had a meeting at 11 PM their
  time, and a London guest had one at 5:30 AM.
- **What I did:** gave the demo host a plain email, replaced the whole local address (scheme included) with the
  live one, and moved the bookings to times that make sense for each guest's timezone.
- **Lesson:** a reviewer reads every pixel. Demo data should look like real use, and the app's own timezone
  display is what exposed the bad times.

### The test marker would have shown in the GIF

- **What happened:** the fake Groq finds a test's script by a marker the test puts in the guest's message (a random
  `ref-…` word). In a screenshot, that word would sit in the guest's sentence.
- **What I did:** the fake matches the marker anywhere in the request, and the shots run alone. So the guest's whole
  sentence ("Next week, a morning. I'm in London") is the marker, and the box shows exactly what a guest would type.
- **Lesson:** knowing a helper's exact contract (here, "anywhere in the request") lets you reuse it without
  changing it.

### The diagram that came out as a tower

- **What happened:** the first Mermaid diagram drew an edge from the app to each of seven services. The layout put
  them in one tall column with crossing lines.
- **What I did:** rendered it locally with mermaid-cli before shipping, then grouped Postgres and Redis as Data and
  the rest as Services, with one edge to each group.
- **Lesson:** render a diagram before you publish it. Mermaid's layout follows the edges, so fewer, grouped edges
  give a cleaner picture.

## Next

- **You:** commit and push. Add `docs/images/claude.png` (Claude booking through MeetReady, the confirm step if
  possible) and uncomment its line in the README. Then check the README on GitHub: the GIF, the diagram and the
  links.
- **Then, from the backlog (your pick):** list MeetReady in Claude's Connectors Directory, cancel and reschedule over
  MCP, or the Phase 2 items.
