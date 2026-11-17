// polyfills p/ navegadores de TV antigos (webOS 4 = Chromium 53)
if(!Promise.prototype.finally) Promise.prototype.finally = function(f){ return this.then(v => Promise.resolve(f()).then(() => v), e => Promise.resolve(f()).then(() => { throw e; })); };
if(!String.prototype.padStart) String.prototype.padStart = function(n, c){ let s = String(this); while(s.length < n) s = c + s; return s; };
[Element.prototype, DocumentFragment.prototype].forEach(P => { if(!P.append) P.append = function(){ for(const n of arguments) this.appendChild(typeof n === "string" ? document.createTextNode(n) : n); }; });
if(!Element.prototype.closest) Element.prototype.closest = function(s){ let e = this; while(e && e.nodeType === 1){ if(e.matches(s)) return e; e = e.parentElement; } return null; };
"use strict";
const MEDIA = "https://d212z35lp14c1p.cloudfront.net/m/";
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const store = { get(k){try{return localStorage.getItem(k)}catch{return null}}, set(k,v){try{localStorage.setItem(k,v)}catch{}}, del(k){try{localStorage.removeItem(k)}catch{}} };
let KEY, ITEMS = [], order = store.get("order") || "old", secs = +(store.get("secs") || 8);

/* ---------- cripto ---------- */
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function deriveKey(pass){
  const c = await (await fetch("crypto.json")).json();
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2", salt:b64(c.salt), iterations:c.iter, hash:"SHA-256"}, base, {name:"AES-GCM", length:256}, true, ["decrypt"]);
}
async function decrypt(buf){
  const u = new Uint8Array(buf);
  return crypto.subtle.decrypt({name:"AES-GCM", iv:u.subarray(0,12)}, KEY, u.subarray(12));
}
async function fetchDec(url, type, signal){
  const r = await fetch(url, {signal});
  if(!r.ok) throw new Error(r.status);
  return URL.createObjectURL(new Blob([await decrypt(await r.arrayBuffer())], {type}));
}

/* ---------- entrar ---------- */
async function unlock(key){
  KEY = key;
  ITEMS = JSON.parse(new TextDecoder().decode(await decrypt(await (await fetch("manifest.enc")).arrayBuffer())));
}
$("#lockform").onsubmit = async e => {
  e.preventDefault();
  const msg = $("#lockmsg"); msg.className = ""; msg.textContent = "Abrindo…";
  try{
    const k = await deriveKey($("#pw").value);
    await unlock(k);
    if($("#remember").checked){
      const raw = await crypto.subtle.exportKey("raw", k);
      store.set("gk", btoa(String.fromCharCode(...new Uint8Array(raw))));
    }
    showHome();
  }catch(err){ msg.className = "err"; msg.textContent = "Senha incorreta."; $("#pw").select(); }
};
$("#logout").onclick = () => { store.del("gk"); location.reload(); };
(async () => {
  const saved = store.get("gk");
  if(!saved) return;
  try{ await unlock(await crypto.subtle.importKey("raw", b64(saved), "AES-GCM", false, ["decrypt"])); showHome(); }
  catch{ store.del("gk"); }
})();

/* ---------- home ---------- */
const photos = () => ITEMS.filter(i => i.t === "p"), videos = () => ITEMS.filter(i => i.t === "v");
const fmtDate = d => d ? new Date(d).toLocaleDateString("pt-BR", {day:"numeric", month:"long", year:"numeric"}) : "";
const fmtDur = s => `${Math.floor(s/60)}:${String(Math.round(s%60)).padStart(2,"0")}`;
function showHome(){
  $("#lock").classList.add("hidden"); $("#home").classList.remove("hidden");
  const p = photos().length, v = videos().length, ds = ITEMS.map(i => i.d).filter(Boolean).sort();
  $("#np").textContent = `${p} fotos`; $("#nv").textContent = `${v} vídeos`;
  $("#stats").textContent = ds.length ? `${ITEMS.length} itens · ${new Date(ds[0]).getFullYear()}–${new Date(ds[ds.length - 1]).getFullYear()}` : `${ITEMS.length} itens`;
  syncChips();
  // capas: 6 miniaturas aleatórias por cartão
  const pick = (arr, n) => arr.slice().sort(() => Math.random() - .5).slice(0, n);
  [["photos", photos()], ["videos", videos()], ["grid", ITEMS]].forEach(([m, arr]) =>
    pick(arr, 6).forEach(async it => { const img = new Image(); $(`.mode[data-mode=${m}] .bg`).append(img); img.src = await thumb(it); }));
  focusFirst();
}
function syncChips(){
  $$("[data-order]").forEach(b => b.setAttribute("aria-pressed", b.dataset.order === order));
  $$("[data-sec]").forEach(b => b.setAttribute("aria-pressed", +b.dataset.sec === secs));
}
$$("[data-order]").forEach(b => b.onclick = () => { order = b.dataset.order; store.set("order", order); syncChips(); });
$$("[data-sec]").forEach(b => b.onclick = () => { secs = +b.dataset.sec; store.set("secs", secs); syncChips(); });
function ordered(list){
  const l = list.slice().sort((a, b) => (a.d || "").localeCompare(b.d || ""));
  if(order === "new") l.reverse();
  if(order === "rand") for(let i = l.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; }
  return l;
}
$$(".mode").forEach(b => b.onclick = () => {
  const m = b.dataset.mode; b.focus();
  if(m === "grid") return showGrid();
  play(ordered(m === "photos" ? photos() : videos()), 0, true);
});

/* ---------- miniaturas (fila com limite) ---------- */
const tcache = new Map(); let active = 0; const queue = [];
function thumb(it){
  if(tcache.has(it.id)) return tcache.get(it.id);
  const p = new Promise(res => queue.push(() => fetchDec("t/" + it.id, "image/jpeg").then(res, () => res(""))));
  tcache.set(it.id, p); pump(); return p;
}
function pump(){
  while(active < 6 && queue.length){ active++; queue.shift()().finally(() => { active--; pump(); }); }
}

/* ---------- galeria ---------- */
let gridBuilt = false;
function showGrid(){
  const g = $("#grid"); g.classList.remove("hidden");
  if(!gridBuilt){
    gridBuilt = true;
    const list = ITEMS.slice().sort((a, b) => (b.d || "").localeCompare(a.d || ""));
    const months = new Map();
    list.forEach(it => { const k = (it.d || "0000-00").slice(0, 7); (months.get(k) || months.set(k, []).get(k)).push(it); });
    const io = new IntersectionObserver(es => es.forEach(async e => {
      if(!e.isIntersecting) return; io.unobserve(e.target);
      const img = e.target.querySelector("img"); img.src = await thumb(list[+e.target.dataset.i]); img.onload = () => img.classList.add("on");
    }), {rootMargin: "800px"});
    let i = 0;
    for(const [k, arr] of months){
      const sec = document.createElement("div"); sec.className = "month";
      const title = k === "0000-00" ? "Sem data" : new Date(k + "-15").toLocaleDateString("pt-BR", {month:"long", year:"numeric"});
      sec.innerHTML = `<h2>${title}<small>${arr.length}</small></h2><div class="tiles"></div>`;
      const tiles = sec.querySelector(".tiles");
      arr.forEach(it => {
        const b = document.createElement("button"); b.className = "tile f"; b.dataset.i = i++;
        b.setAttribute("aria-label", `${it.t === "v" ? "Vídeo" : "Foto"} ${fmtDate(it.d)}`);
        b.innerHTML = `<img alt="">${it.t === "v" ? `<span class="dur">▶ ${fmtDur(it.dur)}</span>` : ""}`;
        b.onclick = () => play(list, +b.dataset.i, false);
        tiles.append(b); io.observe(b);
      });
      g.append(sec);
    }
  }
  g.scrollIntoView({behavior: "smooth"});
  setTimeout(() => g.querySelector(".tile")?.focus(), 400);
}

/* ---------- player ---------- */
const P = { gen: 0, list: [], i: 0, auto: true, paused: false, timer: 0, ctrl: null, hudT: 0, cache: new Map(), back: null };
function load(it){
  if(P.cache.has(it.id)) return P.cache.get(it.id);
  const p = fetchDec(MEDIA + it.id, it.t === "v" ? "video/mp4" : "image/jpeg");
  P.cache.set(it.id, p); return p;
}
function trimCache(){
  const keep = new Set([-1, 0, 1, 2].map(o => P.list[(P.i + o + P.list.length) % P.list.length]?.id));
  for(const [id, p] of P.cache) if(!keep.has(id)){ p.then(u => URL.revokeObjectURL(u), () => {}); P.cache.delete(id); }
}
function play(list, i, auto){
  if(!list.length) return;
  P.back = document.activeElement; P.list = list; P.i = i; P.auto = auto; P.paused = false;
  $("#player").classList.remove("hidden"); $("#player").focus();
  try{ const de = document.documentElement, fs = de.requestFullscreen || de.webkitRequestFullscreen; const r = fs && fs.call(de); if(r && r.catch) r.catch(() => {}); }catch(e){}
  show(); hud();
}
function killMedia(el){ if(el.tagName === "VIDEO"){ el.onended = el.onerror = null; el.pause(); el.removeAttribute("src"); el.load(); } el.remove(); }
function close(){
  clearTimeout(P.timer); P.gen++; [...$("#stage").children].forEach(killMedia);
  for(const p of P.cache.values()) p.then(u => URL.revokeObjectURL(u), () => {});
  P.cache.clear(); $("#player").classList.add("hidden");
  try{ const ex = document.exitFullscreen || document.webkitExitFullscreen; if((document.fullscreenElement || document.webkitFullscreenElement) && ex){ const r = ex.call(document); if(r && r.catch) r.catch(() => {}); } }catch(e){}
  const b = P.back;
  (b?.matches?.(".f") && b.offsetParent ? b : $(".mode"))?.focus();
}
async function show(){
  if($("#player").classList.contains("hidden")) return;
  clearTimeout(P.timer); $("#bar").style.transition = "none"; $("#bar").style.width = "0";
  const it = P.list[P.i], n = P.i, g = ++P.gen;
  $("#pdate").textContent = fmtDate(it.d); $("#pctr").textContent = `${P.i + 1} de ${P.list.length}`;
  $("#spin").classList.remove("hidden");
  let url; try{ url = await load(it); }catch{ url = null; }
  if(g !== P.gen || n !== P.i) return; // usuário já avançou ou fechou
  $("#spin").classList.add("hidden");
  const stage = $("#stage"), old = [...stage.children];
  let el;
  if(!url){ el = document.createElement("div"); }
  else if(it.t === "v"){
    el = document.createElement("video"); el.src = url; el.playsInline = true; el.autoplay = true; el.controls = !P.auto;
    el.onended = () => { if(P.auto && g === P.gen) step(1); };
    el.onerror = () => { if(P.auto && g === P.gen) step(1); };
  } else {
    el = document.createElement("img"); el.src = url; el.alt = ""; if(P.auto) el.className = "kb";
  }
  stage.append(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("on")));
  old.forEach(o => { if(o.tagName === "VIDEO"){ o.onended = o.onerror = null; o.pause(); } }); setTimeout(() => old.forEach(killMedia), 1200);
  if(it.t === "v" && P.paused) el.autoplay = false;
  if(P.auto && !P.paused && (it.t === "p" || !url)) timerStart();
  // pré-carrega as próximas
  [1, 2].forEach(o => { const nx = P.list[(P.i + o) % P.list.length]; if(nx) load(nx).catch(() => {}); });
  trimCache();
}
function timerStart(){
  clearTimeout(P.timer); const g = P.gen;
  const bar = $("#bar");
  requestAnimationFrame(() => { bar.style.transition = `width ${secs}s linear`; bar.style.width = "100%"; });
  P.timer = setTimeout(() => { if(g === P.gen && !P.paused) step(1); }, secs * 1000);
}
function step(d){ P.i = (P.i + d + P.list.length) % P.list.length; show(); }
function togglePause(){
  P.paused = !P.paused;
  $("#playico").setAttribute("d", P.paused ? "M8 5v14l11-7z" : "M6 5h4v14H6zm8 0h4v14h-4z");
  const v = $("#stage video.on"), it = P.list[P.i];
  if(v){ P.paused ? v.pause() : v.play(); }
  if(it.t === "p" && P.auto){
    if(P.paused){ clearTimeout(P.timer); const bar = $("#bar"); bar.style.width = getComputedStyle(bar).width; bar.style.transition = "none"; }
    else { $("#bar").style.transition = "none"; $("#bar").style.width = "0"; timerStart(); }
  }
  toast(P.paused ? "Pausado" : "Continuando"); hud();
}
function hud(){
  $("#player").classList.add("hud-on"); clearTimeout(P.hudT);
  P.hudT = setTimeout(() => $("#player").classList.remove("hud-on"), 3500);
}
let toastT;
function toast(t){
  let el = $(".toast"); if(!el){ el = document.createElement("div"); el.className = "toast"; document.body.append(el); }
  el.textContent = t; el.style.opacity = 1; clearTimeout(toastT); toastT = setTimeout(() => el.style.opacity = 0, 1200);
}
$("#bprev").onclick = () => { step(-1); hud(); };
$("#bnext").onclick = () => { step(1); hud(); };
$("#bplay").onclick = togglePause;
$("#bclose").onclick = close;
$("#player").addEventListener("mousemove", hud);
$("#stage").addEventListener("click", () => P.auto ? togglePause() : hud());

/* ---------- controle remoto / teclado ---------- */
// Voltar: Escape, Backspace, Tizen 10009, webOS 461, Android TV 4/"GoBack"
const isBack = e => ["Escape", "Backspace", "GoBack", "BrowserBack"].includes(e.key) || [10009, 461, 4].includes(e.keyCode);
const DIRS = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]};
function focusFirst(){ setTimeout(() => $(".mode")?.focus(), 50); }
function spatial(dx, dy){
  const cur = document.activeElement, all = $$(".f").filter(el => el.offsetParent && !el.closest(".hidden"));
  if(!cur || !all.includes(cur)){ ($(".mode") || all[0])?.focus(); return; }
  const a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best, bd = Infinity;
  for(const el of all){
    if(el === cur) continue;
    const b = el.getBoundingClientRect(), bx = b.left + b.width / 2, by = b.top + b.height / 2;
    const px = (bx - ax) * dx + (by - ay) * dy;          // avanço na direção
    if(px <= 4) continue;
    const off = Math.abs(dx ? by - ay : bx - ax);        // desvio lateral
    const d = px + off * 2.5;
    if(d < bd){ bd = d; best = el; }
  }
  if(best){ best.focus(); best.scrollIntoView({block: "nearest", behavior: "smooth"}); }
}
document.addEventListener("keydown", e => {
  if(!$("#player").classList.contains("hidden")){
    hud();
    if(isBack(e)){ e.preventDefault(); return close(); }
    if(e.key === "ArrowRight" || e.key === "MediaTrackNext"){ e.preventDefault(); return step(1); }
    if(e.key === "ArrowLeft" || e.key === "MediaTrackPrevious"){ e.preventDefault(); return step(-1); }
    if(["Enter", " ", "MediaPlayPause", "MediaPlay", "MediaPause"].includes(e.key) || [415, 19, 10252].includes(e.keyCode)){
      if(document.activeElement?.closest?.(".hud") && e.key === "Enter") return; // botão focado recebe o OK
      e.preventDefault(); return togglePause();
    }
    return;
  }
  if(e.target === $("#pw")) return;
  if(isBack(e) && !$("#grid").classList.contains("hidden")){ e.preventDefault(); $("#grid").classList.add("hidden"); window.scrollTo({top: 0}); return focusFirst(); }
  if(DIRS[e.key]){ e.preventDefault(); spatial(...DIRS[e.key]); }
});
