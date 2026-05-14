/**
 * GTA 2D - Server (Node.js + Express + Socket.IO)
 * Авторитарный сервер: вся логика мира выполняется здесь,
 * клиент только отправляет ввод и отображает состояние.
 */

const express = require('express');
const http = require('http');
const socketIO = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000
});

const PORT = process.env.PORT || 3000;

// Раздаём статические файлы из папки public
app.use(express.static(__dirname + '/public'));

// ===== КОНСТАНТЫ =====
const WORLD_W = 3000;
const WORLD_H = 3000;
const TILE_SIZE = 50;
const TICK_RATE = 30; // Гц
const TICK_MS = 1000 / TICK_RATE;

const WEAPONS = {
  pistol:   { name: 'Pistol', damage: 15, fireRate: 15, spread: 0, range: 300, bullets: 1 },
  auto:     { name: 'Auto',   damage: 10, fireRate: 5,  spread: 0.1, range: 400, bullets: 1 },
  shotgun:  { name: 'Shotgun',damage: 20, fireRate: 30, spread: 0.3, range: 200, bullets: 5 }
};
const WEAPON_LIST = ['pistol', 'auto', 'shotgun'];

const VEHICLE_TYPES = {
  car:     { hp: 100, speed: 5, color: '#4488ff' },
  police:  { hp: 150, speed: 7, color: '#222244' }
};

// ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====
function dist(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}

function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// ===== КЛАССЫ =====

class Player {
  constructor(id, nick, x, y) {
    this.id = id;
    this.nick = nick || 'Player';
    this.x = x;
    this.y = y;
    this.rotation = 0;
    this.hp = 100;
    this.maxHp = 100;
    this.weaponIndex = 0; // 0=pistol, 1=auto, 2=shotgun
    this.ammo = { pistol: 36, auto: 120, shotgun: 24 };
    this.wanted = 0;
    this.wantedTimer = 0;
    this.inVehicle = null; // id машины или null
    this.money = 0;
    this.alive = true;
    this.respawnTimer = 0;
    this.kills = 0;
    this.deaths = 0;
    // состояние стрельбы
    this.shooting = false;
    this.fireCooldown = 0;
    this.mouseX = x;
    this.mouseY = y;
    // ввод
    this.input = { up: false, down: false, left: false, right: false, shoot: false, weapon: -1, enterVehicle: false, pickup: false };
  }

  get weapon() {
    return WEAPON_LIST[this.weaponIndex];
  }

  respawn() {
    this.alive = true;
    this.hp = this.maxHp;
    this.weaponIndex = 0;
    this.ammo = { pistol: 36, auto: 120, shotgun: 24 };
    this.money = Math.floor(this.money * 0.5);
    this.inVehicle = null;
    this.wanted = 0;
    this.wantedTimer = 0;
    // спавн в случайном месте
    this.x = rand(200, WORLD_W - 200);
    this.y = rand(200, WORLD_H - 200);
  }
}

class Vehicle {
  constructor(id, type, x, y, rotation, isParked = false) {
    this.id = id;
    this.type = type;
    this.x = x;
    this.y = y;
    this.rotation = rotation || 0;
    this.hp = VEHICLE_TYPES[type].hp;
    this.maxHp = this.hp;
    this.speed = VEHICLE_TYPES[type].speed;
    this.driver = null; // id игрока
    this.npcDriver = null; // null, 'cop', 'pedestrian', 'gangster'
    this.targetX = x;
    this.targetY = y;
    this.width = 30;
    this.height = 16;
    this.isParked = isParked; // припаркована ли машина
    this.parkAngle = rotation || 0; // угол припарковки
    this.aiState = 'idle'; // idle, patrol, chase
    this.aiTimer = 0;
  }

  get color() {
    return VEHICLE_TYPES[this.type].color;
  }
}

class NPC {
  constructor(id, type, x, y) {
    this.id = id;
    this.type = type; // 'pedestrian', 'gangster', 'cop'
    this.x = x;
    this.y = y;
    this.rotation = rand(0, Math.PI * 2);
    this.hp = type === 'gangster' ? 80 : type === 'cop' ? 120 : 50;
    this.maxHp = this.hp;
    this.speed = type === 'cop' ? 3.5 : type === 'gangster' ? 2.5 : 1.2;
    this.aiState = 'wander'; // wander, chase, attack, flee
    this.aiTimer = 0;
    this.targetX = x;
    this.targetY = y;
    this.shootCooldown = 0;
    this.weapon = type === 'gangster' ? 'pistol' : type === 'cop' ? 'auto' : null;
    this.radius = 8;
  }
}

class Item {
  constructor(id, type, subtype, x, y) {
    this.id = id;
    this.type = type; // 'health' или 'weapon'
    this.subtype = subtype; // количество hp или название оружия
    this.x = x;
    this.y = y;
    this.radius = 8;
    this.lifetime = 300; // тиков (10 секунд)
  }
}

class Bullet {
  constructor(ownerId, weapon, x, y, angle) {
    this.ownerId = ownerId;
    this.weapon = weapon;
    this.x = x;
    this.y = y;
    this.vx = Math.cos(angle) * 10;
    this.vy = Math.sin(angle) * 10;
    this.damage = weapon.damage;
    this.range = weapon.range;
    this.distTraveled = 0;
    this.radius = 2;
    this.alive = true;
  }
}

// ===== ГЕНЕРАЦИЯ МИРА =====

/**
 * Генерирует карту: дороги, здания, деревья, особые объекты.
 * Возвращает объект с массивами препятствий.
 */
function generateWorld() {
  const buildings = [];
  const trees = [];
  const grid = [];
  const specialObjects = []; // банки, АЗС, гаражи

  // Сетка 60x60 (3000/50)
  for (let row = 0; row < 60; row++) {
    grid[row] = [];
    for (let col = 0; col < 60; col++) {
      grid[row][col] = 'grass';
    }
  }

  // Дороги: каждая 6-я строка и столбец — дорога
  const roadRows = [];
  const roadCols = [];
  for (let i = 0; i < 60; i += 6) {
    roadRows.push(i);
    roadCols.push(i);
  }

  // Размечаем дороги
  for (const row of roadRows) {
    for (let col = 0; col < 60; col++) {
      grid[row][col] = 'road';
    }
  }
  for (const col of roadCols) {
    for (let row = 0; row < 60; row++) {
      grid[row][col] = 'road';
    }
  }

  // Тротуары рядом с дорогами (только 1 ряд)
  for (const row of roadRows) {
    for (const dr of [-1, 1]) {
      const r = row + dr;
      if (r >= 0 && r < 60) {
        for (let col = 0; col < 60; col++) {
          if (grid[r][col] === 'grass') grid[r][col] = 'sidewalk';
        }
      }
    }
  }
  for (const col of roadCols) {
    for (const dc of [-1, 1]) {
      const c = col + dc;
      if (c >= 0 && c < 60) {
        for (let row = 0; row < 60; row++) {
          if (grid[row][c] === 'grass') grid[row][c] = 'sidewalk';
        }
      }
    }
  }

  // Здания — разные типы и этажи
  const buildingTypes = ['residential', 'commercial', 'industrial'];

  for (let row = 0; row < 60; row += 6) {
    for (let col = 0; col < 60; col += 6) {
      if (Math.random() < 0.6) {
        const bType = buildingTypes[randInt(0, 2)];
        const bw = 1 + Math.floor(Math.random() * 2); // 1-2 клетки
        const bh = 1 + Math.floor(Math.random() * 2); // 1-2 клетки
        const maxCol = 60 - bw;
        const maxRow = 60 - bh;
        const bc = Math.min(col + 1 + Math.floor(Math.random() * Math.max(1, maxCol - col - 1)), maxCol - 1);
        const br = Math.min(row + 1 + Math.floor(Math.random() * Math.max(1, maxRow - row - 1)), maxRow - 1);
        
        let canBuild = true;
        // Проверяем клетки
        for (let dr = 0; dr < bh && canBuild; dr++) {
          for (let dc = 0; dc < bw && canBuild; dc++) {
            const rr = br + dr, cc = bc + dc;
            if (rr >= 60 || cc >= 60 || (grid[rr][cc] !== 'grass' && grid[rr][cc] !== 'sidewalk')) {
              canBuild = false;
            }
          }
        }
        
        if (canBuild) {
          // Размечаем клетки
          for (let dr = 0; dr < bh; dr++) {
            for (let dc = 0; dc < bw; dc++) {
              grid[br + dr][bc + dc] = 'building';
            }
          }
          buildings.push({
            x: bc * TILE_SIZE,
            y: br * TILE_SIZE,
            w: bw * TILE_SIZE,
            h: bh * TILE_SIZE,
            type: bType,
            floors: 1 + Math.floor(Math.random() * 3) // 1-3 этажа
          });
        }
      }
    }
  }

  // ОСОБЫЕ ОБЪЕКТЫ (банки, АЗС, гаражи) - по краям карты
  const specialPositions = [
    { type: 'bank', x: 200, y: 200 },
    { type: 'bank', x: WORLD_W - 300, y: WORLD_H - 300 },
    { type: 'gas_station', x: 500, y: WORLD_H - 400 },
    { type: 'gas_station', x: WORLD_W - 600, y: 400 },
    { type: 'garage', x: WORLD_W/2 - 100, y: 300 },
    { type: 'garage', x: WORLD_W/2 + 50, y: WORLD_H - 400 },
    { type: 'police_station', x: 1500, y: 1500 }
  ];
  
  for (const sp of specialPositions) {
    // Проверяем, что место свободно (не на дороге и не в здании)
    const cellX = Math.floor(sp.x / TILE_SIZE);
    const cellY = Math.floor(sp.y / TILE_SIZE);
    if (cellX > 2 && cellX < 57 && cellY > 2 && cellY < 57) {
      // Проверяем, нет ли уже здания
      let occupied = false;
      for (let dr = 0; dr < 4 && !occupied; dr++) {
        for (let dc = 0; dc < 4 && !occupied; dc++) {
          if (grid[cellY+dr] && grid[cellY+dr][cellX+dc] !== 'grass') {
            occupied = true;
          }
        }
      }
      if (!occupied) {
        // Размечаем территорию
        for (let dr = 0; dr < 4; dr++) {
          for (let dc = 0; dc < 4; dc++) {
            if (cellY+dr < 60 && cellX+dc < 60) {
              grid[cellY+dr][cellX+dc] = 'special';
            }
          }
        }
        specialObjects.push({
          type: sp.type,
          x: sp.x,
          y: sp.y,
          w: 200,
          h: 200,
          interactRadius: 50
        });
      }
    }
  }

  // Деревья на газонах
  for (let row = 0; row < 60; row++) {
    for (let col = 0; col < 60; col++) {
      if (grid[row][col] === 'grass' && Math.random() < 0.08) {
        trees.push({
          x: col * TILE_SIZE + TILE_SIZE / 2,
          y: row * TILE_SIZE + TILE_SIZE / 2,
          radius: 10
        });
      }
    }
  }

  return { grid, buildings, trees, roadRows, roadCols, specialObjects };
}

// ===== КОЛЛИЗИИ =====

// ===== КОЛЛИЗИИ =====

function rectCircleCollision(rx, ry, rw, rh, cx, cy, cr) {
  const nearX = clamp(cx, rx, rx + rw);
  const nearY = clamp(cy, ry, ry + rh);
  return dist(cx, cy, nearX, nearY) < cr;
}

function pointInRect(px, py, rx, ry, rw, rh) {
  return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
}

function circleCollision(x1, y1, r1, x2, y2, r2) {
  return dist(x1, y1, x2, y2) < r1 + r2;
}

// ===== GAME WORLD =====

class GameWorld {
  constructor() {
    this.mapData = generateWorld();
    this.players = {}; // id -> Player
    this.vehicles = {}; // id -> Vehicle
    this.npcs = {}; // id -> NPC
    this.items = {}; // id -> Item
    this.specialObjects = {}; // id -> особые объекты
    this.bullets = []; // массив Bullet
    this.nextId = 1;
    
    // Преобразуем specialObjects из массива в объект с ID
    for (let i = 0; i < this.mapData.specialObjects.length; i++) {
      const sp = this.mapData.specialObjects[i];
      this.specialObjects[i] = {
        id: i,
        type: sp.type,
        x: sp.x,
        y: sp.y,
        w: sp.w,
        h: sp.h,
        interactRadius: sp.interactRadius || 50
      };
    }
    
    this.spawnNPCs();
    this.spawnVehicles();
    this.spawnItems();
  }

  genId() {
    return this.nextId++;
  }

  // ===== СПАВН =====

  spawnNPCs() {
    // Пешеходы
    for (let i = 0; i < 15; i++) {
      this.spawnNPC('pedestrian');
    }
    // Гангстеры
    for (let i = 0; i < 5; i++) {
      this.spawnNPC('gangster');
    }
    // Полиция (появляется при розыске)
  }

  spawnNPC(type) {
    let x, y;
    let attempts = 0;
    do {
      x = rand(100, WORLD_W - 100);
      y = rand(100, WORLD_H - 100);
      attempts++;
    } while (this.isInsideBuilding(x, y) && attempts < 20);

    const npc = new NPC(this.genId(), type, x, y);
    npc.targetX = rand(100, WORLD_W - 100);
    npc.targetY = rand(100, WORLD_H - 100);
    this.npcs[npc.id] = npc;
    return npc;
  }

  spawnVehicles() {
    const roadPositions = [
      [300, 300], [900, 300], [1500, 300], [2100, 300], [2700, 300],
      [300, 900], [900, 900], [1500, 900], [2100, 900], [2700, 900],
      [300, 1500], [900, 1500], [2100, 1500], [2700, 1500],
      [300, 2100], [900, 2100], [1500, 2100], [2100, 2100], [2700, 2100],
      [300, 2700], [900, 2700], [1500, 2700], [2100, 2700], [2700, 2700],
    ];
    
    // Движущиеся машины на дорогах (6 штук)
    for (let i = 0; i < 6; i++) {
      const pos = roadPositions[i % roadPositions.length];
      const type = Math.random() < 0.2 ? 'police' : 'car';
      const v = new Vehicle(this.genId(), type, pos[0], pos[1], rand(0, Math.PI * 2));
      v.npcDriver = type === 'police' ? 'cop' : 'pedestrian';
      v.aiState = 'patrol';
      this.vehicles[v.id] = v;
    }
    
    // ПРИПАРКОВАННЫЕ МАШИНЫ у зданий и на обочинах (12 штук)
    const parkedPositions = [];
    // Парковка вдоль дорог (с обочинами)
    for (const row of this.mapData.roadRows) {
      for (let col = 1; col < 60; col += 6) {
        if (col < 59) {
          parkedPositions.push({
            x: col * TILE_SIZE + TILE_SIZE/2,
            y: row * TILE_SIZE - 25,
            angle: -Math.PI/2
          });
          parkedPositions.push({
            x: col * TILE_SIZE + TILE_SIZE/2,
            y: row * TILE_SIZE + TILE_SIZE + 25,
            angle: Math.PI/2
          });
        }
      }
    }
    for (const col of this.mapData.roadCols) {
      for (let row = 1; row < 60; row += 6) {
        if (row < 59) {
          parkedPositions.push({
            x: col * TILE_SIZE - 25,
            y: row * TILE_SIZE + TILE_SIZE/2,
            angle: Math.PI
          });
          parkedPositions.push({
            x: col * TILE_SIZE + TILE_SIZE + 25,
            y: row * TILE_SIZE + TILE_SIZE/2,
            angle: 0
          });
        }
      }
    }
    
    // Спавним припаркованные машины
    for (let i = 0; i < 12 && i < parkedPositions.length; i++) {
      const pos = parkedPositions[i];
      // 20% шанс полицейской машины на парковке
      const type = Math.random() < 0.2 ? 'police' : 'car';
      const v = new Vehicle(this.genId(), type, pos.x, pos.y, pos.angle, true);
      v.npcDriver = null; // припаркованные машины без водителя
      v.aiState = 'idle';
      this.vehicles[v.id] = v;
    }
  }
  
  spawnItems() {
    const types = ['health', 'weapon', 'health', 'weapon', 'health'];
    const weaponTypes = ['pistol', 'auto', 'shotgun'];
    for (let i = 0; i < 5; i++) {
      const type = types[i % types.length];
      const subtype = type === 'weapon' ? weaponTypes[i % 3] : 25;
      this.spawnItem(type, subtype);
    }
  }

  spawnItem(type, subtype) {
    let x, y;
    let attempts = 0;
    do {
      x = rand(100, WORLD_W - 100);
      y = rand(100, WORLD_H - 100);
      attempts++;
    } while ((this.isInsideBuilding(x, y) || this.isOnRoad(x, y)) && attempts < 20);
    const item = new Item(this.genId(), type, subtype, x, y);
    this.items[item.id] = item;
    return item;
  }

  spawnCopPlayer(wantedLevel) {
    // Спавним полицейские машины с полицейскими внутри
    // Машины появляются на ближайшей дороге в радиусе 400-800 клеток от игрока
    for (const id in this.players) {
      const p = this.players[id];
      if (!p.alive) continue;
      
      // Количество полицейских зависит от уровня розыска (1-3 машины)
      const numCops = Math.min(wantedLevel, 3);
      for (let i = 0; i < numCops; i++) {
        // Ищем ближайшую дорогу в радиусе от игрока
        const angle = rand(0, Math.PI * 2);
        const minDist = 400;
        const maxDist = 800;
        
        // Сначала пытаемся найти позицию на дороге
        let spawnX, spawnY;
        let foundRoad = false;
        
        for (let attempt = 0; attempt < 20; attempt++) {
          const distFromPlayer = rand(minDist, maxDist);
          const testX = clamp(p.x + Math.cos(angle) * distFromPlayer, 100, WORLD_W - 100);
          const testY = clamp(p.y + Math.sin(angle) * distFromPlayer, 100, WORLD_H - 100);
          
          if (this.isOnRoad(testX, testY)) {
            spawnX = testX;
            spawnY = testY;
            foundRoad = true;
            break;
          }
        }
        
        // Если не нашли дорогу, спавним рядом с игроком (fallback)
        if (!foundRoad) {
          spawnX = clamp(p.x + rand(-200, 200), 50, WORLD_W - 50);
          spawnY = clamp(p.y + rand(-200, 200), 50, WORLD_H - 50);
        }
        
        // Создаём полицейскую машину
        const vehicle = new Vehicle(this.genId(), 'police', spawnX, spawnY, rand(0, Math.PI * 2));
        vehicle.npcDriver = 'cop';
        vehicle.aiState = 'chase';
        vehicle.targetPlayerId = p.id; // преследуем этого игрока
        this.vehicles[vehicle.id] = vehicle;
        
        // Создаём полицейского, который будет в этой машине
        const cop = new NPC(this.genId(), 'cop', spawnX, spawnY);
        cop.vehicleId = vehicle.id; // привязываем к машине
        cop.aiState = 'patrol';
        this.npcs[cop.id] = cop;
      }
    }
  }

  // ===== ПРОВЕРКИ =====

  isInsideBuilding(x, y) {
    for (const b of this.mapData.buildings) {
      if (pointInRect(x, y, b.x, b.y, b.w, b.h)) return true;
    }
    return false;
  }

  isOnRoad(x, y) {
    const col = Math.floor(x / TILE_SIZE);
    const row = Math.floor(y / TILE_SIZE);
    if (row < 0 || row >= 60 || col < 0 || col >= 60) return false;
    return this.mapData.grid[row][col] === 'road';
  }

  isWalkable(x, y, radius) {
    if (x - radius < 0 || x + radius > WORLD_W || y - radius < 0 || y + radius > WORLD_H) return false;
    for (const b of this.mapData.buildings) {
      if (rectCircleCollision(b.x, b.y, b.w, b.h, x, y, radius)) return false;
    }
    return true;
  }

  findNearestVehicle(x, y) {
    let nearest = null;
    let minDist = 50; // дистанция взаимодействия
    for (const id in this.vehicles) {
      const v = this.vehicles[id];
      if (v.driver !== null) continue;
      const d = dist(x, y, v.x, v.y);
      if (d < minDist) {
        minDist = d;
        nearest = v;
      }
    }
    return nearest;
  }

  findNearestItem(x, y) {
    for (const id in this.items) {
      const item = this.items[id];
      if (dist(x, y, item.x, item.y) < 30) {
        return item;
      }
    }
    return null;
  }

  // ===== AI =====

   updateNPC(npc, dt) {
    // Если NPC находится в машине, он не ходит пешком
    if (npc.vehicleId && this.vehicles[npc.vehicleId]) {
      return; // Управление машиной осуществляется в updatePoliceVehicle
    }
    
    npc.aiTimer -= dt;
    npc.shootCooldown = Math.max(0, npc.shootCooldown - dt);

    let targetPlayer = null;
    let minDistToPlayer = Infinity;
    for (const id in this.players) {
      const p = this.players[id];
      if (!p.alive) continue;
      const d = dist(npc.x, npc.y, p.x, p.y);
      if (d < minDistToPlayer) {
        minDistToPlayer = d;
        targetPlayer = p;
      }
    }

    switch (npc.type) {
      case 'pedestrian': {
        // Случайное блуждание
        if (npc.aiTimer <= 0 || dist(npc.x, npc.y, npc.targetX, npc.targetY) < 20) {
          npc.targetX = rand(100, WORLD_W - 100);
          npc.targetY = rand(100, WORLD_H - 100);
          npc.aiTimer = rand(120, 300); // 4-10 секунд
        }
        this.moveEntity(npc, npc.targetX, npc.targetY, npc.speed);
        break;
      }
      case 'gangster': {
        if (targetPlayer && minDistToPlayer < 400) {
          npc.aiState = 'attack';
          if (npc.weapon && npc.shootCooldown <= 0) {
            const angle = Math.atan2(targetPlayer.y - npc.y, targetPlayer.x - npc.x);
            this.shootNPC(npc, angle);
            npc.shootCooldown = 20;
          }
          // Двигаться к игроку
          this.moveEntity(npc, targetPlayer.x, targetPlayer.y, npc.speed);
        } else {
          if (npc.aiTimer <= 0) {
            npc.targetX = rand(100, WORLD_W - 100);
            npc.targetY = rand(100, WORLD_H - 100);
            npc.aiTimer = rand(120, 300);
          }
          this.moveEntity(npc, npc.targetX, npc.targetY, npc.speed * 0.5);
        }
        break;
      }
      case 'cop': {
        // Полиция атакует только игроков с уровнем розыска > 0
        if (targetPlayer && targetPlayer.wanted > 0) {
          npc.aiState = 'chase';
          this.moveEntity(npc, targetPlayer.x, targetPlayer.y, npc.speed);
          if (minDistToPlayer < 300 && npc.weapon && npc.shootCooldown <= 0) {
            const angle = Math.atan2(targetPlayer.y - npc.y, targetPlayer.x - npc.x);
            this.shootNPC(npc, angle);
            npc.shootCooldown = 10;
          }
        } else {
          if (npc.aiTimer <= 0) {
            npc.targetX = rand(100, WORLD_W - 100);
            npc.targetY = rand(100, WORLD_H - 100);
            npc.aiTimer = rand(120, 300);
          }
          this.moveEntity(npc, npc.targetX, npc.targetY, npc.speed);
        }
        break;
      }
    }
  }

  moveEntity(entity, targetX, targetY, speed) {
    const dx = targetX - entity.x;
    const dy = targetY - entity.y;
    const d = Math.hypot(dx, dy);
    if (d < 2) return;
    const vx = (dx / d) * speed;
    const vy = (dy / d) * speed;
    entity.rotation = Math.atan2(dy, dx);
    const newX = entity.x + vx;
    const newY = entity.y + vy;
    if (this.isWalkable(newX, newY, entity.radius || 10)) {
      entity.x = newX;
      entity.y = newY;
    } else if (this.isWalkable(newX, entity.y, entity.radius || 10)) {
      entity.x = newX;
    } else if (this.isWalkable(entity.x, newY, entity.radius || 10)) {
      entity.y = newY;
    }
  }

  shootNPC(npc, angle) {
    const weapon = WEAPONS[npc.weapon || 'pistol'];
    const count = weapon.bullets;
    for (let i = 0; i < count; i++) {
      const spread = (Math.random() - 0.5) * weapon.spread * 2;
      const a = angle + spread;
      const bullet = new Bullet('npc_' + npc.id, weapon, npc.x, npc.y, a);
      this.bullets.push(bullet);
    }
  }

  // ===== ОБНОВЛЕНИЕ ИГРОКА =====

  updatePlayer(player) {
    if (!player.alive) return;

    const input = player.input;

    // Смена оружия
    if (input.weapon >= 0 && input.weapon <= 2) {
      player.weaponIndex = input.weapon;
    }

    // Движение
    let dx = 0, dy = 0;
    if (input.up) dy -= 1;
    if (input.down) dy += 1;
    if (input.left) dx -= 1;
    if (input.right) dx += 1;

    const speed = player.inVehicle !== null ? 0 : 3;

    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy);
      dx /= len;
      dy /= len;
      player.rotation = Math.atan2(dy, dx);

      const newX = player.x + dx * speed;
      const newY = player.y + dy * speed;

      if (player.inVehicle !== null) {
        // Управление машиной
        const v = this.vehicles[player.inVehicle];
        if (v) {
          const rot = Math.atan2(dy, dx);
          const diff = angleDiff(v.rotation, rot);
          v.rotation += diff * 0.1;
          const mvx = Math.cos(v.rotation) * v.speed;
          const mvy = Math.sin(v.rotation) * v.speed;
          const nvx = v.x + mvx;
          const nvy = v.y + mvy;
          if (this.isWalkable(nvx, nvy, v.width / 2)) {
            v.x = nvx;
            v.y = nvy;
            player.x = v.x;
            player.y = v.y;
          } else {
            v.hp = Math.max(0, v.hp - 0.5);
          }
          v.x = clamp(v.x, v.width / 2, WORLD_W - v.width / 2);
          v.y = clamp(v.y, v.height / 2, WORLD_H - v.height / 2);
        }
      } else {
        if (this.isWalkable(newX, newY, 8)) {
          player.x = newX;
          player.y = newY;
        } else if (this.isWalkable(newX, player.y, 8)) {
          player.x = newX;
        } else if (this.isWalkable(player.x, newY, 8)) {
          player.y = newY;
        }
      }

      player.x = clamp(player.x, 8, WORLD_W - 8);
      player.y = clamp(player.y, 8, WORLD_H - 8);
    }

    // Управление мышью (прицел)
    const targetRot = Math.atan2(player.mouseY - player.y, player.mouseX - player.x);
    if (!player.inVehicle) {
      player.rotation = targetRot;
    }

    // Стрельба
    if (player.fireCooldown > 0) player.fireCooldown--;
    if (input.shoot && player.fireCooldown <= 0) {
      this.playerShoot(player);
    }

    // Вход/выход из машины
    if (input.enterVehicle) {
      // Не сбрасываем флаг — клиент присылает его только по нажатию
      input.enterVehicle = false;
      if (player.inVehicle !== null) {
        const v = this.vehicles[player.inVehicle];
        if (v) {
          v.driver = null;
          player.x = v.x + Math.cos(v.rotation + Math.PI / 2) * 20;
          player.y = v.y + Math.sin(v.rotation + Math.PI / 2) * 20;
          player.inVehicle = null;
        }
      } else {
        const v = this.findNearestVehicle(player.x, player.y);
        if (v) {
          v.driver = player.id;
          player.inVehicle = v.id;
        }
      }
    }

    // Подбор предметов
    if (input.pickup) {
      input.pickup = false;
      const item = this.findNearestItem(player.x, player.y);
      if (item) {
        this.pickupItem(player, item);
      }
    }

    // Урон от столкновения с машинами
    for (const vid in this.vehicles) {
      const v = this.vehicles[vid];
      if (v.driver !== null && v.driver !== player.id && dist(player.x, player.y, v.x, v.y) < 20) {
        player.hp = Math.max(0, player.hp - 0.5);
      }
    }

    // Сбивание пешеходов
    for (const nid in this.npcs) {
      const npc = this.npcs[nid];
      if (player.inVehicle !== null && dist(player.x, player.y, npc.x, npc.y) < 25) {
        npc.hp = Math.max(0, npc.hp - 20);
        this.wantedIncrease(player, 1);
      }
    }

    // Проверка смерти
    if (player.hp <= 0) {
      player.alive = false;
      player.deaths++;
      player.respawnTimer = 90; // 3 секунды
      if (player.inVehicle !== null) {
        const v = this.vehicles[player.inVehicle];
        if (v) v.driver = null;
        player.inVehicle = null;
      }
    }
  }

  // Респавн — вызывается отдельно для мёртвых игроков
  respawnPlayer(player) {
    if (player.alive) return;
    player.respawnTimer--;
    if (player.respawnTimer <= 0) {
      player.respawn();
    }
  }

  playerShoot(player) {
    const weaponName = player.weapon;
    if (player.ammo[weaponName] <= 0) return;
    const weapon = WEAPONS[weaponName];
    player.ammo[weaponName]--;
    player.fireCooldown = weapon.fireRate;

    const count = weapon.bullets;
    for (let i = 0; i < count; i++) {
      const spread = (Math.random() - 0.5) * weapon.spread * 2;
      const angle = player.rotation + spread;
      const bullet = new Bullet(player.id, weapon, player.x, player.y, angle);
      this.bullets.push(bullet);
    }
  }

  pickupItem(player, item) {
    if (item.type === 'health') {
      player.hp = Math.min(player.maxHp, player.hp + (item.subtype || 25));
    } else if (item.type === 'weapon') {
      const wName = item.subtype;
      if (WEAPON_LIST.includes(wName)) {
        const idx = WEAPON_LIST.indexOf(wName);
        player.weaponIndex = idx;
        player.ammo[wName] += 30;
      }
    }
    delete this.items[item.id];
  }

  wantedIncrease(player, amount) {
    player.wanted = Math.min(5, player.wanted + amount);
    player.wantedTimer = 0;
    // Спавним полицию если розыск > 0
    if (player.wanted > 0 && Math.random() < 0.1) {
      this.spawnCopPlayer(player.wanted);
    }
  }

  // ===== ОБНОВЛЕНИЕ ПУЛЬ =====

  updateBullets() {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      if (!b.alive) {
        this.bullets.splice(i, 1);
        continue;
      }

      b.x += b.vx;
      b.y += b.vy;
      b.distTraveled += Math.hypot(b.vx, b.vy);

      // Проверка границ
      if (b.x < 0 || b.x > WORLD_W || b.y < 0 || b.y > WORLD_H || b.distTraveled > b.range) {
        b.alive = false;
        continue;
      }

      // Попадание в игроков
      for (const pid in this.players) {
        const p = this.players[pid];
        if (!p.alive) continue;
        if (b.ownerId === pid) continue; // свои пули не наносят урон (можно улучшить)
        if (typeof b.ownerId === 'string' && b.ownerId.startsWith('npc_')) {
          // пропускаем, NPC пули не попадают в других NPC, только в игроков
        }
        if (circleCollision(b.x, b.y, b.radius, p.x, p.y, 10)) {
          p.hp = Math.max(0, p.hp - b.damage);
          b.alive = false;
          // Повышаем розыск если стреляли в игрока из NPC
          if (b.ownerId === 'npc_cop') {
            // ничего
          }
          break;
        }
      }

      if (!b.alive) continue;

      // Попадание в NPC
      for (const nid in this.npcs) {
        const npc = this.npcs[nid];
        if (circleCollision(b.x, b.y, b.radius, npc.x, npc.y, npc.radius || 10)) {
          npc.hp = Math.max(0, npc.hp - b.damage);
          b.alive = false;
          if (typeof b.ownerId === 'string' && !b.ownerId.startsWith('npc_')) {
            // Игрок выстрелил в NPC
            const player = this.players[b.ownerId];
            if (player && npc.type === 'pedestrian') {
              this.wantedIncrease(player, 2);
            }
            if (npc.hp <= 0 && player) {
              player.kills++;
              if (npc.type === 'gangster' || npc.type === 'cop') {
                player.wanted = Math.max(0, player.wanted - 1);
              }
              // Выпадение предмета
              if (Math.random() < 0.4) {
                this.spawnItem(Math.random() < 0.5 ? 'health' : 'weapon',
                  Math.random() < 0.5 ? 25 : WEAPON_LIST[randInt(0, 2)]);
              }
            }
          }
          break;
        }
      }

      if (!b.alive) continue;

      // Попадание в машины
      for (const vid in this.vehicles) {
        const v = this.vehicles[vid];
        if (circleCollision(b.x, b.y, b.radius, v.x, v.y, v.width / 2)) {
          v.hp = Math.max(0, v.hp - b.damage);
          b.alive = false;
          if (typeof b.ownerId === 'string' && !b.ownerId.startsWith('npc_')) {
            const player = this.players[b.ownerId];
            if (player) {
              this.wantedIncrease(player, 1);
            }
          }
          break;
        }
      }
    }
  }

  // ===== УПРАВЛЕНИЕ NPC (ПОЛИЦИЯ ПРИ РОЗЫСКЕ) =====

  updateWantedSystem() {
    for (const pid in this.players) {
      const p = this.players[pid];
      if (!p.alive) continue;
      if (p.wanted > 0 && Math.random() < 0.02) {
        this.spawnCopPlayer(p.wanted);
      }
    }
  }

  // ===== ОЧИСТКА МЁРТВЫХ NPC =====

  cleanupDead() {
    for (const id in this.npcs) {
      if (this.npcs[id].hp <= 0) {
        delete this.npcs[id];
      }
    }
    // Респавн NPC если их мало
    const pedCount = Object.values(this.npcs).filter(n => n.type === 'pedestrian').length;
    const gangCount = Object.values(this.npcs).filter(n => n.type === 'gangster').length;
    if (pedCount < 10) this.spawnNPC('pedestrian');
    if (gangCount < 3) this.spawnNPC('gangster');
  }

  // ===== ОЧИСТКА МЁРТВЫХ МАШИН =====

  cleanupVehicles() {
    for (const id in this.vehicles) {
      const v = this.vehicles[id];
      if (v.hp <= 0) {
        // Взрыв
        if (v.driver) {
          const p = this.players[v.driver];
          if (p) {
            p.hp = Math.max(0, p.hp - 30);
            p.inVehicle = null;
          }
        }
        delete this.vehicles[id];
        // Респавн
        if (Object.keys(this.vehicles).length < 6) {
          const type = Math.random() < 0.2 ? 'police' : 'car';
          const nv = new Vehicle(this.genId(), type, rand(200, WORLD_W - 200), rand(200, WORLD_H - 200), rand(0, Math.PI * 2));
          nv.npcDriver = true;
          this.vehicles[nv.id] = nv;
        }
      }
    }
  }

  // ===== ОБНОВЛЕНИЕ ITEMS =====

  updateItems() {
    for (const id in this.items) {
      this.items[id].lifetime--;
      if (this.items[id].lifetime <= 0) {
        delete this.items[id];
      }
    }
    if (Object.keys(this.items).length < 3) {
      this.spawnItem(Math.random() < 0.5 ? 'health' : 'weapon',
        Math.random() < 0.5 ? 25 : WEAPON_LIST[randInt(0, 2)]);
    }
  }

  // ===== NPC МАШИНЫ (ДВИЖЕНИЕ ПО ДОРОГАМ) =====

  updateNPCVehicles() {
    for (const id in this.vehicles) {
      const v = this.vehicles[id];
      if (v.driver !== null) continue; // управляется игроком
      
      // Припаркованные машины не двигаются
      if (v.isParked) continue;
      
      // Полицейские машины управляются через отдельную логику
      if (v.npcDriver === 'cop') {
        this.updatePoliceVehicle(v);
        continue;
      }
      
      // Гражданские машины (с водителем-пешеходом или без)
      if (v.npcDriver === 'pedestrian' || v.npcDriver === 'gangster') {
        this.updateCivilianVehicle(v);
        continue;
      }
      
      // Обычное блуждание по дорогам
      this.updateWanderingVehicle(v);
    }
  }
  
  // Машины гражданных (ездят по дорогам)
  updateCivilianVehicle(v) {
    if (dist(v.x, v.y, v.targetX, v.targetY) < 50) {
      // Новая цель — случайная точка на дороге
      const roads = this.mapData.roadRows;
      const roadRow = roads[randInt(0, roads.length - 1)];
      v.targetX = rand(0, WORLD_W);
      v.targetY = roadRow * TILE_SIZE;
      // Случайный поворот
      v.rotation = rand(0, Math.PI * 2);
    }

    const dx = v.targetX - v.x;
    const dy = v.targetY - v.y;
    const d = Math.hypot(dx, dy);
    if (d > 2) {
      const targetRot = Math.atan2(dy, dx);
      const diff = angleDiff(v.rotation, targetRot);
      v.rotation += diff * 0.05;
      const mvx = Math.cos(v.rotation) * v.speed * 0.5;
      const mvy = Math.sin(v.rotation) * v.speed * 0.5;
      v.x += mvx;
      v.y += mvy;
      v.x = clamp(v.x, v.width / 2, WORLD_W - v.width / 2);
      v.y = clamp(v.y, v.height / 2, WORLD_H - v.height / 2);
    }
  }
  
  // Полицейские машины (преследуют игрока с розыском)
  updatePoliceVehicle(v) {
    // Находим цель
    let targetPlayer = null;
    let minDist = Infinity;
    
    for (const pid in this.players) {
      const p = this.players[pid];
      if (!p.alive) continue;
      if (p.wanted <= 0) continue;
      
      const d = dist(v.x, v.y, p.x, p.y);
      if (d < minDist) {
        minDist = d;
        targetPlayer = p;
      }
    }
    
    if (targetPlayer) {
      // Преследование игрока
      v.aiState = 'chase';
      const dx = targetPlayer.x - v.x;
      const dy = targetPlayer.y - v.y;
      const d = Math.hypot(dx, dy);
      
      if (d > 30) {
        const targetRot = Math.atan2(dy, dx);
        const diff = angleDiff(v.rotation, targetRot);
        v.rotation += diff * 0.08;
        const mvx = Math.cos(v.rotation) * v.speed * 0.7;
        const mvy = Math.sin(v.rotation) * v.speed * 0.7;
        
        // Проверка коллизий
        const newX = v.x + mvx;
        const newY = v.y + mvy;
        if (this.isWalkable(newX, newY, v.width / 2)) {
          v.x = newX;
          v.y = newY;
        } else {
          // Попытка объезда
          const tryAngles = [Math.PI/4, -Math.PI/4, Math.PI/2, -Math.PI/2];
          let moved = false;
          for (const offset of tryAngles) {
            const altRot = v.rotation + offset;
            const altX = v.x + Math.cos(altRot) * v.speed * 0.5;
            const altY = v.y + Math.sin(altRot) * v.speed * 0.5;
            if (this.isWalkable(altX, altY, v.width / 2)) {
              v.x = altX;
              v.y = altY;
              v.rotation = altRot;
              moved = true;
              break;
            }
          }
          if (!moved) {
            // Останавливаемся, но получаем урон от столкновений
            v.hp = Math.max(0, v.hp - 0.2);
          }
        }
      }
      v.x = clamp(v.x, v.width / 2, WORLD_W - v.width / 2);
      v.y = clamp(v.y, v.height / 2, WORLD_H - v.height / 2);
    } else {
      // Нет цели - патрулирование
      v.aiState = 'patrol';
      if (dist(v.x, v.y, v.targetX, v.targetY) < 50 || v.aiTimer <= 0) {
        const roads = this.mapData.roadRows;
        const roadRow = roads[randInt(0, roads.length - 1)];
        v.targetX = rand(100, WORLD_W - 100);
        v.targetY = roadRow * TILE_SIZE;
        v.aiTimer = rand(180, 480);
      }
      this.updateCivilianVehicle(v);
      v.aiTimer--;
    }
  }
  
  // Машины, которые просто ездят без водителя (блуждают)
  updateWanderingVehicle(v) {
    if (dist(v.x, v.y, v.targetX, v.targetY) < 50) {
      const roads = this.mapData.roadRows;
      const roadRow = roads[randInt(0, roads.length - 1)];
      v.targetX = rand(0, WORLD_W);
      v.targetY = roadRow * TILE_SIZE;
    }
    this.updateCivilianVehicle(v);
  }

  // ===== ГЛАВНЫЙ ЦИКЛ =====

   tick() {
    // Обновление игроков (включая респавн мёртвых)
    for (const id in this.players) {
      const p = this.players[id];
      if (p.alive) {
        this.updatePlayer(p);
      } else {
        this.respawnPlayer(p);
      }
    }

    // Обновление NPC (пешеходов и гангстеров, полицейские вне машин)
    for (const id in this.npcs) {
      const npc = this.npcs[id];
      // Пропускаем полицейских, которые в машинах
      if (npc.vehicleId && this.vehicles[npc.vehicleId]) continue;
      this.updateNPC(npc, 1);
    }

    // Обновление пуль
    this.updateBullets();

    // Обновление машин (включая полицейские, гражданские и припаркованные)
    this.updateNPCVehicles();

    // Система розыска
    this.updateWantedSystem();

    // Очистка мёртвых
    this.cleanupDead();
    this.cleanupVehicles();
    this.updateItems();

    // Сбор данных для отправки
    return this.getState();
  }

  // ===== ПОЛУЧЕНИЕ СОСТОЯНИЯ =====

  getState() {
    const players = {};
    for (const id in this.players) {
      const p = this.players[id];
      players[id] = {
        id: p.id, nick: p.nick, x: p.x, y: p.y, rotation: p.rotation,
        hp: p.hp, maxHp: p.maxHp, weaponIndex: p.weaponIndex,
        ammo: p.ammo, wanted: p.wanted, inVehicle: p.inVehicle,
        alive: p.alive, money: p.money, kills: p.kills, deaths: p.deaths
      };
    }

    const vehicles = {};
    for (const id in this.vehicles) {
      const v = this.vehicles[id];
      vehicles[id] = {
        id: v.id, type: v.type, x: v.x, y: v.y, rotation: v.rotation,
        hp: v.hp, maxHp: v.maxHp, driver: v.driver, color: v.color,
        width: v.width, height: v.height, isParked: v.isParked || false,
        npcDriver: v.npcDriver || null
      };
    }

    const npcs = {};
    for (const id in this.npcs) {
      const n = this.npcs[id];
      npcs[id] = {
        id: n.id, type: n.type, x: n.x, y: n.y, rotation: n.rotation,
        hp: n.hp, maxHp: n.maxHp, radius: n.radius
      };
    }

    const items = {};
    for (const id in this.items) {
      const it = this.items[id];
      items[id] = {
        id: it.id, type: it.type, subtype: it.subtype, x: it.x, y: it.y
      };
    }

    const special = {};
    for (const id in this.specialObjects) {
      const so = this.specialObjects[id];
      special[id] = {
        id: so.id, type: so.type, x: so.x, y: so.y, w: so.w, h: so.h
      };
    }

    const bullets = this.bullets.filter(b => b.alive).map(b => ({
      x: b.x, y: b.y, vx: b.vx, vy: b.vy, ownerId: b.ownerId
    }));

    return { players, vehicles, npcs, items, special, bullets };
  }
}

// ===== SOCKET.IO =====

const worlds = {}; // комнаты -> GameWorld

function getOrCreateWorld(roomId) {
  if (!worlds[roomId]) {
    worlds[roomId] = new GameWorld();
  }
  return worlds[roomId];
}

// Игровой цикл для каждой комнаты
setInterval(() => {
  for (const roomId in worlds) {
    const world = worlds[roomId];
    const state = world.tick();
    io.to(roomId).emit('game:state', state);
  }
}, TICK_MS);

// Удаляем пустые миры
setInterval(() => {
  for (const roomId in worlds) {
    const sockets = io.sockets.adapter.rooms.get(roomId);
    if (!sockets || sockets.size === 0) {
      delete worlds[roomId];
    }
  }
}, 60000);

io.on('connection', (socket) => {
  console.log('[connect]', socket.id);

  // Синглплеер
  socket.on('game:singleplayer', (nick) => {
    const room = 'singleplayer_' + socket.id;
    socket.join(room);
    const world = getOrCreateWorld(room);
    const player = new Player(socket.id, nick || 'Player', 200, 200);
    world.players[socket.id] = player;
    socket.emit('game:init', { world: world.mapData, playerId: socket.id });
    console.log('[singleplayer]', socket.id, nick);
  });

  // Мультиплеер
  socket.on('game:join', (nick) => {
    const room = 'multiplayer';
    socket.join(room);
    const world = getOrCreateWorld(room);
    const player = new Player(socket.id, nick || 'Player', rand(200, WORLD_W - 200), rand(200, WORLD_H - 200));
    world.players[socket.id] = player;
    socket.emit('game:init', { world: world.mapData, playerId: socket.id });
    io.to(room).emit('game:chat', { from: 'System', msg: nick + ' connected!' });
    console.log('[multiplayer]', socket.id, nick);
  });

  // Ввод игрока
  socket.on('player:input', (data) => {
    // Ищем мир где есть этот игрок
    for (const roomId in worlds) {
      const world = worlds[roomId];
      if (world.players[socket.id]) {
        const p = world.players[socket.id];
        if (data) {
          if (data.keys) {
            p.input.up = data.keys.up || false;
            p.input.down = data.keys.down || false;
            p.input.left = data.keys.left || false;
            p.input.right = data.keys.right || false;
          }
          if (data.shoot !== undefined) p.input.shoot = data.shoot;
          if (data.weapon !== undefined) p.input.weapon = data.weapon;
          if (data.enterVehicle !== undefined) p.input.enterVehicle = data.enterVehicle;
          if (data.pickup !== undefined) p.input.pickup = data.pickup;
          if (data.mouseX !== undefined && data.mouseY !== undefined) {
            p.mouseX = data.mouseX;
            p.mouseY = data.mouseY;
          }
        }
        break;
      }
    }
  });

  // Чат
  socket.on('player:chat', (msg) => {
    for (const roomId in worlds) {
      const world = worlds[roomId];
      if (world.players[socket.id]) {
        const p = world.players[socket.id];
        io.to(roomId).emit('game:chat', { from: p.nick, msg: msg });
        break;
      }
    }
  });

  // Отключение
  socket.on('disconnect', () => {
    console.log('[disconnect]', socket.id);
    for (const roomId in worlds) {
      const world = worlds[roomId];
      if (world.players[socket.id]) {
        delete world.players[socket.id];
        // Убираем из машин
        for (const vid in world.vehicles) {
          const v = world.vehicles[vid];
          if (v.driver === socket.id) v.driver = null;
        }
        io.to(roomId).emit('game:chat', { from: 'System', msg: 'Player disconnected' });
        break;
      }
    }
  });
});

// ===== ЗАПУСК =====

server.listen(PORT, '0.0.0.0', () => {
  console.log(`GTA 2D server running on http://0.0.0.0:${PORT}`);
});