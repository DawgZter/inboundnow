# Action Protocol

This package defines the typed action envelope shared by the local agent worker,
tests, and browser-side inboundnow browser layer bridge.

The protocol separates responsibilities:

- The agent decides what to say and which browser actions to request.
- The protocol validates and gates those requests.
- The widget owns the visible cursor, highlight, scroll, click, and Cal UI.

`openCal` is only valid when the booking state is `confirmed`. Before that,
`gateActionForBooking()` rewrites it to `showBookingPrompt` so planner output
cannot accidentally load or open Cal before the visitor confirms.

The browser owns the configured Cal URL. Agent actions must not attach a URL to
`openCal`; this keeps scheduling controlled by the site integration, not by
model output.
