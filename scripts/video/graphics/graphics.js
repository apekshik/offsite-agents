// The launch video's graphics, drawn as a pure function of time: build.mjs calls setup(cut) once,
// then frame(t) for every frame (t in timeline seconds) and screenshots the page. No CSS animation
// or timers, so every render of a frame is the same.
"use strict";

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lin = (t, a, b) => clamp((t - a) / (b - a));
const outCubic = (u) => 1 - Math.pow(1 - u, 3);
const outQuint = (u) => 1 - Math.pow(1 - u, 5);
const inOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const el = (cls, html = "") => { const d = document.createElement("div"); d.className = cls; d.innerHTML = html; return d; };
const BRACKETS = '<div class="brackets"><i></i><i></i><i></i><i></i></div>';

const stage = document.getElementById("stage");
let items = [];

// ---------------- the kinds ----------------

function makeTitle(g) {
  const root = el("layer title", `<div class="block"><div class="rule"></div><div class="word">${esc(g.text)}</div><div class="tag">${esc(g.tagline)}</div></div>`);
  const [rule, word, tag] = ["rule", "word", "tag"].map((c) => root.querySelector(`.${c}`));
  return {
    root,
    draw(t) {
      const lt = t - g.from, out = outCubic(lin(t, g.to - 0.5, g.to));
      const a = outQuint(lin(lt, 0, 0.9)), b = outQuint(lin(lt, 0.4, 1.25)), r = outCubic(lin(lt, 0.15, 0.8));
      word.style.opacity = a * (1 - out);
      word.style.transform = `translateY(${(1 - a) * 22 - out * 10}px)`;
      word.style.letterSpacing = `${0.07 * (1 - a) - 0.012}em`;
      tag.style.opacity = b * (1 - out);
      tag.style.transform = `translateY(${(1 - b) * 16 - out * 8}px)`;
      rule.style.transform = `scaleX(${r})`;
      rule.style.opacity = r * (1 - out);
      return { visible: lt >= 0 && t <= g.to };
    },
  };
}

function makeCaption(g) {
  const root = el("layer caption", `<div class="box">${BRACKETS}<div class="text">${esc(g.text)}</div></div>`);
  const box = root.querySelector(".box"), brackets = root.querySelector(".brackets"), text = root.querySelector(".text");
  return {
    root,
    draw(t) {
      const lt = t - g.from, a = outQuint(lin(lt, 0, 0.42)), out = lin(t, g.to - 0.22, g.to);
      box.style.opacity = a * (1 - out);
      box.style.transform = `translateY(${(1 - a) * 14}px)`;
      // The brackets settle onto the box's corners as it arrives.
      brackets.style.setProperty("--o", `${-10 * (1 - outCubic(lin(lt, 0.05, 0.55)))}px`);
      text.style.transform = `translateX(${(1 - outQuint(lin(lt, 0.06, 0.5))) * -10}px)`;
      return { visible: lt >= 0 && t <= g.to };
    },
  };
}

/** One line of the real runner's output, coloured as a terminal would. */
function lineHtml(l) {
  const s = l.text;
  if (l.kind === "probe") {
    const m = s.match(/^(\s+)(\S+)(\s+)(v\S+)(\s+)authenticated(\s+)(.+)$/);
    if (m) return `${m[1]}<span class="k-name">${esc(m[2])}</span>${m[3]}<span class="k-dim">${esc(m[4])}</span>${m[5].slice(2)}<span class="k-ok">✓ authenticated</span>${m[6]}<span class="k-plan">${esc(m[7])}</span>`;
  }
  if (l.kind === "crew" || l.kind === "landed") {
    const m = s.match(/^(\[[0-9a-z]+\]) ([^:]+:)(.*)$/);
    if (m) {
      let rest = esc(m[3]).replace(/\((claude|codex)\)$/, '<span class="k-acc">($1)</span>').replace(/landed ([0-9a-f]+)/, '<span class="k-ok">landed $1</span>');
      return `<span class="k-faint">${esc(m[1])}</span> <span class="k-name">${esc(m[2])}</span><span class="k-dim">${rest}</span>`;
    }
  }
  if (l.kind === "diff") return esc(s).replace(/(\+\d+)/, '<span class="k-ok">$1</span>').replace(/ (-\d+)/, ' <span class="k-red">$1</span>');
  if (l.kind === "dim") return `<span class="k-dim">${esc(s)}</span>`;
  return `<span class="k-name">${esc(s)}</span>`;
}

function makeTerminal(g, script) {
  const root = el("layer terminal", `
    <div class="head"><div class="l1">${esc(g.caption[0])}</div><div class="l2">${esc(g.caption[1])}</div></div>
    <div class="win"><div class="bar"><div class="dots"><i></i><i></i><i></i></div><div class="wtitle">offsite — zsh</div></div><div class="body"></div></div>`);
  const body = root.querySelector(".body"), win = root.querySelector(".win"), head = root.querySelector(".head");
  const [l1, l2] = [head.querySelector(".l1"), head.querySelector(".l2")];
  const cmdLine = el("ln");
  body.append(cmdLine);
  const rows = script.lines.map((l) => {
    const row = el("ln", lineHtml(l));
    body.append(row);
    return { l, row };
  });
  const hl = el("hl");
  const probeRow = rows.findIndex((r) => r.l.kind === "probe");
  rows[probeRow].row.prepend(hl);
  const tail = el("ln");
  body.append(tail);
  return {
    root,
    opaque: true,
    draw(t) {
      const lt = (t - g.from) * (g.pace ?? 1);
      const inA = outCubic(lin(t - g.from, 0, 0.3));
      root.style.opacity = inA;
      win.style.transform = `translateY(${(1 - outQuint(lin(lt, 0, 0.6))) * 26}px)`;
      const h1 = outQuint(lin(lt, 0.05, 0.6)), h2 = outQuint(lin(lt, 0.35, 0.9));
      l1.style.opacity = h1; l1.style.transform = `translateY(${(1 - h1) * 14}px)`;
      l2.style.opacity = h2; l2.style.transform = `translateY(${(1 - h2) * 14}px)`;
      // The command, typed.
      const n = clamp(Math.floor((lt - script.typeFrom) * script.cps), 0, script.typed.length);
      const typing = lt < script.enterAt;
      const blinkOn = Math.floor(lt * 2.2) % 2 === 0 || (lt > script.typeFrom && lt < script.enterAt - 0.1);
      cmdLine.innerHTML = `<span class="prompt">$</span> <span class="cmd">${esc(script.typed.slice(0, n))}</span>${typing && blinkOn ? '<span class="cur"></span>' : ""}`;
      for (const { l, row } of rows) {
        const a = lin(lt, l.at, l.at + 0.1);
        row.style.opacity = a;
        row.style.visibility = a > 0 ? "visible" : "hidden";
      }
      const hlA = outCubic(lin(lt, 2.0, 2.45));
      hl.style.opacity = hlA;
      hl.style.transform = `scaleX(${0.6 + 0.4 * hlA})`;
      hl.style.transformOrigin = "left center";
      const last = script.lines[script.lines.length - 1].at;
      tail.innerHTML = lt > last + 0.15 && Math.floor(lt * 2.2) % 2 === 0 ? '<span class="prompt">$</span> <span class="cur"></span>' : lt > last + 0.15 ? '<span class="prompt">$</span> ' : "";
      return { visible: lt >= 0 && t <= g.to, opaque: inA >= 1 };
    },
  };
}

function makeEndcard(g) {
  const root = el("layer endcard", `
    <i class="sun"></i><i class="sea"></i><i class="glint g1"></i><i class="glint g2"></i><i class="glint g3"></i>
    <div class="block"><div class="word">${esc(g.wordmark)}</div><div class="tag">Take your coding agents on an offsite.</div>
      <div class="links">${g.lines.map((x) => `<div class="link"><b></b>${esc(x)}</div>`).join("")}</div>
      <div class="foot">${esc(g.foot)}</div></div>`);
  const parts = [".word", ".tag", ...g.lines.map((_, i) => `.link:nth-child(${i + 1})`), ".foot"].map((q) => root.querySelector(q));
  const sun = root.querySelector(".sun");
  return {
    root,
    opaque: true,
    draw(t) {
      const lt = t - g.from;
      const a = inOut(lin(lt, 0, 0.45));
      root.style.opacity = a;
      parts.forEach((p, i) => {
        const u = outQuint(lin(lt, 0.12 + i * 0.12, 0.85 + i * 0.12));
        p.style.opacity = u;
        p.style.transform = `translateY(${(1 - u) * 18}px)`;
      });
      // The sun sinks a little while the card is up.
      sun.style.transform = `translateY(${lt * 6}px)`;
      return { visible: lt >= 0 && t <= g.to + 1, opaque: a >= 1 };
    },
  };
}

// ---------------- the page's API ----------------

window.setup = (cut) => {
  stage.innerHTML = "";
  items = cut.graphics.map((g) => {
    const it = g.kind === "title" ? makeTitle(g) : g.kind === "caption" ? makeCaption(g) : g.kind === "terminal" ? makeTerminal(g, cut.terminal) : g.kind === "endcard" ? makeEndcard(g) : null;
    if (!it) throw new Error(`no graphic kind ${g.kind}`);
    stage.append(it.root);
    return { g, it };
  });
  const want = ["480 50px Saira", "560 50px Saira", "600 60px Saira", "680 200px Saira", "760 160px Saira", "400 24px 'JetBrains Mono'", "600 24px 'JetBrains Mono'"];
  return Promise.all(want.map((f) => document.fonts.load(f, "Offsite ✓·…"))).then(() => document.fonts.ready)
    .then(() => [...new Set([...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, "")))]);
};

/** Draws time t. visible: anything on screen; opaque: something covers the whole frame. */
window.frame = (t) => {
  let visible = false, opaque = false;
  const text = [];
  for (const { g, it } of items) {
    const live = t >= g.from - 1e-6 && t <= g.to + (g.kind === "endcard" ? 1 : 0);
    it.root.classList.toggle("on", live);
    if (!live) continue;
    const r = it.draw(t);
    visible ||= r.visible;
    opaque ||= !!r.opaque;
    text.push(it.root.innerText);
  }
  return { visible, opaque, text: text.join("\n") };
};

/** The YouTube thumbnail: a frame of the film behind a bold title. */
window.thumb = ({ image, word, tag, chip }) => {
  stage.innerHTML = `<div class="thumb"><img src="${image}"><div class="shade"></div><div class="block"><div class="rule"></div><div class="word">${esc(word)}</div><div class="tag">${tag}</div><div class="chip">${BRACKETS}${esc(chip)}</div></div></div>`;
  const img = stage.querySelector("img");
  return Promise.all([document.fonts.load("760 160px Saira"), document.fonts.load("640 58px Saira"), document.fonts.load("560 30px Saira"), img.decode()]).then(() => document.fonts.ready);
};
