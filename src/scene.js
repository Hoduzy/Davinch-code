// 3D 화면: 테이블, 타일, 카메라(고개 돌리기), 터치 선택
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/RoundedBoxGeometry.js';
import { JOKER } from './game.js';

const TILE_W = 0.15;
const TILE_H = 0.21;
const TILE_D = 0.06;
const GAP = 0.17;          // 줄에서 타일 간격
const MAX_ROW = 1.75;      // 줄 최대 길이 (넘으면 간격을 줄임)
const ROW_R = 1.0;         // 테이블 중심 ~ 각 줄 거리
const HELD_R = ROW_R - 0.26;
const CAM_POS = new THREE.Vector3(0, 0.75, 1.65);
const DEFAULT_PITCH = -0.5;

// 플레이어 인덱스 → 자리 각도 (0: 나, 1: 왼쪽, 2: 앞, 3: 오른쪽)
const SEAT_ANGLES = [0, -Math.PI / 2, Math.PI, Math.PI / 2];
const AVATAR_COLORS = [0x000000, 0xe57373, 0x64b5f6, 0x81c784];

const COLOR_BODY = { black: 0x1c1c22, white: 0xf1ede2 };
const COLOR_INK = { black: '#f5f1e6', white: '#17171c' };

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function seatQuat(seat) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(0, SEAT_ANGLES[seat], 0));
}

function quatFromEuler(x, y, z, order = 'XYZ') {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, order));
}

export class TableScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x2a2320);
    this.scene.fog = new THREE.Fog(0x2a2320, 4, 9);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 30);
    this.camera.position.copy(CAM_POS);
    this.camera.rotation.order = 'YXZ';
    this.yaw = 0;
    this.pitch = DEFAULT_PITCH;
    this.yawTarget = null;

    this.tileMeshes = new Map();
    this.faceTextures = new Map();
    this.interactive = new Set();
    this.selectedId = null;
    this.pilePos = new Map();
    this.onTap = null;
    this.clock = new THREE.Clock();

    this._buildRoom();
    this._bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));
    this.renderer.setAnimationLoop(() => this._frame());
  }

  // ---------- 방 / 테이블 / 상대 ----------
  _buildRoom() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0xfff4e0, 0x3a2e28, 0.9));
    const lamp = new THREE.DirectionalLight(0xffffff, 1.6);
    lamp.position.set(0.8, 3.2, 1.2);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(1024, 1024);
    Object.assign(lamp.shadow.camera, { left: -1.8, right: 1.8, top: 1.8, bottom: -1.8, near: 0.5, far: 6 });
    lamp.shadow.bias = -0.0005;
    s.add(lamp);

    const felt = new THREE.Mesh(
      new THREE.BoxGeometry(2.8, 0.06, 2.8),
      new THREE.MeshStandardMaterial({ color: 0x1f5f45, roughness: 0.95 }));
    felt.position.y = -0.03;
    felt.receiveShadow = true;
    s.add(felt);

    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.6 });
    for (let i = 0; i < 4; i++) {
      const rim = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.08, 0.1), wood);
      const q = seatQuat(i);
      rim.position.copy(new THREE.Vector3(0, -0.02, 1.45).applyQuaternion(q));
      rim.quaternion.copy(q);
      rim.receiveShadow = true;
      s.add(rim);
    }
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.7, 2.6), wood);
    base.position.y = -0.42;
    s.add(base);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20),
      new THREE.MeshStandardMaterial({ color: 0x3b302a, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.78;
    s.add(floor);

    // 현재 차례 표시 띠
    this.turnStrip = new THREE.Mesh(
      new THREE.PlaneGeometry(1.95, 0.3),
      new THREE.MeshBasicMaterial({ color: 0xffd54a, transparent: true, opacity: 0.16, depthWrite: false }));
    this.turnStrip.rotation.x = -Math.PI / 2;
    this.turnStrip.position.y = 0.002;
    s.add(this.turnStrip);

    // 상대 3명
    this.avatars = [];
    for (let seat = 1; seat < 4; seat++) {
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: AVATAR_COLORS[seat], roughness: 0.7 });
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.4, 6, 16), mat);
      body.position.y = 0.02;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 16),
        new THREE.MeshStandardMaterial({ color: 0xf0c9a0, roughness: 0.8 }));
      head.position.y = 0.55;
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
      for (const dx of [-0.06, 0.06]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 8), eyeMat);
        eye.position.set(dx, 0.58, -0.15);
        g.add(eye);
      }
      g.add(body, head);
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false }));
      label.position.set(0, 0.3, -0.32);
      label.scale.set(0.48, 0.12, 1);
      label.renderOrder = 10;
      g.add(label);
      const q = seatQuat(seat);
      g.position.copy(new THREE.Vector3(0, 0, 1.75).applyQuaternion(q));
      g.quaternion.copy(q);
      g.scale.setScalar(0.85);
      s.add(g);
      this.avatars[seat] = { group: g, label, key: '' };
    }

    this.tileGeo = new RoundedBoxGeometry(TILE_W, TILE_H, TILE_D, 3, 0.014);
    this.faceGeo = new THREE.PlaneGeometry(TILE_W * 0.84, TILE_H * 0.86);
  }

  _labelTexture(text, active, dead) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = dead ? 'rgba(60,60,60,0.85)' : active ? 'rgba(255,200,40,0.95)' : 'rgba(20,20,20,0.75)';
    x.beginPath();
    x.roundRect(8, 8, 496, 112, 56);
    x.fill();
    x.fillStyle = active && !dead ? '#1a1a1a' : '#ffffff';
    x.font = 'bold 64px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(text, 256, 68);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  _faceTexture(color, value) {
    const key = `${color}:${value}`;
    if (this.faceTextures.has(key)) return this.faceTextures.get(key);
    const c = document.createElement('canvas');
    c.width = 128; c.height = 184;
    const x = c.getContext('2d');
    x.fillStyle = color === 'black' ? '#1c1c22' : '#f1ede2';
    x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = COLOR_INK[color];
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    if (value === JOKER) {
      x.fillRect(22, 84, 84, 16);
      x.font = 'bold 22px sans-serif';
      x.fillText('JOKER', 64, 150);
    } else {
      x.font = `bold ${value >= 10 ? 84 : 112}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
      x.fillText(String(value), 64, 92);
      if (value === 6 || value === 9) x.fillRect(40, 150, 48, 8);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    this.faceTextures.set(key, t);
    return t;
  }

  // ---------- 타일 ----------
  reset(game) {
    for (const m of this.tileMeshes.values()) this.scene.remove(m);
    this.tileMeshes.clear();
    this.pilePos.clear();
    this.interactive.clear();
    this.selectedId = null;

    // 더미 자리: 7x4 격자를 섞어서 배정
    const slots = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 7; c++) slots.push([(c - 3) * 0.18, (r - 1.5) * 0.25]);
    slots.sort(() => Math.random() - 0.5);
    game.tiles.forEach((t, i) => {
      const [sx, sz] = slots[i];
      this.pilePos.set(t.id, {
        pos: new THREE.Vector3(sx + (Math.random() - 0.5) * 0.02, TILE_D / 2, sz + (Math.random() - 0.5) * 0.02),
        quat: new THREE.Quaternion()
          .setFromEuler(new THREE.Euler(0, (Math.random() - 0.5) * 0.25, 0))
          .multiply(quatFromEuler(Math.PI / 2, 0, 0)),
      });
    });

    for (const t of game.tiles) {
      const bodyMat = new THREE.MeshStandardMaterial({
        color: COLOR_BODY[t.color], roughness: 0.35, metalness: 0.05, emissive: 0x000000,
      });
      const mesh = new THREE.Mesh(this.tileGeo, bodyMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const p = this.pilePos.get(t.id);
      mesh.position.copy(p.pos);
      mesh.quaternion.copy(p.quat);
      mesh.userData = { tileId: t.id, bodyMat, face: null, tween: null, targetKey: '', state: 'pile' };
      this.scene.add(mesh);
      this.tileMeshes.set(t.id, mesh);
    }
    this.yawTarget = 0;
  }

  _setFace(mesh, tile, show) {
    const ud = mesh.userData;
    if (show && !ud.face) {
      ud.face = new THREE.Mesh(this.faceGeo,
        new THREE.MeshStandardMaterial({ map: this._faceTexture(tile.color, tile.value), roughness: 0.4 }));
      ud.face.position.z = TILE_D / 2 + 0.0015;
      mesh.add(ud.face);
    } else if (!show && ud.face) {
      mesh.remove(ud.face);
      ud.face = null;
    }
  }

  // 게임 상태 → 모든 타일의 목표 위치 계산 후 애니메이션
  // humanId 플레이어가 항상 내 자리(앞쪽)에 오도록 자리를 돌려서 배치
  // 타일 앞면은 값을 아는 타일(view에서 value가 있는 타일)에만 붙음
  sync(game, { humanId = 0, revealAll = false, stagger = 0 } = {}) {
    const poses = new Map();
    const n = game.players.length;
    const seatOf = (pid) => (pid - humanId + n) % n;
    this.humanId = humanId;

    for (const t of game.pile) poses.set(t.id, { ...this.pilePos.get(t.id), state: 'pile' });

    for (const p of game.players) {
      const seat = seatOf(p.id);
      const sq = seatQuat(seat);
      const n = p.hand.length;
      const gap = Math.min(GAP, MAX_ROW / Math.max(n - 1, 1));
      p.hand.forEach((t, i) => {
        const x = (i - (n - 1) / 2) * gap;
        const flat = t.revealed || revealAll;
        let local;
        let q;
        if (!flat) {
          local = new THREE.Vector3(x, TILE_H / 2, ROW_R);
          q = new THREE.Quaternion();
        } else if (seat === 0) {
          local = new THREE.Vector3(x, TILE_D / 2, ROW_R - 0.06);
          q = quatFromEuler(-Math.PI / 2, 0, 0);
        } else {
          local = new THREE.Vector3(x, TILE_D / 2, ROW_R + 0.04);
          q = quatFromEuler(Math.PI / 2, Math.PI, 0);
        }
        poses.set(t.id, {
          pos: local.applyQuaternion(sq),
          quat: sq.clone().multiply(q),
          state: flat ? 'flat' : 'stand',
        });
      });
    }

    // 손에 든 타일: 이번 차례에 뽑은 타일 + 초기 배치 대기 조커
    const held = [];
    if (game.drawn) held.push({ tile: game.drawn, pid: game.current });
    for (const ps of game.pendingSetup) held.push({ tile: game.tile(ps.tileId), pid: ps.playerId });
    const heldCount = {};
    for (const { tile, pid } of held) {
      const k = heldCount[pid] = (heldCount[pid] || 0) + 1;
      const sq = seatQuat(seatOf(pid));
      // 줄 오른쪽 끝 옆에 들고 있음 (주인 기준 오른쪽 = 로컬 +x)
      const n = game.player(pid).hand.length;
      const rowEnd = ((n - 1) / 2) * Math.min(GAP, MAX_ROW / Math.max(n - 1, 1));
      const x = Math.min(rowEnd + 0.3, 0.8) - (k - 1) * 0.2;
      let local;
      let q;
      if (seatOf(pid) === 0) {
        local = new THREE.Vector3(x, TILE_H / 2 + 0.04, HELD_R + 0.04);
        q = quatFromEuler(-0.35, -0.25, 0);
      } else {
        local = new THREE.Vector3(x, TILE_H / 2 + 0.03, HELD_R + 0.04);
        q = tile.revealed ? quatFromEuler(-0.2, Math.PI, 0) : new THREE.Quaternion();
      }
      poses.set(tile.id, { pos: local.applyQuaternion(sq), quat: sq.clone().multiply(q), state: 'held' });
    }

    let order = 0;
    for (const t of game.tiles) {
      const mesh = this.tileMeshes.get(t.id);
      const pose = poses.get(t.id);
      if (!pose) continue;
      this._setFace(mesh, t, t.value !== null && t.value !== undefined);

      const pos = pose.pos.clone();
      if (t.id === this.selectedId) pos.y += 0.05;
      const key = `${pos.x.toFixed(3)},${pos.y.toFixed(3)},${pos.z.toFixed(3)},${pose.quat.x.toFixed(3)},${pose.quat.y.toFixed(3)},${pose.quat.z.toFixed(3)},${pose.quat.w.toFixed(3)}`;
      if (key === mesh.userData.targetKey) continue;
      mesh.userData.targetKey = key;

      const from = mesh.userData.state;
      let lift = 0;
      let dur = 0.35;
      if (from !== pose.state) {
        if (from === 'pile' || pose.state === 'held') { lift = 0.3; dur = 0.7; }
        else if (pose.state === 'flat') { lift = 0.22; dur = 0.8; } // 뒤집기
        else { lift = 0.15; dur = 0.6; }
      }
      mesh.userData.state = pose.state;
      mesh.userData.tween = {
        fromPos: mesh.position.clone(), toPos: pos,
        fromQuat: mesh.quaternion.clone(), toQuat: pose.quat,
        t: 0, dur, lift, delay: from !== pose.state ? stagger * order++ : 0,
      };
    }

    this._updateSeats(game, seatOf);
  }

  _updateSeats(game, seatOf) {
    const q = seatQuat(seatOf(game.current));
    this.turnStrip.position.copy(new THREE.Vector3(0, 0.002, ROW_R - 0.08).applyQuaternion(q));
    this.turnStrip.quaternion.copy(q).multiply(quatFromEuler(-Math.PI / 2, 0, 0));
    this.turnStrip.visible = game.phase !== 'over';
    for (const p of game.players) {
      const seat = seatOf(p.id);
      if (seat === 0) continue;
      const av = this.avatars[seat];
      const active = game.current === p.id && game.phase !== 'over';
      const key = `${p.name}|${active}|${p.eliminated}`;
      if (key === av.key) continue;
      av.key = key;
      if (av.label.material.map) av.label.material.map.dispose();
      av.label.material.map = this._labelTexture(p.eliminated ? `${p.name} (탈락)` : p.name, active, p.eliminated);
      av.label.material.needsUpdate = true;
      av.group.children.forEach((c) => { if (c.isMesh) c.material.transparent = p.eliminated; });
      av.group.children.forEach((c) => { if (c.isMesh) c.material.opacity = p.eliminated ? 0.35 : 1; });
    }
  }

  /** 탭할 수 있는 타일 지정 (반짝임 표시) */
  setInteractive(ids) {
    this.interactive = new Set(ids);
  }

  setSelected(id) {
    this.selectedId = id;
  }

  isBusy() {
    for (const m of this.tileMeshes.values()) if (m.userData.tween) return true;
    return false;
  }

  lookAtSeat(seat) {
    this.yawTarget = [0, 0.75, 0, -0.75][seat];
  }

  resetView() {
    this.yawTarget = 0;
    this.pitchTarget = DEFAULT_PITCH;
  }

  // ---------- 입력 ----------
  _bindInput() {
    const el = this.canvas;
    let down = null;
    el.addEventListener('pointerdown', (e) => {
      if (down) return; // 두 번째 손가락 무시
      down = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, t: performance.now(), drag: false };
      el.setPointerCapture?.(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!down || e.pointerId !== down.id) return;
      if (!down.drag && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12) down.drag = true;
      if (down.drag) {
        const k = 2.4 / Math.max(window.innerWidth, 1);
        this.yaw = THREE.MathUtils.clamp(this.yaw + (e.clientX - down.lx) * k, -1.25, 1.25);
        this.pitch = THREE.MathUtils.clamp(this.pitch + (e.clientY - down.ly) * k * 0.6, -1.0, -0.1);
        this.yawTarget = null;
        this.pitchTarget = null;
      }
      down.lx = e.clientX;
      down.ly = e.clientY;
    });
    const end = (e) => {
      if (!down || e.pointerId !== down.id) return;
      const tap = !down.drag && performance.now() - down.t < 700;
      down = null;
      if (tap && e.type === 'pointerup') {
        const id = this.pick(e.clientX, e.clientY);
        if (id !== null && this.onTap) this.onTap(id);
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    document.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  /** 넉넉한 터치 판정: 탭한 지점과 화면상 가장 가까운 선택 가능 타일 */
  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector3();
    const top = new THREE.Vector3();
    let best = null;
    let bestD = Infinity;
    for (const id of this.interactive) {
      const m = this.tileMeshes.get(id);
      if (!m) continue;
      v.copy(m.position).project(this.camera);
      if (v.z > 1 || v.z < -1) continue; // 카메라 뒤
      const sx = rect.left + (v.x + 1) / 2 * rect.width;
      const sy = rect.top + (1 - v.y) / 2 * rect.height;
      top.copy(m.position).add(new THREE.Vector3(0, TILE_H / 2, 0)).project(this.camera);
      const halfH = Math.abs((top.y - v.y) / 2 * rect.height);
      const d = Math.hypot(clientX - sx, clientY - sy);
      const reach = Math.max(halfH * 1.3, 18) + 26;
      if (d < reach && d < bestD) { best = id; bestD = d; }
    }
    return best;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    // 세로 화면에서는 시야를 넓혀서 내 줄이 잘리지 않게
    const minHFov = THREE.MathUtils.degToRad(80);
    const vFromH = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(minHFov / 2) / aspect));
    this.camera.fov = THREE.MathUtils.clamp(vFromH, 58, 88);
    this.camera.updateProjectionMatrix();
  }

  // ---------- 매 프레임 ----------
  _frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const time = this.clock.elapsedTime;

    if (this.yawTarget !== null && this.yawTarget !== undefined) {
      this.yaw += (this.yawTarget - this.yaw) * Math.min(1, dt * 6);
      if (Math.abs(this.yawTarget - this.yaw) < 0.002) this.yawTarget = null;
    }
    if (this.pitchTarget !== null && this.pitchTarget !== undefined) {
      this.pitch += (this.pitchTarget - this.pitch) * Math.min(1, dt * 6);
      if (Math.abs(this.pitchTarget - this.pitch) < 0.002) this.pitchTarget = null;
    }
    this.camera.rotation.set(this.pitch, this.yaw, 0);

    const pulse = 0.18 + 0.14 * Math.sin(time * 5);
    for (const m of this.tileMeshes.values()) {
      const ud = m.userData;
      const tw = ud.tween;
      if (tw) {
        if (tw.delay > 0) {
          tw.delay -= dt;
        } else {
          tw.t = Math.min(1, tw.t + dt / tw.dur);
          const e = easeInOut(tw.t);
          m.position.lerpVectors(tw.fromPos, tw.toPos, e);
          m.position.y += Math.sin(Math.PI * e) * tw.lift;
          m.quaternion.slerpQuaternions(tw.fromQuat, tw.toQuat, e);
          if (tw.t >= 1) ud.tween = null;
        }
      }
      const em = ud.bodyMat.emissive;
      if (ud.tileId === this.selectedId) em.setRGB(0.9, 0.55, 0.0);
      else if (this.interactive.has(ud.tileId)) em.setRGB(pulse, pulse * 0.8, 0.05);
      else em.setRGB(0, 0, 0);
    }
    this.renderer.render(this.scene, this.camera);
  }
}
