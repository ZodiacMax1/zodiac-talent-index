import re
s = open('shell.html').read()

def sub_between(s, start, end, new, include_end=False):
    a = s.index(start)
    b = s.index(end, a)
    if include_end: b += len(end)
    return s[:a] + new + s[b:]

# ---- 1. data + API layer + gate
api_layer = r"""let DATA = [];
let ROLE = null;
let TOKEN = null;
let lastVersion = -1;
const TOKEN_KEY = 'zodiacTalentToken_v2';
try{ TOKEN = localStorage.getItem(TOKEN_KEY); }catch(e){}

function canEdit(){ return ROLE === 'edit'; }

async function api(path, opts){
  opts = opts || {};
  const headers = {'content-type':'application/json'};
  if(TOKEN) headers.authorization = 'Bearer ' + TOKEN;
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
  });
  let j = {};
  try{ j = await res.json(); }catch(e){}
  if(res.status === 401 && path !== '/login'){ lockGate(); throw new Error('Session expired'); }
  if(!res.ok) throw new Error(j.error || 'Something went wrong');
  return j;
}

function lockGate(){
  TOKEN = null; ROLE = null;
  try{ localStorage.removeItem(TOKEN_KEY); }catch(e){}
  document.getElementById('password-gate').classList.remove('unlocked');
}

/* ---------- password gate (server-checked) ---------- */
document.getElementById('gate-form').addEventListener('submit', async function(e){
  e.preventDefault();
  const input = document.getElementById('gate-input');
  const err = document.getElementById('gate-error');
  err.textContent = '';
  try{
    const j = await api('/login', {method:'POST', body:{password: input.value}});
    TOKEN = j.token; ROLE = j.role;
    try{ localStorage.setItem(TOKEN_KEY, TOKEN); }catch(e2){}
    input.value = '';
    document.getElementById('password-gate').classList.add('unlocked');
    await loadState();
  }catch(ex){
    err.textContent = ex.message === 'Incorrect password' ? 'Incorrect password — try again.' : (ex.message || 'Could not sign in');
    input.value = '';
    input.focus();
  }
});

"""
s = sub_between(s, 'const DATA = __DATA__;', 'function isExclusive(r){', api_layer)

# ---- 2. isExclusive
s = s.replace("return r.source === 'roster' && r.status === 'Exclusive';", "return r.exclusivity === 'Exclusive';")

# ---- 3. lists store
lists_new = r"""/* ---------- named brand lists (shared live via the database) ---------- */
const ACTIVE_KEY = 'zodiacActiveList_v2';
let store = { lists: { 'My List': [] }, active: 'My List' };
let listsSynced = {};
let listTimer = null;
function listId(name){
  return 'l_' + btoa(unescape(encodeURIComponent(name))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function saveStore(){
  try{ localStorage.setItem(ACTIVE_KEY, store.active); }catch(e){}
  clearTimeout(listTimer);
  listTimer = setTimeout(pushLists, 400);
}
async function pushLists(){
  listTimer = null;
  try{
    for(const name of Object.keys(store.lists)){
      const json = JSON.stringify(store.lists[name]);
      if(listsSynced[name] !== json){
        listsSynced[name] = json;
        await api('/lists/' + listId(name), {method:'PUT', body:{name, data:{ids: store.lists[name]}}});
      }
    }
    for(const name of Object.keys(listsSynced)){
      if(!(name in store.lists)){
        delete listsSynced[name];
        await api('/lists/' + listId(name), {method:'DELETE'});
      }
    }
  }catch(e){ showToast('Could not save list: ' + e.message); }
}
function applyLists(serverLists){
  if(listTimer) return; // local changes still waiting to save
  const lists = {};
  serverLists.forEach(l => { lists[l.name] = (l.data && l.data.ids) || []; });
  if(!Object.keys(lists).length) lists['My List'] = [];
  listsSynced = {};
  serverLists.forEach(l => { listsSynced[l.name] = JSON.stringify(lists[l.name]); });
  let active = store.active;
  try{ active = localStorage.getItem(ACTIVE_KEY) || active; }catch(e){}
  store.lists = lists;
  store.active = lists[active] ? active : Object.keys(lists)[0];
}
"""
s = sub_between(s, '/* ---------- named, persistent brand lists ---------- */', 'function activeIds(){', lists_new)

# ---- 4. decks store
decks_new = r"""/* ---------- saved decks (shared live via the database) ---------- */
let deckStore = {};
let decksSynced = {};
let deckTimer = null;
function saveDeckStoreToDisk(){
  clearTimeout(deckTimer);
  deckTimer = setTimeout(pushDecks, 400);
}
async function pushDecks(){
  deckTimer = null;
  try{
    for(const id of Object.keys(deckStore)){
      const json = JSON.stringify(deckStore[id]);
      if(decksSynced[id] !== json){
        decksSynced[id] = json;
        await api('/decks/' + encodeURIComponent(id), {method:'PUT', body:{name: deckStore[id].name, data: deckStore[id]}});
      }
    }
    for(const id of Object.keys(decksSynced)){
      if(!(id in deckStore)){
        delete decksSynced[id];
        await api('/decks/' + encodeURIComponent(id), {method:'DELETE'});
      }
    }
  }catch(e){ showToast('Could not save deck: ' + e.message); }
}
function applyDecks(serverDecks){
  if(deckTimer) return;
  const d = {}; decksSynced = {};
  serverDecks.forEach(x => { d[x.id] = x.data; decksSynced[x.id] = JSON.stringify(x.data); });
  deckStore = d;
}
"""
s = sub_between(s, "const DECK_STORAGE_KEY = 'zodiacSavedDecks_v1';", 'function renderSavedDecksList(){', decks_new)

# ---- 5. detail panel: edit buttons + remove stale note
s = re.sub(r"\$\{\(!r\.ig_followers && !r\.tt_followers[^\n]*\n", "", s)
s = s.replace("""        <button class="btn ghost" style="padding:7px 14px;font-size:12.5px;" data-copy="${r.id}">Copy Pitch Blurb</button>
""", """        <button class="btn ghost" style="padding:7px 14px;font-size:12.5px;" data-copy="${r.id}">Copy Pitch Blurb</button>
        ${canEdit() ? `<button class="btn ghost" style="padding:7px 14px;font-size:12.5px;" data-edit="${r.id}">Edit</button>
        <button class="btn ghost danger" style="padding:7px 14px;font-size:12.5px;" data-del="${r.id}">Delete</button>` : ''}
""")
s = s.replace("""  tbody.querySelectorAll('[data-copy]').forEach(btn => {""", """  tbody.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openTalentForm(DATA.find(r => r.id === btn.dataset.edit)); });
  });
  tbody.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const r = DATA.find(x => x.id === btn.dataset.del);
      if(!r || !confirm('Delete ' + r.name + ' for everyone? This cannot be undone.')) return;
      try{ await api('/talents/' + encodeURIComponent(r.id), {method:'DELETE'}); expandedId = null; await loadState(); showToast('Deleted ' + r.name); }
      catch(ex){ showToast(ex.message); }
    });
  });
  tbody.querySelectorAll('[data-copy]').forEach(btn => {""", 1)

# ---- 6. header buttons
s = s.replace("""<div class="header-total" id="header-total"></div>""", """<button class="btn ghost" id="add-talent-btn" style="display:none;">+ Add Talent</button>
      <button class="btn ghost" id="unlock-edit-btn" style="display:none;">Unlock Editing</button>
      <div class="header-total" id="header-total"></div>""")

# ---- 7. CSS + modal markup
css = """
  .btn.danger{color:#9b1c1c;border-color:#d9b3b3;}
  .btn.danger:hover{background:#fbeaea;}
  .live-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#2e8b57;margin-right:6px;vertical-align:middle;}
  .modal-back{position:fixed;inset:0;background:rgba(30,0,6,.45);display:none;align-items:flex-start;justify-content:center;z-index:300;overflow:auto;padding:40px 16px;}
  .modal-back.open{display:flex;}
  .modal-card{background:#fff;border-radius:6px;max-width:640px;width:100%;padding:26px 28px;box-shadow:0 20px 60px rgba(0,0,0,.25);}
  .modal-card h3{font-family:'Oswald',sans-serif;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--burgundy);margin:0 0 16px;font-size:18px;}
  .form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 14px;}
  .form-grid .full{grid-column:1 / -1;}
  .form-grid label{display:block;font-family:'Oswald',sans-serif;font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:var(--grey);margin-bottom:4px;}
  .form-grid input,.form-grid select,.form-grid textarea{width:100%;box-sizing:border-box;background:var(--cream);border:1px solid var(--line-strong);color:var(--ink);font-family:'DM Sans',sans-serif;font-size:13.5px;padding:9px 10px;border-radius:4px;}
  .form-grid textarea{min-height:80px;resize:vertical;}
  .form-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:18px;}
  .form-error{color:#9b1c1c;font-size:12.5px;margin-top:10px;min-height:16px;}
  @media(max-width:560px){.form-grid{grid-template-columns:1fr;}}
</style>"""
s = s.replace("</style>", css, 1)

modal = """<div class="modal-back" id="modal-back"><div class="modal-card" id="modal-card"></div></div>
<div class="toast" id="toast"></div>"""
s = s.replace('<div class="toast" id="toast"></div>', modal, 1)

# ---- 8. forms + state loading + boot
boot = r"""
/* ---------- live state ---------- */
function modalOpen(){ return document.getElementById('modal-back').classList.contains('open'); }
function closeModal(){ document.getElementById('modal-back').classList.remove('open'); }
function openModal(html){
  document.getElementById('modal-card').innerHTML = html;
  document.getElementById('modal-back').classList.add('open');
}
document.getElementById('modal-back').addEventListener('mousedown', e => { if(e.target.id === 'modal-back') closeModal(); });

function applyRole(){
  document.getElementById('add-talent-btn').style.display = canEdit() ? '' : 'none';
  document.getElementById('unlock-edit-btn').style.display = (ROLE === 'view') ? '' : 'none';
}

async function loadState(){
  const j = await api('/state');
  ROLE = j.role;
  lastVersion = j.version;
  DATA = j.talents;
  applyLists(j.lists);
  applyDecks(j.decks);
  applyRole();
  document.getElementById('header-total').innerHTML = '<span class="live-dot"></span>' + DATA.length + ' talent on file';
  renderNichePanel();
  updateNicheButtonLabel();
  render();
  renderShortlist();
  renderSavedDecksList();
}

async function poll(){
  if(!TOKEN || modalOpen() || document.hidden) return;
  try{
    const j = await api('/version');
    if(j.version !== lastVersion) await loadState();
  }catch(e){}
}
setInterval(poll, 20000);
document.addEventListener('visibilitychange', () => { if(!document.hidden) poll(); });

/* ---------- add / edit talent ---------- */
function distinct(field){
  return [...new Set(DATA.map(r => r[field]).filter(Boolean))].sort();
}
function openTalentForm(r){
  const isNew = !r;
  r = r || {exclusivity:'Non-Exclusive'};
  const regions = distinct('region');
  const nicheList = [...getNicheSet()].sort();
  const v = x => escapeAttr(x == null ? '' : x);
  openModal(`<h3>${isNew ? 'Add Talent' : 'Edit ' + escapeHtml(r.name)}</h3>
  <form id="talent-form"><div class="form-grid">
    <div class="full"><label>Name</label><input name="name" value="${v(r.name)}" required></div>
    <div><label>Exclusivity</label><select name="exclusivity">
      <option value="Non-Exclusive" ${r.exclusivity!=='Exclusive'?'selected':''}>Non-Exclusive</option>
      <option value="Exclusive" ${r.exclusivity==='Exclusive'?'selected':''}>Exclusive</option></select></div>
    <div><label>Gender</label><select name="gender">
      <option value="" ${!r.gender?'selected':''}></option>
      <option value="F" ${r.gender==='F'?'selected':''}>Female</option>
      <option value="M" ${r.gender==='M'?'selected':''}>Male</option>
      <option value="Mixed" ${r.gender==='Mixed'?'selected':''}>Mixed</option></select></div>
    <div><label>Region</label><input name="region" list="dl-regions" value="${v(r.region)}">
      <datalist id="dl-regions">${regions.map(x => `<option value="${escapeAttr(x)}">`).join('')}</datalist></div>
    <div><label>Typical Rate</label><input name="rate" value="${v(r.rate)}"></div>
    <div class="full"><label>Niches (comma separated)</label><input name="niche" id="niche-input" value="${v(r.niche)}">
      <div class="niche-tags" style="margin-top:8px;">${nicheList.map(n => `<span class="niche-tag" data-addniche="${escapeAttr(n)}" style="cursor:pointer;">${escapeHtml(n)}</span>`).join('')}</div></div>
    <div><label>Instagram Followers</label><input name="ig_followers" inputmode="numeric" value="${v(r.ig_followers)}"></div>
    <div><label>Instagram Link</label><input name="instagram" value="${v(r.instagram)}"></div>
    <div><label>TikTok Followers</label><input name="tt_followers" inputmode="numeric" value="${v(r.tt_followers)}"></div>
    <div><label>TikTok Link</label><input name="tiktok" value="${v(r.tiktok)}"></div>
    <div><label>YouTube Followers</label><input name="yt_followers" inputmode="numeric" value="${v(r.yt_followers)}"></div>
    <div><label>YouTube Link</label><input name="youtube" value="${v(r.youtube)}"></div>
    <div class="full"><label>Photo URL</label><input name="photo" value="${v(r.photo)}"></div>
    <div class="full"><label>Bio</label><textarea name="public_bio">${escapeHtml(r.public_bio || '')}</textarea></div>
  </div>
  <div class="form-error" id="form-error"></div>
  <div class="form-actions">
    <button type="button" class="btn ghost" id="form-cancel">Cancel</button>
    <button type="submit" class="btn" id="form-save">${isNew ? 'Add Talent' : 'Save Changes'}</button>
  </div></form>`);
  document.getElementById('form-cancel').onclick = closeModal;
  document.querySelectorAll('[data-addniche]').forEach(t => t.addEventListener('click', () => {
    const inp = document.getElementById('niche-input');
    const cur = inp.value.split(',').map(x => x.trim()).filter(Boolean);
    const n = t.dataset.addniche;
    inp.value = (cur.includes(n) ? cur.filter(x => x !== n) : cur.concat(n)).join(', ');
  }));
  document.getElementById('talent-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {};
    for(const [k, val] of fd.entries()){
      const orig = r[k] == null ? '' : String(r[k]);
      if(isNew || String(val).trim() !== orig) body[k] = val;
    }
    if(!isNew && !Object.keys(body).length){ closeModal(); return; }
    const btn = document.getElementById('form-save');
    btn.disabled = true;
    try{
      if(isNew) await api('/talents', {method:'POST', body});
      else await api('/talents/' + encodeURIComponent(r.id), {method:'PATCH', body});
      closeModal();
      await loadState();
      showToast(isNew ? 'Talent added' : 'Saved');
    }catch(ex){
      document.getElementById('form-error').textContent = ex.message;
      btn.disabled = false;
    }
  });
}
document.getElementById('add-talent-btn').addEventListener('click', () => openTalentForm(null));

/* ---------- unlock editing ---------- */
document.getElementById('unlock-edit-btn').addEventListener('click', () => {
  openModal(`<h3>Unlock Editing</h3>
  <form id="edit-pw-form"><div class="form-grid"><div class="full"><label>Edit password</label><input type="password" name="pw" autocomplete="off" required></div></div>
  <div class="form-error" id="form-error"></div>
  <div class="form-actions"><button type="button" class="btn ghost" id="form-cancel">Cancel</button><button type="submit" class="btn">Unlock</button></div></form>`);
  document.getElementById('form-cancel').onclick = closeModal;
  document.querySelector('#edit-pw-form input').focus();
  document.getElementById('edit-pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try{
      const j = await api('/login', {method:'POST', body:{password: new FormData(e.target).get('pw')}});
      if(j.role !== 'edit') throw new Error('Incorrect edit password');
      TOKEN = j.token; ROLE = j.role;
      try{ localStorage.setItem(TOKEN_KEY, TOKEN); }catch(x){}
      closeModal(); applyRole(); render(); showToast('Editing unlocked');
    }catch(ex){
      document.getElementById('form-error').textContent = ex.message === 'Incorrect password' ? 'Incorrect edit password' : ex.message;
    }
  });
});

/* ---------- start ---------- */
(async function boot(){
  if(!TOKEN) return;
  try{
    await loadState();
    document.getElementById('password-gate').classList.add('unlocked');
    if(sharedDeck){ document.getElementById('deck-overlay').classList.add('open'); renderDeck(sharedDeck); }
  }catch(e){ /* gate stays up */ }
})();
"""
a = s.index("const sharedDeck = parseDeckHash();")
tail_start = s.index("document.getElementById('header-total').textContent = DATA.length")
tail = s[a:]
new_tail = """const sharedDeck = parseDeckHash();
""" + boot + """
render();
renderShortlist();
</script>
</body>
</html>
"""
s = s[:a] + new_tail
open('../public/index.html','w').write(s)
print(len(s))
