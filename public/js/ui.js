// All DOM/UI handling: start screen, HUD, puzzle modal, shop, leaderboard,
// announcements, chat and touch controls. Talks to the game via callbacks.

import { HEROES, STAGES, SHOP_ITEMS } from '/shared/config.js';

const $ = sel => document.querySelector(sel);

export class UI {
  constructor() {
    this.selectedHero = HEROES[0].id;
    this.callbacks = {};
    this.currentOrbId = null;
  }

  on(name, fn) { this.callbacks[name] = fn; return this; }
  fire(name, ...args) { this.callbacks[name]?.(...args); }

  init() {
    this._buildHeroPicker();
    this._buildShop();
    this._bindStart();
    this._bindAccount();
    this._bindShopControls();
    this._bindPuzzle();
    this._bindChat();
    this._bindTouch();
  }

  _bindAccount() {
    const pin = $('#pin-input');
    pin.addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, ''); });
    $('#login-btn').onclick = () => this._authClick('login');
    $('#register-btn').onclick = () => this._authClick('register');
    $('#logout-btn').onclick = () => this.fire('logout');
  }

  _authClick(mode) {
    const name = $('#name-input').value.trim();
    const pinVal = $('#pin-input').value.trim();
    if (name.length < 2) { this.showStartError('Enter your hero name first.'); return; }
    if (!/^\d{4}$/.test(pinVal)) { this.showStartError('PIN must be exactly 4 digits.'); return; }
    this.showStartError('');
    this.fire('auth', { mode, name, pin: pinVal });
  }

  showLoggedIn(profile) {
    $('#account-loggedout').classList.add('hidden');
    $('#account-loggedin').classList.remove('hidden');
    $('#account-name').textContent = profile.username;
    $('#account-coins').textContent = profile.coins;
    $('#name-input').value = profile.username;
    $('#name-input').disabled = true;
  }

  showLoggedOut() {
    $('#account-loggedout').classList.remove('hidden');
    $('#account-loggedin').classList.add('hidden');
    $('#name-input').disabled = false;
    $('#pin-input').value = '';
  }

  // ---------- Start screen ----------
  _buildHeroPicker() {
    const wrap = $('#hero-pick');
    wrap.innerHTML = '';
    HEROES.forEach(h => {
      const el = document.createElement('div');
      el.className = 'hero-opt' + (h.id === this.selectedHero ? ' sel' : '');
      el.innerHTML = `<div class="hero-dot" style="background:${h.color}"></div>
        <div class="hname">${h.name.split(' ')[0]}</div><div class="hpow">${h.power}</div>`;
      el.onclick = () => {
        this.selectedHero = h.id;
        wrap.querySelectorAll('.hero-opt').forEach(o => o.classList.remove('sel'));
        el.classList.add('sel');
      };
      wrap.appendChild(el);
    });
  }

  _bindStart() {
    $('#create-btn').onclick = () => {
      const name = $('#name-input').value.trim() || 'Hero';
      this.fire('create', { name, hero: this.selectedHero });
    };
    $('#join-btn').onclick = () => {
      const name = $('#name-input').value.trim() || 'Hero';
      const code = $('#code-input').value.trim().toUpperCase();
      if (code.length !== 4) { this.showStartError('Enter the 4-letter room code.'); return; }
      this.fire('join', { name, hero: this.selectedHero, code });
    };
    $('#code-input').addEventListener('input', e => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });
  }

  showStartError(msg) { $('#start-error').textContent = msg; }

  hideStart() {
    $('#start-screen').classList.add('hidden');
    $('#hud').classList.remove('hidden');
    $('#chat').classList.remove('hidden');
    if ('ontouchstart' in window) $('#touch-controls').classList.remove('hidden');
  }

  // ---------- HUD ----------
  setRoom(code) {
    $('#hud-room').textContent = code;
    $('#copy-code').onclick = () => {
      navigator.clipboard?.writeText(code);
      $('#copy-code').textContent = '✓';
      setTimeout(() => $('#copy-code').textContent = '📋', 1200);
    };
  }

  setStage(stageIndex, points) {
    const stage = STAGES[stageIndex];
    $('#hud-stage').textContent = `${stageIndex + 1}. ${stage.name}`;
    $('#hud-target').textContent = stage.targetPoints;
    this.setPoints(points || 0, stage.targetPoints);
  }

  setPoints(points, target) {
    $('#hud-points').textContent = points;
    const pct = Math.min(100, (points / target) * 100);
    $('#hud-progress').style.width = pct + '%';
  }

  setCoins(n) { $('#hud-coins').textContent = n; $('#shop-coins').textContent = n; }

  setLeaderboard(list, myId) {
    const ol = $('#lb-list');
    ol.innerHTML = '';
    list.slice(0, 6).forEach(p => {
      const li = document.createElement('li');
      const tro = p.trophies ? ' '.repeat(0) + '🏆'.repeat(Math.min(p.trophies, 3)) : '';
      li.innerHTML = `${p.name} — ${p.totalScore}${tro}`;
      if (p.id === myId) li.className = 'me';
      ol.appendChild(li);
    });
  }

  announce(msg) {
    const el = $('#announce');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(this._annTimer);
    this._annTimer = setTimeout(() => el.classList.add('hidden'), 3500);
  }

  streak(n) {
    if (n < 2) return;
    const el = $('#streak-pop');
    el.textContent = `${n}× STREAK!`;
    el.classList.remove('hidden');
    // restart animation
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(this._streakTimer);
    this._streakTimer = setTimeout(() => el.classList.add('hidden'), 1000);
  }

  // ---------- Puzzle ----------
  _bindPuzzle() {
    $('#puzzle-close').onclick = () => this.closePuzzle();
  }

  openPuzzle(orbId, data) {
    this.currentOrbId = orbId;
    this.answered = false;
    $('#puzzle-skill').textContent = skillLabel(data.skill);
    $('#puzzle-question').textContent = data.question;
    $('#puzzle-feedback').textContent = '';
    $('#puzzle-feedback').className = 'puzzle-feedback';
    const wrap = $('#puzzle-choices');
    wrap.innerHTML = '';
    data.choices.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'choice-btn';
      b.textContent = c;
      if (data.hint && i === data.hintWrongIndex) b.classList.add('dim');
      b.onclick = () => {
        if (this.answered) return;
        this.fire('answer', { orbId, answer: c, button: b });
      };
      wrap.appendChild(b);
    });
    $('#puzzle-modal').classList.remove('hidden');
  }

  showAnswerResult(button, correct, correctAnswer) {
    this.answered = true;
    const fb = $('#puzzle-feedback');
    if (correct) {
      button.classList.add('correct');
      fb.textContent = '🎉 Correct! Great job!';
      fb.className = 'puzzle-feedback good';
      setTimeout(() => this.closePuzzle(), 850);
    } else {
      button.classList.add('wrong');
      fb.textContent = '🙈 Oops! Try the next one.';
      fb.className = 'puzzle-feedback bad';
      // allow retry on a different orb; close after a moment
      setTimeout(() => this.closePuzzle(), 1200);
    }
  }

  closePuzzle() {
    $('#puzzle-modal').classList.add('hidden');
    this.currentOrbId = null;
    this.fire('puzzleClosed');
  }

  get puzzleOpen() { return !$('#puzzle-modal').classList.contains('hidden'); }

  // ---------- Shop ----------
  _buildShop() {
    const types = ['color', 'cape', 'hat', 'trail', 'perk'];
    const labels = { color: '🎨 Colors', cape: '🦸 Capes', hat: '🎩 Hats', trail: '✨ Trails', perk: '⚡ Power-ups' };
    const tabs = $('#shop-tabs');
    tabs.innerHTML = '';
    this.shopTab = 'color';
    types.forEach(t => {
      const b = document.createElement('button');
      b.className = 'shop-tab' + (t === 'color' ? ' sel' : '');
      b.textContent = labels[t];
      b.onclick = () => {
        this.shopTab = t;
        tabs.querySelectorAll('.shop-tab').forEach(x => x.classList.remove('sel'));
        b.classList.add('sel');
        this.renderShop();
      };
      tabs.appendChild(b);
    });
  }

  setOwnership(cosmetics, perks, coins, owned) {
    this.cosmetics = cosmetics || {};
    this.perks = perks || [];
    this.owned = owned || this.owned || [];
    this.coins = coins ?? this.coins ?? 0;
    if (this.shopOpen) this.renderShop();
  }

  renderShop() {
    const grid = $('#shop-grid');
    grid.innerHTML = '';
    SHOP_ITEMS.filter(i => i.type === this.shopTab).forEach(item => {
      const el = document.createElement('div');
      el.className = 'shop-item';
      const swatch = item.type === 'color' || item.type === 'cape'
        ? `<div class="swatch" style="background:${item.value === 'rainbow' ? 'linear-gradient(45deg,red,orange,yellow,green,blue,violet)' : item.value}"></div>`
        : `<div class="swatch">${swatchEmoji(item)}</div>`;
      const owned = (this.owned || []).includes(item.id);
      const equipped = item.type !== 'perk' && this.cosmetics[item.type] === item.value;
      let btn;
      if (item.type === 'perk') {
        btn = owned ? `<button class="buy-btn owned" disabled>Owned ✓</button>`
                    : `<button class="buy-btn" data-id="${item.id}">🪙 ${item.cost}</button>`;
      } else if (equipped) {
        btn = `<button class="buy-btn equipped" disabled>Equipped ✓</button>`;
      } else if (owned) {
        btn = `<button class="buy-btn owned" data-id="${item.id}">Equip</button>`;
      } else {
        btn = `<button class="buy-btn" data-id="${item.id}">🪙 ${item.cost}</button>`;
      }
      el.innerHTML = `${swatch}<div class="iname">${item.name}</div>
        <div class="idesc">${item.desc || ''}</div>${btn}`;
      const buy = el.querySelector('.buy-btn[data-id]');
      if (buy) {
        if (this.coins < item.cost && !owned) buy.disabled = true;
        buy.onclick = () => this.fire('buy', { itemId: item.id });
      }
      grid.appendChild(el);
    });
  }

  _bindShopControls() {
    $('#shop-btn').onclick = () => this.toggleShop(true);
    $('#shop-x').onclick = () => this.toggleShop(false);
  }

  toggleShop(open) {
    this.shopOpen = open;
    $('#shop-modal').classList.toggle('hidden', !open);
    if (open) this.renderShop();
  }

  // ---------- Win screen ----------
  showWin(onContinue) {
    $('#win-screen').classList.remove('hidden');
    $('#win-continue').onclick = () => {
      $('#win-screen').classList.add('hidden');
      onContinue && onContinue();
    };
  }

  // ---------- Chat ----------
  _bindChat() {
    const input = $('#chat-input');
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && input.value.trim()) {
        this.fire('chat', { text: input.value.trim() });
        input.value = '';
        input.blur();
      }
    });
  }

  addChat(from, text) {
    const log = $('#chat-log');
    const d = document.createElement('div');
    d.textContent = `${from}: ${text}`;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    while (log.children.length > 30) log.removeChild(log.firstChild);
  }

  // ---------- Touch controls ----------
  _bindTouch() {
    const joy = $('#joystick'), stick = $('#stick');
    if (!joy) return;
    let active = false, cx = 0, cy = 0;
    const start = e => { active = true; const r = joy.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; move(e); };
    const move = e => {
      if (!active) return;
      const t = e.touches ? e.touches[0] : e;
      let dx = t.clientX - cx, dy = t.clientY - cy;
      const max = 45, d = Math.hypot(dx, dy);
      if (d > max) { dx *= max / d; dy *= max / d; }
      stick.style.transform = `translate(${dx}px,${dy}px)`;
      this.fire('touchmove', { x: dx / max, y: dy / max });
    };
    const end = () => { active = false; stick.style.transform = ''; this.fire('touchmove', { x: 0, y: 0 }); };
    joy.addEventListener('touchstart', start, { passive: true });
    joy.addEventListener('touchmove', move, { passive: true });
    joy.addEventListener('touchend', end);
    $('#jump-btn').addEventListener('touchstart', () => this.fire('touchjump'), { passive: true });
  }
}

function skillLabel(skill) {
  return { count: 'Counting', add: 'Addition', sub: 'Subtraction', mul: 'Multiply',
    div: 'Divide', pattern: 'Pattern', fraction: 'Fractions' }[skill] || 'Math';
}
function swatchEmoji(item) {
  if (item.type === 'hat') return { crown: '👑', wizard: '🧙', cap: '🧢' }[item.value] || '🎩';
  if (item.type === 'trail') return { stars: '⭐', fire: '🔥', hearts: '💖' }[item.value] || '✨';
  if (item.type === 'perk') return { hint: '💡', boost: '🪙' }[item.value] || '⚡';
  return '🎨';
}
