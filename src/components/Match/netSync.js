import { serverNow } from '../../firebase/config';
import {
  markPresence,
  pushMatchEvent,
  sendPlayerState,
  watchMatchEvents,
} from '../../firebase/matchService';
import { useMatchStore } from '../../store/matchStore';
import {
  applyRemoteShatter,
  applyRemoteStroke,
  attachChargeById,
  damagePlayer,
  rebuildMasks,
  spawnRemoteCharge,
  spawnTracer,
} from './ActionPhase';
import { attachHeldRig, heldFlash, holdWeapon } from './heldWeapon';

const SEND_MS = 66;
const TEAM_COLORS = { ATLAS: 0x3f8cff, OUTLIERS: 0xff5a47 };
const FFA_ENEMY = 0xff8a3d;

function nameTag(game, text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = '600 30px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeText(text, 128, 32);
  ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  ctx.fillText(text, 128, 32);
  const tex = new game.THREE.CanvasTexture(canvas);
  const mat = new game.THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  game.materialDisposables.push(mat);
  const sprite = new game.THREE.Sprite(mat);
  sprite.scale.set(1.4, 0.35, 1);
  sprite.position.set(0, 1.2, 0);
  sprite.raycast = () => {};
  return sprite;
}

function makeAvatar(game, uid, info) {
  const THREE = game.THREE;
  if (!game.avatarGeo) {
    game.avatarGeo = {
      body: new THREE.BoxGeometry(0.62, 1.32, 0.5),
      head: new THREE.BoxGeometry(0.34, 0.34, 0.34),
      visor: new THREE.BoxGeometry(0.3, 0.08, 0.04),
    };
    game.geometries.push(game.avatarGeo.body, game.avatarGeo.head, game.avatarGeo.visor);
  }
  const faction = info.faction === 'OUTLIERS' ? 'outliers' : 'atlas';
  // Only teammates get a floating nameplate; enemies (everyone in FFA) don't.
  const teammate = !game.ffa && faction === game.faction;
  const color = game.ffa ? FFA_ENEMY : TEAM_COLORS[info.faction] || 0xcccccc;
  const bodyMat = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.12 });
  const headMat = new THREE.MeshLambertMaterial({ color: 0xe9d3c4 });
  const visorMat = new THREE.MeshBasicMaterial({ color: 0x0f1620 });
  game.materialDisposables.push(bodyMat, headMat, visorMat);
  const body = new THREE.Mesh(game.avatarGeo.body, bodyMat);
  const head = new THREE.Mesh(game.avatarGeo.head, headMat);
  const visor = new THREE.Mesh(game.avatarGeo.visor, visorMat);
  head.position.set(0, 0.86, 0);
  visor.position.set(0, 0.03, -0.18);
  visor.raycast = () => {};
  head.add(visor);
  body.add(head);
  if (teammate) body.add(nameTag(game, info.name || 'Player', color));
  const holder = attachHeldRig(game, body, bodyMat, 0.42, info.weapon);
  body.userData = {
    w: 0.62, h: 1.32, d: 0.5, kind: 'remote', type: 'remote', part: 'body', uid, faction, solid: true, materialName: 'player',
  };
  head.userData = { type: 'remote', part: 'head', uid, faction, solid: true, materialName: 'player' };
  body.visible = false;
  game.scene.add(body);
  return {
    ...holder,
    uid,
    faction,
    name: info.name || 'Player',
    body,
    head,
    bodyMat,
    teammate,
    flash: 0,
    hp: 100,
    dealt: 0,
    alive: false,
    seen: false,
    target: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, crouch: 0, weapon: 'pistol' },
    shotN: null,
  };
}

// 3D sound placement for another player's sound: the Web Audio panner does
// direction + distance attenuation; range is a hard cut-off for quiet sounds.
function spatialFor(game, remote, range, floor, lift = 0) {
  const p = remote.body.position;
  const dist = Math.hypot(p.x - game.player.x, p.y - game.player.feetY - 0.66, p.z - game.player.z);
  const gain = dist > range ? floor : 1;
  return { gain, pos: { x: p.x, y: p.y + lift, z: p.z }, dist };
}

export function createNet(game, seat) {
  const spatial = (remote, range, floor) => spatialFor(game, remote, range, floor);
  const me = seat.uid;
  const matchId = seat.matchId;
  const queue = [];
  const shatterIds = [];
  let lastSend = 0;
  let shotN = 0;
  let shotSegments = null;
  let seedN = 0;
  let deathSent = false;
  const countedKills = new Set();
  game.remotes = new Map();
  game.remoteList = [];

  const emitFeed = (text) => game.emit('game:killfeed', { text });
  const nameOf = (uid) => (uid === me ? game.playerName : useMatchStore.getState().players?.[uid]?.name || 'Player');
  const factionOf = (uid) => (useMatchStore.getState().players?.[uid]?.faction || 'ATLAS');
  const send = (event) => pushMatchEvent(matchId, { round: game.round || 1, ...event }).catch(() => {});

  game.newSeed = () => {
    seedN += 1;
    return `${me.slice(0, 5)}${(game.round || 1).toString(36)}${seedN.toString(36)}${Date.now().toString(36).slice(-4)}`;
  };
  game.onPainted = (detail) => send({ type: 'paint', ...detail });
  game.onShatter = (id) => shatterIds.push(id);
  game.onShot = (segments) => {
    shotN += 1;
    shotSegments = segments.map((seg) => seg.map((n) => Math.round(n * 100) / 100));
  };
  game.onRemoteHit = (uid, dmg, part) => {
    send({ type: 'hit', to: uid, dmg, part });
    const remote = game.remotes.get(uid);
    if (!remote) return false;
    const before = remote.hp - remote.dealt;
    remote.dealt += dmg;
    return before > 0 && before - dmg <= 0;
  };
  game.onBomb = (spec) => send({ type: 'bomb', ...spec });
  game.onBombStick = (detail) => send({ type: 'bombStick', ...detail });
  game.onUplink = (ms) => send({ type: 'uplink', endsAt: serverNow() + ms });
  game.onDeath = (sourceName, sourceId) => {
    if (deathSent) return;
    deathSent = true;
    send({ type: 'kill', killer: sourceId || null, killerName: sourceName, victimName: game.playerName });
    game.deaths = (game.deaths || 0) + 1;
    sendPlayerState(matchId, { alive: false, hp: 0, deaths: game.deaths }).catch(() => {});
  };

  markPresence(matchId).catch(() => {});
  const stopEvents = watchMatchEvents(matchId, (event) => queue.push(event));

  const handle = (event) => {
    const fresh = serverNow() - (event.t || 0) < 4000;
    const mine = event.from === me;
    switch (event.type) {
      case 'paint':
        if (!mine) applyRemoteStroke(game, event);
        break;
      case 'shatter':
        if (!mine) applyRemoteShatter(game, event.ids);
        break;
      case 'hit':
        if (event.to === me && fresh && game.phase === 'action') {
          damagePlayer(game, Number(event.dmg) || 0, nameOf(event.from), event.from);
        }
        break;
      case 'kill':
        if (fresh) emitFeed(`${event.killerName || 'Someone'} ▸ ${event.victimName || nameOf(event.from)}`);
        if (event.killer === me && !mine && !countedKills.has(event.key)) {
          countedKills.add(event.key);
          game.kills = (game.kills || 0) + 1;
          sendPlayerState(matchId, { kills: game.kills }).catch(() => {});
          game.onHud?.();
        }
        break;
      case 'bomb':
        if (!mine && fresh) {
          const age = Math.max(0, (serverNow() - (event.t || 0)) / 1000);
          spawnRemoteCharge(game, event, factionOf(event.from) === 'OUTLIERS' ? 'outliers' : 'atlas', nameOf(event.from), age);
        }
        break;
      case 'bombStick':
        if (!mine && fresh) attachChargeById(game, event, me);
        break;
      case 'uplink':
        if (!mine && event.endsAt > serverNow()) {
          game.uplinkEndsAt = performance.now() + (event.endsAt - serverNow());
          emitFeed(`${nameOf(event.from)} armed the uplink — hold 30s`);
          game.onHud?.();
        }
        break;
      default:
        break;
    }
  };

  const drainEvents = () => {
    const round = game.round || 1;
    for (let i = 0; i < queue.length;) {
      const event = queue[i];
      if ((event.round || 1) < round) {
        queue.splice(i, 1);
        continue;
      }
      if ((event.round || 1) > round || (game.phase !== 'action' && event.type !== 'kill')) {
        i += 1;
        continue;
      }
      queue.splice(i, 1);
      handle(event);
    }
  };

  const syncRemotes = (dt) => {
    const players = useMatchStore.getState().players || {};
    let changed = false;
    for (const [uid, info] of Object.entries(players)) {
      if (uid === me) continue;
      let remote = game.remotes.get(uid);
      if (!remote) {
        if (!info.faction) continue;
        remote = makeAvatar(game, uid, info);
        game.remotes.set(uid, remote);
        game.remoteList.push(remote);
      }
      const alive = !!info.alive && !info.left && info.online !== false && typeof info.x === 'number';
      if (alive !== remote.alive) {
        remote.alive = alive;
        remote.body.visible = alive;
        changed = true;
      }
      const prot = !!info.prot && alive;
      if (prot !== !!remote.prot) {
        remote.prot = prot;
        remote.bodyMat.transparent = prot;
        remote.bodyMat.opacity = prot ? 0.45 : 1;
        remote.bodyMat.needsUpdate = true;
      }
      if (typeof info.hp === 'number' && info.hp !== remote.hp) {
        remote.hp = info.hp;
        remote.dealt = 0;
      }
      if (typeof info.x === 'number') {
        remote.target = {
          x: info.x,
          y: info.y || 0,
          z: info.z,
          yaw: info.yaw || 0,
          pitch: info.pitch || 0,
          crouch: info.crouch || 0,
          weapon: info.weapon || 'pistol',
        };
        const jump = Math.hypot(info.x - remote.body.position.x, info.z - remote.body.position.z);
        if (!remote.seen || jump > 6) {
          // first sighting or a respawn teleport: snap instead of gliding
          remote.seen = true;
          remote.body.position.set(info.x, (info.y || 0) + 0.66, info.z);
        }
      }
      if (info.shot && info.shot.n !== remote.shotN) {
        const first = remote.shotN === null;
        remote.shotN = info.shot.n;
        if (!first && game.phase === 'action') {
          remote.flash = 0.06;
          for (const seg of info.shot.s || []) {
            game._o.set(seg[0], seg[1], seg[2]);
            game._d.set(seg[3], seg[4], seg[5]);
            spawnTracer(game, game._o, game._d, seg[6], true);
          }
          game.sfx.shot(remote.target.weapon || 'pistol', spatial(remote, 200, 1, 0.8));
        }
      }
    }
    for (const remote of game.remoteList) {
      const t = remote.target;
      const k = Math.min(1, dt * 14);
      const crouchDrop = t.crouch * 0.4;
      const px = remote.body.position.x;
      const pz = remote.body.position.z;
      remote.body.position.x += (t.x - remote.body.position.x) * k;
      remote.body.position.y += (t.y + 0.66 - crouchDrop - remote.body.position.y) * k;
      remote.body.position.z += (t.z - remote.body.position.z) * k;
      let dy = t.yaw - remote.body.rotation.y;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      remote.body.rotation.y += dy * k;
      remote.rig.rotation.x += (t.pitch - remote.rig.rotation.x) * k;
      remote.head.rotation.x = remote.rig.rotation.x * 0.6;
      holdWeapon(game, remote, t.weapon);
      remote.flash = Math.max(0, remote.flash - dt);
      const flash = heldFlash(remote);
      if (flash) flash.visible = remote.flash > 0;
      const moved = Math.hypot(remote.body.position.x - px, remote.body.position.z - pz);
      const speed = dt > 0 ? moved / dt : 0;
      const running = remote.alive && speed > 3.4 && speed < 14 && t.crouch < 0.5;
      remote.stepDist = running ? (remote.stepDist || 0) + moved : 0;
      if (remote.stepDist > 1.9) {
        remote.stepDist = 0;
        const sound = spatial(remote, 28, 0, -0.6);
        if (sound.gain > 0) game.sfx.step?.({ ...sound, gain: 0.8, material: remote.groundMaterial });
      }
    }
    if (changed) rebuildMasks(game);
  };

  const sendState = (now) => {
    if (now - lastSend < SEND_MS) return;
    lastSend = now;
    const p = game.player;
    const state = {
      name: game.playerName,
      faction: game.faction === 'outliers' ? 'OUTLIERS' : 'ATLAS',
      x: Math.round(p.x * 100) / 100,
      y: Math.round(p.feetY * 100) / 100,
      z: Math.round(p.z * 100) / 100,
      yaw: Math.round(p.yaw * 100) / 100,
      pitch: Math.round(p.pitch * 100) / 100,
      weapon: game.mode,
      crouch: Math.round((p.crouch || 0) * 10) / 10,
      hp: p.hp,
      alive: p.hp > 0,
      prot: (game.protectUntil || 0) > performance.now(),
      kills: game.kills || 0,
      deaths: game.deaths || 0,
      online: true,
      left: false,
    };
    if (shotSegments) state.shot = { n: shotN, s: shotSegments };
    shotSegments = null;
    sendPlayerState(matchId, state).catch(() => {});
  };

  return {
    update(dt, now) {
      drainEvents();
      if (shatterIds.length) send({ type: 'shatter', ids: shatterIds.splice(0) });
      syncRemotes(dt);
      sendState(now);
    },
    playerInfo(uid) {
      return useMatchStore.getState().players?.[uid] || null;
    },
    revive() {
      deathSent = false;
      lastSend = 0;
    },
    resetRound() {
      deathSent = false;
      queue.splice(0, queue.length, ...queue.filter((event) => (event.round || 1) >= (game.round || 1)));
    },
    aliveCounts() {
      const counts = { ATLAS: 0, OUTLIERS: 0 };
      const roster = { ATLAS: 0, OUTLIERS: 0 };
      const mine = game.faction === 'outliers' ? 'OUTLIERS' : 'ATLAS';
      roster[mine] += 1;
      if (game.player.hp > 0) counts[mine] += 1;
      const players = useMatchStore.getState().players || {};
      for (const [uid, info] of Object.entries(players)) {
        if (uid === me || !info.faction) continue;
        if (info.left) continue;
        roster[info.faction] += 1;
        if (info.alive && info.online !== false) counts[info.faction] += 1;
      }
      return { counts, roster };
    },
    dispose() {
      stopEvents();
      for (const remote of game.remoteList) game.scene.remove(remote.body);
      game.remoteList = [];
      game.remotes.clear();
    },
  };
}
