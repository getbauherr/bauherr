# Request widget and stakeholder access

Planned on 2026-11-24, not built. The old widget is described in [product-owner-intake](product-owner-intake.md); its code is at the git tag `legacy-final`. This page plans what comes after product-owner sign-in and requests work.

## Why later

- The widget, stakeholder accounts and product-owner requests all need the Product-owner module first. Without it there is no place for a request to land.
- The widget is the only part open to the public internet. It should be built last, after the closed paths are proven.
- Nothing here changes the core. The module creates records through Intake and reads only the mirror.

## What it needs

### Anonymous visitors

- Who: people using a Product's own site who are not signed in. They report a problem or ask for something. They never see the factory.
- They get one conversation, as the request chat works for a product owner. It ends in the same request card: type, urgency, what is wrong or wanted, how they will know it works.
- Visitors give no account and no email by default. A visitor may leave an email to hear back. Without one, the visitor sees progress only in the same browser, through a private link.
- A visitor sees their own request only. They never see other visitors' requests.
- Screenshots are allowed, with the same size and type limits as other requests.

### Admission of requests

A visitor's request is not a Ticket yet. It waits in a holding area until a person lets it in.

- Default: every visitor request goes to the Bauherr as a decision card: let in, decline with a reason, or merge into a similar request.
- The intake check still runs first. An incomplete request goes back to the visitor with questions before it reaches the Bauherr.
- A Product may choose automatic admission once the Bauherr trusts it. Automatic admission applies only to complete requests of type bug or question. It never applies to urgent requests.
- Spam and abuse never reach a person. Messages that are empty, repeated, or clearly not about the Product are dropped, and a count is shown to the Bauherr.
- A declined visitor request shows the reason in one sentence, in the visitor's language.

### Allowed sites

- One widget token per Product. The token is shown once, stored as a hash, and can be revoked.
- Each token lists the sites that may use it. A request from any other site answers 403.
- The list is edited by the Bauherr, never by a visitor or product owner.
- The token is not a secret, because it sits in the page. The site list and the rate limits are the real protection.
- A revoked token stops new conversations at once. Open conversations end with a plain message.

### Rate limits

- Per token: at most 20 new conversations per hour, as before. The Bauherr can lower or raise it per Product.
- Per visitor, by browser and network address: at most 3 new conversations per hour and 40 messages per conversation.
- A daily cap per Product on model spend for visitor chats. When it is reached, the widget shows a plain "try again tomorrow" and offers a plain form with no model.
- Limits answer with a plain message to the visitor, never an error code.

### Stakeholder accounts

- Who: outside people who care about a Product but do not own it. Examples are a customer's contact, a partner team, or a reviewer from another company. They are not product owners and cannot send work into the factory on their own.
- What they see: the Product's requests that were shared with them, each with the five plain-word states from the request research (received, waiting for you, in progress, ready to try, closed). They see release notes for the Product.
- What they can do: read, comment on a shared request, and say "this matters to me too". A comment or a "me too" goes to the owner of the request, not to the factory.
- What they never see: Runs, cost, models, plans, other Products, other stakeholders' comments unless shared, or any setting.
- How they are invited: a product owner or the Bauherr picks a Product and one or more requests, and enters the person's email. The person gets a link and signs in with the same sign-in as everyone else. An invite names the Product and expires after 14 days.
- Access is per Product and can be removed at any time. Removal takes effect at once.
- Closed by default: anything not shared answers 404, as for product owners.

## Open questions

- Should a visitor without an email see progress at all, or only an immediate "received"?
- Is automatic admission ever acceptable for a Product, or should every visitor request pass a person?
- Which sites count as one site: only the exact address, or its subdomains too?
- What daily model spend cap per Product is acceptable?
- May a stakeholder start a request, or only comment? This plan says comment only.
- Do stakeholders get email when a shared request changes state? This plan says yes for waiting, ready to try and closed, as for requesters.
- Is "me too" counted and shown to the Bauherr as demand?
- Are visitor requests kept after a decline, and for how long? Privacy rules decide.

## Out of scope here

Keycloak role or client changes, and product-owner sign-in and requests. Those are tracked in #841 to #847.
