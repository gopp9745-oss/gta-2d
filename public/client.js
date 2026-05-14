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
}

function startGame(eventType) {
  const nick = $('nick-input').value.trim() || 'Player';
  $('menu').style.display = 'none';
  $('game-screen').style.display = 'block';

  // Показываем мобильное управление если выбран touch
  if (controlMode === 'touch') {
    $('mobile-controls').style.display = 'block';
    // На телефонах скрываем курсор
    canvas.style.cursor = 'none';
  }

  isMultiplayer = eventType === 'game:join';
  socket = io({ transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    console.log('connected');
    socket.emit(eventType, nick);
  });

  socket.on('game:init', data => {
    worldData = data.world;
    playerId = data.playerId;
    console.log('init');
  });

  socket.on('game:state', state => {
    gameState = state;
    if (state.players[playerId]) {
      myPlayer = state.players[playerId];
      $('death-screen').style.display = myPlayer.alive ? 'none' : 'flex';
    }
    updateHUD();
  });

  socket.on('game:chat', data => addChat(data.from, data.msg));
  socket.on('disconnect', () => addChat('System', 'Disconnected'));
}

// ===== ОТПРАВКА ВВОДА =====
function send(data) { if (socket && socket.connected) socket.emit('player:input', data); }

setInterval(() => {
  const k = controlMode === 'touch' ? touchKeys : keys;
  send({
    keys: { up: k.up, down: k.down, left: k.left, right: k.right },
    shoot: controlMode === 'touch' ? touchShoot : mouseDown,
    mouseX: Math.round(mouseX + cameraX),
    mouseY: Math.round(mouseY + cameraY)
  });
  // Отправляем разовые действия
  if (touchWeapon >= 0) { send({ weapon: touchWeapon }); touchWeapon = -1; }
  if (touchEnter) { send({ enterVehicle: true }); touchEnter = false; }
  if (touchPickup) { send({ pickup: true }); touchPickup = false; }
}, 50);

// ===== КЛАВИАТУРА =====
document.addEventListener('keydown', e => {
  if (controlMode === 'touch') return;
  const c = e.code;
  if (c === 'KeyW' || c === 'ArrowUp') { keys.up = true; e.preventDefault(); }
  else if (c === 'KeyS' || c === 'ArrowDown') { keys.down = true; e.preventDefault(); }
  else if (c === 'KeyA' || c === 'ArrowLeft') { keys.left = true; e.preventDefault(); }
  else if (c === 'KeyD' || c === 'ArrowRight') { keys.right = true; e.preventDefault(); }
  else if (c === 'KeyE') { send({ enterVehicle: true }); e.preventDefault(); }
  else if (c === 'KeyF') { send({ pickup: true }); e.preventDefault(); }
  else if (c === 'Digit1') { send({ weapon: 0 }); }
  else if (c === 'Digit2') { send({ weapon: 1 }); }
  else if (c === 'Digit3') { send({ weapon: 2 }); }
  else if (c === 'Enter' || c === 'NumpadEnter') {
    if (isChatOpen) { sendChat(); }
    else { isChatOpen = true; $('chat-input').style.display = 'block'; $('chat-input').focus(); }
    e.preventDefault();
  }
  else if (c === 'Escape' && isChatOpen) { closeChat(); e.preventDefault(); }
});

document.addEventListener('keyup', e => {
  if (controlMode === 'touch') return;
  const c = e.code;
  if (c === 'KeyW' || c === 'ArrowUp') { keys.up = false; e.preventDefault(); }
  else if (c === 'KeyS' || c === 'ArrowDown') { keys.down = false; e.preventDefault(); }
  else if (c === 'KeyA' || c === 'ArrowLeft') { keys.left = false; e.preventDefault(); }
  else if (c === 'KeyD' || c === 'ArrowRight') { keys.right = false; e.preventDefault(); }
});

// ===== МЫШЬ =====
canvas.addEventListener('mousemove', e => {
  if (controlMode === 'touch') return;
  const r = canvas.getBoundingClientRect();
  mouseX = e.clientX - r.left; mouseY = e.clientY - r.top;
});
canvas.addEventListener('mousedown', e => {
  if (controlMode === 'touch') return;
  if (e.button === 0) { mouseDown = true; e.preventDefault(); }
});
canvas.addEventListener('mouseup', e => {
  if (controlMode === 'touch') return;
  if (e.button === 0) mouseDown = false;
});
canvas.addEventListener('contextmenu', e => e.preventDefault());

// ===== СЕНСОРНОЕ УПРАВЛЕНИЕ =====
// Джойстик
const joystickArea = $('joystick-area');
const joystickKnob = $('joystick-knob');
let joystickTouchId = null;
const JOYSTICK_RADIUS = 40; // радиус движения стика от центра

function handleJoystick(clientX, clientY) {
  const rect = joystickArea.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let dx = clientX - cx;
  let dy = clientY - cy;
  const dist = Math.hypot(dx, dy);
  if (dist > JOYSTICK_RADIUS) {
    dx = (dx / dist) * JOYSTICK_RADIUS;
    dy = (dy / dist) * JOYSTICK_RADIUS;
  }
  // Позиция кружка
  joystickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  // Определяем направление
  const deadZone = 10;
  touchKeys.up = dy < -deadZone;
  touchKeys.down = dy > deadZone;
  touchKeys.left = dx < -deadZone;
  touchKeys.right = dx > deadZone;
}

function resetJoystick() {
  joystickKnob.style.transform = 'translate(-50%, -50%)';
  touchKeys.up = touchKeys.down = touchKeys.left = touchKeys.right = false;
  joystickTouchId = null;
}

joystickArea.addEventListener('touchstart', e => {
  if (e.target !== joystickArea && e.target !== joystickKnob) return;
  e.preventDefault();
  const touch = e.changedTouches[0];
  joystickTouchId = touch.identifier;
  handleJoystick(touch.clientX, touch.clientY);
});

joystickArea.addEventListener('touchmove', e => {
  e.preventDefault();
  for (const touch of e.changedTouches) {
    if (touch.identifier === joystickTouchId) {
      handleJoystick(touch.clientX, touch.clientY);
    }
  }
});

joystickArea.addEventListener('touchend', e => {
  for (const touch of e.changedTouches) {
    if (touch.identifier === joystickTouchId) {
      resetJoystick();
    }
  }
});

joystickArea.addEventListener('touchcancel', resetJoystick);

// Кнопка стрельбы
$('btn-fire').addEventListener('touchstart', e => { e.preventDefault(); touchShoot = true; });
$('btn-fire').addEventListener('touchend', e => { e.preventDefault(); touchShoot = false; });
$('btn-fire').addEventListener('touchcancel', e => { touchShoot = false; });

// Кнопки оружия
for (const btn of document.querySelectorAll('.weapon-btn')) {
  btn.addEventListener('touchstart', e => {
    e.preventDefault();
    const w = parseInt(btn.dataset.w);
    document.querySelectorAll('.weapon-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    touchWeapon = w;
  });
}

// Кнопки действий
$('btn-enter').addEventListener('touchstart', e => { e.preventDefault(); touchEnter = true; });
$('btn-pickup').addEventListener('touchstart', e => { e.preventDefault(); touchPickup = true; });

// Кнопка чата
$('btn-chat-toggle').addEventListener('touchstart', e => {
  e.preventDefault();
  if (isChatOpen) { sendChat(); }
  else { isChatOpen = true; $('chat-input').style.display = 'block'; $('chat-input').focus(); }
});

// ===== ЧАТ =====
function closeChat() { isChatOpen = false; $('chat-input').style.display = 'none'; $('chat-input').value = ''; $('chat-input').blur(); }
function sendChat() {
  const msg = $('chat-input').value.trim();
  if (msg && socket && socket.connected) socket.emit('player:chat', msg);
  closeChat();
}
$('chat-input').onkeydown = e => { if (e.key === 'Enter') sendChat(); if (e.key === 'Escape') closeChat(); };
function addChat(from, msg) {
  const d = document.createElement('div'); d.className = 'chat-msg';
  d.innerHTML = from === 'System' ? `<span class="system">${msg}</span>` : `<span class="nick">${from}:</span> ${msg}`;
  $('chat-messages').appendChild(d);
  if ($('chat-messages').children.length > 50) $('chat-messages').removeChild($('chat-messages').firstChild);
  $('chat-messages').scrollTop = $('chat-messages').scrollHeight;
}

// ===== HUD =====
function updateHUD() {
  if (!myPlayer) return;
  const p = myPlayer;
  $('hp-fill').style.width = (p.hp / p.maxHp * 100) + '%';
  $('hp-text').textContent = Math.ceil(p.hp);
  $('weapon-name').textContent = WEAPON_NAMES[p.weaponIndex] || 'Pistol';
  const ammo = p.ammo ? p.ammo[['pistol','auto','shotgun'][p.weaponIndex]] : 0;
  $('weapon-ammo').textContent = ammo || '0';
  let stars = '';
  for (let i = 0; i < 5; i++) stars += i < (p.wanted || 0) ? '★' : '☆';
  $('wanted-stars').textContent = stars;
}

// ===== РЕНДЕР =====
function draw() {
  if (!worldData) return;
  ctx.fillStyle = '#3a7d32'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (myPlayer) {
    cameraX += (myPlayer.x - canvas.width/2 - cameraX) * 0.1;
    cameraY += (myPlayer.y - canvas.height/2 - cameraY) * 0.1;
  }
  ctx.save(); ctx.translate(-cameraX, -cameraY);
  drawGrid();
  drawBuildings();
  drawTrees();
  if (gameState) {
    for (const id in gameState.items) drawItem(gameState.items[id]);
    for (const id in gameState.vehicles) drawVehicle(gameState.vehicles[id]);
    for (const id in gameState.npcs) drawNPC(gameState.npcs[id]);
    for (const id in gameState.players) if (id !== playerId) drawPlayer(gameState.players[id], false);
    if (myPlayer) drawPlayer(myPlayer, true);
    for (const b of gameState.bullets) drawBullet(b);
  }
  ctx.restore();
  drawMinimap();
}

function drawGrid() {
  if (!worldData.grid) return;
  const g = worldData.grid;
  const sc = Math.max(0, Math.floor(cameraX/50)-1), ec = Math.min(59, Math.ceil((cameraX+canvas.width)/50)+1);
  const sr = Math.max(0, Math.floor(cameraY/50)-1), er = Math.min(59, Math.ceil((cameraY+canvas.height)/50)+1);
  for (let r = sr; r <= er; r++) {
    for (let c = sc; c <= ec; c++) {
      const t = g[r][c], x = c*50, y = r*50;
      if (t === 'road') { ctx.fillStyle = '#555'; ctx.fillRect(x, y, 50, 50); if (r%6===0 && c%3===0) { ctx.fillStyle='#ff0'; ctx.fillRect(x+5, y+23, 40, 4); } if (c%6===0 && r%3===0) { ctx.fillStyle='#ff0'; ctx.fillRect(x+23, y+5, 4, 40); } }
      else if (t === 'sidewalk') { ctx.fillStyle = '#888'; ctx.fillRect(x, y, 50, 50); }
      else { ctx.fillStyle = '#3a7d32'; ctx.fillRect(x, y, 50, 50); }
    }
  }
}

function drawBuildings() {
  for (const b of worldData.buildings) {
    // Определяем цвет в зависимости от типа здания
    let baseColor, windowColor, accentColor;
    switch (b.type) {
      case 'residential': // жилые
        baseColor = '#8b6f47';
        windowColor = '#ffeb3b';
        accentColor = '#5d4037';
        break;
      case 'commercial': // коммерческие
        baseColor = '#4a6fa5';
        windowColor = '#aaddff';
        accentColor = '#2c4a6f';
        break;
      case 'industrial': // промышленные
        baseColor = '#606060';
        windowColor = '#ff8800';
        accentColor = '#404040';
        break;
      default:
        baseColor = '#6b6b6b';
        windowColor = '#88ccff';
        accentColor = '#444';
    }
    
    // Фон здания
    ctx.fillStyle = baseColor;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    
    // Контур
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    
    // Количество этажей
    const floors = b.floors || 1;
    const floorHeight = b.h / floors;
    
    // Рисуем этажи
    for (let f = 0; f < floors; f++) {
      const floorY = b.y + f * floorHeight;
      
      // Линия между этажами
      if (f > 0) {
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(b.x, floorY);
        ctx.lineTo(b.x + b.w, floorY);
        ctx.stroke();
      }
      
      // Окна для этого этажа
      const windowSize = 8;
      const spacingH = 18;
      const spacingV = 16;
      const margin = 10;
      
      for (let wy = floorY + margin; wy < floorY + floorHeight - margin; wy += spacingV) {
        for (let wx = b.x + margin; wx < b.x + b.w - margin; wx += spacingH) {
          // Рамка окна
          ctx.fillStyle = windowColor;
          ctx.fillRect(wx, wy, windowSize, windowSize - 2);
          ctx.strokeStyle = accentColor;
          ctx.lineWidth = 1;
          ctx.strokeRect(wx, wy, windowSize, windowSize - 2);
        }
      }
    }
    
    // Особенности по типу здания
    if (b.type === 'residential') {
      // Дверь
      ctx.fillStyle = '#8b4513';
      const doorW = 16, doorH = 24;
      ctx.fillRect(b.x + b.w/2 - doorW/2, b.y + b.h - doorH, doorW, doorH);
      // Дверная ручка
      ctx.fillStyle = '#ffd700';
      ctx.beginPath(); ctx.arc(b.x + b.w/2 + doorW/4, b.y + b.h - doorH/2, 2, 0, Math.PI*2); ctx.fill();
    }
    
    if (b.type === 'commercial') {
      // Большие витрины
      ctx.fillStyle = '#aaf';
      ctx.fillRect(b.x + 5, b.y + 5, b.w - 10, 20);
      ctx.strokeStyle = '#88ccff';
      ctx.lineWidth = 2;
      ctx.strokeRect(b.x + 5, b.y + 5, b.w - 10, 20);
    }
    
    if (b.type === 'industrial') {
      // Ворота
      ctx.fillStyle = '#444';
      const gateW = Math.min(50, b.w * 0.6);
      ctx.fillRect(b.x + b.w/2 - gateW/2, b.y + b.h - 30, gateW, 25);
      // Полосы на воротах
      ctx.strokeStyle = '#666';
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const gx = b.x + b.w/2 - gateW/2 + i*(gateW/3);
        ctx.beginPath(); ctx.moveTo(gx, b.y + b.h - 30); ctx.lineTo(gx, b.y + b.h - 5); ctx.stroke();
      }
    }
  }
}

function drawTrees() {
  for (const t of worldData.trees) {
    ctx.fillStyle='#5a3a1a'; ctx.fillRect(t.x-2, t.y-2, 4, 8);
    ctx.fillStyle='#2d8a2d'; ctx.beginPath(); ctx.arc(t.x, t.y-4, t.radius, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle='#3aaa3a'; ctx.beginPath(); ctx.arc(t.x-3, t.y-6, t.radius*0.7, 0, Math.PI*2); ctx.fill();
  }
}

function drawSpecialObjects(special) {
  for (const id in special) {
    const so = special[id];
    ctx.save();
    ctx.translate(so.x, so.y);
    
    switch (so.type) {
      case 'bank':
        // Банк - здание с вывеской
        ctx.fillStyle = '#2c3e50';
        ctx.fillRect(-so.w/2, -so.h/2, so.w, so.h);
        ctx.strokeStyle = '#34495e';
        ctx.lineWidth = 3;
        ctx.strokeRect(-so.w/2, -so.h/2, so.w, so.h);
        // Колонны
        ctx.fillStyle = '#ecf0f1';
        for (let i = 0; i < 3; i++) {
          ctx.fillRect(-so.w/2 + 20 + i*60, -so.h/2 + 20, 10, so.h - 40);
        }
        // Вывеска
        ctx.fillStyle = '#f1c40f';
        ctx.fillRect(-so.w/2 + 10, -so.h/2 - 30, so.w - 20, 25);
        ctx.fillStyle = '#2c3e50';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('BANK', 0, -so.h/2 - 12);
        break;
        
      case 'gas_station':
        // АЗС - колонка с бензином
        ctx.fillStyle = '#7f8c8d';
        ctx.fillRect(-30, -50, 60, 100);
        // Корпус колонки
        ctx.fillStyle = '#95a5a6';
        ctx.fillRect(-20, -80, 40, 30);
        // Экран
        ctx.fillStyle = '#2ecc71';
        ctx.fillRect(-15, -75, 30, 20);
        // Знак бензина
        ctx.fillStyle = '#e74c3c';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('FUEL', 0, -60);
        break;
        
      case 'garage':
        // Гараж - ворота
        ctx.fillStyle = '#7f8c8d';
        ctx.fillRect(-so.w/2, -so.h/2, so.w, so.h);
        // Ворота (расщеплены)
        ctx.fillStyle = '#95a5a6';
        ctx.fillRect(-so.w/2, -so.h/2, so.w/2 - 5, so.h);
        ctx.fillRect(5, -so.h/2, so.w/2 - 5, so.h);
        // Дверь
        ctx.fillStyle = '#34495e';
        ctx.fillRect(-so.w/2 + 10, -so.h/2 + 10, 25, 40);
        ctx.fillRect(so.w/2 - 35, -so.h/2 + 10, 25, 40);
        break;
        
      case 'police_station':
        // Полицейский участок
        ctx.fillStyle = '#2c3e50';
        ctx.fillRect(-so.w/2, -so.h/2, so.w, so.h);
        // Синие полосы
        ctx.fillStyle = '#3498db';
        for (let i = 0; i < 5; i++) {
          ctx.fillRect(-so.w/2, -so.h/2 + i*40, so.w, 20);
        }
        // Окна
        ctx.fillStyle = '#ecf0f1';
        ctx.fillRect(-so.w/2 + 20, -so.h/2 + 20, 40, 60);
        ctx.fillRect(so.w/2 - 60, -so.h/2 + 20, 40, 60);
        // Знак
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 18px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('POLICE', 0, 10);
        break;
    }
    
    ctx.restore();
  }
}

function drawItem(item) {
  if (item.type === 'health') {
    ctx.fillStyle='#0f0'; ctx.fillRect(item.x-3, item.y-8, 6, 16); ctx.fillRect(item.x-8, item.y-3, 16, 6);
    ctx.strokeStyle='#080'; ctx.lineWidth=1; ctx.strokeRect(item.x-3, item.y-8, 6, 16); ctx.strokeRect(item.x-8, item.y-3, 16, 6);
  } else {
    ctx.fillStyle='#ff8800'; ctx.beginPath(); ctx.arc(item.x, item.y, 7, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle='#c60'; ctx.fillRect(item.x+3, item.y-2, 10, 4);
    ctx.strokeStyle='#840'; ctx.lineWidth=1; ctx.beginPath(); ctx.arc(item.x, item.y, 7, 0, Math.PI*2); ctx.stroke();
  }
}

function drawVehicle(v) {
  ctx.save(); ctx.translate(v.x, v.y); ctx.rotate(v.rotation);
  
  // Припаркованные машины рисуем серым
  if (v.isParked) {
    ctx.fillStyle = '#666666';
  } else if (v.hp <= 0) {
    ctx.fillStyle = '#444';
  } else {
    ctx.fillStyle = v.color || '#48f';
  }
  
  ctx.fillRect(-v.width/2, -v.height/2, v.width, v.height);
  
  // Окно
  ctx.fillStyle = 'rgba(150,200,255,0.5)'; 
  ctx.fillRect(-3, -v.height/2+2, 8, v.height-4);
  
  // Контур
  ctx.strokeStyle = '#333'; ctx.lineWidth = 1; 
  ctx.strokeRect(-v.width/2, -v.height/2, v.width, v.height);
  
  // Припаркованные машины - крест и ручной тормоз
  if (v.isParked) {
    ctx.strokeStyle = '#222'; ctx.lineWidth = 2;
    // Крест (знак "не угоняйте")
    ctx.beginPath();
    ctx.moveTo(-v.width/2 + 6, -v.height/2 + 6);
    ctx.lineTo(v.width/2 - 6, v.height/2 - 6);
    ctx.moveTo(v.width/2 - 6, -v.height/2 + 6);
    ctx.lineTo(-v.width/2 + 6, v.height/2 - 6);
    ctx.stroke();
    // Полоска ручного тормоза
    ctx.fillStyle = '#222';
    ctx.fillRect(v.width/2 + 2, -v.height/2, 3, v.height);
  }
  
  ctx.restore();
  
  // Полоска HP (только если повреждена или это полицейская машина)
  if (v.hp < v.maxHp || v.type === 'police') {
    const p = v.hp/v.maxHp;
    ctx.fillStyle='#333'; ctx.fillRect(v.x-15, v.y-v.height/2-8, 30, 4);
    ctx.fillStyle = p>0.5?'#2ecc71':p>0.25?'#f39c12':'#e74c3c'; ctx.fillRect(v.x-15, v.y-v.height/2-8, 30*p, 4);
  }
  
  // Мигающие сирены полицейских машин (движущиеся или с полицейским внутри)
  if (v.type === 'police' && (!v.isParked || (v.npcDriver === 'cop'))) {
    const t = Date.now()/200;
    ctx.fillStyle = Math.sin(t)>0?'#f00':'#04f';
    ctx.beginPath(); ctx.arc(v.x-6, v.y-12, 4, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = Math.sin(t+Math.PI)>0?'#f00':'#04f';
    ctx.beginPath(); ctx.arc(v.x+6, v.y-12, 4, 0, Math.PI*2); ctx.fill();
  }
}

function drawNPC(npc) {
  const color = NPC_COLORS[npc.type] || '#8c8', r = npc.radius || 8;
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(npc.x, npc.y, r, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(npc.x, npc.y); ctx.lineTo(npc.x+Math.cos(npc.rotation)*(r+5), npc.y+Math.sin(npc.rotation)*(r+5)); ctx.stroke();
  if (npc.hp < npc.maxHp) {
    const p = npc.hp/npc.maxHp;
    ctx.fillStyle='#333'; ctx.fillRect(npc.x-8, npc.y-r-6, 16, 3);
    ctx.fillStyle = p>0.5?'#2ecc71':p>0.25?'#f39c12':'#e74c3c'; ctx.fillRect(npc.x-8, npc.y-r-6, 16*p, 3);
  }
}

function drawPlayer(p, isMe) {
  if (!p.alive) return;
  ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rotation);
  const grad = ctx.createRadialGradient(-2, -2, 0, 0, 0, 12);
  if (isMe) { grad.addColorStop(0,'#6cf'); grad.addColorStop(1,'#28c'); }
  else { grad.addColorStop(0,'#fc4'); grad.addColorStop(1,'#c80'); }
  ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = isMe?'#05a':'#850'; ctx.lineWidth=2; ctx.stroke();
  ctx.strokeStyle = isMe?'#8df':'#fd6'; ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(20, 0); ctx.stroke();
  ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(4,-3,3,0,Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.arc(4,3,3,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#222'; ctx.beginPath(); ctx.arc(6,-3,1.5,0,Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.arc(6,3,1.5,0,Math.PI*2); ctx.fill();
  ctx.restore();
  if (p.hp < p.maxHp || isMe) {
    const hp = p.hp/p.maxHp;
    ctx.fillStyle='#333'; ctx.fillRect(p.x-12, p.y-20, 24, 4);
    ctx.fillStyle = hp>0.5?'#2ecc71':hp>0.25?'#f39c12':'#e74c3c'; ctx.fillRect(p.x-12, p.y-20, 24*hp, 4);
  }
  if (!isMe || isMultiplayer) {
    ctx.fillStyle='#fff'; ctx.font='12px Arial'; ctx.textAlign='center'; ctx.fillText(p.nick||'Player', p.x, p.y-28);
  }
}

function drawBullet(b) {
  ctx.fillStyle='#ff0'; ctx.shadowColor='#ff0'; ctx.shadowBlur=6; ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, Math.PI*2); ctx.fill(); ctx.shadowBlur=0;
  ctx.strokeStyle='rgba(255,255,0,0.3)'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x-b.vx*2, b.y-b.vy*2); ctx.stroke();
}

function drawMinimap() {
  const s = 150 / WORLD_W;
  minimapCtx.fillStyle = '#0a0a14'; minimapCtx.fillRect(0, 0, 150, 150);
  
  if (worldData) {
    // Здания
    minimapCtx.fillStyle = '#2a2a3a';
    for (const b of worldData.buildings) {
      minimapCtx.fillRect(b.x*s, b.y*s, b.w*s, b.h*s);
    }
    // Дороги
    if (worldData.roadRows) {
      minimapCtx.fillStyle = '#1a1a2a';
      for (const r of worldData.roadRows) minimapCtx.fillRect(0, r*50*s, 150, 50*s);
      for (const c of worldData.roadCols) minimapCtx.fillRect(c*50*s, 0, 50*s, 150);
    }
  }
  
  if (gameState) {
    // Машины
    for (const id in gameState.vehicles) {
      const v = gameState.vehicles[id];
      if (v.isParked) {
        minimapCtx.fillStyle = 'rgba(150,150,150,0.6)';
        minimapCtx.fillRect(v.x*s-1, v.y*s-1, 2, 2);
      } else {
        if (v.driver !== null) {
          minimapCtx.fillStyle = '#0f8';
        } else if (v.npcDriver === 'cop') {
          minimapCtx.fillStyle = '#48f';
        } else {
          minimapCtx.fillStyle = '#aa0';
        }
        minimapCtx.fillRect(v.x*s-1.5, v.y*s-1, 3, 2);
      }
    }
    
    // NPC
    for (const id in gameState.npcs) {
      const n = gameState.npcs[id];
      // Если полицейский в машине, не показываем отдельно
      if (n.vehicleId && gameState.vehicles[n.vehicleId]) continue;
      
      minimapCtx.fillStyle = n.type==='cop'?'#48f':n.type==='gangster'?'#f44':'#8c8';
      minimapCtx.beginPath();
      minimapCtx.arc(n.x*s, n.y*s, n.type==='cop'?2:1.5, 0, Math.PI*2);
      minimapCtx.fill();
    }
    
    // Предметы
    for (const id in gameState.items) {
      const it = gameState.items[id];
      minimapCtx.fillStyle = it.type==='health'?'#0f0':'#f80';
      minimapCtx.beginPath(); minimapCtx.arc(it.x*s, it.y*s, 1.5, 0, Math.PI*2); minimapCtx.fill();
    }
    
    // Игроки
    for (const id in gameState.players) {
      const p = gameState.players[id];
      if (id === playerId) {
        // Свой игрок - большой кружок с направлением
        minimapCtx.fillStyle = '#0f8';
        minimapCtx.beginPath(); minimapCtx.arc(p.x*s, p.y*s, 4, 0, Math.PI*2); minimapCtx.fill();
        // Направление
        const angle = p.rotation || 0;
        minimapCtx.strokeStyle = '#0f8';
        minimapCtx.lineWidth = 2;
        minimapCtx.beginPath();
        minimapCtx.moveTo(p.x*s, p.y*s);
        minimapCtx.lineTo(p.x*s + Math.cos(angle)*6, p.y*s + Math.sin(angle)*6);
        minimapCtx.stroke();
      } else {
        // Другие игроки
        minimapCtx.fillStyle = '#fc0';
        minimapCtx.beginPath(); minimapCtx.arc(p.x*s, p.y*s, 2.5, 0, Math.PI*2); minimapCtx.fill();
        // Направление
        const angle = p.rotation || 0;
        minimapCtx.strokeStyle = '#fc0';
        minimapCtx.lineWidth = 1;
        minimapCtx.beginPath();
        minimapCtx.moveTo(p.x*s, p.y*s);
        minimapCtx.lineTo(p.x*s + Math.cos(angle)*4, p.y*s + Math.sin(angle)*4);
        minimapCtx.stroke();
      }
    }
    
    // Особые объекты
    if (gameState.special) {
      for (const id in gameState.special) {
        const so = gameState.special[id];
        minimapCtx.fillStyle = so.type === 'bank' ? '#3498db' :
                              so.type === 'gas_station' ? '#2ecc71' :
                              so.type === 'police_station' ? '#e74c3c' : '#95a5a6';
        minimapCtx.fillRect(so.x*s-2, so.y*s-2, 4, 4);
      }
    }
  }
  
  // Граница
  minimapCtx.strokeStyle = '#446'; minimapCtx.lineWidth = 2; minimapCtx.strokeRect(0, 0, 150, 150);
  
  // Легенда
  minimapCtx.fillStyle = '#667';
  minimapCtx.font = '6px Arial';
  minimapCtx.fillText('●self ◆parked ■npc ◆loc', 5, 148);
}

// ===== ГЛАВНЫЙ ЦИКЛ =====
requestAnimationFrame(function loop() { draw(); requestAnimationFrame(loop); });
