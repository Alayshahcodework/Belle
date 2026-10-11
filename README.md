# Belle

A patient taps their NFC card on the bedside tablet, says what they need, and
the request goes to the department that can actually do it — not to a nurse's
pager.   

Rutgers Health Hack 2026 · Ops Unleashed Challenge 2 (Inpatient AI).   

## Run it

```bash
npm install
npm run dev                  # Vite on :5173 + API on :8787
```

or serve the built app and API from one port:

```bash
npm run build && npm start   # http://localhost:8787
```

| Screen | URL |
|---|---|
| Launcher / NFC simulator | `/` |
| Bedside (one patient) | `/#/t/<card id>` |
| Staff sign in | `/#/staff` |

```bash
npm test     # 76 tests across 7 files
```

| Suite | Covers |
|---|---|
| `classifier.test.js` | keyword routing, red flags, Spanish |
| `triage.test.js` | engine order, caching, fallback, safety cross-check |
| `guardrails.test.js` | NPO / dysphagia / fall-risk overrides, CSV parsing |
| `eta.test.js` | the wait-time model |
| `voiceflow.test.js` | prompt → listen → retry → confirm, and giving up |
| `speech.test.js` | browser speech wrappers, including the blocked case |
| `admin.test.js` | built-in logins, hashing, the charge-only gate, adding patients, persistence |

> **The microphone needs a secure origin.** Browsers refuse it on plain
> `http://` to anything except `localhost`. The bedside screen says so on load
> when that is the problem. See [Known gaps](#known-gaps).

## Deploying

Belle is a website **and** a Node server (`server/index.js`) that handles
sign-in, patients, requests, live updates and Gemini. It needs a host that runs
Node.

**Static hosts do not work.** Vercel, Netlify and GitHub Pages publish the built
pages but never start the server, so the site loads and then every `/api` call,
sign-in included, returns 404.

**Render** (free tier) runs it as-is, using [render.yaml](render.yaml):

1. [dashboard.render.com](https://dashboard.render.com) → sign in with GitHub.
2. **New → Blueprint** → choose this repo → **Apply**.
3. Paste your `GEMINI_API_KEY` when asked.
4. Wait for the deploy to go live, then sign in at `https://<your-service>.onrender.com/#/staff`.

Or set it up by hand as a **Web Service**: build `npm ci --include=dev && npm run build`,
start `npm start`, environment variable `GEMINI_API_KEY`.

On Render's free plan the service sleeps after about 15 minutes idle (the first
visit after that takes up to a minute), and its disk is wiped on every restart,
so patients and staff added from the admin page do not last. The 120 patients
in the CSV and the 13 built-in accounts always do.

## Two separate interfaces

### 1. The bedside tablet — NFC, voice first

There is no login and nothing to choose. The card *is* the session.

- Each row of `elderly_inpatients_synthetic*.csv` carries a `card_id`, so cards
  map one-to-one with patients: 120 patients, 120 cards, 7 units, 8 nurses.
- The tag holds a URL, `http://<host>/#/t/CARD-6D7E7F`. Tapping it opens the
  bedside screen already personalised — *"Hello Margaret"*, room 302A, their
  diagnosis.
- **It talks first.** On open it says *"Record your request"* out loud and
  starts listening. The screen can stay off and the flow still works, which is
  the point: a patient who cannot see has no "start recording" button to find.
- **A typing box with a Send button** sits under the microphone. It classifies
  as you type and shows where the request is heading before you send it. It is
  also the fallback whenever the mic is unavailable.
- **Six quick buttons** underneath: water or ice, something to eat, blanket or
  pillow, help to bathroom, TV/phone/lights, room cleaning. Every press is
  confirmed out loud.
- **Language comes from the chart.** 26 of the 120 patients are Spanish
  speakers; they are prompted, retried and confirmed entirely in Spanish with
  `es-ES` recognition, without touching anything.

#### The voice loop

```
  say "Record your request"   ← spoken aloud
          ↓
      listen
          ↓
  heard nothing, or could not be understood?
          ↓ yes                                   ↓ no
  discard that answer                       send the request
  say "Sorry, I did not understand.               ↓
       Record your request again."          say "Your request is sent to
          ↓                                      Housekeeping. Someone is
      listen again                               on the way."
          ↓
  still no good after 2 tries?
          ↓
  heard words but could not parse them → hand the transcript to the nurse
                                         and say so
  heard nothing at all                 → stop, and say how to get a nurse
```

Two attempts, then it stops rather than looping at the patient. Each discarded
answer is thrown away — only the newest one is ever used.

One deliberate deviation from "just give up": if Belle *heard words* but could
not classify them, the transcript goes to the nurse as *Needs Human Triage*
rather than being dropped. Silently discarding a request from a patient who
cannot see the screen is the worst available outcome. If it heard nothing at
all, nothing is sent — background noise should not create tickets.

There is no panic button on the bedside screen. Urgency is detected from what
the patient says or types: *"my chest hurts"* escalates to the nurse as
critical whichever way it arrives.

#### Writing the cards

```bash
node scripts/nfc-cards.mjs --host http://192.168.82.117:8787
node scripts/nfc-cards.mjs --host http://192.168.82.117:8787 --out cards.csv
```

Write each URL to its tag as an **NDEF URI record** with any tag writer (NFC
Tools on Android/iOS, or an ACR122U over USB).

### 2. The staff board — login, role-aware

Sign in at `/#/staff`. Password for every built-in account is `belle`. On a
deployed host, set `STAFF_PASSWORD` to replace it without editing the repo.

The built-in accounts are written out in [server/auth.js](server/auth.js) rather
than derived from the patient CSV, so sign-in still works if the roster fails to
load.

| Username | Who | Role |
|---|---|---|
| `a.rivera`, `p.sharma`, `m.fitzgerald`, `l.brooks`, `k.thomas`, `s.mathew`, `d.oyelaran`, `j.kim` | the eight nurses in the roster | Nurse |
| `charge` | charge nurse | Charge |
| `pct` | T. Nguyen | Patient Care Tech |
| `hk` | M. Diallo | Housekeeping |
| `food` | R. Castillo | Food Services |
| `clerk` | J. Whitfield | Unit Clerk |

The board splits by role:

- **Left, highlighted** — your own queue. For a nurse that splits again into
  *My patients* (matched on `assigned_nurse`) and other nursing requests. A
  care tech sees their toileting and mobility queue; housekeeping sees theirs.
- **Right** — every other team's queue, visible but not yours.

**Adding patients and staff.** The `charge` account sees an **Add patient /
staff** link in the board header (`/#/admin`). It creates:

- **a patient**, with a freshly issued `CARD-XXXXXX` and the exact URL to write
  onto their NFC tag. Chart rules (NPO, fall risk, language) apply immediately.
- **a staff account**, with a role and password. Passwords added this way are
  stored as salted scrypt hashes, never in plain text.

Everything added here is saved to `data/` (gitignored). On a host with an
ephemeral disk it is lost on redeploy, and the page says so when a write fails.
Set `DATA_DIR` to a persistent volume if you need it to last.

Clicking a room opens the patient's chart: diagnosis, treatment plan, diet
order, allergies, fall risk, mobility, language, sensory aids, assigned nurse.
Tapping **why?** shows which engine routed the ticket and on what evidence.

## How a request flows

```
NFC tap  →  bedside screen personalised from the card
                      ↓
     patient speaks, types, or taps a button
                      ↓
     red flag?  ──yes──→  Primary Nurse, URGENT, interrupts the queue
                      ↓ no
     Gemini classifies it (keyword engine if unavailable)
                      ↓
     chart guardrail?  ──yes──→  Primary Nurse, with the reason attached
                      ↓ no               and explained to the patient
     confident?  ──no──→  Primary Nurse (needs human triage)
                      ↓ yes
   Housekeeping · Food Services · Care Techs · Unit Clerk
                      ↓
          live on that team's column
                      ↓
   Accept → Complete · patient sees "On the way" → "Done"
```

## Classification

Two engines, in a deliberate order.

```
patient request
      |
 1. clinical red flags   local, instant, offline. NEVER calls the network.
      |  no flag
 2. cache                identical wording answered free
      |  miss
 3. Gemini               gemini-3.5-flash-lite, ~700ms
      |  unavailable / rate-limited / bad response
 4. keyword engine       the original rules, as a fallback
      |
 5. safety cross-check   if the keyword engine saw a clinical signal and
                         Gemini did not, the clinical reading wins
```

**Why Gemini.** The keyword list could only recognise words someone had thought
to write down. *"I want a sandwich"* matched nothing and fell through to a
nurse: exactly the interruption this product exists to remove. The model
understands the request instead of pattern-matching it, and handles the long
tail — *"something from the vending machine"*, *"my dentures fell under the
bed"*, *"it is too bright in here"*. It also read *"my feet are swollen"* as
clinical, which the keyword engine missed entirely.

**Why not only Gemini.** Three things are never delegated:

1. **Red flags are matched locally and never leave the machine.** A patient
   saying "chest pain" must not depend on an API call succeeding, on a quota,
   or on conference wifi. This also makes emergencies the fastest path through
   the system rather than the slowest.
2. **Chart guardrails stay local.** The NPO, dysphagia and fall-risk overrides
   depend on the patient record, which is deliberately never sent to Google.
3. **The model cannot downgrade a safety signal.** If the keyword engine reads
   something as clinical and Gemini calls it hospitality, the clinical reading
   wins and the ticket is stamped `safety-override`.

Every ticket records which engine decided it and why. Tap **why?** on the staff
board: `engine: gemini · confidence 95% · Patient requested food.`

**Privacy.** Only the words of the request go to Google. No name, room,
diagnosis, card id or any other patient field.

### Rate limit, read this before the demo

The free tier allows **15 requests per minute** on `gemini-3.5-flash-lite`.
Three things hold usage under it: red flags never call out, the six quick
buttons never call out (a tapped button is explicit intent, not something to
re-guess), and identical wording is cached. Only novel typed or spoken requests
cost a call. If the limit is hit anyway the keyword engine answers and the app
keeps working: degraded, not broken.

### Configuration

`GEMINI_API_KEY` is read from `.env` in the project root, which is gitignored.
The key stays server-side and is never bundled into the client.

```
GEMINI_API_KEY=your-key-here
GEMINI_MODEL=gemini-3.5-flash-lite   # optional
GEMINI_TIMEOUT_MS=6000               # optional
```

With no key present the app runs on the keyword engine alone and says so at
startup.

## Safety

Criterion #1 is isolating urgent clinical requests. Three layers:

1. **Red flags short-circuit.** *"I'd love some apple juice but my chest
   hurts"* goes to the nurse. Nothing else runs, so no amount of hospitality
   vocabulary can outvote a clinical phrase.
2. **The chart can override the words.** 18 of the 120 patients have a diet
   order that makes a food request unsafe to fill directly — 12 NPO (nothing
   by mouth), 3 dysphagia, 3 fluid-restricted. When one of them asks for ice
   water the sentence is a textbook Food Services request, and honouring it
   could harm them. Belle reroutes it to the nurse with the clinical reason
   attached, and tells the patient in plain language why: *"Your nurse needs
   to check this first, because you are not cleared to eat or drink right
   now."* *This is the part a language model cannot do: the answer is not in
   the sentence, it is in the chart.*
3. **Low confidence is not a guess.** Anything unclear is labelled *Needs
   Human Triage* and goes to a clinician.

Toileting requests from high-fall-risk patients carry a "do not leave
unattended" flag; two-person assists say so; allergies ride along on every
ticket.

The launcher tints restricted-diet cards yellow and shows each patient's diet
order, so a food request diverting to a nurse reads as the safety feature it is
rather than a bug.

## Wait times

Every ticket carries a computed wait estimate, but **the predicted minutes are
not shown to anyone**. The staff board shows the queue state behind it instead
— *"6 ahead · 2 on evening shift"* — and the patient is told someone is on the
way, not a number.

The model is live in [shared/eta.js](shared/eta.js) and recomputed on every
read, so re-surfacing it is a display change rather than a rebuild. It is
driven by measured mean handling times supplied by the team:

| Request | Minutes |
|---|---|
| Water/ice, food, blanket/pillow | 5.48 |
| Medication | 5.75 |
| Bathroom | 9.22 (9:13) |
| Room cleaning | 6.0 |
| TV, phones, lights | 4.0 |

```
wait    = work already queued ahead of you ÷ staff on shift × shift drag
service = base time × patient acuity × shift drag × meal surge
ETA     = wait + service
```

What moves the number: queue depth (minutes of work ahead, not a count), staff
on shift per role, a night-shift drag factor, patient acuity from the chart's
`mobility` and `fall_risk`, a meal-service surge for Food Services, and
priority — urgent clinical never queues.

Tune the roster in [shared/eta.js](shared/eta.js) and the service times in
[shared/config.js](shared/config.js).

## PHI boundary

- The bedside tablet is served only its *own* patient's data. The live feed is
  filtered server-side by card, and tickets are stripped of names and rooms
  before they leave.
- The full chart requires a staff session. So does the board, the live floor
  feed and every status change.
- The patient is told *that* a request was diverted and roughly why, never the
  clinical note; staff get the full wording.
- Verified by test: an anonymous `/api/stream` is refused, a bedside feed
  carries no names, and the bedside profile omits allergies, fall risk and
  assigned nurse.

## Look and feel

Palette, applied as tokens at the top of [src/styles.css](src/styles.css):

| Colour | Role |
|---|---|
| `#F3F7FF` | page background |
| `#92C7FF` | light accents, chip fills, the listening state |
| `#8AB0D6` | borders and secondary structure |
| `#4C6FA8` | primary actions, headings, the owned-queue highlight |
| `#FFEEA6` | attention, in-progress, warnings |

Darker inks are derived from `#4C6FA8`, because all five supplied colours are
too light to carry small text. Clinical urgency is the one deliberate exception
to the scheme: critical tickets and the escalation banner stay a saturated red,
since a soft tint cannot carry an emergency across a ward corridor.

Type is **Libre Baskerville**, self-hosted via `@fontsource` — no Google Fonts
request, so the typography survives dead conference wifi.

Every foreground/background pair was measured against WCAG AA; the lowest ratio
is 5.03. That matters more than usual here: the patients are 65–99 years old.

## Layout

```
elderly_inpatients_synthetic*.csv  120 synthetic patients, one card_id each
                                   (loader takes the newest matching file)
shared/config.js       routing matrix, roles, service times, department accents
shared/classifier.js   keyword engine: red flags and the offline fallback
shared/eta.js          the wait-time model
shared/csv.js          RFC-4180 parser (the diet column has quoted commas)
server/gemini.js       Gemini classification (structured JSON output)
server/triage.js       engine orchestration + safety cross-check
server/guardrails.js   chart-aware overrides (NPO, dysphagia, fall risk)
server/patients.js     roster, card lookup, PHI-safe projections
server/auth.js         staff accounts and sessions — DEMO GRADE
server/dataDir.js      where admin-added staff and patients are saved
server/store.js        tickets + pub/sub
server/index.js        REST + SSE, with the PHI boundary
src/App.jsx            hash routing + the launcher / NFC simulator
src/PatientView.jsx    NFC bedside screen
src/voiceFlow.js       the prompt / retry / confirm loop, testable headless
src/speech.js          promise-wrapped browser speech, in and out
src/phrases.js         every spoken and on-screen line, English + Spanish
src/StaffLogin.jsx     staff sign in
src/StaffView.jsx      role-split board + patient chart drawer
src/AdminView.jsx      add patients and staff (charge nurse only)
src/styles.css         design tokens and every component style
scripts/nfc-cards.mjs  generates the URL for each physical tag
```

## Demo script (2 minutes)

1. Staff board on a laptop, signed in as `hk`. Empty. *"This is housekeeping
   right now."*
2. Tap a card on the tablet, or open the launcher and pick any card **not**
   tinted yellow. It greets the patient by name and the mic is already
   listening.
3. Say *"could I get an extra pillow."* It lands in Housekeeping's column.
   **No nurse was paged.**
4. Say *"I want a sandwich."* Food Services. Tap **why?** on the board:
   `engine: gemini`. *"No keyword list has the word sandwich in it."*
5. Sign in as `a.rivera` on a second screen. *My patients* is highlighted on
   the left; housekeeping's queue sits on the right, visible but not hers.
6. Now pick a **yellow** card — one of the NPO patients — and ask for ice
   water. It does **not** go to Food Services. The patient hears *"Your nurse
   needs to check this first."* The nurse's board shows *"Patient is NPO —
   food and fluids must be cleared by the nurse."*
7. Click the room. The full chart opens: diagnosis, diet order, allergies,
   fall risk.
8. Say *"my incision is throbbing and I feel dizzy."* Urgent, top of the board,
   routed to the primary nurse, decided locally without an API call.

**Reset demo** clears the board between runs.

## Known gaps

- **The microphone needs a secure origin.** Browsers block it on plain
  `http://` to anything but `localhost`, so the LAN address serves the screens
  but not the mic. The bedside page detects this and says so on load;
  diagnostics also print to the console as `[Belle] microphone diagnostics`.
  Fix for a real demo: serve over HTTPS, or launch Chrome with
  `--unsafely-treat-insecure-origin-as-secure=http://<host>:8787`.
- **Both the mic and speech synthesis are gated behind a user gesture.** An NFC
  tap is not one. Belle asks for microphone permission up front and falls back
  to "the next touch anywhere starts it", so in practice the patient may need
  one touch — which partly undercuts the eyes-free goal. A kiosk browser with
  permissions pre-granted removes it, and that is how this would be deployed.
  **Test on the real tablet before relying on it.**
- Speech support varies: Chrome and Edge are safe, Firefox has no speech
  recognition at all.
- **Authentication is demo grade.** Passwords are plain text in
  [server/auth.js](server/auth.js) and sessions live in memory. It stands in
  for an SSO integration; it is not a security control.
- **`/api/demo/cards` must be deleted before anything real.** It exists so the
  launcher can simulate a tap without physical cards.
- The Gemini key is free tier: 15 requests/minute. Fine for a demo with
  caching, not for a floor of 30 patients. A key beginning `AQ.` is an
  OAuth-style token and may expire; if classification silently drops to the
  keyword engine, check the credential first.
- Gemini adds roughly 700ms to a novel request. Buttons and emergencies are
  unaffected because neither calls out.
- Tickets are in memory and clear on restart. No patient data is persisted.
- Service times are averages over a small sample, and the staffing roster in
  [shared/eta.js](shared/eta.js) is invented. Both deserve real floor numbers.
- No integration with a real nurse call system (Rauland, Hill-Rom). Escalation
  is a UI alert, not a pager.



