const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const {
  MONGO_URL = 'mongodb://mongo:27017/poly',
  PORT = 4000,
  BASE_POINTS = 1000000,
  VOTE_COST = 1,
  CREATE_COST = 20,
  MAX_TITLE_LEN = 40,
  ADMIN_TOKEN = 'change-me-please',
} = process.env;

const BASE = Number(BASE_POINTS);
const VCOST = Number(VOTE_COST);
const CCOST = Number(CREATE_COST);
const MAXLEN = Number(MAX_TITLE_LEN);

const app = express();
app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '64kb' }));

function getIp(req) {
  const xff = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || req.ip || req.connection.remoteAddress || 'unknown';
}

// Most recent Sunday 00:00 UTC. Weekly refill happens at Sunday morning UTC.
function currentWeekKey() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // Sunday = 0
  return d.toISOString().slice(0, 10);
}

const userSchema = new mongoose.Schema({
  ip: { type: String, unique: true, index: true },
  points: { type: Number, default: BASE },
  lastRefillWeek: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
});

const pollSchema = new mongoose.Schema({
  title: { type: String, required: true, maxlength: MAXLEN },
  description: { type: String, default: '', maxlength: 500 },
  type: { type: String, enum: ['binary', 'multi'], default: 'binary' },
  options: [{ label: String, votes: { type: Number, default: 0 } }],
  totalVotes: { type: Number, default: 0 },
  totalPoints: { type: Number, default: 0 },
  closesAt: { type: Date, default: null },
  creatorIp: String,
  language: { type: String, enum: ['he', 'en'], default: 'he' },
  createdAt: { type: Date, default: Date.now },
});
pollSchema.index({ createdAt: -1 });

const voteSchema = new mongoose.Schema({
  pollId: { type: mongoose.Schema.Types.ObjectId, index: true },
  ip: String,
  amount: Number, // points spent (== cost) for this vote
  at: { type: Date, default: Date.now, index: true },
});
voteSchema.index({ at: -1 });

const User = mongoose.model('User', userSchema);
const Poll = mongoose.model('Poll', pollSchema);
const Vote = mongoose.model('Vote', voteSchema);

async function getOrCreateUser(ip) {
  const week = currentWeekKey();
  let user = await User.findOne({ ip });
  if (!user) {
    user = await User.create({ ip, points: BASE, lastRefillWeek: week });
    return user;
  }
  if (user.lastRefillWeek !== week) {
    user.points = BASE; // weekly reset to base
    user.lastRefillWeek = week;
    await user.save();
  }
  return user;
}

app.get('/api/health', (_, res) => res.json({ ok: true }));

app.get('/api/me', async (req, res) => {
  const ip = getIp(req);
  const user = await getOrCreateUser(ip);
  res.json({
    ip,
    points: user.points,
    base: BASE,
    voteCost: VCOST,
    createCost: CCOST,
    maxTitle: MAXLEN,
  });
});

app.get('/api/polls', async (req, res) => {
  const { q, sort = 'new' } = req.query;
  const filter = {};
  if (q) filter.title = { $regex: String(q).slice(0, 60), $options: 'i' };

  if (sort === 'hot') {
    // Most points wagered in the last 60 seconds, descending. Polls with zero recent
    // activity are appended at the bottom ordered by newest.
    const since = new Date(Date.now() - 60 * 1000);
    const agg = await Vote.aggregate([
      { $match: { at: { $gte: since } } },
      { $group: { _id: '$pollId', recentPoints: { $sum: '$amount' } } },
      { $sort: { recentPoints: -1 } },
      { $limit: 200 },
    ]);
    const hotIds = agg.map(a => a._id);
    const hotMap = new Map(agg.map(a => [String(a._id), a.recentPoints]));
    const hotPolls = hotIds.length
      ? await Poll.find({ ...filter, _id: { $in: hotIds } }).lean()
      : [];
    hotPolls.sort((a, b) => (hotMap.get(String(b._id)) || 0) - (hotMap.get(String(a._id)) || 0));
    hotPolls.forEach(p => { p.recentPoints = hotMap.get(String(p._id)) || 0; });

    const remaining = 200 - hotPolls.length;
    let fillers = [];
    if (remaining > 0) {
      fillers = await Poll.find({ ...filter, _id: { $nin: hotIds } })
        .sort({ createdAt: -1 }).limit(remaining).lean();
      fillers.forEach(p => { p.recentPoints = 0; });
    }
    return res.json([...hotPolls, ...fillers]);
  }

  let sortObj = { createdAt: -1 };
  if (sort === 'rich') sortObj = { totalPoints: -1, createdAt: -1 };
  const polls = await Poll.find(filter).sort(sortObj).limit(200).lean();
  res.json(polls);
});

app.get('/api/polls/:id', async (req, res) => {
  try {
    const poll = await Poll.findById(req.params.id).lean();
    if (!poll) return res.status(404).json({ error: 'not found' });
    res.json(poll);
  } catch {
    res.status(400).json({ error: 'bad id' });
  }
});

app.post('/api/polls', async (req, res) => {
  const ip = getIp(req);
  const user = await getOrCreateUser(ip);
  if (user.points < CCOST) {
    return res.status(402).json({ error: `אין מספיק נקודות. דרושות ${CCOST}.` });
  }
  let { title, description = '', type = 'binary', options = [], closesAt = null, language = 'he' } = req.body || {};
  if (typeof title !== 'string') return res.status(400).json({ error: 'כותרת חסרה' });
  title = title.trim();
  if (!title) return res.status(400).json({ error: 'כותרת חסרה' });
  if (title.length > MAXLEN) return res.status(400).json({ error: `כותרת מקסימום ${MAXLEN} תווים` });
  if (!['binary', 'multi'].includes(type)) return res.status(400).json({ error: 'סוג לא תקין' });
  if (!['he', 'en'].includes(language)) language = 'he';

  let opts;
  if (type === 'binary') {
    opts = [
      { label: language === 'he' ? 'כן' : 'Yes', votes: 0 },
      { label: language === 'he' ? 'לא' : 'No', votes: 0 },
    ];
  } else {
    if (!Array.isArray(options) || options.length < 2 || options.length > 10) {
      return res.status(400).json({ error: 'בין 2 ל-10 אפשרויות' });
    }
    opts = options.map(o => ({ label: String(o).trim().slice(0, 60), votes: 0 })).filter(o => o.label);
    if (opts.length < 2) return res.status(400).json({ error: 'אפשרויות לא תקינות' });
  }

  if (closesAt) {
    const d = new Date(closesAt);
    if (isNaN(d.getTime()) || d.getTime() < Date.now()) closesAt = null; else closesAt = d;
  }

  user.points -= CCOST;
  await user.save();

  const poll = await Poll.create({
    title, description: String(description).slice(0, 500), type,
    options: opts, closesAt, creatorIp: ip, language,
  });
  res.json({ poll, points: user.points });
});

app.post('/api/polls/:id/vote', async (req, res) => {
  const ip = getIp(req);
  const { optionIndex, amount = 1 } = req.body || {};
  const amt = Math.max(1, Math.min(1000000, parseInt(amount, 10) || 1));
  const user = await getOrCreateUser(ip);
  const cost = amt * VCOST;
  if (user.points < cost) {
    return res.status(402).json({ error: `אין מספיק נקודות. דרושות ${cost}.` });
  }
  try {
    const poll = await Poll.findById(req.params.id);
    if (!poll) return res.status(404).json({ error: 'הסקר לא נמצא' });
    if (poll.closesAt && poll.closesAt.getTime() < Date.now()) {
      return res.status(400).json({ error: 'הסקר נסגר' });
    }
    const idx = parseInt(optionIndex, 10);
    if (isNaN(idx) || idx < 0 || idx >= poll.options.length) {
      return res.status(400).json({ error: 'אפשרות לא תקינה' });
    }
    poll.options[idx].votes += amt;
    poll.totalVotes += amt;
    poll.totalPoints += cost;
    await poll.save();
    await Vote.create({ pollId: poll._id, ip, amount: cost });
    user.points -= cost;
    await user.save();
    res.json({ poll: poll.toObject(), points: user.points });
  } catch (e) {
    res.status(400).json({ error: 'בקשה לא תקינה' });
  }
});

// ---------- Admin (token-protected) ----------
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token || token !== ADMIN_TOKEN) return res.status(401).json({ error: 'unauthorized' });
  next();
}

// POST /api/admin/credit  body: { ip, points, mode?: 'set'|'add' }
app.post('/api/admin/credit', requireAdmin, async (req, res) => {
  const { ip, points, mode = 'set' } = req.body || {};
  if (!ip || typeof points !== 'number') {
    return res.status(400).json({ error: 'body: { ip, points, mode? }' });
  }
  const week = currentWeekKey();
  let user = await User.findOne({ ip });
  if (!user) user = await User.create({ ip, points: 0, lastRefillWeek: week });
  if (mode === 'add') user.points += points;
  else user.points = points;
  user.lastRefillWeek = week; // prevent immediate weekly reset
  await user.save();
  res.json({ ip: user.ip, points: user.points });
});

app.get('/api/admin/users', requireAdmin, async (_, res) => {
  const users = await User.find().sort({ points: -1 }).limit(200).lean();
  res.json(users);
});

// DELETE /api/admin/polls  — wipes all polls and vote logs
app.delete('/api/admin/polls', requireAdmin, async (_, res) => {
  const pollsRes = await Poll.deleteMany({});
  const votesRes = await Vote.deleteMany({});
  res.json({ deletedPolls: pollsRes.deletedCount, deletedVotes: votesRes.deletedCount });
});

// GET /api/admin/polls — small admin UI in the browser
app.get('/api/admin/polls', (_, res) => {
  res.type('html').send(`<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<title>Keves Hakvasim · Admin</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root{
    --bg:#0b0f14; --card:#121821; --card-2:#0f1520; --border:#1f2937;
    --text:#e5e7eb; --muted:#94a3b8; --danger:#ef4444;
    --grad: linear-gradient(135deg,#8b5cf6 0%,#ec4899 50%,#f97316 100%);
  }
  *{ box-sizing:border-box }
  body{
    margin:0; min-height:100vh; background:var(--bg); color:var(--text);
    font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;
    display:flex; align-items:center; justify-content:center; padding:24px;
  }
  .card{
    width:min(520px, 100%); background:var(--card); border:1px solid var(--border);
    border-radius:20px; padding:28px; box-shadow:0 30px 80px rgba(0,0,0,.5);
  }
  h1{ margin:0 0 6px; font-size:22px }
  .sub{ color:var(--muted); font-size:13px; margin-bottom:22px }
  label{ display:block; margin:14px 0 6px; font-size:13px; font-weight:600; color:var(--muted) }
  input{
    width:100%; background:var(--card-2); color:var(--text);
    border:1px solid var(--border); border-radius:12px; padding:11px 14px;
    font-size:14px; outline:none; font-family:inherit;
  }
  input:focus{ border-color:#a78bfa }
  .row{ display:flex; gap:10px; align-items:center; margin-top:18px; flex-wrap:wrap }
  button{
    border:0; cursor:pointer; padding:11px 18px; border-radius:999px;
    font-weight:800; font-size:14px; font-family:inherit;
  }
  .btn-danger{
    background: linear-gradient(135deg,#ef4444 0%,#f97316 100%); color:#fff;
    box-shadow: 0 6px 18px rgba(239,68,68,.35);
  }
  .btn-ghost{ background:var(--card-2); color:var(--text); border:1px solid var(--border) }
  .btn-danger:disabled{ opacity:.5; cursor:not-allowed }
  .result{
    margin-top:18px; padding:12px 14px; border-radius:12px; font-size:14px;
    border:1px solid var(--border); background:var(--card-2); display:none;
  }
  .result.ok{ border-color:#16a34a; color:#86efac }
  .result.err{ border-color:#ef4444; color:#fca5a5 }
  .brand{
    display:flex; align-items:center; gap:12px; margin-bottom:18px;
  }
  .dot{
    width:38px; height:38px; border-radius:50%; background:var(--grad);
    display:flex; align-items:center; justify-content:center; font-size:22px;
  }
  code{ background:var(--card-2); padding:2px 6px; border-radius:6px; font-size:12px }
</style>
</head>
<body>
  <div class="card">
    <div class="brand">
      <div class="dot">🐑</div>
      <div>
        <h1>Keves Hakvasim · Admin</h1>
        <div class="sub">פאנל ניהול · מחיקת כל הסקרים</div>
      </div>
    </div>

    <label for="token">Admin Token</label>
    <input id="token" type="password" placeholder="X-Admin-Token" autocomplete="off" />

    <div class="row">
      <button class="btn-danger" id="del">מחק את כל הסקרים</button>
      <button class="btn-ghost" id="count">בדוק כמה סקרים קיימים</button>
    </div>

    <div class="result" id="result"></div>
  </div>

<script>
const $ = s => document.querySelector(s);
const tokenInput = $('#token');
const result = $('#result');

function show(msg, kind){
  result.style.display = 'block';
  result.className = 'result ' + (kind||'');
  result.textContent = msg;
}

$('#count').addEventListener('click', async () => {
  try{
    const r = await fetch('/api/polls?sort=new');
    const arr = await r.json();
    show('סקרים קיימים: ' + arr.length, 'ok');
  }catch(e){ show('שגיאה: ' + e.message, 'err'); }
});

$('#del').addEventListener('click', async () => {
  const t = tokenInput.value.trim();
  if (!t){ show('נדרש Admin Token', 'err'); tokenInput.focus(); return; }
  if (!confirm('למחוק את כל הסקרים? פעולה זו בלתי הפיכה.')) return;
  const btn = $('#del'); btn.disabled = true;
  try{
    const r = await fetch('/api/admin/polls', {
      method:'DELETE', headers:{ 'X-Admin-Token': t }
    });
    const data = await r.json();
    if (!r.ok){ show('שגיאה: ' + (data.error||r.status), 'err'); return; }
    show('נמחקו ' + data.deletedPolls + ' סקרים ו-' + data.deletedVotes + ' הצבעות.', 'ok');
  }catch(e){ show('שגיאה: ' + e.message, 'err'); }
  finally{ btn.disabled = false; }
});
</script>
</body>
</html>`);
});

async function start() {
  await mongoose.connect(MONGO_URL);
  console.log('Mongo connected');
  app.listen(PORT, () => console.log(`Backend on :${PORT} (weekly base=${BASE})`));
}
start().catch(e => { console.error(e); process.exit(1); });
