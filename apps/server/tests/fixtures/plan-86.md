<!-- bauherr:plan -->
## Goal

- A Product user opens "New request" in the Bauherr UI, types one sentence, and the factory asks one plain-language question per turn until the draft has problem, context, at least two acceptance criteria and (where the request refers to a screen) at least one screenshot.
- The engine asks for a screenshot explicitly when the request mentions a page, button, error or layout, and does not finish while one is missing for such a request.
- The manager can attach screenshots at any turn; they reach the model as vision input.
- Screenshots are stored with the Ticket (adapter `addAttachment`, else `addLink`) and shown on the Ticket page; the draft Ticket is created at Triage (no stage label) with the interview transcript as context.
- The same engine runs for wayfinder tickets: the owner is asked the open questions before Plan, using the persona "owner".
- An embeddable widget runs the interview in a third-party page with an embed token against the same session API.
- `pnpm typecheck` and `pnpm test` pass; each slice ships its tests and a Playwright smoke run on the compose stack where UI is touched.

## Steps

Too large for one MR: the engine and session API come first; UI, screenshots, owner questions and widget are separate children (see Sub-tickets). Design follows the decided #11 (bare Messages API via the gateway, schema-enforced single question per turn, max 6 questions, readiness computed engine-side) and #21 (mapping, dedupe hook, marker).

1. **Engine (child 1)** — `apps/server/src/lib/intake/engine.ts`: `nextTurn(session, userMessage, images?)` calls `POST ${GATEWAY_URL}/v1/messages` (as `verifyProvider` in `lib/gateway.ts` does, Workspace key, model of tier `cheap`/`standard` from the Workspace) with a `json_schema` output `{question, options?[{label, recommended}], draft{problem, context, acceptance_criteria[], type, severity?, links[]}, needsScreenshot, missing[]}`. Prompt in `pack/skills/intake/SKILL.md` (non-technical language, one question, recommended default only for choices, never hypotheses on the cause, ask for a screenshot when the text mentions page/button/error/layout). Pure `readiness(draft, hasScreen, refersToScreen)` decides "done" (required fields, >=2 criteria, screenshot rule) and the 6-question cap; not self-scored. Prompt-injection guard: user text goes in the user turn only, draft values are escaped when rendered.
2. **Session store + API (child 1)** — new collection `intake_sessions` in `apps/server/src/collections.ts` (+ migration in `src/migrations/`): `product`, `persona` (`product-user|owner`), `status` (`open|submitted|abandoned`), `messages` (JSON, images by media reference), `draft` (JSON), `ticket` (pointer set on submit), `embedToken` ref, `ip`. Routes under `apps/server/src/app/intake/api/`: `POST sessions`, `POST sessions/:id/messages` (SSE stream of the partial structured output), `POST sessions/:id/submit`. Per-IP and per-session caps (messages, image count, bytes); Workspace budget is enforced by the gateway.
3. **Submit to Ticket (child 1)** — `submitIntake(payload, session)` in `src/lib/actions.ts`: title = problem in <=80 chars; body `## Problem / ## Context / ## Acceptance criteria / ## Open` + `<!-- bauherr:intake session=<id> -->`; labels `type:<..>`, `product:<slug>` and no stage label, so Triage (#76) picks it up; interview transcript appended as a Comment. Dedupe hook (#21 step 2) is out of scope here.
4. **UI intake (child 2)** — `apps/server/src/app/(app)/(shell)/requests/new/page.tsx` + `components/IntakeChat.tsx`: Product select (only Products of the selected Workspace), one input, streamed question with option chips, a "Submit request" button once `readiness` is true; "New request" button in the overview header. Role gate: Bauherren and Product users. Design tokens from `docs/design/tokens.json`; both themes; Playwright `e2e/intake.spec.ts` against the fake model (`INTAKE_FAKE=1`, deterministic turns).
5. **Screenshots (child 3)** — upload in the chat (paste, drop, picker; png/jpeg/webp, <=5 MB, <=5 per session, magic-byte check, EXIF stripped, stored in Payload `media` with the session as owner). Engine passes them as `image` content blocks. On submit: `ts.addAttachment?.(id, name, bytes)` where the adapter has it, else upload to the media URL and `ts.addLink` (capability `attachments` in `packages/adapters/src/contracts.ts`). Ticket page shows an "Attachments" strip (thumbnails, full size on click) in `(shell)/tickets/[id]`. Tests: type/size rejection, adapter fallback (fake adapter with and without `addAttachment`), engine request contains image blocks.
6. **Wayfinder owner questions (child 4)** — persona `owner`: `startOwnerIntake(ticket)` seeds the session from a wayfinder Ticket's open questions (the `## Open` block / decision sheet), the same engine asks them one per turn, answers are written back through the existing `answerDecisions` (`lib/actions.ts`) so worklog and Comment stay one surface; entry point is the Ticket page "Answer interactively" next to the decision sheet (supersedes nothing: the sheet form stays). Tests: answers land as Decisions; critical-first order.
7. **Widget (child 5, later)** — `apps/server/src/app/intake/embed.ts` built to `/intake/widget.js` (TypeScript, a Shadow-DOM chat that talks to the same `/intake/api`). Embed token: new collection `embed_tokens` (hash only stored, product, allowed origins, rate cap, revocable in Settings > Products). Server checks token + `Origin`, CORS limited to allowed origins, token only grants "start/continue own session" for its Product. Email at submit for magic-link resume is a follow-up (#21 step 3).
8. **Docs** — `docs/spec/workflow.md` (Triage entry from intake, intake section, persona owner), `CONTEXT.md` Intake session wording, widget embed snippet in README of the Product settings.

## Sub-tickets

- **Intake engine and session API** — Messages-API engine with schema-enforced single question, readiness rule, `intake_sessions` collection, SSE routes, submit-to-Ticket mapping, caps. Acceptance: a scripted vague request ends with a complete draft within 6 questions; the Ticket lands without a stage label (Triage); unit tests for `readiness` and mapping.
- **Intake UI: New request chat** — Product select, streamed chat, option chips, submit; Playwright smoke with the fake model. Acceptance: a Product user types one sentence and ends with a created Ticket at Triage.
- **Intake screenshots** — upload, vision input, explicit screenshot ask, store as attachment or link, Ticket page strip. Acceptance: a request mentioning a button is not submittable without a screenshot; screenshot is visible on the Ticket page.
- **Owner questions via the intake engine for wayfinder tickets** — persona `owner`, "Answer interactively" on the Ticket page, answers land as Decisions. Acceptance: the owner answers a wayfinder Ticket's open questions in chat before Plan.
- **Embeddable widget and embed token** — `/intake/widget.js`, `embed_tokens` with origin allowlist and revocation. Acceptance: a static test page with the snippet runs the same interview and creates a Ticket; a wrong origin or revoked token gets 403.

## Decisions

- **D1 Access for product users (critical: true)** — Options: (a) require a Bauherr/Product-user login for the in-UI intake and an embed token for the widget; (b) anonymous start on a public page `/intake/<product>`. Recommended default: (a). Why: every session spends Workspace budget on LLM calls; anonymous public access is an open spend and abuse surface. #11 decided anonymous-at-start for the hosted page, so (b) is a later, separate Ticket.
- **D2 Embed token model (critical: true)** — Options: (a) per-Product hashed token + origin allowlist + rate caps, revocable; (b) signed short-lived JWT minted by the host page's backend. Recommended default: (a). Why: public API and security surface; (a) needs no integration code on the host's server; (b) can be added later as a second token type.
- **D3 Screenshot data (critical: true)** — Options: (a) store images in Payload `media` and forward to the model and the forge; strip EXIF, no redaction; (b) additionally blur/redaction step. Recommended default: (a) with a visible notice "screenshots are sent to the model and stored on the Ticket". Why: screenshots may show personal data; (b) is costly and not in the acceptance criteria.
- **D4 Slicing** — Options: five children as listed; a single MR. Recommended default: five children. Why: one MR would cover schema, streaming, UI, uploads, security and a bundled script; children inherit the approval at plan approval time.
- **D5 Model tier** — Options: cheap, standard. Recommended default: standard for the interview, cheap for the readiness check. Why: #11 prototype used the `sonnet` alias with 1-4 questions at $0.02-0.07 per interview.
- **D6 Where the draft lands** — Options: no stage label (Triage picks it up, #76); `bauherr:stage:plan` directly. Recommended default: no stage label. Why: matches the acceptance criterion "lands in Triage"; operator persona may later skip it (#21 step 5).
- **D7 Language** — Options: language of the user's first message; Product setting. Recommended default: language of the first message. Why: no new config; the draft body follows the same language.
- **D8 Wayfinder owner flow** — Options: chat only for the owner and keep the form; replace the form. Recommended default: keep the decision sheet form and add the chat as an alternative. Why: the form is the shipped surface (#79), no regression.

## Files

- apps/server/src/app/(app)/lib/plan.ts
- `apps/server/src/lib/intake/**`
- docs/spec/workflow.md

## Out of scope

Magic-link resume and reporter replies (#21 step 3), the dedupe hook, anonymous public intake pages, screenshot redaction, voice input.
