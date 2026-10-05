# What the interface would like from the backend

The interface works with today's API. These would make it better; none is blocking.

| Want | Shape | Why |
|---|---|---|
| `crew.message` | `{ crewId, text }` → writes `inbox` (`runId`: their live run, else `null` so the next run picks it up) | The phone's Message goes straight to a crew member, working or not. Today it goes through the thread they work on (`threads.send` with `@handle`), which wakes Computah, and is unavailable while they're off duty. |
| `users.describeLook` | `{ prompt }` → a `look` run for the captain | "Describe it" in the customizer works for crew only (`crew.describeLook` takes a crewId). |
| Usage per subscription | latest `usage.updated` windows per machine and harness, e.g. on `machines.mine` | The helm's top bar in the concept shows "Claude Max · 41% of 5h". The runner already emits `usage.updated`; nothing exposes it outside a run's events. |
| Pull request checks | `threads.list`: `pr: { number, checks: "pending" \| "pass" \| "fail" } \| null` | The helm's pull request list says "Checks pass". Today the number is parsed from `prUrl` and every PR shows as open. |
| Setup skipped | `users.setPrefs({ skippedSetup: true })` or similar | Skipping the machine steps is remembered per browser (localStorage); another browser asks again. |
