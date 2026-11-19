# The walkthrough video

- `passport-walkthrough.mp4` — the recorded walkthrough of the whole product (H.264, 1280x720, no audio). Title cards
  between chapters explain what is coming; a caption bar at the bottom of every app screen says what is happening and
  why the rule behind it exists.
- `walkthrough-script.md` — the same video as text: every card and caption with its timestamp.

Everything shown is synthetic sandbox data from `scripts/seed.ts`. No money moves, no email is sent.

## Chapters

0. What this is — the three pieces and who uses each.
1. The website — the home page, the paperwork-melt section, the ground rules.
2. A family verifies (phone-sized) — SGO link → emailed code → permission → household → synthetic SNAP letter → submit.
3. The SGO dashboard — home, queue, review, a decided verification (limit, PROVISIONAL, both readings, timeline), the
   evidence pack (PDF pages and signed JSON), an unreadable scan resolved by a reviewer, donations, acknowledgments,
   the IRS report, developers and the API docs.
4. A donor gives — search, tax-math panel, the "not credit-eligible yet" banner, sandbox payment, receipt email.
5. The camp handoff — demo camp checkout, the family's hold page, the partner portal, the SGO's award, "Awarded".
6. The admin console — gates & fees, the income-limit lookup, the audit log.
7. What is real versus sandbox, what only the founder can supply, how to run it.

## Re-recording

The recorder changes demo data as it goes (it confirms letters, resolves a review, makes a gift, offers an award), so
always start from a freshly seeded data directory. Use a separate data directory, build directory and port so a dev
server you already run is untouched.

```bash
# 1. Fresh seeded data (dev server for this directory stopped: the embedded database is single-process)
rm -rf .data-demo
APP_URL=http://localhost:3217 ECCA_DATA_DIR=.data-demo npm run db:seed

# 2. The app on that data
APP_URL=http://localhost:3217 ECCA_DATA_DIR=.data-demo NEXT_DIST_DIR=.next-demo npx next dev -p 3217

# 3. Record (another terminal). Writes docs/demo/passport-walkthrough.mp4 and docs/demo/walkthrough-script.md
npx tsx scripts/record-demo.ts --base-url http://localhost:3217 --data-dir .data-demo
```

Options: `--chapters 0,1,4` records a subset (useful while editing captions; the output is then a partial cut, so
point `--out` at a scratch directory), `--keep` keeps the raw per-chapter recordings, `--ffmpeg <path>` if ffmpeg is
not at `/usr/bin/ffmpeg` or on the PATH, `--out <dir>` for another output directory.

Needs: Node, the Playwright Chromium browser (`npx playwright install chromium`), ffmpeg and ffprobe. Captions,
cards and the order of screens live in `scripts/record-demo.ts` (`chapters()`); reading time is
`MS_PER_CHAR` (55 ms per character, at least 3 s per caption).

Tips:

- Visit the dashboard pages once before recording (or record twice): a dev server compiles each route on its first
  visit, and a slow first compile shows up as a pause in the video.
- If pages keep reloading by themselves (the dev server's Fast Refresh loops), stop the server, delete
  `.next-demo` and start it again; a stale build directory from an earlier run causes it.
- Do not run a second dev server or the end-to-end suite from the same checkout while recording: each server's
  embedded database writes inside the project can make the other's pages reload.
- Check the result: extract one frame every 15 seconds into a contact sheet, e.g.
  `ffmpeg -i docs/demo/passport-walkthrough.mp4 -vf "fps=1/15,scale=480:-1,tile=4x10" sheet.png`.
