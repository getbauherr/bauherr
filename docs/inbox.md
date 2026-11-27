# Deciding in the Inbox

The Inbox at `/inbox` is where you decide what waits for you. It is a list on the left and one conversation per ticket on the right.

## The list

The list groups tickets by who has to act: Waiting on you, Failed, Working, Waiting on others and Decided. Decided shows the last 7 days, and only the latest five until you press Show more.

The first waiting ticket is open. The selection is `?t=<id>` in the address. `j` and `k` move, `/` writes to the factory. The badge on the sidebar counts what waits on you.

## One decision

The conversation shows the ticket's thread, what you decided before and the pending decision as a card. The card has the question, one reason, one Recommended action and the other options. Every `#ref` links to its ticket.

- **One primary action**: the Recommended one. The others are quieter.
- **Undo, not confirmation**: pressing an action shows a receipt and a toast with Undo for six seconds. The decision is written when the toast runs out or when you leave the ticket. Undo writes nothing.
- **Next**: the next waiting ticket opens after the decision.

## Ending a criteria loop

A ticket can bounce between Build and Verify on a criterion that cannot be met. These actions end the loop without a new Brief.

- **Drop criteria**: pick the criteria to forget and add a note. Dropped criteria show on the Result card as "Dropped by you". You cannot drop all of them.
- **Accept anyway**: accept the Result with the unmet criteria. The card shows them as "Not met, accepted by you".
- **Retry Brief**: when a Brief rewrite fails, the card says why. Retry the rewrite or discard the ticket.

Dropping after the verify rounds are used up sends the ticket back to Verify once, on the same code. If every remaining criterion is already met, it goes straight to the Result card.

## Steering by typing

The composer is always there. Type what you want, for example "Drop c3 and c4, no new Brief".

1. The factory reads the ticket and proposes one action, shown as the same receipt with Undo.
2. Nothing happens until the six seconds pass or you leave the ticket. The factory only proposes what the buttons already offer.
3. A question gets a plain answer and no action.
4. An action that does not fit, such as dropping every criterion, is refused in the thread.

When the model is not available, your words come back as a proposal card: "post this as a comment?". You press the button to post it.
