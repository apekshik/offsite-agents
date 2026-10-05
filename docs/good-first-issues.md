# Good first issues

Small, real tasks found in the code, each a pull request on its own. All of them can be done and checked in demo mode
(`pnpm i && pnpm dev:demo`, then the state or gallery cell named) with no backend. Claim one by opening an issue (or
commenting on its issue, if there is one) so two people don't build the same thing. Line numbers are as of writing;
search for the quoted text if they've moved.

### 1. Name the machine in the diff viewer's offline notes

[apps/web/src/review/Review.tsx](../apps/web/src/review/Review.tsx) says "Your Mac is offline" (around lines 132 and
161) whatever the machine is called, or whether it's a Mac. The repo's machine is right there (`part.machine.name`):
say "Studio is offline; the diff lives there." **See it:** gallery cell `error-offline`, then open a diff, or add a cell
for it.

### 2. Ask before disconnecting a machine

The Ship tab's **Disconnect** on a machine ([apps/web/src/screens/setup.tsx](../apps/web/src/screens/setup.tsx),
`MachineCard`, around line 68) revokes it at once, while removing a repo asks first. Use `ConfirmButton` from
`ui/index.tsx` ("Disconnect it?"), like `RepoItem` does. **See it:** `/?state=phone-ship`.

### 3. Let the keyboard open a crew row with Space

Crew rows in the phone's crew tab ([apps/web/src/phone/Crew.tsx](../apps/web/src/phone/Crew.tsx), `CrewRowCard`, around
line 50) are a `div` with `role="button"` that only answers Enter. Buttons answer Space too (and Space shouldn't
scroll the list). Bonus: mark the selected row (`aria-current` or `aria-pressed`). **See it:** `/?state=phone-crew`,
Tab to a row.

### 4. Make the phone's tabs real tabs for screen readers

The phone's Threads / Crew / Ship tabs ([apps/web/src/phone/Phone.tsx](../apps/web/src/phone/Phone.tsx), around
lines 116 to 118) are plain buttons. Give them `role="tablist"`, `role="tab"` and `aria-selected`, the way the diff
viewer's repo tabs already do (`Review.tsx`, around line 227). Arrow keys moving between tabs is a welcome extra.
**See it:** `/?state=phone-open`.

### 5. The same for the look customizer's tabs

[apps/web/src/creator/Creator.tsx](../apps/web/src/creator/Creator.tsx) (around line 106) has the same plain-button
tabs (ready-made, parts, colours, shape, describe). Same fix as 4; share a small `Tabs` component in `ui/index.tsx` if it helps both. **See
it:** `/?state=creator` or gallery cell `creator`.

### 6. Respect reduced motion for `.fade-up`

[apps/web/src/ui/ui.css](../apps/web/src/ui/ui.css) turns off the caret and pulse animations under
`prefers-reduced-motion: reduce` (around line 197), but not `.fade-up`, which toasts, messages and the way aboard use.
Add it (a plain fade, or nothing). **See it:** gallery cell `toasts` with reduced motion on (DevTools, Rendering,
"Emulate CSS prefers-reduced-motion").

### 7. Keep toasts up while the pointer is on them

Delivery and new-hire toasts ([apps/web/src/hud/Toasts.tsx](../apps/web/src/hud/Toasts.tsx)) vanish on a timer
(`until`), even while you're reading or reaching for "Open the pull request". Pause a toast's timer while it's hovered
or focused, and restart it on leave. **See it:** gallery cell `toasts`, or `/?state=hire`.

### 8. Say how to copy when the clipboard isn't available

`CopyCommand` ([apps/web/src/screens/setup.tsx](../apps/web/src/screens/setup.tsx), around lines 84 to 90) selects the
command when `navigator.clipboard` fails (an insecure page, an old browser) but tells you nothing. Show "Selected:
press ⌘C" (Ctrl+C off a Mac) in the button for a moment instead. **See it:** `/?state=onboarding-machine`; to make the
clipboard fail, open the demo from your machine's network address rather than `localhost`.

### 9. A gallery cell for the pairing page

`/pair?code=…` ([apps/web/src/screens/Pair.tsx](../apps/web/src/screens/Pair.tsx)), where a captain approves a new
machine, is in neither the demo's states nor the gallery. Add cells to
[apps/web/src/gallery/cells.tsx](../apps/web/src/gallery/cells.tsx) for its states (a code found, a code not found,
approved); demo mode already answers `machines.lookup` and `machines.approve`. Add the new cell names to `CELLS` in
[scripts/screenshots.mjs](../scripts/screenshots.mjs) so CI pictures them.

### 10. A readable phone on a phone

At phone widths the unfolded phone is the whole 1036-pixel book shrunk to fit, so its text is a few pixels tall
(`phoneScale` in [apps/web/src/phone/Phone.tsx](../apps/web/src/phone/Phone.tsx); see the `*-phone.png` screenshots CI
takes, like `gallery-phone-crew-watch-phone`). Below about 720 pixels, show one pane at a time (the list, or the
conversation with a back button) at full size instead. A bigger task than the rest; open an issue first to agree on
the shape. **See it:** gallery cells at "Phone 390", or DevTools' device toolbar on `/?state=phone-open`.
