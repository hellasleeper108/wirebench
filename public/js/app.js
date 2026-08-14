/* WIREBENCH 1.3 — Workbench shell + AmigaDOS wire CLI */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const state = {
    desks: null,
    wire: null,
    pins: loadPins(),
    history: [],
    histIdx: -1,
    z: 20,
    filter: "all",
    busy: 0,
    selected: null,
  };

  function loadPins() {
    try { return JSON.parse(localStorage.getItem("wirebench.pins") || "[]"); }
    catch { return []; }
  }
  function savePins() {
    localStorage.setItem("wirebench.pins", JSON.stringify(state.pins));
  }

  const pointer = $("#pointer");
  document.addEventListener("pointermove", (e) => {
    pointer.style.left = e.clientX + "px";
    pointer.style.top = e.clientY + "px";
  });

  function busy(on) {
    state.busy += on ? 1 : -1;
    if (state.busy < 0) state.busy = 0;
    document.body.classList.toggle("is-busy", state.busy > 0);
    $("#led").classList.toggle("on", state.busy > 0);
  }

  async function api(path, opts) {
    busy(true);
    try {
      const r = await fetch(path, opts);
      if (!r.ok) throw new Error(r.status + " " + r.statusText);
      return await r.json();
    } finally {
      busy(false);
    }
  }

  function clock() {
    const d = new Date();
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const pad = (n) => String(n).padStart(2, "0");
    $("#clock").textContent =
      `${days[d.getDay()]} ${pad(d.getDate())}-${mon[d.getMonth()]}-${String(d.getFullYear()).slice(2)}  ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  setInterval(clock, 1000);
  clock();

  const bootLines = [
    "WIREBENCH KICKSTART  1.3  (40.068)",
    "A1200-class wire desk",
    "",
    "Copyright 2026  local disk  SYS:WireBench",
    "Not affiliated with Commodore-Amiga, Inc.",
    "",
    "Memory test ........ 8192K OK",
    "ROM checksum ....... OK",
    "CIA / custom chips .. OK",
    "",
    "Insert Workbench disk in DF0:",
    "Reading  WIREBENCH.OS",
    "Mounting WIRE:",
    "Mounting DESK-10:",
    "No firehose. Ten desks.",
  ];

  function typeBoot() {
    return new Promise((resolve) => {
      const rom = $("#boot .rom");
      const bar = $("#boot .bar > i");
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) {
        rom.textContent = bootLines.join("\n");
        bar.style.width = "100%";
        return resolve();
      }
      let i = 0;
      let acc = "";
      const tick = () => {
        if (i >= bootLines.length) return resolve();
        acc += bootLines[i] + "\n";
        rom.textContent = acc;
        bar.style.width = Math.round(((i + 1) / bootLines.length) * 100) + "%";
        i += 1;
        setTimeout(tick, i < 6 ? 70 : 110);
      };
      tick();
    });
  }

  async function finishBoot() {
    if ($("#boot").dataset.done) return;
    $("#boot").dataset.done = "1";
    $("#boot").style.display = "none";
    $("#workbench").classList.add("on");
    openWin("cli");
    openWin("wire");
    openWin("desk");
    termPrint(banner(), "ora");
    termPrint("Type  help  — or click DESK. The NOW line is latest RSS, not a ranking.", "dim");
    $("#cmdline").focus();
    try {
      await refreshAll();
    } catch (err) {
      termPrint("NET: " + err.message, "err");
    }
  }

  function openWin(id) {
    const el = document.getElementById("win-" + id);
    if (!el) return;
    el.hidden = false;
    focusWin(el);
    if (id === "cli") setTimeout(() => $("#cmdline").focus(), 0);
  }
  function closeWin(el) { el.hidden = true; }
  function focusWin(el) {
    $$(".win").forEach((w) => w.classList.remove("active"));
    el.classList.add("active");
    el.style.zIndex = String(++state.z);
  }

  function wireWindows() {
    $$(".win").forEach((win) => {
      win.addEventListener("pointerdown", () => focusWin(win));
      const bar = $(".titlebar", win);
      let drag = null;
      bar.addEventListener("pointerdown", (e) => {
        if (e.target.closest(".gadget")) return;
        const r = win.getBoundingClientRect();
        drag = { x: e.clientX - r.left, y: e.clientY - r.top };
        bar.setPointerCapture(e.pointerId);
      });
      bar.addEventListener("pointermove", (e) => {
        if (!drag) return;
        win.style.left = Math.max(0, e.clientX - drag.x) + "px";
        win.style.top = Math.max(20, e.clientY - drag.y) + "px";
      });
      bar.addEventListener("pointerup", () => { drag = null; });
      $(".gadget.close", win)?.addEventListener("click", () => closeWin(win));
      $(".gadget.depth", win)?.addEventListener("click", () => {
        win.style.zIndex = "1";
        win.classList.remove("active");
      });
      $(".gadget.zoom", win)?.addEventListener("click", () => {
        if (win.dataset.zoomed) {
          win.style.left = win.dataset.l;
          win.style.top = win.dataset.t;
          win.style.width = win.dataset.w;
          win.style.height = win.dataset.h;
          delete win.dataset.zoomed;
        } else {
          win.dataset.l = win.style.left;
          win.dataset.t = win.style.top;
          win.dataset.w = win.style.width;
          win.dataset.h = win.style.height;
          win.dataset.zoomed = "1";
          win.style.left = "8px";
          win.style.top = "28px";
          win.style.width = "calc(100% - 16px)";
          win.style.height = "calc(100% - 50px)";
        }
      });
      const rz = $(".resize", win);
      if (rz) {
        let rs = null;
        rz.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          const r = win.getBoundingClientRect();
          rs = { x: e.clientX, y: e.clientY, w: r.width, h: r.height };
          rz.setPointerCapture(e.pointerId);
        });
        rz.addEventListener("pointermove", (e) => {
          if (!rs) return;
          win.style.width = Math.max(280, rs.w + (e.clientX - rs.x)) + "px";
          win.style.height = Math.max(160, rs.h + (e.clientY - rs.y)) + "px";
        });
        rz.addEventListener("pointerup", () => { rs = null; });
      }
    });
  }

  $$(".icon").forEach((ic) => {
    ic.addEventListener("click", () => {
      $$(".icon").forEach((x) => x.classList.remove("selected"));
      ic.classList.add("selected");
    });
    ic.addEventListener("dblclick", () => {
      openWin(ic.dataset.open);
      if (ic.dataset.cmd) termExec(ic.dataset.cmd);
    });
    ic.addEventListener("keydown", (e) => {
      if (e.key === "Enter") openWin(ic.dataset.open);
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "F1") { e.preventDefault(); openWin("cli"); termExec("help"); }
    if (e.key === "F2") { e.preventDefault(); openWin("desk"); }
    if (e.key === "F3") { e.preventDefault(); openWin("wire"); }
    if (e.key === "F4") { e.preventDefault(); openWin("src"); }
    if (e.key === "Escape") {
      const top = [...$$(".win")].filter((w) => !w.hidden).sort((a, b) => (+b.style.zIndex || 0) - (+a.style.zIndex || 0))[0];
      if (top && document.activeElement?.id !== "cmdline") closeWin(top);
    }
  });

  function weightWidth(s) {
    return { critical: 100, high: 78, medium: 52, low: 30 }[s] || 50;
  }

  function findDesk(q) {
    const n = String(q || "").toLowerCase();
    return (state.desks?.desks || []).find((d) =>
      d.id === n || d.name.toLowerCase() === n || String(d.rank) === n
    );
  }

  function renderDesks() {
    const box = $("#desk-list");
    if (!state.desks) {
      box.innerHTML = "<p class='dim'>Mounting DESK-10: …</p>";
      return;
    }
    const src = state.desks.ranking_source || {};
    $("#desk-src").innerHTML =
      `Ranking: <a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.name)}</a>`;
    box.innerHTML = "";
    (state.desks.desks || []).forEach((a, i) => {
      const now = a.now;
      const row = document.createElement("div");
      row.className = "shelf-row" + (state.selected === a.id ? " on" : "");
      row.tabIndex = 0;
      row.innerHTML = `
        <div class="rk">${String(a.rank).padStart(2, "0")}</div>
        <div class="who">
          <div class="nm">${esc(a.name)}</div>
          <div class="sub">${now ? esc((now.name || "").slice(0, 72)) : "— no copy on this desk —"}</div>
        </div>
        <div class="attr">${a.n ?? 0}</div>
        <div class="meter"><i style="width:${weightWidth(a.weight)}%;--w:${weightWidth(a.weight)}%"></i></div>`;
      row.addEventListener("click", () => selectDesk(a.id));
      row.addEventListener("keydown", (e) => { if (e.key === "Enter") selectDesk(a.id); });
      box.appendChild(row);
      requestAnimationFrame(() => {
        setTimeout(() => { row.querySelector(".meter > i").style.width = weightWidth(a.weight) + "%"; }, 80 * i);
      });
    });
    if (state.selected) renderDossier(state.selected);
  }

  function selectDesk(id) {
    state.selected = id;
    state.filter = id;
    $$("[data-filter]").forEach((x) => x.classList.toggle("on", x.dataset.filter === id || (id && x.dataset.filter === id)));
    renderDesks();
    renderDossier(id);
    renderWire();
    openWin("desk");
  }

  function renderDossier(id) {
    const a = findDesk(id);
    const box = $("#dossier");
    if (!a) { box.classList.remove("open"); box.innerHTML = ""; return; }
    const now = a.now;
    box.classList.add("open");
    box.innerHTML = `
      <h3>${String(a.rank).padStart(2, "0")}  ${esc(a.name)}</h3>
      <div class="meta">
        <span>${a.n ?? 0} on tape</span>
        ${now ? `<span>${esc(now.src_label)}</span>` : ""}
      </div>
      <p>${esc(a.summary)}</p>
      ${now ? `<p><b>NOW</b>  ${now.url ? `<a href="${esc(now.url)}" target="_blank" rel="noopener">${esc(now.name)}</a>` : esc(now.name)}</p>
        <p>${esc(now.summary || "")}</p>` : "<p>No live copy on this desk right now.</p>"}
      <p>${(a.sources || []).map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>`).join("  ·  ")}</p>`;
  }

  function renderWire() {
    const box = $("#wire-body");
    if (!state.wire) { box.innerHTML = "Mounting WIRE: …"; return; }
    $("#wire-stats").innerHTML = `
      <div class="statline">
        <span>copy <b>${state.wire.count ?? 0}</b></span>
        <span>pins <b>${state.pins.length}</b></span>
      </div>`;
    let rows = state.wire.rows || [];
    if (state.filter === "pin") {
      rows = rows.filter((r) => state.pins.includes(r.id) || state.pins.includes(r.name));
    } else if (state.filter !== "all") {
      rows = rows.filter((r) => r.desk === state.filter || r.source === state.filter);
    }
    box.innerHTML = `
      <table class="wb">
        <thead><tr><th></th><th>DESK</th><th>SRC</th><th>STORY</th></tr></thead>
        <tbody>
          ${rows.map((r) => {
            const pinned = state.pins.includes(r.id) || state.pins.includes(r.name);
            return `<tr class="${pinned ? "pin" : ""}">
              <td><button class="pinbtn" data-id="${esc(r.id)}" data-name="${esc(r.name)}">${pinned ? "*" : "+"}</button></td>
              <td>${esc(r.desk)}</td>
              <td>${esc(r.src_label)}</td>
              <td>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a>` : esc(r.name)}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>`;
    box.querySelectorAll(".pinbtn").forEach((b) => {
      b.addEventListener("click", () => {
        const key = b.dataset.id || b.dataset.name;
        const i = state.pins.indexOf(key);
        if (i >= 0) state.pins.splice(i, 1);
        else state.pins.push(key);
        savePins();
        renderWire();
      });
    });
  }

  $$("[data-filter]").forEach((b) => {
    b.addEventListener("click", () => {
      state.filter = b.dataset.filter;
      $$("[data-filter]").forEach((x) => x.classList.toggle("on", x === b));
      renderWire();
    });
  });

  function renderSrc() {
    const box = $("#src-body");
    if (!state.wire) { box.innerHTML = "Mounting SRC: …"; return; }
    const feeds = state.wire.feeds || {};
    $("#src-meta").textContent = `${Object.keys(feeds).length} public RSS · no Reuters/AP scrape`;
    box.innerHTML = Object.entries(feeds).map(([k, m]) => `
      <div class="aid-item">
        <div><span class="who">${esc(k)}</span>
          <span class="pill ${m.ok === false ? "hot" : "online"}">${m.ok === false ? "FAIL" : "OK"}</span></div>
        <div>${m.error ? esc(m.error) : (m.cached ? "cached " + (m.age_s || 0) + "s" : "fresh")}</div>
      </div>`).join("");
  }

  const term = $("#term-log");
  const cmd = $("#cmdline");

  function banner() {
    return [
      "WIREBENCH 1.3  CLI",
      "SYS:WireTerm  WIRE:BBC,Guardian,NPR,AJ,NASA,Tribune,HPM,DoD",
      "Ten desks. Public RSS. No firehose.",
      "",
    ].join("\n");
  }

  function termPrint(text, cls) {
    const d = document.createElement("div");
    d.className = "out" + (cls ? " " + cls : "");
    d.textContent = text;
    term.appendChild(d);
    const body = $("#win-cli .body");
    body.scrollTop = body.scrollHeight;
  }

  cmd.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const line = cmd.value;
      cmd.value = "";
      if (line.trim()) {
        state.history.push(line);
        state.histIdx = state.history.length;
      }
      termExec(line);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!state.history.length) return;
      state.histIdx = Math.max(0, state.histIdx - 1);
      cmd.value = state.history[state.histIdx];
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      state.histIdx = Math.min(state.history.length, state.histIdx + 1);
      cmd.value = state.history[state.histIdx] || "";
    }
  });

  function termExec(line) {
    const raw = line.trim();
    termPrint("1> " + raw, "ora");
    if (!raw) return;
    const [verb, ...rest] = raw.split(/\s+/);
    const arg = rest.join(" ");
    const fn = commands[verb.toLowerCase()] || commands[aliases[verb.toLowerCase()]];
    if (!fn) {
      termPrint(`Unknown command "${verb}".  help  for the binder.`, "err");
      return;
    }
    Promise.resolve(fn(arg)).catch((err) => termPrint(String(err.message || err), "err"));
  }

  const aliases = {
    ls: "list", "?": "help", man: "help", dir: "list",
    cat: "show", type: "show", info: "show",
    q: "search", find: "search",
    r: "refresh",
    desks: "list",
    in: "wire",
    sources: "src",
  };

  const HELP = `WIREBENCH 1.3 command binder

  help                 this text
  desk | list          DESK-10 standing beats
  show <desk|#>        open a desk dossier
  wire [desk]          live tape
  src                  feed attribution
  search | find <term>
  pin <name>
  unpin <name>
  pins
  refresh
  status
  open <desk|wire|src|cli>
  clear
  about

  F1 help   F2 DESK-10   F3 WIRE   F4 SRC
  Double-click desktop icons.  Drag orange title bars.`;

  const commands = {
    help() { termPrint(HELP); },
    about() {
      termPrint(
        "WIREBENCH 1.3 — Amiga Workbench-inspired wire desk.\n" +
        "DESK-10 is editorial (which beats to staff). NOW is latest RSS on that beat.\n" +
        "Public RSS only. No Reuters/AP scrape. Homage — not a Commodore product."
      );
    },
    clear() { term.innerHTML = ""; },
    open(arg) {
      const map = {
        desk: "desk", desks: "desk", "desk-10": "desk",
        wire: "wire", in: "wire",
        src: "src", sources: "src",
        cli: "cli",
      };
      const id = map[(arg || "").toLowerCase()];
      if (!id) return termPrint("open desk | wire | src | cli", "err");
      openWin(id);
    },
    async list() {
      if (!state.desks) await refreshAll();
      termPrint((state.desks.desks || []).map((d) =>
        `${String(d.rank).padStart(2, "0")}  ${d.name.padEnd(8)}  ${(d.now && d.now.name || "—").slice(0, 56)}`
      ).join("\n"));
      openWin("desk");
    },
    desk(arg) {
      if (!arg) return commands.list();
      return commands.show(arg);
    },
    show(arg) {
      if (!arg) return termPrint("show <desk|#>");
      const d = findDesk(arg);
      if (!d) return termPrint("No desk " + arg, "err");
      selectDesk(d.id);
      termPrint(`${d.name}\n${d.summary}\nNOW  ${(d.now && d.now.name) || "—"}`);
    },
    async wire(arg) {
      if (!state.wire) await refreshAll();
      openWin("wire");
      if (arg) {
        state.filter = arg.toLowerCase();
        $$("[data-filter]").forEach((x) => x.classList.toggle("on", x.dataset.filter === state.filter));
        renderWire();
      }
      termPrint((state.wire.rows || []).slice(0, 14).map((r) =>
        `${(r.desk || "").padEnd(8)} ${(r.src_label || "").padEnd(12)} ${(r.name || "").slice(0, 48)}`
      ).join("\n"));
    },
    src() {
      renderSrc();
      openWin("src");
      const feeds = state.wire?.feeds || {};
      termPrint(Object.entries(feeds).map(([k, m]) =>
        `${k.padEnd(16)} ${m.ok === false ? "FAIL" : "OK"}`
      ).join("\n"));
    },
    async search(arg) {
      if (!arg) return termPrint("find <term>");
      const data = await api("/api/search?q=" + encodeURIComponent(arg));
      if (!data.hits?.length) return termPrint("No hits for " + arg, "dim");
      termPrint(data.hits.map((h) => `[${h.kind}] ${h.name}\n      ${h.detail}`).join("\n"));
    },
    pin(arg) {
      if (!arg) return termPrint("pin <name>");
      if (!state.pins.includes(arg)) state.pins.push(arg);
      savePins();
      renderWire();
      termPrint("Pinned " + arg, "ok");
    },
    unpin(arg) {
      state.pins = state.pins.filter((p) => p.toLowerCase() !== arg.toLowerCase());
      savePins();
      renderWire();
      termPrint("Dropped " + arg);
    },
    pins() {
      termPrint(state.pins.length ? state.pins.map((p) => "* " + p).join("\n") : "(empty spike)");
    },
    async refresh() {
      termPrint("Motor on DF0:  re-reading WIRE: …", "dim");
      await api("/api/refresh", { method: "POST" });
      await refreshAll();
      termPrint("Wire refreshed.", "ok");
    },
    async status() {
      const st = await api("/api/status");
      termPrint(
        `WIREBENCH ${st.version}  port ${st.port}  ttl ${st.ttl_s}s\n` +
        `desks: ${state.desks?.desks?.length ?? 0}  copy: ${state.wire?.count ?? 0}`
      );
    },
    time() { termPrint(new Date().toUTCString()); },
  };

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  async function refreshAll() {
    const [desks, wire] = await Promise.all([
      api("/api/desks"),
      api("/api/wire"),
    ]);
    state.desks = desks;
    state.wire = wire;
    if (!state.selected && desks.desks?.[0]) state.selected = desks.desks[0].id;
    renderDesks();
    renderWire();
    renderSrc();
    const fails = Object.entries(wire.feeds || {}).filter(([, m]) => m && m.ok === false);
    if (fails.length) {
      termPrint("Feed warnings: " + fails.map(([k]) => k).join(" · "), "err");
    } else {
      termPrint(`WIRE: ${wire.count} stories across 10 desks`, "ok");
    }
  }

  wireWindows();
  $("#skip").addEventListener("click", finishBoot);
  document.addEventListener("keydown", (e) => {
    if (!$("#boot").dataset.done && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      finishBoot();
    }
  });
  typeBoot().then(() => setTimeout(finishBoot, 450));
})();
