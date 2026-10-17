/* Random Picker — static app for GitHub Pages.
   Pages (hash-routed, so GitHub Pages needs no server config):
     #/                  Lists page
     #/list/<id>         Picker page
     #/list/<id>/items   Add/edit items page
   Source of truth: data/lists.json. Local edits live in localStorage until you
   Export JSON and commit the file back to the repo. */
const DATA_URL = 'data/lists.json';
const STORE_KEY = 'randomPicker.v1';
const SETTINGS_KEY = 'randomPicker.settings';
const $ = id => document.getElementById(id);

const state = { lists: [], activeId: null, picked: new Set(), history: [], current: null, spinning: false, editingItem: null, flashItem: null };
const settings = Object.assign({ spin: true, noRepeat: false, hideDetail: false }, safeParse(localStorage.getItem(SETTINGS_KEY)));

function safeParse(s) { try { return JSON.parse(s) || {}; } catch (e) { return {}; } }

/* ---------- persistence ---------- */
async function loadFromFile() {
  const res = await fetch(DATA_URL + '?t=' + Date.now());
  if (!res.ok) throw new Error('Could not load ' + DATA_URL);
  return (await res.json()).lists;
}
function saveLocal() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ lists: state.lists })); } catch (e) {}
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
}
async function init() {
  const saved = safeParse(localStorage.getItem(STORE_KEY));
  if (Array.isArray(saved.lists) && saved.lists.length) state.lists = saved.lists;
  else {
    try { state.lists = await loadFromFile(); }
    catch (e) { alert(e.message + '\nServe the folder over http (e.g. "python -m http.server") or use GitHub Pages; file:// blocks fetch.'); }
  }
  route();
}

/* ---------- math rendering ---------- */
const KATEX_OPTS = {
  delimiters: [
    { left: '$$', right: '$$', display: true },
    { left: '\\[', right: '\\]', display: true },
    { left: '\\(', right: '\\)', display: false },
    { left: '$', right: '$', display: false }
  ],
  throwOnError: false
};
// {{ expr }} -> \( expr = result \) using math.js
function expandMath(str) {
  return String(str ?? '').replace(/\{\{([^}]+)\}\}/g, (_, expr) => {
    try {
      const tex = math.parse(expr).toTex({ parenthesis: 'auto' });
      const val = math.format(math.evaluate(expr), { precision: 12 });
      return `\\(${tex} = ${val}\\)`;
    } catch (e) { return `\\(\\text{error: ${String(expr).replace(/[\\{}]/g, '')}}\\)`; }
  });
}
function setMath(el, text) {
  el.textContent = expandMath(text);      // textContent => no HTML injection
  if (window.renderMathInElement) renderMathInElement(el, KATEX_OPTS);
}

/* ---------- helpers ---------- */
const active = () => state.lists.find(l => l.id === state.activeId);
const uid = () => 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const norm = s => String(s).trim().toLowerCase().replace(/\s+/g, ' ');
function parseItem(s) {
  const k = s.indexOf('::');
  return k < 0 ? { text: s.trim() } : { text: s.slice(0, k).trim(), detail: s.slice(k + 2).trim() };
}
const itemToLine = i => i.detail ? `${i.text} :: ${i.detail}` : i.text;
function randInt(n) { // unbiased crypto RNG
  const max = Math.floor(0x100000000 / n) * n; const a = new Uint32Array(1);
  do { crypto.getRandomValues(a); } while (a[0] >= max);
  return a[0] % n;
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/* ---------- router ---------- */
function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'list' && parts[1]) {
    const l = state.lists.find(x => x.id === parts[1]);
    if (!l) return go('#/');
    state.activeId = l.id;
    return parts[2] === 'items' ? showItems() : showPicker();
  }
  showLists();
}
function showView(id) {
  ['viewLists', 'viewPicker', 'viewItems'].forEach(v => $(v).hidden = v !== id);
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

/* ================= PAGE 1: LISTS ================= */
function showLists() {
  showView('viewLists');
  document.title = 'Random Picker';
  renderListGrid();
}
function renderListGrid() {
  const q = norm($('listSearch').value);
  const grid = $('listGrid'); grid.innerHTML = '';
  const shown = state.lists.filter(l => !q || norm(l.name + ' ' + (l.description || '')).includes(q));
  shown.forEach(l => {
    const b = document.createElement('button'); b.className = 'list-card';
    const n = document.createElement('span'); n.className = 'name'; n.textContent = l.name;
    const d = document.createElement('span'); d.className = 'desc'; d.textContent = l.description || '';
    const c = document.createElement('span'); c.className = 'count'; c.textContent = `${l.items.length} item${l.items.length === 1 ? '' : 's'}`;
    b.append(n, d, c);
    b.onclick = () => go('#/list/' + encodeURIComponent(l.id));
    grid.append(b);
  });
  $('listsEmpty').hidden = shown.length > 0;
  $('listsEmpty').textContent = state.lists.length ? 'No lists match your search.' : 'No lists yet. Click “+ New list”.';
}
$('listSearch').addEventListener('input', renderListGrid);

/* ---------- list dialog (new list / edit info) ---------- */
let dlgMode = 'new';
function openDialog(mode) {
  dlgMode = mode;
  const l = mode === 'edit' ? active() : null;
  $('dlgTitle').textContent = mode === 'edit' ? 'Edit list info' : 'New list';
  $('fName').value = l?.name ?? '';
  $('fDesc').value = l?.description ?? '';
  $('fItems').value = '';
  $('fItemsLabel').hidden = mode === 'edit';       // items are managed on the items page
  $('dlg').showModal();
}
$('dlgForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('fName').value.trim(); if (!name) return;
  const description = $('fDesc').value.trim();
  if (dlgMode === 'edit') {
    Object.assign(active(), { name, description });
    saveLocal(); $('dlg').close(); showPicker(); return;
  }
  const items = $('fItems').value.split('\n').map(s => s.trim()).filter(Boolean).map(parseItem);
  state.lists.push({ id: uid(), name, description, items });
  saveLocal(); $('dlg').close(); renderListGrid();
});
$('dlgCancel').onclick = () => $('dlg').close();

$('btnNew').onclick = () => openDialog('new');
$('btnExport').onclick = () => {
  const blob = new Blob([JSON.stringify({ lists: state.lists }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'lists.json'; a.click();
  URL.revokeObjectURL(a.href);
};
$('fileImport').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (!Array.isArray(j.lists)) throw new Error('Expected {"lists":[...]}');
    state.lists = j.lists.map(l => ({ id: l.id || uid(), name: l.name || 'Untitled', description: l.description || '', items: (l.items || []).map(i => typeof i === 'string' ? { text: i } : i) }));
    saveLocal(); renderListGrid();
  } catch (err) { alert('Import failed: ' + err.message); }
  e.target.value = '';
};
$('btnReset').onclick = async () => {
  if (!confirm('Discard local changes and reload data/lists.json?')) return;
  localStorage.removeItem(STORE_KEY);
  try { state.lists = await loadFromFile(); renderListGrid(); } catch (e) { alert(e.message); }
};

/* ================= PAGE 2: PICKER ================= */
function showPicker() {
  const l = active();
  showView('viewPicker');
  document.title = l.name + ' · Random Picker';
  $('pTitle').textContent = l.name;
  $('pDesc').textContent = l.description || '';
  $('optSpin').checked = settings.spin;
  $('optRemove').checked = settings.noRepeat;
  $('optHide').checked = settings.hideDetail;
  state.picked.clear(); state.history = []; state.current = null; state.spinning = false;
  showResult(l.items.length ? null : { text: 'This list has no items yet.', detail: '' });
  renderHistory(); updatePoolInfo();
}
function pool() {
  const l = active(); if (!l) return [];
  const all = l.items.map((_, i) => i);
  return settings.noRepeat ? all.filter(i => !state.picked.has(i)) : all;
}
function renderHistory() {
  const ol = $('history'); ol.innerHTML = '';
  state.history.slice().reverse().forEach(h => {
    const li = document.createElement('li');
    setMath(li, h.detail ? `${h.text} — ${h.detail}` : h.text);
    ol.append(li);
  });
}
// Keeps Pick / Reset picks in step with the pool. Returns true when every item has been picked.
function updatePoolInfo() {
  const l = active();
  const empty = !l || !l.items.length;
  const exhausted = !empty && settings.noRepeat && pool().length === 0;
  $('btnPick').disabled = state.spinning || empty || exhausted;
  $('btnPick').title = exhausted ? 'All items picked. Reset picks to start again.' : '';
  $('btnClearPicks').classList.toggle('attention', exhausted);
  $('poolInfo').textContent = !l ? '' : exhausted
    ? `All ${l.items.length} items picked. Reset picks to start again.`
    : `${pool().length} of ${l.items.length} available`;
  return exhausted;
}
function showResult(item, opts = {}) {
  const stage = $('stage');
  stage.classList.toggle('spinning', !!opts.spinning);
  stage.classList.toggle('done', !!opts.done);
  if (!item) { $('resultText').textContent = 'Press “Pick”'; $('resultDetail').textContent = ''; $('btnReveal').hidden = true; return; }
  setMath($('resultText'), item.text);
  const hide = opts.done && settings.hideDetail && item.detail;
  if (hide) { $('resultDetail').textContent = ''; $('btnReveal').hidden = false; }
  else { setMath($('resultDetail'), opts.spinning ? '' : (item.detail || '')); $('btnReveal').hidden = true; }
}
function finishPick(idx) {
  const item = active().items[idx];
  state.spinning = false;
  state.current = item; state.picked.add(idx); state.history.push(item);
  showResult(item, { done: true });
  renderHistory();
  if (updatePoolInfo()) $('btnClearPicks').focus();
}
function pick() {
  if (state.spinning) return;
  const l = active();
  if (!l || !l.items.length) return;
  const p = pool();
  if (!p.length) return;                                    // all picked: user must press Reset picks
  const finalIdx = p[randInt(p.length)];                    // winner is decided first
  if (!settings.spin) return finishPick(finalIdx);          // spin off: instant result
  state.spinning = true; updatePoolInfo();
  let ticks = 0; const total = 14;
  const timer = setInterval(() => {
    showResult(l.items[randInt(l.items.length)], { spinning: true });
    if (++ticks >= total) { clearInterval(timer); finishPick(finalIdx); }
  }, 70);
}

$('btnPick').onclick = pick;
$('btnReveal').onclick = () => { setMath($('resultDetail'), state.current?.detail || ''); $('btnReveal').hidden = true; };
$('btnClearPicks').onclick = () => {
  state.picked.clear(); state.history = []; renderHistory(); updatePoolInfo();
  if (!$('btnPick').disabled) $('btnPick').focus();
};
$('optSpin').onchange = e => { settings.spin = e.target.checked; saveSettings(); };
$('optRemove').onchange = e => { settings.noRepeat = e.target.checked; saveSettings(); updatePoolInfo(); };
$('optHide').onchange = e => { settings.hideDetail = e.target.checked; saveSettings(); };
$('btnBackLists').onclick = () => go('#/');
$('btnItems').onclick = () => go('#/list/' + encodeURIComponent(state.activeId) + '/items');
$('btnEdit').onclick = () => openDialog('edit');
$('btnDelete').onclick = () => {
  const l = active(); if (!l || !confirm(`Delete “${l.name}”?`)) return;
  state.lists = state.lists.filter(x => x.id !== l.id);
  saveLocal(); go('#/');
};

/* ================= PAGE 3: ADD / EDIT ITEMS ================= */
function showItems() {
  const l = active();
  showView('viewItems');
  document.title = 'Items · ' + l.name;
  $('iTitle').textContent = l.name;
  $('itemInput').value = '';
  state.editingItem = null; state.flashItem = null;
  refreshItems();
  $('itemInput').focus();
}
function itemQuery() { return parseItem($('itemInput').value).text; }
function itemExists(text) { return active().items.some(i => norm(i.text) === norm(text)); }
/* ---- live preview: renders text/detail exactly like the picker will, and flags mistakes ---- */
function mathProblems(raw) {
  const probs = [];
  const stripped = raw.replace(/\\\$/g, '').replace(/\$\$/g, '');
  if ((stripped.match(/\$/g) || []).length % 2) probs.push('Unclosed $ (add the closing $)');
  raw.replace(/\{\{([^}]+)\}\}/g, (m, expr) => {
    try { math.evaluate(expr); } catch (e) { probs.push('math.js: ' + e.message); }
    return m;
  });
  return probs;
}
function renderPreview(box, textEl, detailEl, warnEl, raw) {
  const empty = !raw.trim();
  box.classList.toggle('empty', empty);
  if (empty) {
    textEl.textContent = 'Type an item to see how it will look…';
    detailEl.textContent = ''; warnEl.textContent = ''; box.classList.remove('bad'); return;
  }
  const it = parseItem(raw);
  setMath(textEl, it.text);
  setMath(detailEl, it.detail || '');
  const probs = mathProblems(raw);
  if (box.querySelector('.katex-error')) probs.unshift('LaTeX error: check the red part of the formula');
  warnEl.textContent = probs.length ? '⚠ ' + probs.join(' · ') : '';
  box.classList.toggle('bad', probs.length > 0);
}
function updatePreview() {
  renderPreview($('itemPreview'), $('pvText'), $('pvDetail'), $('pvWarn'), $('itemInput').value);
}

function updateStatus() {
  const q = itemQuery(), st = $('itemStatus'), add = $('btnAddItem');
  st.className = 'status';
  if (!q) { st.textContent = ''; add.disabled = true; return; }
  if (itemExists(q)) { st.textContent = '⚠ Already exists in this list'; st.classList.add('warn'); add.disabled = true; return; }
  const similar = filteredItems().length;
  st.textContent = similar ? `✓ New item — ${similar} similar item${similar === 1 ? '' : 's'} below` : '✓ New item';
  st.classList.add('ok'); add.disabled = false;
}
function filteredItems() {
  const l = active(), q = norm(itemQuery());
  return l.items.filter(i => !q || norm(i.text + ' ' + (i.detail || '')).includes(q));
}
function renderItemList() {
  const l = active(), ul = $('itemList'); ul.innerHTML = '';
  const shown = filteredItems();
  $('itemTotal').textContent = shown.length === l.items.length
    ? `Total items: ${l.items.length}`
    : `Total items: ${l.items.length} · showing ${shown.length} match${shown.length === 1 ? '' : 'es'}`;
  let flashEl = null;
  shown.forEach(it => {
    const li = document.createElement('li');
    if (it === state.flashItem) { li.className = 'flash'; flashEl = li; }
    if (it === state.editingItem) {
      const inp = document.createElement('input'); inp.value = itemToLine(it);
      inp.onkeydown = e => {
        if (e.key === 'Enter') saveEdit(it, inp.value);
        if (e.key === 'Escape') { state.editingItem = null; renderItemList(); }
      };
      const col = document.createElement('div'); col.className = 'edit-col';
      const pv = document.createElement('div'); pv.className = 'preview';
      const pl = document.createElement('div'); pl.className = 'preview-label'; pl.textContent = 'Live preview';
      const pt = document.createElement('div'); pt.className = 'pv-text';
      const pd = document.createElement('div'); pd.className = 'pv-detail';
      const pw = document.createElement('div'); pw.className = 'pv-warn';
      pv.append(pl, pt, pd, pw);
      const refresh = () => renderPreview(pv, pt, pd, pw, inp.value);
      inp.addEventListener('input', refresh);
      col.append(inp, pv); refresh();
      const acts = document.createElement('div'); acts.className = 'row-actions';
      const ok = document.createElement('button'); ok.textContent = 'Save'; ok.className = 'primary'; ok.onclick = () => saveEdit(it, inp.value);
      const cx = document.createElement('button'); cx.textContent = 'Cancel'; cx.onclick = () => { state.editingItem = null; renderItemList(); };
      acts.append(ok, cx); li.append(col, acts); ul.append(li);
      setTimeout(() => inp.focus(), 0);
      return;
    }
    const body = document.createElement('div'); body.className = 'body';
    const t = document.createElement('div'); setMath(t, it.text); body.append(t);
    if (it.detail) { const d = document.createElement('div'); d.className = 'd'; setMath(d, it.detail); body.append(d); }
    const acts = document.createElement('div'); acts.className = 'row-actions';
    const ed = document.createElement('button'); ed.textContent = 'Edit'; ed.onclick = () => { state.editingItem = it; renderItemList(); };
    const del = document.createElement('button'); del.textContent = '✕'; del.className = 'danger'; del.title = 'Delete';
    del.onclick = () => { l.items.splice(l.items.indexOf(it), 1); saveLocal(); refreshItems(); };
    acts.append(ed, del); li.append(body, acts); ul.append(li);
  });
  if (flashEl) { flashEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); state.flashItem = null; }
}
const renderItemListSoon = debounce(renderItemList, 90);
function refreshItems() { updateStatus(); updatePreview(); renderItemList(); }
function saveEdit(it, raw) {
  const n = parseItem(raw);
  if (!n.text) return;
  const dup = active().items.some(x => x !== it && norm(x.text) === norm(n.text));
  if (dup) { alert('Another item with that text already exists.'); return; }
  it.text = n.text; if (n.detail) it.detail = n.detail; else delete it.detail;
  state.editingItem = null; saveLocal(); refreshItems();
}
function addItem() {
  const it = parseItem($('itemInput').value);
  if (!it.text || itemExists(it.text)) return;
  if (!it.detail) delete it.detail;
  active().items.push(it);
  saveLocal();
  state.flashItem = it;
  $('itemInput').value = '';
  refreshItems();
  $('itemInput').focus();
}
$('itemInput').addEventListener('input', () => { updateStatus(); updatePreview(); renderItemListSoon(); });
$('itemInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } });
$('btnAddItem').onclick = addItem;
$('btnBackPicker').onclick = () => go('#/list/' + encodeURIComponent(state.activeId));

init();
