/* Vibrant Academy in-app batch viewer: Lectures / Notes / About */
(function () {
  "use strict";
  const API = "https://vibrant.nextmate.site";
  const PDF_VIEWER = "https://pdfweb.classx.co.in/pdfjs/web/viewer-new.html";
  const CLIENT_KEY = "kyu-re-madarchod";
  const SIGN_KEY = "vb-x7k9m2p4q8r1t5w3y6";
  const JWT_KEY = "vb-jwt-s3cr3t-k3y-2024";
  const PAGE = 20;
  const ROOTS = { 35: 3929, 8: 13 }; // course id -> root folder id
  const HLS_SRC = "https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.13/hls.min.js";

  const enc = new TextEncoder();
  const esc = (v = "") => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
  const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

  async function hmac(secret, data) {
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return crypto.subtle.sign("HMAC", key, enc.encode(data));
  }

  async function authHeaders() {
    const nonce = crypto.randomUUID();
    const ts = String(Date.now());
    const signature = hex(await hmac(SIGN_KEY, nonce + ts));
    const now = Date.now();
    const head = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
    const body = b64url(enc.encode(JSON.stringify({ iat: now, exp: now + 30000 })));
    const sig = b64url(await hmac(JWT_KEY, head + "." + body));
    return { "x-client-key": CLIENT_KEY, "x-nonce": nonce, "x-timestamp": ts, "x-signature": signature, Authorization: `Bearer ${head}.${body}.${sig}` };
  }

  async function api(path) {
    const res = await fetch(API + path, { headers: await authHeaders() });
    if (!res.ok) throw new Error("Request failed (" + res.status + ")");
    return res.json();
  }

  async function listFolder(courseId, parentId, start = 0) {
    const data = await api(`/api/folders?course_id=${encodeURIComponent(courseId)}&parent_id=${encodeURIComponent(parentId)}&start=${start}`);
    const arr = Array.isArray(data) ? data : data.items ?? data.data ?? data.children ?? [];
    return arr.map((o) => ({ ...o, title: o.Title || o.title || o.name || "Untitled" }));
  }

  async function getStreams(courseId, videoId) {
    const d = await api(`/api/play?course_id=${encodeURIComponent(courseId)}&video_id=${encodeURIComponent(videoId)}`);
    const out = [];
    if (Array.isArray(d.all)) d.all.forEach((o) => o.url && out.push({ quality: o.quality || "Auto", url: o.url }));
    else if (d.best && d.best.url) out.push({ quality: d.best.quality || "Best", url: d.best.url });
    else if (d.url) out.push({ quality: "Default", url: d.url });
    return out;
  }

  async function getPdf(courseId, contentId) {
    const d = await api(`/api/pdf?course_id=${encodeURIComponent(courseId)}&content_id=${encodeURIComponent(contentId)}`);
    return d.url || d.pdf_url || d.link || "";
  }

  /* Live course list (names/thumbnails). Falls back to batches.json data. */
  async function fetchCourses() {
    const data = await api("/api/purchases");
    const list = Array.isArray(data) ? data : data.data ?? data.courses ?? [];
    return list.map((n) => {
      const s = (n.coursedt && n.coursedt[0]) || n;
      return {
        id: s.id ?? n.itemid ?? n.id,
        name: s.course_name ?? s.name ?? n.name ?? "Untitled",
        thumbnail: s.course_thumbnail ?? s.course_image_url ?? s.course_logo ?? ""
      };
    });
  }

  /* ---------- UI ---------- */
  const css = `
  #vbViewer{position:fixed;inset:0;z-index:9000;background:var(--bg,#080a0f);color:var(--text,#f4f6fb);overflow-y:auto;display:none;-webkit-overflow-scrolling:touch}
  #vbViewer.open{display:block}
  .vb-top{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:14px;padding:14px 16px;background:var(--bg,#080a0f);border-bottom:1px solid var(--line,rgba(255,255,255,.09))}
  .vb-back{width:42px;height:42px;border-radius:12px;border:1px solid var(--line,rgba(255,255,255,.09));background:var(--panel-solid,#11151f);color:var(--brand-bright,#a69cff);display:grid;place-items:center;cursor:pointer;flex:none}
  .vb-top h2{margin:0;font-size:17px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .vb-wrap{max-width:760px;margin:0 auto;padding:16px}
  .vb-hero{border:1px solid var(--line,rgba(255,255,255,.09));border-radius:22px;overflow:hidden;background:var(--panel-solid,#11151f)}
  .vb-hero img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block;background:#1a1530}
  .vb-hero-body{padding:18px}
  .vb-hero h1{margin:0 0 6px;font-size:24px;line-height:1.2}
  .vb-hero p{margin:0 0 14px;color:var(--muted,#8d96a8)}
  .vb-pills{display:flex;gap:8px;flex-wrap:wrap}
  .vb-pill{padding:7px 14px;border-radius:999px;border:1px solid var(--line-strong,rgba(255,255,255,.16));font-size:13px;color:var(--muted-bright,#b4bdcd)}
  .vb-pill.acc{color:var(--brand-bright,#a69cff);border-color:rgba(139,124,255,.5);background:rgba(139,124,255,.1)}
  .vb-tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:16px 0}
  .vb-tab{padding:15px 8px;border-radius:14px;border:1px solid var(--line,rgba(255,255,255,.09));background:transparent;color:var(--muted-bright,#b4bdcd);font:600 16px inherit;font-family:inherit;cursor:pointer}
  .vb-tab.active{background:linear-gradient(135deg,#8b7cff,#6c5ce7);color:#fff;border-color:transparent;box-shadow:0 10px 28px rgba(108,92,231,.35)}
  .vb-crumbs{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:0 0 12px;font-size:13px;color:var(--muted,#8d96a8)}
  .vb-crumbs button{background:none;border:0;color:var(--brand-bright,#a69cff);cursor:pointer;font:inherit;padding:2px 0}
  .vb-list{display:flex;flex-direction:column;gap:12px}
  .vb-item{display:flex;align-items:center;gap:14px;padding:16px;border-radius:18px;border:1px solid var(--line,rgba(255,255,255,.09));background:var(--panel-solid,#11151f);cursor:pointer;text-align:left;color:inherit;font:inherit;width:100%}
  .vb-item:active{transform:scale(.99)}
  .vb-ico{width:46px;height:46px;border-radius:13px;background:rgba(139,124,255,.14);color:var(--brand-bright,#a69cff);display:grid;place-items:center;flex:none}
  .vb-ico svg{width:24px;height:24px}
  .vb-item .t{flex:1;min-width:0}
  .vb-item .t b{display:block;font-size:16px;line-height:1.3;word-break:break-word}
  .vb-item .t span{display:block;font-size:13px;color:var(--muted,#8d96a8);margin-top:3px}
  .vb-chev{color:var(--muted,#8d96a8);flex:none}
  .vb-msg{padding:28px 10px;text-align:center;color:var(--muted,#8d96a8)}
  .vb-more{margin:14px auto;display:block;padding:11px 22px;border-radius:12px;border:1px solid var(--line-strong,rgba(255,255,255,.16));background:transparent;color:inherit;cursor:pointer;font:inherit}
  .vb-about{padding:18px;border-radius:18px;border:1px solid var(--line,rgba(255,255,255,.09));background:var(--panel-solid,#11151f);line-height:1.6;color:var(--muted-bright,#b4bdcd)}
  .vb-about h3{margin:0 0 8px;color:var(--text,#f4f6fb)}
  .vb-skel{height:76px;border-radius:18px;background:linear-gradient(90deg,rgba(255,255,255,.04),rgba(255,255,255,.09),rgba(255,255,255,.04));background-size:200% 100%;animation:vbsk 1.2s infinite}
  @keyframes vbsk{to{background-position:-200% 0}}
  #vbPlayer{position:fixed;inset:0;z-index:9100;background:#000;display:none;flex-direction:column}
  #vbPlayer.open{display:flex}
  .vb-pbar{display:flex;align-items:center;gap:10px;padding:10px 12px;background:#0b0d13;color:#fff}
  .vb-pbar b{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:15px}
  .vb-pbar select,.vb-pbar button{background:#161a24;color:#fff;border:1px solid rgba(255,255,255,.16);border-radius:10px;padding:8px 10px;font:inherit;font-size:13px}
  #vbPlayer video{flex:1;width:100%;min-height:0;background:#000}
  `;

  const ICON_VIDEO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="m15.5 10.5 6-3.5v10l-6-3.5"/></svg>';
  const ICON_FOLDER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
  const ICON_PDF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>';
  const CHEV = '<svg class="vb-chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';

  let root, player, state;

  function ensureDom() {
    if (root) return;
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    root = document.createElement("div");
    root.id = "vbViewer";
    root.innerHTML = `
      <div class="vb-top"><button class="vb-back" id="vbBack" aria-label="Back"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg></button><h2 id="vbHeadTitle"></h2></div>
      <div class="vb-wrap">
        <div class="vb-hero"><img id="vbBanner" alt="" referrerpolicy="no-referrer"><div class="vb-hero-body"><h1 id="vbTitle"></h1><p id="vbSub"></p><div class="vb-pills" id="vbPills"></div></div></div>
        <div class="vb-tabs" id="vbTabs"><button class="vb-tab active" data-tab="lectures">Lectures</button><button class="vb-tab" data-tab="notes">Notes</button><button class="vb-tab" data-tab="about">About</button></div>
        <div id="vbBody"></div>
      </div>`;
    document.body.appendChild(root);
    player = document.createElement("div");
    player.id = "vbPlayer";
    player.innerHTML = `<div class="vb-pbar"><button id="vbPClose">✕</button><b id="vbPTitle"></b><select id="vbPQuality" aria-label="Quality"></select><select id="vbPSpeed" aria-label="Speed"><option value="0.75">0.75x</option><option value="1" selected>1x</option><option value="1.25">1.25x</option><option value="1.5">1.5x</option><option value="2">2x</option></select></div><video id="vbVideo" controls playsinline autoplay></video>`;
    document.body.appendChild(player);

    root.querySelector("#vbBack").addEventListener("click", closeBack);
    root.querySelector("#vbTabs").addEventListener("click", (e) => {
      const b = e.target.closest(".vb-tab");
      if (!b) return;
      state.tab = b.dataset.tab;
      state.path = [];
      render();
    });
    player.querySelector("#vbPClose").addEventListener("click", closePlayer);
    player.querySelector("#vbPQuality").addEventListener("change", (e) => playUrl(e.target.value, true));
    player.querySelector("#vbPSpeed").addEventListener("change", (e) => { document.getElementById("vbVideo").playbackRate = Number(e.target.value); });
    window.addEventListener("popstate", () => {
      if (player.classList.contains("open")) closePlayer(true);
      else if (root.classList.contains("open") && !(history.state && history.state.vb)) closeViewer(true);
    });
  }

  function closeBack() {
    if (state.path.length) { state.path.pop(); render(); return; }
    closeViewer();
  }

  function closeViewer(fromPop) {
    root.classList.remove("open");
    document.documentElement.style.overflow = "";
    if (!fromPop && history.state && history.state.vb) history.back();
  }

  function openViewer(batch) {
    ensureDom();
    const id = String(batch._id || batch.batch_id);
    state = {
      batch, id, rootId: ROOTS[id] ?? batch.rootId ?? 0,
      tab: "lectures", path: [], seq: 0
    };
    root.querySelector("#vbHeadTitle").textContent = batch.name || "Batch";
    root.querySelector("#vbTitle").textContent = batch.name || "Batch";
    root.querySelector("#vbSub").textContent = batch.byName || "Dedicated for Competitive Exams";
    root.querySelector("#vbPills").innerHTML = `<span class="vb-pill acc">Recorded</span><span class="vb-pill">${esc(batch.language || "Hinglish")}</span>`;
    const img = root.querySelector("#vbBanner");
    img.style.display = batch.previewImage ? "" : "none";
    img.src = batch.previewImage || "";
    img.onerror = () => { img.style.display = "none"; };
    root.querySelectorAll(".vb-tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === "lectures"));
    root.classList.add("open");
    root.scrollTop = 0;
    document.documentElement.style.overflow = "hidden";
    try { history.pushState({ vb: 1 }, ""); } catch (e) {}
    render();
  }

  function render() {
    root.querySelectorAll(".vb-tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === state.tab));
    const body = root.querySelector("#vbBody");
    if (state.tab === "about") {
      const b = state.batch;
      body.innerHTML = `<div class="vb-about"><h3>About this batch</h3>${esc(b.name || "")} — ${esc(b.byName || "recorded lectures and notes")}.<br>Language: ${esc(b.language || "Hinglish")}<br>Type: Recorded lectures + PDF notes. Open Lectures to watch videos and Notes for study material.</div>`;
      return;
    }
    loadFolder();
  }

  async function loadFolder(more) {
    const body = root.querySelector("#vbBody");
    const mySeq = more ? state.seq : ++state.seq;
    const parentId = state.path.length ? state.path[state.path.length - 1].id : state.rootId;
    if (!more) {
      state.items = []; state.start = 0; state.done = false;
      body.innerHTML = crumbs() + '<div class="vb-list"><div class="vb-skel"></div><div class="vb-skel"></div><div class="vb-skel"></div></div>';
      bindCrumbs();
    }
    try {
      const chunk = await listFolder(state.id, parentId, state.start);
      if (mySeq !== state.seq) return;
      const known = new Set(state.items.map((i) => String(i.id)));
      chunk.forEach((c) => { if (!known.has(String(c.id))) state.items.push(c); });
      state.start += PAGE;
      state.done = chunk.length < PAGE;
      draw();
    } catch (err) {
      if (mySeq !== state.seq) return;
      body.innerHTML = crumbs() + `<div class="vb-msg">Could not load content. ${esc(err.message || "")}<br><br><button class="vb-more" id="vbRetry">Retry</button></div>`;
      bindCrumbs();
      body.querySelector("#vbRetry").addEventListener("click", () => loadFolder());
    }
  }

  function crumbs() {
    if (!state.path.length) return "";
    const parts = [`<button data-c="-1">${state.tab === "notes" ? "Notes" : "Lectures"}</button>`];
    state.path.forEach((p, i) => parts.push("›", `<button data-c="${i}">${esc(p.title)}</button>`));
    return `<div class="vb-crumbs">${parts.join(" ")}</div>`;
  }

  function bindCrumbs() {
    root.querySelectorAll(".vb-crumbs button").forEach((b) =>
      b.addEventListener("click", () => { state.path = state.path.slice(0, Number(b.dataset.c) + 1); render(); })
    );
  }

  function kind(it) {
    const t = String(it.material_type || "").toUpperCase();
    if (t === "FOLDER") return "folder";
    if (t === "VIDEO") return "video";
    if (t === "PDF" || t === "STUDY_MATERIAL") return "pdf";
    return "other";
  }

  function draw() {
    const body = root.querySelector("#vbBody");
    // Lectures tab shows folders + videos, Notes tab shows folders + PDFs
    const items = state.items.filter((it) => {
      const k = kind(it);
      if (k === "folder") return true;
      return state.tab === "notes" ? k === "pdf" : k === "video";
    });
    let html = crumbs();
    if (!items.length) {
      html += `<div class="vb-msg">${state.done ? "Nothing here yet." : "Loading…"}</div>`;
    } else {
      html += '<div class="vb-list">' + items.map((it) => {
        const k = kind(it);
        const idx = state.items.indexOf(it);
        const sub = k === "folder" ? "Open" : k === "video" ? "Watch lecture" : "Open notes";
        return `<button class="vb-item" data-i="${idx}"><span class="vb-ico">${k === "folder" ? ICON_FOLDER : k === "video" ? ICON_VIDEO : ICON_PDF}</span><span class="t"><b>${esc(it.title)}</b><span>${sub}</span></span>${CHEV}</button>`;
      }).join("") + "</div>";
    }
    if (!state.done) html += '<button class="vb-more" id="vbMore">Load more</button>';
    body.innerHTML = html;
    bindCrumbs();
    body.querySelectorAll(".vb-item").forEach((b) => b.addEventListener("click", () => openItem(state.items[Number(b.dataset.i)])));
    const more = body.querySelector("#vbMore");
    if (more) more.addEventListener("click", () => { more.textContent = "Loading…"; loadFolder(true); });
  }

  async function openItem(it) {
    const k = kind(it);
    if (k === "folder") { state.path.push({ id: it.id, title: it.title }); render(); return; }
    const toast = window.showToast || (() => {});
    try {
      if (k === "video") {
        toast("Loading lecture…");
        const vid = it.video_id && it.video_id !== "" ? it.video_id : String(it.id);
        const streams = await getStreams(it.course_id || state.id, vid);
        if (!streams.length) return toast("Video not available.");
        openPlayer(it.title, streams);
      } else if (k === "pdf") {
        toast("Opening notes…");
        const url = await getPdf(state.id, it.content_id || String(it.id));
        if (!url) return toast("Notes not available.");
        window.open(`${PDF_VIEWER}?file=${encodeURIComponent(url)}&save_flag=1`, "_blank");
      }
    } catch (e) { toast("Could not open this item."); }
  }

  /* ---------- Player ---------- */
  let hls = null;
  function loadHls() {
    if (window.Hls) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = HLS_SRC; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  function openPlayer(title, streams) {
    player.querySelector("#vbPTitle").textContent = title;
    const sel = player.querySelector("#vbPQuality");
    sel.innerHTML = streams.map((s) => `<option value="${esc(s.url)}">${esc(s.quality)}</option>`).join("");
    player.classList.add("open");
    try { history.pushState({ vb: 2 }, ""); } catch (e) {}
    playUrl(streams[0].url, false);
  }

  async function playUrl(url, keepTime) {
    const v = document.getElementById("vbVideo");
    const t = keepTime ? v.currentTime : 0;
    if (hls) { hls.destroy(); hls = null; }
    const start = () => { if (t) v.currentTime = t; v.playbackRate = Number(player.querySelector("#vbPSpeed").value); v.play().catch(() => {}); };
    if (/\.m3u8(\?|$)/i.test(url)) {
      if (v.canPlayType("application/vnd.apple.mpegurl")) { v.src = url; v.addEventListener("loadedmetadata", start, { once: true }); return; }
      try { await loadHls(); } catch (e) { return (window.showToast || (() => {}))("Player failed to load."); }
      hls = new window.Hls();
      hls.loadSource(url);
      hls.attachMedia(v);
      hls.on(window.Hls.Events.MANIFEST_PARSED, start);
    } else {
      v.src = url;
      v.addEventListener("loadedmetadata", start, { once: true });
    }
  }

  function closePlayer(fromPop) {
    const v = document.getElementById("vbVideo");
    v.pause();
    if (hls) { hls.destroy(); hls = null; }
    v.removeAttribute("src"); v.load();
    player.classList.remove("open");
    if (fromPop !== true && history.state && history.state.vb === 2) history.back();
  }

  window.CXVibrant = { open: openViewer, fetchCourses, ROOTS };
})();
