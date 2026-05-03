/* ============================================================
   SPACE JAY – Space Invaders-style game
   ============================================================ */

// ── Constants ────────────────────────────────────────────────
const SHIP_ROTATION_OFFSET = 0; // rotation baked into Ship.png — nose already faces up
const SHIP_W = 80;
const SHIP_H = 80;
const SHIP_SPEED = 6;

const BULLET_SPEED    = 12;
const BULLET_COOLDOWN = 250; // ms between player shots

const ENEMY_ROWS         = 4;
const ENEMY_COLS         = 10;
const ENEMY_W            = 44;
const ENEMY_H            = 36;
const ENEMY_PADDING      = 14;  // gap between enemies
const ENEMY_DROP         = 28;  // pixels dropped when hitting a wall
const ENEMY_BULLET_SPEED = 6;

const MAX_LIVES = 3;

// Points per row (row 0 = top)
const POINTS = [30, 20, 10, 10];

// Diving enemy bonus multiplier
const DIVE_BONUS = 2;

// Power-up types
const POWERUP_TYPES = ['rapidfire', 'doubleshot', 'shield', 'bomb', 'scoremult'];
const POWERUP_COLORS = {
  rapidfire:  '#00ffff',
  doubleshot: '#ffff00',
  shield:     '#00ff88',
  bomb:       '#ff4444',
  scoremult:  '#ffd700',
};
const POWERUP_ICONS = {
  rapidfire:  '⚡',
  doubleshot: '✦',
  shield:     '🛡',
  bomb:       '💥',
  scoremult:  '★',
};
const POWERUP_DURATION = {
  rapidfire:  8000,
  doubleshot: 8000,
  shield:     0,      // no timer — absorbs one hit
  bomb:       0,      // instant
  scoremult:  10000,
};

// Score multiplier per difficulty
const SCORE_MULTIPLIER = { easy: 1, medium: 2, hard: 3 };

// Difficulty presets
const DIFFICULTY = {
  easy:   { enemySpeed: 0.6, speedMult: 1.10, shootInterval: 2200 },
  medium: { enemySpeed: 1.0, speedMult: 1.25, shootInterval: 1600 },
  hard:   { enemySpeed: 1.6, speedMult: 1.40, shootInterval: 1000 },
};

// Enemy row colours
const ENEMY_COLORS = ['#ff4444', '#ff8844', '#44aaff', '#44aaff'];

// ── State ────────────────────────────────────────────────────
let canvas, ctx;
let gameRunning  = false;
let gamePaused   = false;
let animFrameId  = null;

const keys = {};

let score      = 0;
let hiScore    = parseInt(localStorage.getItem('space-jay-hi') || '0', 10);
let lives      = MAX_LIVES;
let wave       = 1;
let difficulty = 'medium';

// Player
const player = { x: 0, y: 0, w: SHIP_W, h: SHIP_H };

// Arrays
let bullets      = [];   // player bullets
let enemyBullets = [];
let enemies      = [];
let particles    = [];
let stars        = [];

// Enemy grid movement
let enemyDir   = 1;      // 1 = right, -1 = left
let enemyX     = 0;      // horizontal offset of the whole grid
let enemySpeed = 1.0;

// Shooting timers
let lastBulletTime  = 0;
let lastEnemyShot   = 0;
let shootInterval   = 1600;

// Wave message
let waveMsg     = '';
let waveMsgTime = 0;

// Animation frame counter for enemy flap cycles
let animFrame = 0;

// ── Diving enemies ───────────────────────────────────────────
let divingEnemies = [];   // enemies currently diving
let diveTimer     = 0;    // timestamp for next dive trigger
let diveInterval  = 0;    // random 8-12s interval

// ── Power-ups ────────────────────────────────────────────────
let powerUps      = [];   // { x, y, type, life } falling power-ups
let activePowerUps = {};  // { type: expiryTimestamp } for timed ones; 'shield'/'bomb' are instant

// ── Mystery ship ─────────────────────────────────────────────
let mysteryShip  = null;  // { x, y, dir, lightFrame } or null
let mysteryTimer = 0;     // timestamp for next mystery ship spawn
let mysteryDir   = 1;     // 1 = left-to-right, -1 = right-to-left (alternates)
let mysteryOsc   = null;  // Web Audio oscillator for warble tone
let mysteryOscGain = null;

// ── Floating score texts ─────────────────────────────────────
let floatingTexts = [];   // { x, y, text, life, decay }

// Invincibility after being hit
let invincible      = false;
let invincibleUntil = 0;
let flashTimer      = 0;

// Respawn state — ship is hidden during explosion, then fades in
const RESPAWN_DELAY    = 600;   // ms ship stays hidden while explosion plays
const INVINCIBLE_MS    = 1500;  // ms of immunity after respawn (1.5 s as requested)
let   respawning       = false; // true while waiting for respawn delay
let   respawnAt        = 0;     // timestamp when ship reappears
let   spawnAlpha       = 1;     // 0→1 fade-in on respawn (drawn in render)

// Large player explosion particles (separate from enemy particles)
let playerExplosion = []; // { x,y,vx,vy,life,decay,size,color,type }

// ── Ship image ───────────────────────────────────────────────
const shipImg = new Image();
shipImg.src   = 'Ship.png';
let shipImgLoaded = false;
shipImg.onload  = () => { shipImgLoaded = true; };
shipImg.onerror = () => { shipImgLoaded = false; };

// ── Audio Engine (Web Audio API) ─────────────────────────────
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

/** Short beep for player shoot */
function playShootSound() {
  try {
    const ac  = getAudioCtx();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, ac.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ac.currentTime + 0.08);
    gain.gain.setValueAtTime(0.18, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.1);
    osc.start(ac.currentTime);
    osc.stop(ac.currentTime + 0.1);
  } catch (_) {}
}

/** Noise burst for explosion */
function playExplosionSound() {
  try {
    const ac     = getAudioCtx();
    const bufLen = ac.sampleRate * 0.25;
    const buf    = ac.createBuffer(1, bufLen, ac.sampleRate);
    const data   = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
    const src  = ac.createBufferSource();
    src.buffer = buf;
    const gain = ac.createGain();
    src.connect(gain);
    gain.connect(ac.destination);
    gain.gain.setValueAtTime(0.35, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.25);
    src.start(ac.currentTime);
  } catch (_) {}
}

/** Lower beep for enemy shoot */
function playEnemyShootSound() {
  try {
    const ac  = getAudioCtx();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, ac.currentTime);
    osc.frequency.exponentialRampToValueAtTime(110, ac.currentTime + 0.12);
    gain.gain.setValueAtTime(0.12, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.14);
    osc.start(ac.currentTime);
    osc.stop(ac.currentTime + 0.14);
  } catch (_) {}
}

/** Wave-clear fanfare */
function playWaveClearSound() {
  try {
    const ac    = getAudioCtx();
    const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
    notes.forEach((freq, i) => {
      const osc  = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.type = 'triangle';
      const t = ac.currentTime + i * 0.12;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.22, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.start(t);
      osc.stop(t + 0.2);
    });
  } catch (_) {}
}

/** Dramatic layered explosion when player ship is hit */
function playHitSound() {
  try {
    const ac = getAudioCtx();
    const t  = ac.currentTime;

    // ── Layer 1: Deep bass thud (low sine, fast decay) ────────
    const bassOsc  = ac.createOscillator();
    const bassGain = ac.createGain();
    bassOsc.type = 'sine';
    bassOsc.frequency.setValueAtTime(80, t);
    bassOsc.frequency.exponentialRampToValueAtTime(25, t + 0.4);
    bassGain.gain.setValueAtTime(1.2, t);
    bassGain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    bassOsc.connect(bassGain);
    bassGain.connect(ac.destination);
    bassOsc.start(t);
    bassOsc.stop(t + 0.5);

    // ── Layer 2: Mid crunch (sawtooth distorted) ──────────────
    const crunchOsc  = ac.createOscillator();
    const crunchDist = ac.createWaveShaper();
    const crunchGain = ac.createGain();
    crunchOsc.type = 'sawtooth';
    crunchOsc.frequency.setValueAtTime(220, t);
    crunchOsc.frequency.exponentialRampToValueAtTime(40, t + 0.35);
    // Heavy distortion curve
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i * 2) / 256 - 1;
      curve[i] = (Math.PI + 300) * x / (Math.PI + 300 * Math.abs(x));
    }
    crunchDist.curve = curve;
    crunchGain.gain.setValueAtTime(0.6, t);
    crunchGain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    crunchOsc.connect(crunchDist);
    crunchDist.connect(crunchGain);
    crunchGain.connect(ac.destination);
    crunchOsc.start(t);
    crunchOsc.stop(t + 0.35);

    // ── Layer 3: White noise burst (debris/shrapnel) ──────────
    const bufLen  = Math.floor(ac.sampleRate * 0.6);
    const buf     = ac.createBuffer(1, bufLen, ac.sampleRate);
    const data    = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
    const noise     = ac.createBufferSource();
    const noiseFilter = ac.createBiquadFilter();
    const noiseGain = ac.createGain();
    noise.buffer    = buf;
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(1200, t);
    noiseFilter.frequency.exponentialRampToValueAtTime(300, t + 0.6);
    noiseFilter.Q.value = 0.8;
    noiseGain.gain.setValueAtTime(0.5, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ac.destination);
    noise.start(t);

    // ── Layer 4: Shockwave sub-rumble (very low, short) ───────
    const subOsc  = ac.createOscillator();
    const subGain = ac.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(45, t);
    subOsc.frequency.exponentialRampToValueAtTime(18, t + 0.25);
    subGain.gain.setValueAtTime(0.9, t);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    subOsc.connect(subGain);
    subGain.connect(ac.destination);
    subOsc.start(t);
    subOsc.stop(t + 0.25);

  } catch (_) {}
}

/** Short ascending chime when power-up collected (3 quick beeps) */
function playPowerUpSound() {
  try {
    const ac    = getAudioCtx();
    const notes = [660, 880, 1100];
    notes.forEach((freq, i) => {
      const osc  = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.type = 'sine';
      const t = ac.currentTime + i * 0.07;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.20, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.10);
      osc.start(t);
      osc.stop(t + 0.12);
    });
  } catch (_) {}
}

/** Start continuous warbling tone for mystery ship */
function startMysterySound() {
  try {
    const ac  = getAudioCtx();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, ac.currentTime);
    gain.gain.setValueAtTime(0.10, ac.currentTime);
    osc.start(ac.currentTime);
    mysteryOsc     = osc;
    mysteryOscGain = gain;
  } catch (_) {}
}

/** Stop mystery ship warble */
function stopMysterySound() {
  try {
    if (mysteryOscGain) {
      mysteryOscGain.gain.exponentialRampToValueAtTime(0.001, getAudioCtx().currentTime + 0.1);
    }
    if (mysteryOsc) {
      mysteryOsc.stop(getAudioCtx().currentTime + 0.12);
      mysteryOsc     = null;
      mysteryOscGain = null;
    }
  } catch (_) {}
}

/** Descending whistle + explosion for mystery ship hit */
function playMysteryHitSound() {
  try {
    const ac = getAudioCtx();
    const t  = ac.currentTime;
    const osc  = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, t);
    osc.frequency.exponentialRampToValueAtTime(200, t + 0.35);
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    osc.start(t);
    osc.stop(t + 0.4);
    // noise burst
    const bufLen = Math.floor(ac.sampleRate * 0.3);
    const buf    = ac.createBuffer(1, bufLen, ac.sampleRate);
    const data   = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
    const src  = ac.createBufferSource();
    src.buffer = buf;
    const ng   = ac.createGain();
    src.connect(ng);
    ng.connect(ac.destination);
    ng.gain.setValueAtTime(0.3, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    src.start(t);
  } catch (_) {}
}

// ── Supabase leaderboard ─────────────────────────────────────
const SUPABASE_URL = 'https://waqephjzfgdtfmugbobo.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndhcWVwaGp6ZmdkdGZtdWdib2JvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4MzM4NjIsImV4cCI6MjA5MzQwOTg2Mn0.1or5dsYAEgMjSnfGA0oWRgzhKkhLC5bK-Ygkl8lGiZA';
const LB_TABLE    = 'high_scores';
const LB_LIMIT    = 10;

// Cached last-submitted player name
let playerName = localStorage.getItem('space-jay-name') || '';

async function lbFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation',
      ...options.headers,
    },
    ...options,
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return res.json();
}

/** Fetch top-10 scores and render into the menu leaderboard panel */
async function loadLeaderboard() {
  const listEl = document.getElementById('lb-list');
  if (!listEl) return;
  listEl.innerHTML = '<div class="lb-loading">Loading…</div>';
  try {
    const rows = await lbFetch(
      `${LB_TABLE}?select=player,score,wave&order=score.desc&limit=${LB_LIMIT}`
    );
    if (!rows.length) {
      listEl.innerHTML = '<div class="lb-loading">No scores yet — be the first!</div>';
      return;
    }
    listEl.innerHTML = rows.map((r, i) => {
      const isTop  = i < 3;
      const isMine = r.player.toUpperCase() === playerName.toUpperCase() && playerName;
      const medal  = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      return `<div class="lb-row${isTop ? ' lb-top' : ''}${isMine ? ' lb-mine' : ''}">
        <span class="lb-rank">${medal}</span>
        <span class="lb-name">${escapeHtml(r.player)}</span>
        <span class="lb-score">${r.score.toLocaleString()}</span>
        <span class="lb-wave">W${r.wave}</span>
      </div>`;
    }).join('');
  } catch (e) {
    listEl.innerHTML = '<div class="lb-loading">Scores unavailable</div>';
  }
}

/** Submit a score to Supabase */
async function submitScore(name, scoreVal, waveVal) {
  await lbFetch(LB_TABLE, {
    method: 'POST',
    body: JSON.stringify({ player: name.trim().toUpperCase(), score: scoreVal, wave: waveVal }),
  });
}

/** Check if a score qualifies for the top-10 leaderboard */
async function checkQualifies(scoreVal) {
  try {
    const rows = await lbFetch(
      `${LB_TABLE}?select=score&order=score.desc&limit=${LB_LIMIT}`
    );
    if (rows.length < LB_LIMIT) return true;          // board not full yet
    return scoreVal > rows[rows.length - 1].score;    // beats the lowest score
  } catch (_) {
    return true; // if we can't check, allow submission
  }
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
  );
}
function buildStars() {
  stars = [];
  for (let i = 0; i < 120; i++) {
    stars.push({
      x:          Math.random() * (canvas.width  || 800),
      y:          Math.random() * (canvas.height || 600),
      speed:      0.3 + Math.random() * 1.2,
      size:       0.5 + Math.random() * 1.5,
      brightness: 0.4 + Math.random() * 0.6,
    });
  }
}

function updateStars() {
  for (const s of stars) {
    s.y += s.speed;
    if (s.y > canvas.height) {
      s.y = 0;
      s.x = Math.random() * canvas.width;
    }
  }
}

function drawStars() {
  for (const s of stars) {
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${s.brightness})`;
    ctx.fill();
  }
}

// ── Enemy grid ───────────────────────────────────────────────
function buildEnemies() {
  enemies = [];
  const totalW = ENEMY_COLS * (ENEMY_W + ENEMY_PADDING) - ENEMY_PADDING;
  const startX = (canvas.width - totalW) / 2;
  const startY = 100;

  for (let row = 0; row < ENEMY_ROWS; row++) {
    for (let col = 0; col < ENEMY_COLS; col++) {
      enemies.push({
        x:     startX + col * (ENEMY_W + ENEMY_PADDING),
        y:     startY + row * (ENEMY_H + ENEMY_PADDING),
        baseX: startX + col * (ENEMY_W + ENEMY_PADDING), // original X for offset calc
        w:     ENEMY_W,
        h:     ENEMY_H,
        row,
        col,
        alive: true,
        color: ENEMY_COLORS[row],
      });
    }
  }

  enemyDir = 1;
  enemyX   = 0;
}

// ── Particles ────────────────────────────────────────────────
function spawnParticles(x, y, color) {
  const count = 8 + Math.floor(Math.random() * 5);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.5 + Math.random() * 3.5;
    particles.push({
      x,
      y,
      vx:      Math.cos(angle) * speed,
      vy:      Math.sin(angle) * speed,
      life:    1.0,
      decay:   1 / (0.6 * 60), // fade over ~0.6 s at 60 fps
      size:    2 + Math.random() * 3,
      color,
    });
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x    += p.vx;
    p.y    += p.vy;
    p.life -= p.decay;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ── HUD helpers ──────────────────────────────────────────────
function updateHUD() {
  document.getElementById('hud-score').textContent = score;
  document.getElementById('hud-wave').textContent  = wave;
  document.getElementById('hud-hi').textContent    = hiScore;

  // Show active score multiplier in the wave display
  const mult = SCORE_MULTIPLIER[difficulty] || 1;
  if (mult > 1) {
    document.getElementById('hud-wave').textContent = `${wave}  ×${mult}`;
  }

  const msgEl = document.getElementById('hud-msg');
  if (waveMsg && Date.now() < waveMsgTime) {
    msgEl.textContent = waveMsg;
  } else {
    msgEl.textContent = '';
    waveMsg = '';
  }
}

function showWaveMessage(msg, duration = 2000) {
  waveMsg     = msg;
  waveMsgTime = Date.now() + duration;
}

// ── Screen management ────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

async function showGameOver(won) {
  cancelAnimationFrame(animFrameId);
  gameRunning = false;

  showCursorBriefly();
  clearTimeout(cursorHideTimer);

  if (score > hiScore) {
    hiScore = score;
    localStorage.setItem('space-jay-hi', hiScore);
  }

  document.getElementById('finish-title').textContent = won ? '🎉 YOU WIN!' : 'GAME OVER';
  document.getElementById('finish-stats').innerHTML =
    `Score: <span class="highlight">${score.toLocaleString()}</span><br>` +
    `Wave Reached: <span class="highlight">${wave}</span><br>` +
    `Hi-Score: <span class="highlight">${hiScore.toLocaleString()}</span>`;

  // Reset submission UI
  document.getElementById('name-entry').style.display    = 'none';
  document.getElementById('score-submitted').style.display = 'none';
  document.getElementById('finish-rank').textContent     = '';

  showScreen('finish-screen');

  // Check if score qualifies for global leaderboard
  if (score > 0) {
    try {
      const qualifies = await checkQualifies(score);
      if (qualifies) {
        const nameEl = document.getElementById('player-name');
        nameEl.value = playerName;
        document.getElementById('name-entry-label').textContent =
          won ? '🏆 You cleared all waves! Enter your name:'
              : '🏆 You made the leaderboard! Enter your name:';
        document.getElementById('name-entry').style.display = 'flex';
        nameEl.focus();
      } else {
        // Show their rank even if not top-10
        const rows = await lbFetch(
          `${LB_TABLE}?select=score&order=score.desc`
        );
        const rank = rows.filter(r => r.score > score).length + 1;
        document.getElementById('finish-rank').innerHTML =
          `Global rank: <span class="highlight">#${rank}</span>`;
      }
    } catch (_) {}
  }
}

function quitGame() {
  // Tell the local server to shut itself down (kills server + terminal)
  fetch('http://localhost:8765/quit').catch(() => {});
  // Give the fetch a moment to fire, then close the browser window
  setTimeout(() => {
    window.close();
    // If window.close() is blocked (opened by user, not script), show overlay
    setTimeout(() => {
      document.getElementById('quit-overlay').style.display = 'flex';
    }, 400);
  }, 300);
}

// ── Game initialisation ──────────────────────────────────────
function initGame() {
  canvas = document.getElementById('game-canvas');
  ctx    = canvas.getContext('2d');

  // Size canvas to window
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  const cfg = DIFFICULTY[difficulty] || DIFFICULTY.medium;
  enemySpeed   = cfg.enemySpeed;
  shootInterval = cfg.shootInterval;

  score  = 0;
  lives  = MAX_LIVES;
  wave   = 1;
  bullets      = [];
  enemyBullets = [];
  particles    = [];

  player.x = canvas.width  / 2;
  player.y = canvas.height - 80;

  buildStars();
  buildEnemies();

  invincible      = false;
  invincibleUntil = 0;
  flashTimer      = 0;
  respawning      = false;
  respawnAt       = 0;
  spawnAlpha      = 1;
  playerExplosion = [];
  lastBulletTime  = 0;
  lastEnemyShot   = 0;

  // New feature state
  divingEnemies  = [];
  diveTimer      = Date.now() + 8000 + Math.random() * 4000;
  diveInterval   = 8000 + Math.random() * 4000;
  powerUps       = [];
  activePowerUps = {};
  mysteryShip    = null;
  mysteryTimer   = Date.now() + 30000 + Math.random() * 15000;
  mysteryDir     = 1;
  floatingTexts  = [];
  stopMysterySound();

  showWaveMessage(`WAVE ${wave}`);
  updateHUD();
}

// ── Main game loop ───────────────────────────────────────────
function gameLoop(timestamp) {
  if (!gameRunning) return;
  if (!gamePaused) {
    update(timestamp);
    render();
  }
  animFrameId = requestAnimationFrame(gameLoop);
}

// ── Update ───────────────────────────────────────────────────
function update(timestamp) {
  // ── Player movement (blocked while respawning)
  if (!respawning) {
    if (keys['ArrowLeft'] || keys['a'] || keys['A']) {
      player.x = Math.max(player.w / 2, player.x - SHIP_SPEED);
    }
    if (keys['ArrowRight'] || keys['d'] || keys['D']) {
      player.x = Math.min(canvas.width - player.w / 2, player.x + SHIP_SPEED);
    }
  }

  // ── Player shoot (blocked while respawning or invincible-just-spawned blink)
  const effectiveCooldown = activePowerUps['rapidfire'] && Date.now() < activePowerUps['rapidfire']
    ? 125 : BULLET_COOLDOWN;
  if (!respawning && keys[' '] && timestamp - lastBulletTime > effectiveCooldown) {
    if (activePowerUps['doubleshot'] && Date.now() < activePowerUps['doubleshot']) {
      bullets.push({ x: player.x - 8, y: player.y - player.h / 2, w: 4, h: 16 });
      bullets.push({ x: player.x + 8, y: player.y - player.h / 2, w: 4, h: 16 });
    } else {
      bullets.push({ x: player.x, y: player.y - player.h / 2, w: 4, h: 16 });
    }
    lastBulletTime = timestamp;
    playShootSound();
  }

  // ── Move player bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
    bullets[i].y -= BULLET_SPEED;
    if (bullets[i].y < -20) bullets.splice(i, 1);
  }

  // ── Move enemy grid
  let hitWall = false;
  const wallPad = 20;

  // Apply offset to all alive enemies
  for (const e of enemies) {
    if (e.alive) e.x = e.baseX + enemyX;
  }

  // Check wall collision
  const aliveEnemies = enemies.filter(e => e.alive);
  if (aliveEnemies.length === 0) {
    // Wave cleared – handled below
  } else {
    const leftmost  = Math.min(...aliveEnemies.map(e => e.x));
    const rightmost = Math.max(...aliveEnemies.map(e => e.x + e.w));

    if (rightmost >= canvas.width - wallPad && enemyDir === 1) {
      hitWall = true;
    } else if (leftmost <= wallPad && enemyDir === -1) {
      hitWall = true;
    }
  }

  if (hitWall) {
    enemyDir *= -1;
    for (const e of enemies) {
      if (e.alive) {
        e.y      += ENEMY_DROP;
        e.baseX  += 0; // baseX stays; y shift is permanent
      }
    }
  } else {
    enemyX += enemySpeed * enemyDir;
  }

  // ── Enemy shooting (use fresh alive list in case bullets just killed some)
  const shootCandidates = enemies.filter(e => e.alive);
  if (timestamp - lastEnemyShot > shootInterval && shootCandidates.length > 0) {
    const shooter = shootCandidates[Math.floor(Math.random() * shootCandidates.length)];
    enemyBullets.push({
      x: shooter.x + shooter.w / 2,
      y: shooter.y + shooter.h,
      w: 6,
      h: 14,
    });
    lastEnemyShot = timestamp;
    playEnemyShootSound();
  }

  // ── Move enemy bullets
  for (let i = enemyBullets.length - 1; i >= 0; i--) {
    const b = enemyBullets[i];
    if (b.vx !== undefined) {
      b.x += b.vx;
      b.y += b.vy;
    } else {
      b.y += ENEMY_BULLET_SPEED;
    }
    if (b.y > canvas.height + 20 || b.x < -20 || b.x > canvas.width + 20) {
      enemyBullets.splice(i, 1);
    }
  }

  // ── Collision: player bullets vs enemies
  for (let bi = bullets.length - 1; bi >= 0; bi--) {
    const b = bullets[bi];
    for (const e of enemies) {
      if (!e.alive) continue;
      if (b.x > e.x && b.x < e.x + e.w && b.y > e.y && b.y < e.y + e.h) {
        e.alive = false;
        bullets.splice(bi, 1);
        score += (POINTS[e.row] || 10) * (SCORE_MULTIPLIER[difficulty] || 1) *
                 (activePowerUps['scoremult'] && Date.now() < activePowerUps['scoremult'] ? 2 : 1);
        spawnParticles(e.x + e.w / 2, e.y + e.h / 2, e.color);
        playExplosionSound();
        // 15% chance to spawn a power-up
        if (Math.random() < 0.15) {
          const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
          powerUps.push({ x: e.x + e.w / 2, y: e.y + e.h / 2, type });
        }
        break;
      }
    }
  }

  // ── Collision: player bullets vs diving enemies
  for (let bi = bullets.length - 1; bi >= 0; bi--) {
    const b = bullets[bi];
    for (let di = divingEnemies.length - 1; di >= 0; di--) {
      const de = divingEnemies[di];
      const hw = de.w / 2;
      const hh = de.h / 2;
      if (b.x > de.x - hw && b.x < de.x + hw && b.y > de.y - hh && b.y < de.y + hh) {
        bullets.splice(bi, 1);
        const pts = (POINTS[de.row] || 10) * DIVE_BONUS * (SCORE_MULTIPLIER[difficulty] || 1) *
                    (activePowerUps['scoremult'] && Date.now() < activePowerUps['scoremult'] ? 2 : 1);
        score += pts;
        floatingTexts.push({ x: de.x, y: de.y, text: `+${pts}`, life: 1.0, decay: 1 / 90 });
        spawnParticles(de.x, de.y, de.color);
        playExplosionSound();
        divingEnemies.splice(di, 1);
        break;
      }
    }
  }

  // ── Collision: player bullets vs mystery ship
  if (mysteryShip) {
    for (let bi = bullets.length - 1; bi >= 0; bi--) {
      const b = bullets[bi];
      if (b.x > mysteryShip.x - 40 && b.x < mysteryShip.x + 40 &&
          b.y > mysteryShip.y - 16 && b.y < mysteryShip.y + 16) {
        bullets.splice(bi, 1);
        const bonusOptions = [100, 200, 300, 500];
        const bonus = bonusOptions[Math.floor(Math.random() * bonusOptions.length)] *
                      (SCORE_MULTIPLIER[difficulty] || 1);
        score += bonus;
        floatingTexts.push({ x: mysteryShip.x, y: mysteryShip.y, text: `+${bonus}`, life: 1.0, decay: 1 / 90 });
        spawnParticles(mysteryShip.x, mysteryShip.y, '#00ffff');
        stopMysterySound();
        playMysteryHitSound();
        mysteryShip  = null;
        mysteryTimer = Date.now() + 30000 + Math.random() * 15000;
        break;
      }
    }
  }

  // ── Collision: enemy bullets vs player
  if (!invincible && !respawning) {
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const b  = enemyBullets[i];
      const hw = player.w * 0.35;
      const hh = player.h * 0.35;
      if (
        b.x > player.x - hw && b.x < player.x + hw &&
        b.y > player.y - hh && b.y < player.y + hh
      ) {
        enemyBullets.splice(i, 1);

        // Shield absorbs the hit
        if (activePowerUps['shield']) {
          delete activePowerUps['shield'];
          spawnParticles(player.x, player.y, '#00ff88');
          break;
        }

        lives--;
        playHitSound();
        spawnPlayerExplosion(player.x, player.y);

        if (lives <= 0) {
          // Final life — let explosion play briefly then game over
          respawning = true;
          respawnAt  = timestamp + RESPAWN_DELAY;
          setTimeout(() => showGameOver(false), RESPAWN_DELAY);
          return;
        }

        // Still have lives — hide ship, play explosion, then respawn
        respawning      = true;
        respawnAt       = timestamp + RESPAWN_DELAY;
        invincible      = false;
        invincibleUntil = 0;
        bullets         = [];   // clear player bullets on death
        break;
      }
    }
  }

  // ── Respawn: once delay has passed, make ship reappear with immunity
  if (respawning && timestamp >= respawnAt && lives > 0) {
    respawning      = false;
    spawnAlpha      = 0;          // start invisible, fade in
    invincible      = true;
    invincibleUntil = timestamp + INVINCIBLE_MS;
    flashTimer      = timestamp;
    player.x        = canvas.width / 2;  // re-centre ship
  }

  // ── Invincibility expiry
  if (invincible && timestamp > invincibleUntil) {
    invincible = false;
  }

  // ── Respawn fade-in
  if (!respawning && spawnAlpha < 1) {
    spawnAlpha = Math.min(1, spawnAlpha + 0.04); // ~25 frames to fully appear
  }

  // ── Player explosion particles
  updatePlayerExplosion();
  for (const e of enemies) {
    if (e.alive && e.y + e.h > canvas.height - 80) {
      showGameOver(false);
      return;
    }
  }

  // ── Wave clear (re-check after bullet collisions may have killed enemies)
  if (enemies.filter(e => e.alive).length === 0 && divingEnemies.length === 0) {
    playWaveClearSound();
    wave++;
    const cfg = DIFFICULTY[difficulty] || DIFFICULTY.medium;
    enemySpeed    = cfg.enemySpeed * Math.pow(cfg.speedMult, wave - 1);
    shootInterval = Math.max(400, cfg.shootInterval * Math.pow(0.88, wave - 1));
    bullets      = [];
    enemyBullets = [];
    divingEnemies = [];
    diveTimer    = Date.now() + 8000 + Math.random() * 4000;
    buildEnemies();
    showWaveMessage(`WAVE ${wave}`);
  }

  // ── Diving enemies
  if (wave >= 2 && divingEnemies.length < 2 && Date.now() >= diveTimer) {
    // Pick a random alive enemy from row 0, fallback to row 1
    let candidates = enemies.filter(e => e.alive && e.row === 0);
    if (candidates.length === 0) candidates = enemies.filter(e => e.alive && e.row === 1);
    if (candidates.length > 0) {
      const chosen = candidates[Math.floor(Math.random() * candidates.length)];
      chosen.alive = false; // remove from grid
      divingEnemies.push({
        x:       chosen.x + chosen.w / 2,
        y:       chosen.y + chosen.h / 2,
        baseX:   chosen.x + chosen.w / 2,
        baseY:   chosen.y + chosen.h / 2,
        w:       chosen.w,
        h:       chosen.h,
        row:     chosen.row,
        color:   chosen.color,
        t:       0,          // bezier parameter 0→1
        hasFired: false,
        shotsFired: 0,
      });
    }
    diveTimer = Date.now() + 8000 + Math.random() * 4000;
  }

  for (let di = divingEnemies.length - 1; di >= 0; di--) {
    const de = divingEnemies[di];
    de.t += 0.008; // speed of dive

    // Bezier control points: start at baseX/baseY, swoop toward player X, exit bottom
    const p0x = de.baseX;
    const p0y = de.baseY;
    const p1x = player.x;
    const p1y = canvas.height * 0.55;
    const p2x = player.x + (Math.random() < 0.5 ? -80 : 80);
    const p2y = canvas.height + 60;

    const t = Math.min(de.t, 1);
    const mt = 1 - t;
    de.x = mt * mt * p0x + 2 * mt * t * p1x + t * t * p2x;
    de.y = mt * mt * p0y + 2 * mt * t * p1y + t * t * p2y;

    // Fire 1-2 bullets mid-dive
    if (!de.hasFired && de.t > 0.35 && de.shotsFired < 2) {
      const dx = player.x - de.x;
      const dy = player.y - de.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      enemyBullets.push({
        x: de.x,
        y: de.y,
        w: 6,
        h: 14,
        vx: (dx / dist) * ENEMY_BULLET_SPEED,
        vy: (dy / dist) * ENEMY_BULLET_SPEED,
      });
      de.shotsFired++;
      if (de.shotsFired >= 2) de.hasFired = true;
      playEnemyShootSound();
    }

    // Remove when off-screen
    if (de.y > canvas.height + 80) {
      divingEnemies.splice(di, 1);
    }
  }

  // ── Power-ups: move and collect
  for (let i = powerUps.length - 1; i >= 0; i--) {
    const pu = powerUps[i];
    pu.y += 1.5;
    if (pu.y > canvas.height + 30) {
      powerUps.splice(i, 1);
      continue;
    }
    // Check player overlap (30px radius)
    const dx = pu.x - player.x;
    const dy = pu.y - player.y;
    if (!respawning && Math.sqrt(dx * dx + dy * dy) < 30) {
      // Collect
      if (pu.type === 'bomb') {
        // Instantly kill all non-diving enemies
        for (const e of enemies) {
          if (e.alive) {
            score += (POINTS[e.row] || 10) * (SCORE_MULTIPLIER[difficulty] || 1) *
                     (activePowerUps['scoremult'] && Date.now() < activePowerUps['scoremult'] ? 2 : 1);
            spawnParticles(e.x + e.w / 2, e.y + e.h / 2, e.color);
            e.alive = false;
          }
        }
        playExplosionSound();
      } else if (pu.type === 'shield') {
        activePowerUps['shield'] = true;
      } else {
        activePowerUps[pu.type] = Date.now() + POWERUP_DURATION[pu.type];
      }
      playPowerUpSound();
      powerUps.splice(i, 1);
    }
  }

  // ── Mystery ship
  if (!mysteryShip && Date.now() >= mysteryTimer) {
    const dir = mysteryDir;
    mysteryShip = {
      x:          dir === 1 ? -50 : canvas.width + 50,
      y:          55,
      dir,
      lightFrame: 0,
    };
    mysteryDir = -mysteryDir; // alternate direction next time
    startMysterySound();
  }

  if (mysteryShip) {
    mysteryShip.x += mysteryShip.dir * 2.5;
    mysteryShip.lightFrame++;

    // Warble pitch
    if (mysteryOsc) {
      try {
        const wobble = 440 + 80 * Math.sin(Date.now() / 120);
        mysteryOsc.frequency.setValueAtTime(wobble, getAudioCtx().currentTime);
      } catch (_) {}
    }

    // Off-screen exit
    if ((mysteryShip.dir === 1 && mysteryShip.x > canvas.width + 60) ||
        (mysteryShip.dir === -1 && mysteryShip.x < -60)) {
      stopMysterySound();
      mysteryShip  = null;
      mysteryTimer = Date.now() + 30000 + Math.random() * 15000;
    }
  }

  // ── Floating texts
  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    const ft = floatingTexts[i];
    ft.y    -= 0.8;
    ft.life -= ft.decay;
    if (ft.life <= 0) floatingTexts.splice(i, 1);
  }

  // ── Particles
  updateParticles();

  // ── Stars
  updateStars();

  // ── Animation frame counter (enemy flap)
  animFrame++;

  // ── HUD
  updateHUD();
}

// ── Render ───────────────────────────────────────────────────
function render() {
  // Background
  ctx.fillStyle = '#000010';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Stars
  drawStars();

  // Mystery ship (above stars, below enemies)
  if (mysteryShip) {
    drawMysteryShip(mysteryShip);
  }

  // Enemies
  for (const e of enemies) {
    if (!e.alive) continue;
    const flap = Math.floor(animFrame / 28) % 2; // 0 or 1, toggles every 28 frames
    const cx   = e.x + e.w / 2;
    const cy   = e.y + e.h / 2;

    ctx.save();
    ctx.shadowColor = e.color;
    ctx.shadowBlur  = 14;

    if (e.row === 0) {
      drawCommander(cx, cy, e.w, e.h, e.color, flap);
    } else if (e.row === 1) {
      drawSoldier(cx, cy, e.w, e.h, e.color, flap);
    } else {
      drawDrone(cx, cy, e.w, e.h, e.color, flap);
    }

    ctx.restore();
  }
  ctx.shadowBlur = 0;

  // Diving enemies (drawn independently, brighter/larger)
  for (const de of divingEnemies) {
    ctx.save();
    ctx.shadowColor = de.color;
    ctx.shadowBlur  = 24;
    ctx.translate(de.x, de.y);
    ctx.scale(1.2, 1.2);
    ctx.translate(-de.x, -de.y);
    const flap = Math.floor(animFrame / 14) % 2; // faster flap while diving
    if (de.row === 0) {
      drawCommander(de.x, de.y, de.w, de.h, de.color, flap);
    } else if (de.row === 1) {
      drawSoldier(de.x, de.y, de.w, de.h, de.color, flap);
    } else {
      drawDrone(de.x, de.y, de.w, de.h, de.color, flap);
    }
    ctx.restore();
  }
  ctx.shadowBlur = 0;

  // Enemy bullets (red ovals)
  ctx.fillStyle = '#ff3333';
  for (const b of enemyBullets) {
    ctx.beginPath();
    ctx.ellipse(b.x, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Player bullets (bright yellow rounded rects)
  ctx.shadowColor = '#ffff44';
  ctx.shadowBlur  = 8;
  ctx.fillStyle   = '#ffff88';
  for (const b of bullets) {
    ctx.beginPath();
    roundRect(ctx, b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  // Power-ups (above enemies)
  for (const pu of powerUps) {
    const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 200);
    ctx.save();
    ctx.shadowColor = POWERUP_COLORS[pu.type];
    ctx.shadowBlur  = 16 * pulse;
    ctx.fillStyle   = POWERUP_COLORS[pu.type];
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(pu.x, pu.y, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.shadowBlur  = 0;
    ctx.font        = '14px Arial';
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(POWERUP_ICONS[pu.type], pu.x, pu.y);
    ctx.restore();
  }

  // Player ship (hidden while respawning, fades in on respawn, blinks during immunity)
  if (!respawning) {
    const blinking   = invincible && Math.floor((Date.now() - flashTimer) / 100) % 2 === 0;
    const shipOpacity = blinking ? 0.35 : spawnAlpha;
    ctx.globalAlpha  = shipOpacity;
    // Cyan shield ring during invincibility
    if (invincible) {
      const ringPulse = 0.4 + 0.3 * Math.sin(Date.now() / 80);
      ctx.save();
      ctx.globalAlpha  = ringPulse * spawnAlpha;
      ctx.strokeStyle  = '#44eeff';
      ctx.lineWidth    = 3;
      ctx.shadowColor  = '#44eeff';
      ctx.shadowBlur   = 18;
      ctx.beginPath();
      ctx.arc(player.x, player.y, player.w * 0.65, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();
    }
    // Green shield power-up ring
    if (activePowerUps['shield']) {
      const shieldPulse = 0.5 + 0.5 * Math.abs(Math.sin(Date.now() / 150));
      ctx.save();
      ctx.globalAlpha = shieldPulse;
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth   = 4;
      ctx.shadowColor = '#00ff88';
      ctx.shadowBlur  = 22;
      ctx.beginPath();
      ctx.arc(player.x, player.y, player.w * 0.72, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();
    }
    ctx.globalAlpha = shipOpacity;
    if (shipImgLoaded) {
      ctx.save();
      ctx.globalAlpha = shipOpacity;
      ctx.translate(player.x, player.y);
      ctx.rotate(SHIP_ROTATION_OFFSET);
      ctx.drawImage(shipImg, -player.w / 2, -player.h / 2, player.w, player.h);
      ctx.restore();
    } else {
      ctx.fillStyle = '#44aaff';
      ctx.beginPath();
      ctx.moveTo(player.x, player.y - player.h / 2);
      ctx.lineTo(player.x - player.w / 2, player.y + player.h / 2);
      ctx.lineTo(player.x + player.w / 2, player.y + player.h / 2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Player explosion particles
  drawPlayerExplosion();

  // Particles (enemy deaths)
  drawParticles();

  // ── Graphical lives — small ship icons top-right ──────────
  drawLivesHUD();

  // ── Active power-up status icons (bottom-left) ────────────
  drawPowerUpHUD();

  // ── Floating score texts (on top) ─────────────────────────
  for (const ft of floatingTexts) {
    ctx.save();
    ctx.globalAlpha  = Math.max(0, ft.life);
    ctx.font         = 'bold 18px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle    = '#ffd700';
    ctx.shadowColor  = '#ffd700';
    ctx.shadowBlur   = 10;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ft.text, ft.x, ft.y);
    ctx.shadowBlur   = 0;
    ctx.restore();
  }

  // Screen flash on hit
  if (respawning) {
    const elapsed = Date.now() - (respawnAt - RESPAWN_DELAY);
    const t       = Math.max(0, 1 - elapsed / RESPAWN_DELAY);
    ctx.fillStyle = `rgba(255,80,30,${t * 0.35})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

// ── Player explosion ─────────────────────────────────────────
function spawnPlayerExplosion(x, y) {
  playerExplosion = [];
  // Large fiery shards
  for (let i = 0; i < 28; i++) {
    const angle = (i / 28) * Math.PI * 2 + Math.random() * 0.3;
    const speed = 2.5 + Math.random() * 5.5;
    const colors = ['#ff6600','#ff9900','#ffcc00','#ff3300','#ffffff','#ffeeaa'];
    playerExplosion.push({
      x, y,
      vx:    Math.cos(angle) * speed,
      vy:    Math.sin(angle) * speed,
      life:  1.0,
      decay: 1 / ((0.5 + Math.random() * 0.4) * 60),
      size:  3 + Math.random() * 5,
      color: colors[Math.floor(Math.random() * colors.length)],
      type:  Math.random() < 0.4 ? 'spark' : 'ember', // sparks are lines, embers are circles
      angle,
    });
  }
  // Shockwave ring (single entry, type='ring')
  playerExplosion.push({ x, y, life: 1.0, decay: 1 / 25, radius: 0, type: 'ring' });
}

function updatePlayerExplosion() {
  for (let i = playerExplosion.length - 1; i >= 0; i--) {
    const p = playerExplosion[i];
    if (p.type === 'ring') {
      p.radius += 6;
    } else {
      p.x  += p.vx;
      p.y  += p.vy;
      p.vy += 0.12; // slight gravity
      p.vx *= 0.97;
    }
    p.life -= p.decay;
    if (p.life <= 0) playerExplosion.splice(i, 1);
  }
}

function drawPlayerExplosion() {
  for (const p of playerExplosion) {
    ctx.globalAlpha = Math.max(0, p.life);
    if (p.type === 'ring') {
      ctx.strokeStyle = `rgba(255,160,40,${p.life})`;
      ctx.lineWidth   = 3 * p.life;
      ctx.shadowColor = '#ff8800';
      ctx.shadowBlur  = 20;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    } else if (p.type === 'spark') {
      ctx.strokeStyle = p.color;
      ctx.lineWidth   = Math.max(1, p.size * 0.4);
      ctx.shadowColor = p.color;
      ctx.shadowBlur  = 6;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 3, p.y - p.vy * 3);
      ctx.stroke();
      ctx.shadowBlur = 0;
    } else {
      ctx.fillStyle   = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur  = 8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
  ctx.globalAlpha = 1;
}

// ── Graphical lives HUD — small ship icons top-right ─────────
const LIFE_ICON_W   = 26;
const LIFE_ICON_H   = 32;
const LIFE_ICON_GAP = 8;

function drawLivesHUD() {
  // Draw below the HTML HUD bar (which is ~50px tall) so icons aren't hidden under it
  const iconY  = 58;   // top of icon, below the HUD div
  const totalW = lives * LIFE_ICON_W + Math.max(0, lives - 1) * LIFE_ICON_GAP;
  const startX = canvas.width - totalW - 16;

  // "LIVES" label
  ctx.save();
  ctx.font        = 'bold 11px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle   = 'rgba(200,220,255,0.7)';
  ctx.letterSpacing = '2px';
  ctx.textAlign   = 'right';
  ctx.fillText('LIVES', canvas.width - 16, iconY - 4);
  ctx.restore();

  for (let i = 0; i < lives; i++) {
    const icx = startX + i * (LIFE_ICON_W + LIFE_ICON_GAP) + LIFE_ICON_W / 2;
    const icy = iconY + LIFE_ICON_H / 2;

    const isLastLife = lives === 1;
    const alpha = isLastLife ? (0.6 + 0.4 * Math.abs(Math.sin(Date.now() / 200))) : 1;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = '#44eeff';
    ctx.shadowBlur  = invincible ? 14 : 5;
    ctx.translate(icx, icy);
    ctx.rotate(SHIP_ROTATION_OFFSET);

    if (shipImgLoaded) {
      ctx.drawImage(shipImg, -LIFE_ICON_W / 2, -LIFE_ICON_H / 2, LIFE_ICON_W, LIFE_ICON_H);
    } else {
      // Fallback: draw a small triangle pointing up
      ctx.fillStyle = '#44aaff';
      ctx.beginPath();
      ctx.moveTo(0, -LIFE_ICON_H / 2);
      ctx.lineTo(-LIFE_ICON_W / 2, LIFE_ICON_H / 2);
      ctx.lineTo(LIFE_ICON_W / 2, LIFE_ICON_H / 2);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }
}

// ── Active power-up HUD (bottom-left) ───────────────────────
function drawPowerUpHUD() {
  const now    = Date.now();
  const active = [];

  // Timed power-ups
  for (const type of ['rapidfire', 'doubleshot', 'scoremult']) {
    if (activePowerUps[type] && now < activePowerUps[type]) {
      active.push({ type, remaining: activePowerUps[type] - now, total: POWERUP_DURATION[type] });
    }
  }
  // Shield (no timer)
  if (activePowerUps['shield']) {
    active.push({ type: 'shield', remaining: -1, total: -1 });
  }

  if (active.length === 0) return;

  const iconSize = 28;
  const gap      = 6;
  const padX     = 14;
  const padY     = canvas.height - 60;

  active.forEach((item, i) => {
    const x = padX + i * (iconSize + gap);
    const y = padY;

    // Background circle
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.fillStyle   = POWERUP_COLORS[item.type];
    ctx.shadowColor = POWERUP_COLORS[item.type];
    ctx.shadowBlur  = 10;
    ctx.beginPath();
    ctx.arc(x + iconSize / 2, y + iconSize / 2, iconSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur  = 0;
    ctx.globalAlpha = 1;

    // Icon
    ctx.font         = '14px Arial';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(POWERUP_ICONS[item.type], x + iconSize / 2, y + iconSize / 2);

    // Countdown bar (below icon)
    if (item.remaining > 0 && item.total > 0) {
      const barW   = iconSize;
      const barH   = 4;
      const barY   = y + iconSize + 3;
      const frac   = item.remaining / item.total;
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(x, barY, barW, barH);
      ctx.fillStyle = POWERUP_COLORS[item.type];
      ctx.fillRect(x, barY, barW * frac, barH);
    }

    ctx.restore();
  });
}

// ── Mystery ship draw ────────────────────────────────────────
function drawMysteryShip(ms) {
  const x = ms.x;
  const y = ms.y;

  ctx.save();
  ctx.shadowColor = '#00ffff';
  ctx.shadowBlur  = 20;

  // Oval body
  ctx.fillStyle = '#aaddee';
  ctx.beginPath();
  ctx.ellipse(x, y + 4, 38, 14, 0, 0, Math.PI * 2);
  ctx.fill();

  // Dome on top
  ctx.fillStyle = '#cceeff';
  ctx.beginPath();
  ctx.ellipse(x, y - 4, 20, 14, 0, Math.PI, 0);
  ctx.fill();

  // Dome tint
  ctx.fillStyle = 'rgba(100,220,255,0.35)';
  ctx.beginPath();
  ctx.ellipse(x, y - 4, 20, 14, 0, Math.PI, 0);
  ctx.fill();

  // Lights underneath (alternating red/yellow every 20 frames)
  const lightOn = Math.floor(ms.lightFrame / 20) % 2 === 0;
  const lightColors = lightOn
    ? ['#ff4444', '#ffff00', '#ff4444', '#ffff00', '#ff4444']
    : ['#ffff00', '#ff4444', '#ffff00', '#ff4444', '#ffff00'];
  const lightXs = [-24, -12, 0, 12, 24];
  lightXs.forEach((lx, i) => {
    ctx.fillStyle   = lightColors[i];
    ctx.shadowColor = lightColors[i];
    ctx.shadowBlur  = 8;
    ctx.beginPath();
    ctx.arc(x + lx, y + 14, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.shadowBlur = 0;
  ctx.restore();
}

// ── Enemy sprite: Commander (row 0 — 30pts, red) ─────────────
// Skull-like alien: domed head, glowing eye sockets, jagged mandibles
function drawCommander(cx, cy, w, h, color, flap) {
  const s  = Math.min(w, h);   // scale unit
  const r  = color;

  // Dome / cranium
  ctx.fillStyle = r;
  ctx.beginPath();
  ctx.ellipse(cx, cy - s * 0.10, s * 0.38, s * 0.30, 0, Math.PI, 0);
  ctx.fill();

  // Face plate (lower half)
  ctx.fillStyle = r;
  ctx.beginPath();
  ctx.ellipse(cx, cy + s * 0.04, s * 0.34, s * 0.22, 0, 0, Math.PI);
  ctx.fill();

  // Dark eye sockets
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.beginPath();
  ctx.ellipse(cx - s * 0.13, cy - s * 0.08, s * 0.09, s * 0.10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + s * 0.13, cy - s * 0.08, s * 0.09, s * 0.10, 0, 0, Math.PI * 2);
  ctx.fill();

  // Glowing pupils
  ctx.fillStyle = flap === 0 ? '#fff' : 'rgba(255,255,180,0.7)';
  ctx.shadowColor = '#fff';
  ctx.shadowBlur  = 6;
  ctx.beginPath();
  ctx.ellipse(cx - s * 0.13, cy - s * 0.08, s * 0.04, s * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + s * 0.13, cy - s * 0.08, s * 0.04, s * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Mandibles — animate open/close
  const jawOpen = flap === 0 ? s * 0.18 : s * 0.10;
  ctx.fillStyle = r;
  // Left mandible
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.10, cy + s * 0.18);
  ctx.lineTo(cx - s * 0.32, cy + jawOpen);
  ctx.lineTo(cx - s * 0.22, cy + s * 0.30);
  ctx.closePath();
  ctx.fill();
  // Right mandible
  ctx.beginPath();
  ctx.moveTo(cx + s * 0.10, cy + s * 0.18);
  ctx.lineTo(cx + s * 0.32, cy + jawOpen);
  ctx.lineTo(cx + s * 0.22, cy + s * 0.30);
  ctx.closePath();
  ctx.fill();

  // Cranial ridge
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth   = Math.max(1, s * 0.04);
  ctx.beginPath();
  ctx.arc(cx, cy - s * 0.10, s * 0.22, Math.PI * 1.1, Math.PI * 1.9);
  ctx.stroke();
}

// ── Enemy sprite: Soldier (row 1 — 20pts, orange) ────────────
// Crab alien: wide body, claws, antennae, segmented abdomen
function drawSoldier(cx, cy, w, h, color, flap) {
  const s = Math.min(w, h);

  // Claws — animate up/down
  const clawY = flap === 0 ? cy - s * 0.05 : cy + s * 0.05;
  ctx.fillStyle = color;
  // Left claw
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.28, cy);
  ctx.lineTo(cx - s * 0.48, clawY - s * 0.12);
  ctx.lineTo(cx - s * 0.44, clawY + s * 0.08);
  ctx.lineTo(cx - s * 0.30, cy + s * 0.10);
  ctx.closePath();
  ctx.fill();
  // Right claw
  ctx.beginPath();
  ctx.moveTo(cx + s * 0.28, cy);
  ctx.lineTo(cx + s * 0.48, clawY - s * 0.12);
  ctx.lineTo(cx + s * 0.44, clawY + s * 0.08);
  ctx.lineTo(cx + s * 0.30, cy + s * 0.10);
  ctx.closePath();
  ctx.fill();

  // Main body — wide oval
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(cx, cy, s * 0.30, s * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  // Abdomen segments
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.ellipse(cx, cy + s * (0.04 + i * 0.07), s * (0.22 - i * 0.04), s * 0.03, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Eyes
  ctx.fillStyle = '#fff';
  ctx.shadowColor = '#fff';
  ctx.shadowBlur  = 5;
  ctx.beginPath();
  ctx.ellipse(cx - s * 0.10, cy - s * 0.06, s * 0.06, s * 0.07, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + s * 0.10, cy - s * 0.06, s * 0.06, s * 0.07, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Pupils
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(cx - s * 0.10, cy - s * 0.06, s * 0.03, s * 0.04, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + s * 0.10, cy - s * 0.06, s * 0.03, s * 0.04, 0, 0, Math.PI * 2);
  ctx.fill();

  // Antennae — animate sway
  const antSway = flap === 0 ? -s * 0.08 : s * 0.08;
  ctx.strokeStyle = color;
  ctx.lineWidth   = Math.max(1, s * 0.04);
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.10, cy - s * 0.20);
  ctx.quadraticCurveTo(cx - s * 0.18 + antSway, cy - s * 0.36, cx - s * 0.14 + antSway, cy - s * 0.44);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + s * 0.10, cy - s * 0.20);
  ctx.quadraticCurveTo(cx + s * 0.18 - antSway, cy - s * 0.36, cx + s * 0.14 - antSway, cy - s * 0.44);
  ctx.stroke();

  // Antenna tips
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(cx - s * 0.14 + antSway, cy - s * 0.44, s * 0.04, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + s * 0.14 - antSway, cy - s * 0.44, s * 0.04, 0, Math.PI * 2);
  ctx.fill();
}

// ── Enemy sprite: Drone (rows 2-3 — 10pts, blue) ─────────────
// Insect bug: compact oval body, 3 legs each side, small head nub
function drawDrone(cx, cy, w, h, color, flap) {
  const s = Math.min(w, h);

  // Legs — 3 per side, animate up/down alternating
  ctx.strokeStyle = color;
  ctx.lineWidth   = Math.max(1, s * 0.05);
  const legAngles = [-0.25, 0, 0.25]; // offsets along body
  legAngles.forEach((offset, i) => {
    const legY    = cy + offset * s;
    const legFlap = (flap + i) % 2; // alternate legs
    const tipY    = legFlap === 0 ? legY + s * 0.28 : legY + s * 0.18;
    // Left leg
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.22, legY);
    ctx.lineTo(cx - s * 0.44, tipY);
    ctx.stroke();
    // Right leg
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.22, legY);
    ctx.lineTo(cx + s * 0.44, tipY);
    ctx.stroke();
  });

  // Body — compact oval
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(cx, cy, s * 0.24, s * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body sheen
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath();
  ctx.ellipse(cx - s * 0.06, cy - s * 0.10, s * 0.10, s * 0.14, -0.3, 0, Math.PI * 2);
  ctx.fill();

  // Head nub
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(cx, cy - s * 0.36, s * 0.13, s * 0.10, 0, 0, Math.PI * 2);
  ctx.fill();

  // Single cyclopean eye
  ctx.fillStyle = '#fff';
  ctx.shadowColor = color;
  ctx.shadowBlur  = 8;
  ctx.beginPath();
  ctx.ellipse(cx, cy - s * 0.10, s * 0.08, s * 0.09, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Pupil — tracks flap
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(cx + (flap === 0 ? -s*0.02 : s*0.02), cy - s * 0.10,
              s * 0.04, s * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();

  // Small wing stubs — flap
  const wingSpread = flap === 0 ? s * 0.38 : s * 0.30;
  const wingY      = flap === 0 ? cy - s * 0.18 : cy - s * 0.12;
  ctx.fillStyle = `${color}99`;
  ctx.beginPath();
  ctx.ellipse(cx - wingSpread * 0.6, wingY, wingSpread * 0.28, s * 0.10, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + wingSpread * 0.6, wingY, wingSpread * 0.28, s * 0.10, 0.4, 0, Math.PI * 2);
  ctx.fill();
}

// ── Utility: rounded rectangle path ─────────────────────────
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── Input ────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  keys[e.key] = true;

  if (e.key === 'Escape' && gameRunning) {
    if (gamePaused) {
      resumeGame();
    } else {
      pauseGame();
    }
  }

  // Prevent page scroll on space/arrows
  if ([' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
    e.preventDefault();
  }
});

document.addEventListener('keyup', e => {
  keys[e.key] = false;
});

// ── Pause / Resume ───────────────────────────────────────────
function pauseGame() {
  gamePaused = true;
  showCursorBriefly();   // show cursor on pause menu
  clearTimeout(cursorHideTimer);
  showScreen('pause-screen');
}

function resumeGame() {
  gamePaused = false;
  showScreen('game-screen');
  hideCursor();   // hide cursor when returning to game
  cursorHideTimer = null;
}

// ── Start game ───────────────────────────────────────────────
function startGame() {
  // Resume AudioContext if suspended (browser autoplay policy)
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

  difficulty = document.getElementById('difficulty').value || 'medium';
  showScreen('game-screen');
  hideCursor();   // hide cursor as soon as game starts
  initGame();
  gameRunning = true;
  gamePaused  = false;
  animFrameId = requestAnimationFrame(gameLoop);
}

// ── Resize handler ───────────────────────────────────────────
window.addEventListener('resize', () => {
  if (!canvas) return;
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  // Reposition player to stay in bounds
  player.y = canvas.height - 80;
  player.x = Math.min(Math.max(player.x, player.w / 2), canvas.width - player.w / 2);
  buildStars();
});

// ── Mouse cursor auto-hide ───────────────────────────────────
let cursorHideTimer = null;

function hideCursor() {
  document.body.style.cursor = 'none';
}

function showCursorBriefly() {
  document.body.style.cursor = 'default';
  clearTimeout(cursorHideTimer);
  // Only auto-hide again when the game screen is active
  if (gameRunning && !gamePaused) {
    cursorHideTimer = setTimeout(hideCursor, 3000);
  }
}

document.addEventListener('mousemove', showCursorBriefly);

// ── DOM wiring ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Initialise hi-score display on menu
  document.getElementById('hud-hi') && (document.getElementById('hud-hi').textContent = hiScore);

  // ── Splash screen — auto-advance to menu after animation (3.6s total)
  setTimeout(() => {
    showScreen('menu-screen');
    loadLeaderboard();
  }, 3500);

  // Start button
  document.getElementById('start-btn').addEventListener('click', () => {
    startGame();
  });

  // Menu quit
  document.getElementById('menu-quit-btn').addEventListener('click', quitGame);

  // Resume
  document.getElementById('resume-btn').addEventListener('click', () => {
    resumeGame();
  });

  // Pause → Main Menu
  document.getElementById('pause-menu-btn').addEventListener('click', () => {
    cancelAnimationFrame(animFrameId);
    gameRunning = false;
    gamePaused  = false;
    showScreen('menu-screen');
    loadLeaderboard();
  });

  // Pause → Quit
  document.getElementById('pause-quit-btn').addEventListener('click', quitGame);

  // Submit score
  document.getElementById('submit-score-btn').addEventListener('click', async () => {
    const nameEl = document.getElementById('player-name');
    const name   = nameEl.value.trim();
    if (!name) { nameEl.focus(); return; }

    playerName = name;
    localStorage.setItem('space-jay-name', name);

    document.getElementById('submit-score-btn').disabled    = true;
    document.getElementById('submit-score-btn').textContent = 'SUBMITTING…';

    try {
      await submitScore(name, score, wave);
      document.getElementById('name-entry').style.display      = 'none';
      document.getElementById('score-submitted').style.display = 'block';
    } catch (_) {
      document.getElementById('submit-score-btn').textContent = 'RETRY';
      document.getElementById('submit-score-btn').disabled    = false;
    }
  });

  // Enter key submits name
  document.getElementById('player-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('submit-score-btn').click();
  });

  // Play Again
  document.getElementById('play-again-btn').addEventListener('click', () => {
    startGame();
  });

  // Finish → Main Menu
  document.getElementById('finish-menu-btn').addEventListener('click', () => {
    showScreen('menu-screen');
    loadLeaderboard();
  });

  // Finish → Quit
  document.getElementById('finish-quit-btn').addEventListener('click', quitGame);
});
