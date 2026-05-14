/**
 * GTA 2D - Client
 * Поддержка: клавиатура+мышь и сенсорное управление (телефон)
 */

// ===== КОНСТАНТЫ =====
const WORLD_W = 3000, WORLD_H = 3000, TILE_SIZE = 50;
const WEAPON_NAMES = ['Pistol', 'Auto', 'Shotgun'];
const NPC_COLORS = { pedestrian: '#88cc88', gangster: '#cc4444', cop: '#4488ff' };

// ===== DOM =====
const $ = id => document.getElementById(id);
const canvas = $('gameCanvas'), ctx = canvas.getContext('2d');
const minimapCanvas = $('minimapCanvas'), minimapCtx = minimapCanvas.getContext('2d');

// ===== СОСТОЯНИЕ =====
let socket = null, playerId = null, worldData = null, gameState = null, myPlayer = null;
let keys = { up: false, down: false, left: false, right: false };
let mouseX = 0, mouseY = 0, mouseDown = false, cameraX = 0, cameraY = 0;
let isChatOpen = false, isMultiplayer = false;
let controlMode = 'keyboard'; // 'keyboard' или 'touch'

// Для сенсорного управления
let touchKeys = { up: false, down: false, left: false, right: false };
let touchShoot = false;
let touchWeapon = -1;
let touchEnter = false;
let touchPickup = false;

// ===== РАЗМЕР =====
function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener('resize', resize); resize();

// ===== МЕНЮ =====
$('btn-singleplayer').onclick = () => startGame('game:singleplayer');
$('btn-multiplayer').onclick = () => { $('multiplayer-connect').style.display = 'flex'; $('menu-buttons').style.display = 'none'; };
$('btn-back').onclick = () => { $('multiplayer-connect').style.display = 'none'; $('menu-buttons').style.display = 'flex'; };
$('btn-connect').onclick = () => startGame('game:join');
$('nick-input').onkeydown = e => { if (e.key === 'Enter') $('btn-connect').click(); };

// Выбор управления
$('ctrl-keyboard').onclick = () => {
  $('ctrl-keyboard').classList.add('active');
  $('ctrl-touch').classList.remove('active');
  controlMode = 'keyboard';
  $('mobile-controls').style.display = 'none';
  updateControlsInfo('keyboard');
};
$('ctrl-touch').onclick = () => {
  $('ctrl-touch').classList.add('active');
  $('ctrl-keyboard').classList.remove('active');
  controlMode = 'touch';
  updateControlsInfo('touch');
};

function updateControlsInfo(mode) {
  const info = $('controls-info');
  if (mode === 'touch') {
    info.innerHTML = '<p><strong>Управление (сенсор):</strong></p>' +
      '<p>Джойстик (слева) — движение</p>' +
      '<p>🔫 — стрельба</p>' +
      '<p>1,2,3 — оружие / E — машина / F — предмет</p>' +
      '<p>💬 — чат</p>';
  } else {
    info.innerHTML = '<p><strong>Управление:</strong></p>' +
      '<p>WASD / Стрелки — движение</p>' +
      '<p>Мышь — прицел / ЛКМ — стрельба</p>' +
      '<p>1,2,3 — оружие / E — машина / F — предмет</p>' +
      '<p>Enter — чат</p>';
    }
    // Особые объекты
    if (gameState && gameState.special) {
      for (const id in gameState.special) {
        const so = gameState.special[id];
        minimapCtx.fillStyle = so.type === 'bank' ? '#3498db' :
                              so.type === 'gas_station' ? '#2ecc71' :
                              so.type === 'police_station' ? '#e74c3c' : '#95a5a6';
        minimapCtx.fillRect(so.x*s-2, so.y*s-2, 4, 4);
      }
    }
  }
  minimapCtx.strokeStyle = '#555'; minimapCtx.lineWidth = 1; minimapCtx.strokeRect(0, 0, 150, 150);
  
  // Легенда
  minimapCtx.fillStyle = '#fff'; minimapCtx.font = '9px Arial';
  minimapCtx.fillText('■玩家', 5, 145);
  minimapCtx.fillStyle = '#0f8'; minimapCtx.fillText('●自己', 35, 145);
  minimapCtx.fillStyle = '#777'; minimapCtx.fillText('■停车', 65, 145);
  minimapCtx.fillStyle = '#48f'; minimapCtx.fillText('●警察', 90, 145);
}
  }
  if (gameState) {
    for (const id in gameState.npcs) {
      const n = gameState.npcs[id];
      minimapCtx.fillStyle = n.type==='cop'?'#48f':n.type==='gangster'?'#f44':'#8c8';
      minimapCtx.fillRect(n.x*s-1, n.y*s-1, 3, 3);
    }
    for (const id in gameState.vehicles) {
      const v = gameState.vehicles[id];
      minimapCtx.fillStyle = v.driver !== null ? '#0f0' : '#aa0';
      minimapCtx.fillRect(v.x*s-1.5, v.y*s-1, 3, 2);
    }
    for (const id in gameState.items) {
      const it = gameState.items[id];
      minimapCtx.fillStyle = it.type==='health'?'#0f0':'#f80';
      minimapCtx.beginPath(); minimapCtx.arc(it.x*s, it.y*s, 2, 0, Math.PI*2); minimapCtx.fill();
    }
    for (const id in gameState.players) {
      const p = gameState.players[id];
      minimapCtx.fillStyle = id === playerId ? '#0f8' : '#fc0';
      minimapCtx.beginPath(); minimapCtx.arc(p.x*s, p.y*s, id===playerId?3:2, 0, Math.PI*2); minimapCtx.fill();
    }
  }
  minimapCtx.strokeStyle = '#555'; minimapCtx.lineWidth = 1; minimapCtx.strokeRect(0, 0, 150, 150);
}

// ===== ГЛАВНЫЙ ЦИКЛ =====
requestAnimationFrame(function loop() { draw(); requestAnimationFrame(loop); });