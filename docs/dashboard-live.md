# Dashboard live connections

The cloud dashboard keeps its WebSocket or bounded SSE connection while the
document is visible. After the document stays hidden for 60 seconds, it closes
the connection and cancels lease-renewal, reconnect, and replay timers. The
status becomes `paused`, with the neutral status dot, rather than an offline
error. A tab that starts hidden uses the same grace period.

Returning before the deadline cancels the pause timer and preserves the
connection, subject to the transport's existing lifetime limits. Returning
after a pause starts one reconnect and one authoritative REST synchronization
from the last cursor. Changes received while the tab was paused are replayed
through that cursor; the client does not depend on WebSocket delivery alone.
Stale work queued before the pause cannot open a second connection afterward.

SSE still has its existing five-second lifetime and two-minute cooldown.
Visibility return synchronizes REST immediately but does not bypass that
cooldown to open another stream. Normal visible-tab recovery then continues
within the existing budget.

This reduces client-driven background requests. It does not remove server-side
notifications: account activity or skill changes still notify and may wake
`AccountHub`, even with every dashboard tab hidden or paused. Those Worker-to-DO
notifications, other clients, and their costs are outside this change.

The local HTTP dashboard's session event stream is unchanged. The visibility
pause applies to the cloud account event controller.
