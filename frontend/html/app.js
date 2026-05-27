// Keves Hakvasim — frontend
const API = '/api';
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

let state = {
  me: null,
  polls: [],
  filter: { sort: 'new', q: '' },
};

async function api(path, opts={}){
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || 'שגיאת שרת');
  return data;
}

let toastTimer;
function toast(msg, kind='ok'){
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + kind;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> t.hidden = true, 3000);
}

function setPoints(p){
  const a = $('#points'); if (a) a.textContent = p;
  const b = $('#points2'); if (b) b.textContent = p;
}

async function loadMe(){
  state.me = await api('/me');
  setPoints(state.me.points);
  $('#baseAmount').textContent = state.me.base;
}

async function loadPolls(){
  const params = new URLSearchParams();
  if (state.filter.sort) params.set('sort', state.filter.sort);
  if (state.filter.q) params.set('q', state.filter.q);
  state.polls = await api('/polls?' + params.toString());
  renderPolls();
}

function pctOf(o, total){ return total>0 ? Math.round(o.votes*100/total) : 0; }

function renderPolls(){
  const grid = $('#polls');
  if (!state.polls.length){
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--muted);padding:60px 20px">
      <img src="/sheep.jpg" class="logo logo-lg" style="opacity:.4" />
      <div style="margin-top:14px;font-size:18px;font-weight:700">אין סקרים עדיין</div>
      <div style="margin-top:6px">היה הראשון ליצור סקר!</div>
    </div>`;
    return;
  }
  grid.innerHTML = state.polls.map(pollCard).join('');
  $$('.poll').forEach(el => {
    const id = el.dataset.id;
    const amtIn = $('.card-amt', el);
    const amtCost = $('.card-amt-cost', el);
    const clampAmt = () => {
      let v = parseInt(amtIn.value, 10) || 1;
      if (v < 1) v = 1; if (v > 100) v = 100;
      amtIn.value = v;
      if (amtCost) amtCost.textContent = v;
      return v;
    };
    amtIn.addEventListener('input', clampAmt);
    amtIn.addEventListener('click', e => e.stopPropagation());
    $('.card-amt-minus', el).addEventListener('click', e => {
      e.stopPropagation();
      amtIn.value = (parseInt(amtIn.value,10)||1) - 1; clampAmt();
    });
    $('.card-amt-plus', el).addEventListener('click', e => {
      e.stopPropagation();
      amtIn.value = (parseInt(amtIn.value,10)||1) + 1; clampAmt();
    });
    el.addEventListener('click', e => {
      if (e.target.closest('.opt')) return;
      if (e.target.closest('.card-amt-wrap')) return;
      openDetail(id);
    });
    $$('.opt', el).forEach(o => o.addEventListener('click', e => {
      e.stopPropagation();
      const idx = parseInt(o.dataset.idx, 10);
      vote(id, idx, clampAmt());
    }));
  });
}

function pollCard(p){
  const total = p.totalVotes || 0;
  const closed = p.closesAt && new Date(p.closesAt).getTime() < Date.now();
  const isEn = p.language === 'en';
  const opts = p.options.map((o, i) => {
    const pct = pctOf(o, total);
    let cls = '';
    if (p.type === 'binary'){ cls = i===0 ? 'yes' : 'no'; }
    return `
      <div class="opt ${cls} ${isEn?'en':''}" data-idx="${i}">
        <div class="bar" style="width:${pct}%"></div>
        <div class="label">${escapeHtml(o.label)}</div>
        <div class="pct">${pct}%</div>
      </div>
    `;
  }).join('');
  return `
    <article class="poll" data-id="${p._id}">
      <div class="poll-head">
        ${closed ? '<span class="closed">סגור</span>' : `<span class="poll-tag">${p.type==='binary'?'כן / לא':'בחירה מרובה'}</span>`}
      </div>
      <h3 class="poll-title ${isEn?'en':''}">${escapeHtml(p.title)}</h3>
      ${p.description ? `<p class="poll-desc ${isEn?'en':''}">${escapeHtml(p.description)}</p>` : ''}
      <div class="card-amt-wrap">
        <span class="card-amt-lbl">כמות להצבעה:</span>
        <button type="button" class="card-amt-minus">−</button>
        <input type="number" class="card-amt" min="1" max="100" value="1" />
        <button type="button" class="card-amt-plus">+</button>
        <span class="card-amt-cost-wrap">עלות: <b class="card-amt-cost">1</b> נק'</span>
      </div>
      <div class="options">${opts}</div>
      <div class="poll-foot">
        <div>הצבעות: <b>${p.totalVotes}</b></div>
        <div>נקודות בקופה: <b>${p.totalPoints}</b></div>
        ${p.closesAt ? `<div>נסגר: <b>${formatDate(p.closesAt)}</b></div>` : ''}
      </div>
    </article>
  `;
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}
function formatDate(d){
  const x = new Date(d);
  return x.toLocaleDateString('he-IL') + ' ' + x.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'});
}

async function vote(id, idx, amount=1){
  if (!state.me) return;
  if (state.me.points < amount){ toast('אין מספיק נקודות', 'err'); return; }
  try{
    const r = await api(`/polls/${id}/vote`, {
      method:'POST', body: JSON.stringify({ optionIndex: idx, amount })
    });
    state.me.points = r.points;
    setPoints(r.points);
    const i = state.polls.findIndex(p => p._id === id);
    if (i>=0) state.polls[i] = r.poll;
    renderPolls();
    toast(`+${amount} הצבעה! נשארו ${r.points} נק'`);
    if (!$('#detailModal').hidden) openDetail(id);
  }catch(e){ toast(e.message, 'err'); }
}

async function openDetail(id){
  const p = await api('/polls/' + id);
  const isEn = p.language === 'en';
  const total = p.totalVotes || 0;
  const closed = p.closesAt && new Date(p.closesAt).getTime() < Date.now();
  const opts = p.options.map((o, i) => {
    const pct = pctOf(o, total);
    let cls = '';
    if (p.type === 'binary'){ cls = i===0 ? 'yes' : 'no'; }
    return `
      <div class="opt ${cls} ${isEn?'en':''}" data-idx="${i}">
        <div class="bar" style="width:${pct}%"></div>
        <div class="label">${escapeHtml(o.label)}</div>
        <div class="pct">${pct}% · ${o.votes}</div>
      </div>
    `;
  }).join('');

  const card = $('#detailCard');
  card.innerHTML = `
    <button class="close" id="closeDetail">×</button>
    <div class="detail-head">
      <img src="/sheep.jpg" class="logo logo-md gradient-ring ${p.type==='binary'?'green':'alt'}" alt="" />
      <h2 class="${isEn?'en':''}" style="${isEn?'direction:ltr;text-align:left':''}">${escapeHtml(p.title)}</h2>
    </div>
    <div class="detail-meta">
      ${p.type==='binary'?'כן / לא':'בחירה מרובה'} ·
      הצבעות: <b>${p.totalVotes}</b> · נקודות בקופה: <b>${p.totalPoints}</b>
      ${p.closesAt ? ` · נסגר: <b>${formatDate(p.closesAt)}</b>` : ''}
      ${closed ? ' · <span class="closed">סגור</span>' : ''}
    </div>
    ${p.description ? `<p class="poll-desc ${isEn?'en':''}" style="${isEn?'direction:ltr;text-align:left':''}">${escapeHtml(p.description)}</p>` : ''}
    <div class="vote-amount">
      <span style="color:var(--muted)">כמות הצבעות:</span>
      <button id="amtMinus">−</button>
      <input id="amt" type="number" min="1" max="100" value="1" />
      <button id="amtPlus">+</button>
      <span style="color:var(--muted); margin-inline-start:auto">עלות: <b id="amtCost">1</b> נק'</span>
    </div>
    <div class="options" id="detailOpts">${opts}</div>
    <div class="modal-foot">
      <button class="ghost-btn" id="closeDetail2">סגור</button>
    </div>
  `;
  $('#detailModal').hidden = false;

  const amtIn = $('#amt');
  const refreshCost = () => {
    let v = parseInt(amtIn.value,10)||1;
    if (v < 1) v = 1; if (v > 100) v = 100;
    amtIn.value = v;
    $('#amtCost').textContent = v;
  };
  amtIn.addEventListener('input', refreshCost);
  $('#amtMinus').addEventListener('click', () => { amtIn.value = Math.max(1, (parseInt(amtIn.value,10)||1)-1); refreshCost(); });
  $('#amtPlus').addEventListener('click',  () => { amtIn.value = Math.min(100, (parseInt(amtIn.value,10)||1)+1); refreshCost(); });

  $$('.opt', card).forEach(o => o.addEventListener('click', () => {
    if (closed) { toast('הסקר נסגר','err'); return; }
    const idx = parseInt(o.dataset.idx, 10);
    const amt = Math.min(100, Math.max(1, parseInt(amtIn.value,10)||1));
    vote(p._id, idx, amt);
  }));
  $('#closeDetail').onclick = $('#closeDetail2').onclick = () => $('#detailModal').hidden = true;
}

function openNew(){
  if (!state.me) return;
  if (state.me.points < (state.me.createCost||20)){
    toast(`דרושות ${state.me.createCost||20} נקודות`, 'err'); return;
  }
  renderOptionsList(['','']);
  $('#modal').hidden = false;
  $('#f_title').focus();
}
function closeNew(){
  $('#modal').hidden = true;
  $('#pollForm').reset();
  $('#titleCount').textContent = '0/40';
  $('#formError').textContent = '';
  setType('binary');
  setLang('he');
}

function setType(t){
  $$('.type-btn').forEach(b => b.classList.toggle('active', b.dataset.type===t));
  $('#multiOptions').hidden = t !== 'multi';
  $('#pollForm').dataset.type = t;
}
function setLang(l){
  $$('.lang-btn').forEach(b => b.classList.toggle('active', b.dataset.lang===l));
  $('#pollForm').dataset.lang = l;
}

function renderOptionsList(values){
  const list = $('#optionsList');
  list.innerHTML = values.map((v,i) => `
    <div class="opt-row">
      <input data-i="${i}" maxlength="60" placeholder="אפשרות ${i+1}" value="${escapeHtml(v)}" />
      <button type="button" data-rm="${i}">✕</button>
    </div>
  `).join('');
  $$('button[data-rm]', list).forEach(b => b.addEventListener('click', () => {
    const i = parseInt(b.dataset.rm,10);
    const vals = getOptionValues();
    if (vals.length <= 2) { toast('מינימום 2 אפשרויות','err'); return; }
    vals.splice(i,1); renderOptionsList(vals);
  }));
}
function getOptionValues(){
  return $$('#optionsList input').map(i => i.value);
}

async function submitPoll(e){
  e.preventDefault();
  $('#formError').textContent = '';
  const title = $('#f_title').value.trim();
  if (!title) return ($('#formError').textContent = 'כותרת חסרה');
  if (title.length > 40) return ($('#formError').textContent = 'כותרת מקסימום 40 תווים');

  const type = $('#pollForm').dataset.type || 'binary';
  const body = {
    title,
    type,
  };
  if (type === 'multi'){
    body.options = getOptionValues().map(s=>s.trim()).filter(Boolean);
    if (body.options.length < 2) return ($('#formError').textContent = 'מינימום 2 אפשרויות');
  }
  $('#submitBtn').disabled = true;
  try{
    const r = await api('/polls', { method:'POST', body: JSON.stringify(body) });
    state.me.points = r.points;
    setPoints(r.points);
    closeNew();
    toast('הסקר נוצר!','ok');
    await loadPolls();
  }catch(err){ $('#formError').textContent = err.message; }
  finally{ $('#submitBtn').disabled = false; }
}

function wire(){
  $('#newPollBtn2').addEventListener('click', openNew);
  $('#closeModal').addEventListener('click', closeNew);
  $('#cancelBtn').addEventListener('click', closeNew);
  $('#modal').addEventListener('click', e => { if (e.target.id==='modal') closeNew(); });
  $('#detailModal').addEventListener('click', e => { if (e.target.id==='detailModal') $('#detailModal').hidden = true; });

  $('#pollForm').addEventListener('submit', submitPoll);
  $('#f_title').addEventListener('input', () => {
    const n = $('#f_title').value.length;
    $('#titleCount').textContent = n + '/40';
  });
  $$('.type-btn').forEach(b => b.addEventListener('click', ()=> setType(b.dataset.type)));
  $('#addOpt').addEventListener('click', () => {
    const v = getOptionValues();
    if (v.length >= 10) { toast('מקסימום 10 אפשרויות','err'); return; }
    v.push(''); renderOptionsList(v);
  });

  $$('.chip').forEach(c => c.addEventListener('click', () => {
    $$('.chip').forEach(x => x.classList.toggle('active', x===c));
    state.filter.sort = c.dataset.sort;
    loadPolls();
  }));
}

(async function init(){
  wire();
  try{
    await loadMe();
    await loadPolls();
    setInterval(loadMe, 60000);
  }catch(e){ toast('שגיאה בטעינה: ' + e.message, 'err'); }
})();
