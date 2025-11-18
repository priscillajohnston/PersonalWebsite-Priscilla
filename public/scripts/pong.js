import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore,
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js';

const firebaseConfig = {
  apiKey: 'AIzaSyD5beNYVkxKcIvAEeQPojaV1BaoDmz5pXQ',
  authDomain: 'priscillapong-4fcd3.firebaseapp.com',
  projectId: 'priscillapong-4fcd3',
  storageBucket: 'priscillapong-4fcd3.firebasestorage.app',
  messagingSenderId: '832004285673',
  appId: '1:832004285673:web:9fb828eaa5f0bf4e567c78',
  measurementId: 'G-MC2Y85WCJY',
};

const HIGH_SCORE_COOKIE = 'pongHighScore';
const HIGH_SCORE_MAX_AGE_DAYS = 180;
const PLAYER_ID_COOKIE = 'pongPlayerId';
const PLAYER_ID_MAX_AGE_DAYS = 365;
const PLAYER_NAME_STORAGE_KEY = 'pongPlayerName';
const PLAYER_NAME_COOKIE = 'pongPlayerName';

let db = null;
let leaderboardUnsubscribe = null;
let animationId = null;

document.addEventListener('DOMContentLoaded', init, { once: true });

function init() {
  setCurrentYear();
  renderHeartBanner();
  window.addEventListener('resize', renderHeartBanner);

  initFirebase();

  const playerId = ensurePlayerId();
  const playerIdentity = setupPlayerIdentity();
  setupLeaderboard(playerId);
  setupGame(playerId, playerIdentity.getName);
}

function initFirebase() {
  try {
    const apps = getApps();
    const app = apps.length > 0 ? apps[0] : initializeApp(firebaseConfig);
    db = getFirestore(app);
    try {
      getAnalytics(app);
    } catch (error) {
      console.info('Skipping Firebase Analytics initialisation', error);
    }
  } catch (error) {
    db = null;
    console.error('Failed to initialise Firebase', error);
    showLeaderboardError('Leaderboard is offline right now. Scores will stay local.');
  }
}

function setupGame(playerId, getPlayerName) {
  const canvas = document.getElementById('pongCanvas');
  if (!canvas) {
    return;
  }

  const ctx = canvas.getContext('2d');
  const toggleButton = document.getElementById('pongToggle');
  const playerScoreEl = document.getElementById('playerScore');
  const aiScoreEl = document.getElementById('aiScore');
  const highScoreEl = document.getElementById('highScore');

  const arena = { width: canvas.width, height: canvas.height };

  const player = { x: 36, y: arena.height / 2 - 45, width: 14, height: 90, speed: 6, score: 0 };
  const ai = { x: arena.width - 50, y: arena.height / 2 - 45, width: 14, height: 90, speed: 5.2, score: 0 };
  const ball = { x: arena.width / 2, y: arena.height / 2, radius: 10, dx: 0, dy: 0, speed: 6.2 };

  const keys = { up: false, down: false, w: false, s: false };
  let isRunning = false;
  let highScore = readHighScoreCookie();
  let lastSubmittedScore = highScore;

  updateText(playerScoreEl, '0');
  updateText(aiScoreEl, '0');
  updateHighScoreDisplay(highScoreEl, highScore);

  function serveBall(direction = 1) {
    ball.x = arena.width / 2;
    ball.y = arena.height / 2;
    ball.dx = direction * ball.speed;
    ball.dy = (Math.random() * 2 - 1) * (ball.speed * 0.7);
  }

  function updateHighScore(score) {
    if (score <= highScore) return;
    highScore = score;
    updateHighScoreDisplay(highScoreEl, highScore);
    writeHighScoreCookie(highScore);
    if (score > lastSubmittedScore) {
      lastSubmittedScore = score;
      submitLeaderboardScore(playerId, getPlayerName(), score);
    }
  }

  function resetMatch() {
    player.score = 0;
    ai.score = 0;
    updateText(playerScoreEl, '0');
    updateText(aiScoreEl, '0');
    updateHighScoreDisplay(highScoreEl, highScore);
    serveBall(Math.random() > 0.5 ? 1 : -1);
    player.y = arena.height / 2 - player.height / 2;
    ai.y = arena.height / 2 - ai.height / 2;
  }

  function drawArena() {
    ctx.fillStyle = 'rgba(18, 4, 43, 1)';
    ctx.fillRect(0, 0, arena.width, arena.height);

    ctx.setLineDash([10, 12]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(arena.width / 2, 0);
    ctx.lineTo(arena.width / 2, arena.height);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.beginPath();
    ctx.arc(arena.width / 2, arena.height / 2, 46, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPaddle(paddle) {
    const gradient = ctx.createLinearGradient(0, paddle.y, 0, paddle.y + paddle.height);
    gradient.addColorStop(0, 'rgba(216, 182, 255, 0.95)');
    gradient.addColorStop(1, 'rgba(151, 87, 255, 0.85)');
    ctx.fillStyle = gradient;
    ctx.shadowColor = 'rgba(151, 87, 255, 0.55)';
    ctx.shadowBlur = 12;
    ctx.fillRect(paddle.x, paddle.y, paddle.width, paddle.height);
    ctx.shadowBlur = 0;
  }

  function drawBall() {
    const gradient = ctx.createRadialGradient(ball.x, ball.y, 2, ball.x, ball.y, ball.radius);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    gradient.addColorStop(1, 'rgba(200, 170, 255, 0.8)');
    ctx.fillStyle = gradient;
    ctx.shadowColor = 'rgba(255, 255, 255, 0.4)';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function updatePlayer() {
    if (keys.up || keys.w) {
      player.y -= player.speed;
    }
    if (keys.down || keys.s) {
      player.y += player.speed;
    }

    if (player.y < 16) player.y = 16;
    if (player.y + player.height > arena.height - 16) player.y = arena.height - 16 - player.height;
  }

  function updateAI() {
    const target = ball.y - ai.height / 2;
    const easing = Math.min(1, Math.abs(target - ai.y) / 60);
    ai.y += Math.sign(target - ai.y) * ai.speed * easing;

    if (ai.y < 16) ai.y = 16;
    if (ai.y + ai.height > arena.height - 16) ai.y = arena.height - 16 - ai.height;
  }

  function updateBall() {
    ball.x += ball.dx;
    ball.y += ball.dy;

    if (ball.y - ball.radius <= 10 || ball.y + ball.radius >= arena.height - 10) {
      ball.dy = -ball.dy;
    }

    if (ball.dx < 0 && ball.x - ball.radius <= player.x + player.width && ball.y >= player.y && ball.y <= player.y + player.height) {
      ball.dx = -ball.dx;
      ball.x = player.x + player.width + ball.radius;
      const impact = (ball.y - player.y - player.height / 2) / (player.height / 2);
      ball.dy = impact * ball.speed;
    }

    if (ball.dx > 0 && ball.x + ball.radius >= ai.x && ball.y >= ai.y && ball.y <= ai.y + ai.height) {
      ball.dx = -ball.dx;
      ball.x = ai.x - ball.radius;
      const impact = (ball.y - ai.y - ai.height / 2) / (ai.height / 2);
      ball.dy = impact * ball.speed;
    }

    if (ball.x < 0) {
      ai.score += 1;
      updateText(aiScoreEl, String(ai.score));
      serveBall(1);
    } else if (ball.x > arena.width) {
      player.score += 1;
      updateText(playerScoreEl, String(player.score));
      updateHighScore(player.score);
      serveBall(-1);
    }
  }

  function loop() {
    ctx.clearRect(0, 0, arena.width, arena.height);
    drawArena();
    drawPaddle(player);
    drawPaddle(ai);
    drawBall();

    if (isRunning) {
      updatePlayer();
      updateAI();
      updateBall();
    }

    animationId = requestAnimationFrame(loop);
  }

  function handleKeyDown(event) {
    if (event.key === 'ArrowUp') keys.up = true;
    if (event.key === 'ArrowDown') keys.down = true;
    if (event.key === 'w' || event.key === 'W') keys.w = true;
    if (event.key === 's' || event.key === 'S') keys.s = true;
  }

  function handleKeyUp(event) {
    if (event.key === 'ArrowUp') keys.up = false;
    if (event.key === 'ArrowDown') keys.down = false;
    if (event.key === 'w' || event.key === 'W') keys.w = false;
    if (event.key === 's' || event.key === 'S') keys.s = false;
  }

  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('keyup', handleKeyUp);

  if (toggleButton) {
    toggleButton.addEventListener('click', () => {
      isRunning = !isRunning;
      toggleButton.textContent = isRunning ? 'Pause' : 'Play';
      if (isRunning && ball.dx === 0 && ball.dy === 0) {
        serveBall(Math.random() > 0.5 ? 1 : -1);
      }
    });
  }

  resetMatch();
  loop();

  window.addEventListener(
    'beforeunload',
    () => {
      if (animationId !== null) {
        cancelAnimationFrame(animationId);
      }
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    },
    { once: true },
  );
}

function setupLeaderboard(playerId) {
  const listEl = document.getElementById('leaderboardList');
  const emptyEl = document.getElementById('leaderboardEmpty');
  const errorEl = document.getElementById('leaderboardError');
  const syncEl = document.getElementById('leaderboardSyncState');

  if (!listEl) {
    return;
  }

  if (!db) {
    setLeaderboardOfflineState();
    return;
  }

  const leaderboardRef = collection(db, 'leaderboard');

  leaderboardUnsubscribe = onSnapshot(
    leaderboardRef,
    (snapshot) => {
      clearLeaderboardError();
      updateLeaderboardSync(syncEl, snapshot.metadata.fromCache);

      if (snapshot.empty) {
        listEl.innerHTML = '';
        if (emptyEl) emptyEl.hidden = false;
        return;
      }

      if (emptyEl) emptyEl.hidden = true;
      listEl.innerHTML = '';
      const entries = snapshot.docs
        .map((docSnap) => {
          const data = docSnap.data();
          const rawScore = data?.score;
          const score = typeof rawScore === 'number' ? rawScore : Number(rawScore);
          if (!Number.isFinite(score) || score < 0) {
            return null;
          }
          return {
            id: docSnap.id,
            name: normaliseName(data?.name),
            score,
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

      if (entries.length === 0) {
        if (emptyEl) emptyEl.hidden = false;
        listEl.innerHTML = '';
        return;
      }

      if (emptyEl) emptyEl.hidden = true;
      entries.forEach((entry) => {
        const item = document.createElement('li');
        if (entry.id === playerId) {
          item.classList.add('is-self');
        }

        const nameSpan = document.createElement('span');
        nameSpan.className = 'leaderboard-entry-name';
        nameSpan.textContent = entry.name;
        item.appendChild(nameSpan);

        const scoreSpan = document.createElement('span');
        scoreSpan.className = 'leaderboard-entry-score';
        scoreSpan.textContent = String(entry.score);
        item.appendChild(scoreSpan);

        listEl.appendChild(item);
      });
    },
    (error) => {
      console.error('Failed to listen to leaderboard', error);
      const message =
        error && typeof error === 'object' && 'code' in error
          ? `Leaderboard unavailable (${error.code}). Try again soon.`
          : 'We could not load the leaderboard right now. Try again soon.';
      showLeaderboardError(message);
    },
  );

  window.addEventListener(
    'beforeunload',
    () => {
      if (typeof leaderboardUnsubscribe === 'function') {
        leaderboardUnsubscribe();
      }
    },
    { once: true },
  );
}

async function submitLeaderboardScore(playerId, playerName, score) {
  if (!db || !playerId || typeof score !== 'number' || score <= 0) {
    return;
  }

  const leaderboardRef = collection(db, 'leaderboard');
  const playerRef = doc(leaderboardRef, playerId);

  try {
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(playerRef);
      const existingScore = snapshot.exists() ? snapshot.data()?.score : null;
      if (typeof existingScore === 'number' && existingScore >= score) {
        // Existing score is higher or equal; only update name if it changed.
        const existingName = normaliseName(snapshot.data()?.name);
        const nextName = normaliseName(playerName);
        if (existingName !== nextName) {
          transaction.set(playerRef, { name: nextName, updatedAt: serverTimestamp() }, { merge: true });
        }
        return;
      }

      transaction.set(playerRef, {
        name: normaliseName(playerName),
        score,
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    console.error('Failed to submit leaderboard score', error);
    showLeaderboardError('Could not update the leaderboard. Your score is safe locally.');
  }
}

function setupPlayerIdentity() {
  const formEl = document.getElementById('playerIdentityForm');
  const inputEl = document.getElementById('playerNameInput');
  const statusEl = document.getElementById('playerNameStatus');

  let currentName = loadStoredPlayerName();
  if (inputEl && currentName) {
    inputEl.value = currentName;
  }

  if (formEl && inputEl) {
    formEl.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = inputEl.value.trim();
      if (!name) {
        showPlayerNameStatus(statusEl, 'Please enter a name to appear on the leaderboard.', 'error');
        return;
      }
      currentName = name;
      persistPlayerName(name);
      showPlayerNameStatus(statusEl, `Saved as “${name}”`, 'success');
      submitLeaderboardScore(ensurePlayerId(), currentName, readHighScoreCookie());
    });
  }

  return {
    getName: () => currentName,
  };
}

function persistPlayerName(name) {
  try {
    localStorage.setItem(PLAYER_NAME_STORAGE_KEY, name);
  } catch (error) {
    console.warn('Failed to persist player name to localStorage', error);
  }
  writeCookie(PLAYER_NAME_COOKIE, name, PLAYER_ID_MAX_AGE_DAYS);
}

function loadStoredPlayerName() {
  try {
    const name = localStorage.getItem(PLAYER_NAME_STORAGE_KEY);
    if (name && typeof name === 'string') {
      return name.trim();
    }
  } catch (error) {
    // Fall back to cookie.
  }
  return readCookie(PLAYER_NAME_COOKIE);
}

function showPlayerNameStatus(statusEl, message, type) {
  if (!statusEl) return;
  statusEl.hidden = false;
  statusEl.textContent = message;
  statusEl.classList.remove('success', 'error');
  if (type) {
    statusEl.classList.add(type);
  }
  window.setTimeout(() => {
    statusEl.hidden = true;
    statusEl.textContent = '';
    statusEl.classList.remove('success', 'error');
  }, 4000);
}

function ensurePlayerId() {
  const existing = readCookie(PLAYER_ID_COOKIE);
  if (existing) {
    return existing;
  }
  let generated = '';
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    generated = window.crypto.randomUUID();
  } else {
    generated = `player-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  }
  writeCookie(PLAYER_ID_COOKIE, generated, PLAYER_ID_MAX_AGE_DAYS);
  return generated;
}

function readHighScoreCookie() {
  const value = readCookie(HIGH_SCORE_COOKIE);
  const parsed = value ? parseInt(value, 10) : 0;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function writeHighScoreCookie(score) {
  if (!Number.isFinite(score) || score < 0) return;
  writeCookie(HIGH_SCORE_COOKIE, String(score), HIGH_SCORE_MAX_AGE_DAYS);
}

function readCookie(name) {
  const cookieString = document.cookie || '';
  if (!cookieString) return '';
  const prefix = `${name}=`;
  const cookie = cookieString.split(';').map((entry) => entry.trim()).find((entry) => entry.startsWith(prefix));
  if (!cookie) return '';
  try {
    return decodeURIComponent(cookie.substring(prefix.length));
  } catch (error) {
    return cookie.substring(prefix.length);
  }
}

function writeCookie(name, value, maxAgeDays) {
  try {
    const maxAge = Math.max(0, Math.floor(maxAgeDays * 86400));
    document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=${maxAge};SameSite=Lax`;
  } catch (error) {
    console.warn(`Failed to write cookie ${name}`, error);
  }
}

function setCurrentYear() {
  const yearEl = document.getElementById('year');
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }
}

function renderHeartBanner() {
  const heartBanner = document.querySelector('.heart-banner');
  if (!heartBanner) return;
  const availableWidth = heartBanner.clientWidth || window.innerWidth;
  heartBanner.textContent = '💖';
  const heartWidth = heartBanner.scrollWidth || 1;
  const count = Math.max(5, Math.floor(availableWidth / heartWidth));
  heartBanner.textContent = '💖'.repeat(count);
}

function updateText(element, text) {
  if (element) {
    element.textContent = text;
  }
}

function updateHighScoreDisplay(element, score) {
  if (element) {
    element.textContent = String(score);
  }
}

function showLeaderboardError(message) {
  const errorEl = document.getElementById('leaderboardError');
  const emptyEl = document.getElementById('leaderboardEmpty');
  if (errorEl) {
    errorEl.hidden = false;
    errorEl.textContent = message;
  }
  if (emptyEl) {
    emptyEl.hidden = true;
  }
}

function clearLeaderboardError() {
  const errorEl = document.getElementById('leaderboardError');
  if (errorEl) {
    errorEl.hidden = true;
    errorEl.textContent = '';
  }
}

function setLeaderboardOfflineState() {
  const listEl = document.getElementById('leaderboardList');
  const emptyEl = document.getElementById('leaderboardEmpty');
  if (listEl) {
    listEl.innerHTML = '';
  }
  if (emptyEl) {
    emptyEl.hidden = false;
    emptyEl.textContent = 'Leaderboard is offline right now. Beat your best score locally!';
  }
}

function updateLeaderboardSync(syncEl, fromCache) {
  if (!syncEl) return;
  const now = new Date();
  try {
    const formatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
    const mode = fromCache ? 'Cached' : 'Live';
    syncEl.textContent = `${mode} • Updated ${formatter.format(now)}`;
    syncEl.hidden = false;
  } catch (error) {
    syncEl.textContent = fromCache ? 'Cached update' : 'Live update';
    syncEl.hidden = false;
  }
}

function normaliseName(name) {
  if (typeof name !== 'string') {
    return 'Player';
  }
  const trimmed = name.trim();
  if (!trimmed) {
    return 'Player';
  }
  return trimmed.slice(0, 48);
}

