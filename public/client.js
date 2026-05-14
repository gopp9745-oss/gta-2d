/**
 * GTA 2D - Client
 * Минимальный клиент: рендер, ввод, сеть, HUD.
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

// ===== РАЗМЕР =====
function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener('resize', resize); resize();

// ===== МЕНЮ =====
$('btn-singleplayer').onclick = () => startGame('game:singleplayer');
$('btn-multiplayer').onclick = () => { $('multiplayer-connect').style.display = 'flex'; $('menu-buttons').style.display = 'none'; };
$('btn-back').onclick = () => { $('multiplayer-connect').style.display = 'none'; $('menu-buttons').style.display = 'flex'; };
$('btn-connect').onclick = () => startGame('game:join');
$('nick-input').onkeydown = e => { if (e.key === 'Enter') $('btn-connect').click(); };

function startGame(eventType) {
  const nick = $('nick-input').value.trim() || 'Player';
  $('menu').style.display = 'none';
  $('game-screen').style.display = 'block';
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

// ===== ВВОД =====
// Используем e.code чтобы работало на любой раскладке
document.addEventListener('keydown', e => {
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
  const c = e.code;
  if (c === 'KeyW' || c === 'ArrowUp') { keys.up = false; e.preventDefault(); }
  else if (c === 'KeyS' || c === 'ArrowDown') { keys.down = false; e.preventDefault(); }
  else if (c === 'KeyA' || c === 'ArrowLeft') { keys.left = false; e.preventDefault(); }
  else if (c === 'KeyD' || c === 'ArrowRight') { keys.right = false; e.preventDefault(); }
});

canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  mouseX = e.clientX - r.left; mouseY = e.clientY - r.top;
});
canvas.addEventListener('mousedown', e => { if (e.button === 0) { mouseDown = true; e.preventDefault(); } });
canvas.addEventListener('mouseup', e => { if (e.button === 0) mouseDown = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());

// Отправка ввода каждые 50мс
function send(data) { if (socket && socket.connected) socket.emit('player:input', data); }
setInterval(() => {
  send({
    keys: { up: keys.up, down: keys.down, left: keys.left, right: keys.right },
    shoot: mouseDown,
    mouseX: Math.round(mouseX + cameraX),
    mouseY: Math.round(mouseY + cameraY)
  });
}, 50);

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
    ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(b.x+4, b.y+4, b.w, b.h);
    ctx.fillStyle = '#6b6b6b'; ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = '#444'; ctx.lineWidth = 2; ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = '#88ccff';
    for (let wx = b.x+8; wx < b.x+b.w-8; wx += 16) for (let wy = b.y+8; wy < b.y+b.h-8; wy += 16) ctx.fillRect(wx, wy, 8, 8);
  }
}

function drawTrees() {
  for (const t of worldData.trees) {
    ctx.fillStyle='#5a3a1a'; ctx.fillRect(t.x-2, t.y-2, 4, 8);
    ctx.fillStyle='#2d8a2d'; ctx.beginPath(); ctx.arc(t.x, t.y-4, t.radius, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle='#3aaa3a'; ctx.beginPath(); ctx.arc(t.x-3, t.y-6, t.radius*0.7, 0, Math.PI*2); ctx.fill();
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
  ctx.fillStyle = v.hp <= 0 ? '#444' : (v.color || '#48f');
  ctx.fillRect(-v.width/2, -v.height/2, v.width, v.height);
  ctx.fillStyle = 'rgba(150,200,255,0.5)'; ctx.fillRect(-3, -v.height/2+2, 8, v.height-4);
  ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.strokeRect(-v.width/2, -v.height/2, v.width, v.height);
  ctx.restore();
  if (v.hp < v.maxHp) {
    const p = v.hp/v.maxHp;
    ctx.fillStyle='#333'; ctx.fillRect(v.x-15, v.y-v.height/2-8, 30, 4);
    ctx.fillStyle = p>0.5?'#2ecc71':p>0.25?'#f39c12':'#e74c3c'; ctx.fillRect(v.x-15, v.y-v.height/2-8, 30*p, 4);
  }
  if (v.type === 'police' && v.driver === null) {
    const t = Date.now()/200;
    ctx.fillStyle = Math.sin(t)>0?'#f00':'#04f'; ctx.beginPath(); ctx.arc(v.x-6, v.y-12, 4, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = Math.sin(t+Math.PI)>0?'#f00':'#04f'; ctx.beginPath(); ctx.arc(v.x+6, v.y-12, 4, 0, Math.PI*2); ctx.fill();
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
  minimapCtx.fillStyle = '#1a1a2e'; minimapCtx.fillRect(0, 0, 150, 150);
  if (worldData) {
    minimapCtx.fillStyle = '#555';
    for (const b of worldData.buildings) minimapCtx.fillRect(b.x*s, b.y*s, b.w*s, b.h*s);
    if (worldData.roadRows) {
      minimapCtx.fillStyle = '#444';
      for (const r of worldData.roadRows) minimapCtx.fillRect(0, r*50*s, 150, 50*s);
      for (const c of worldData.roadCols) minimapCtx.fillRect(c*50*s, 0, 50*s, 150);
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