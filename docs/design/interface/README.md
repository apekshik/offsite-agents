# Interface concepts

The agreed look for Offsite's interface, from the design canvas
(https://claude.ai/artifact/3weW6g9TU7jjtpWiVTmcLa). Each `.dc.html` is one screen's markup and styles
(they need the canvas runtime to render, but the HTML and CSS are the reference).

- `PhoneCover.dc.html`: the foldable phone, closed: clock, what waits on you, latest delivery, crew.
- `Main.dc.html`: the phone open on a thread: threads on the left, the conversation with the computer on the right.
- `PhoneCrew.dc.html`: the phone open on the crew tab, watching one crew member.
- `Helm.dc.html`: the helm console on the bridge: threads, the conversation, the ship (waiting on you, aboard, pull requests).
- `DeskWorking`, `DeskAsking`, `DeskLanded`, `DeskOffDuty`, `Laptop`: what crew screens show in the world.

The look: calm dark glass, one cyan accent (#4fe3ff), Saira, JetBrains Mono for code, hairline cards
(8 px radius), sentence-case labels, compact spacing. Colour means state everywhere: cyan working,
amber (#ffc861) needs you, green (#6dffa8) landed, grey (#9aa8b6) off duty, red (#ff5d6c) failed or stop.
