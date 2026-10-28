// 상대 자리에 앉는 캐릭터: VRM 스킨(three-vrm) 또는 기본 인형
// - 그 판에 필요한 스킨 파일만 받음 (preloadSkins), 같은 파일은 한 번만 받음
// - 맞힘/틀림/공개당함/승리/탈락에 따라 표정과 동작으로 반응 (react)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { getItem } from './catalog.js';
import { ITEMS } from '../items.config.js';

const SEAT_HIP_Y = -0.2; // 의자에 앉은 엉덩이 높이 (테이블 윗면 = 0, 바닥 = -0.78)
const TARGET_HIP_HEIGHT = 0.95; // 모든 모델을 서 있을 때 엉덩이 높이 0.95로 맞춤

const buffers = new Map(); // 파일 경로 → Promise<ArrayBuffer>

function skinFile(skinId) {
  const item = getItem(skinId);
  return item && item.category === 'skin' ? item.file : null;
}

async function fetchWithProgress(url, onBytes) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} 를 불러오지 못했어요 (${res.status})`);
  if (!res.body || !res.body.getReader) {
    const buf = await res.arrayBuffer();
    onBytes(buf.byteLength);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    onBytes(value.byteLength);
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out.buffer;
}

/**
 * 스킨 파일 미리 받기
 * @param {string[]} skinIds
 * @param {(loaded: number, total: number) => void} onProgress 바이트 단위
 */
export async function preloadSkins(skinIds, onProgress = () => {}) {
  const files = [...new Set(skinIds.map(skinFile).filter(Boolean))];
  const total = files.reduce((s, f) => s + (buffers.has(f) ? 0 : estimateSize(f)), 0);
  let loaded = 0;
  onProgress(0, total);
  await Promise.all(files.map((f) => {
    if (!buffers.has(f)) {
      const p = fetchWithProgress(f, (n) => { loaded += n; onProgress(Math.min(loaded, total), total); });
      buffers.set(f, p);
      p.catch(() => buffers.delete(f));
    }
    return buffers.get(f);
  }));
  onProgress(total, total);
}

// 진행률 표시용 예상 크기 (items.config.js의 sizeMB)
function estimateSize(file) {
  const item = ITEMS.find((it) => it.file === file);
  return item && item.sizeMB ? item.sizeMB * 1e6 : 10e6;
}

/** 스킨으로 캐릭터 만들기 (VRM이 없거나 실패하면 기본 인형) */
export async function createCharacter(skinId, color) {
  const file = skinFile(skinId);
  if (!file) return new BasicCharacter(color);
  try {
    if (!buffers.has(file)) await preloadSkins([skinId]);
    const buf = await buffers.get(file);
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const base = new URL(file, location.href).href;
    const gltf = await loader.parseAsync(buf.slice(0), base);
    const vrm = gltf.userData.vrm;
    if (!vrm) throw new Error('VRM 정보가 없는 파일');
    return new VrmCharacter(vrm);
  } catch (e) {
    console.warn('VRM을 불러오지 못해 기본 인형으로 대신합니다', skinId, e);
    return new BasicCharacter(color);
  }
}

// ---------- 공통 ----------
const ease = (t) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));
/** 반응 동작의 세기: 들어오고(0.25초) 유지했다가 빠짐 */
function envelope(t, dur) {
  return Math.min(ease(t / 0.25), ease((dur - t) / 0.4));
}

const REACTIONS = {
  correct: 2.2, // 내가 맞힘
  wrong: 2.0,   // 내가 틀림
  hit: 2.2,     // 내 타일이 맞혀짐
  dodge: 1.6,   // 남이 내 타일을 틀림
  win: 6.0,     // 승리
};

class CharacterBase {
  constructor() {
    this.root = new THREE.Group();
    this.action = null;
    this.out = false;      // 탈락
    this.time = 0;
    this.lookTarget = new THREE.Vector3(0, 0, 0);
    this.headHeight = 0.55;
  }

  react(kind) {
    if (kind === 'lose') { this.out = true; return; }
    if (!REACTIONS[kind]) return;
    this.action = { kind, t: 0, dur: REACTIONS[kind] };
  }

  setOut(out) { this.out = out; }

  /** 바라볼 곳 (월드 좌표) */
  lookAt(v) { this.lookTarget.copy(v); }

  _step(dt) {
    this.time += dt;
    if (this.action) {
      this.action.t += dt;
      if (this.action.t >= this.action.dur) this.action = null;
    }
    const a = this.action;
    return { kind: a ? a.kind : null, t: a ? a.t : 0, w: a ? envelope(a.t, a.dur) : 0 };
  }
}

// ---------- 기본 인형 (파일 없음) ----------
export class BasicCharacter extends CharacterBase {
  constructor(color = 0x90a4ae) {
    super();
    this.mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, transparent: true });
    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.21, 0.36, 6, 16), this.mat);
    this.body.position.y = 0.0;
    this.head = new THREE.Group();
    const skin = new THREE.Mesh(new THREE.SphereGeometry(0.15, 24, 16),
      new THREE.MeshStandardMaterial({ color: 0xf0c9a0, roughness: 0.8, transparent: true }));
    this.head.add(skin);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    this.eyes = [];
    for (const dx of [-0.055, 0.055]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 8), eyeMat);
      eye.position.set(dx, 0.03, -0.135);
      this.head.add(eye);
      this.eyes.push(eye);
    }
    this.mouth = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 16, Math.PI), eyeMat);
    this.mouth.position.set(0, -0.045, -0.14);
    this.head.add(this.mouth);
    this.head.position.y = 0.48;
    this.root.add(this.body, this.head);
    this.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.headHeight = 0.48;
  }

  update(dt) {
    const { kind, t, w } = this._step(dt);
    let y = Math.sin(this.time * 2) * 0.008;
    let shake = 0;
    let tilt = this.out ? 0.35 : 0;
    let squash = 1;
    let smile = 0;
    if (kind === 'correct' || kind === 'win') { y += Math.abs(Math.sin(t * 9)) * 0.1 * w; smile = w; }
    if (kind === 'wrong') { shake = Math.sin(t * 16) * 0.35 * w; tilt += 0.2 * w; smile = -w; }
    if (kind === 'hit') { squash = 1 - 0.15 * w * Math.abs(Math.sin(t * 6)); tilt -= 0.2 * w; smile = -w; }
    if (kind === 'dodge') { tilt += Math.sin(t * 8) * 0.15 * w; smile = 0.6 * w; }
    if (this.out) smile = Math.min(smile, -0.6);
    this.root.position.y = y;
    this.root.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
    this.head.rotation.set(tilt, shake, 0);
    // 입 모양: 웃음(아래로 볼록) ↔ 시무룩(위로 볼록)
    this.mouth.rotation.z = smile >= 0 ? Math.PI : 0;
    this.mouth.scale.setScalar(0.6 + Math.abs(smile) * 0.6);
    const blink = (this.time % 3.7) < 0.12 ? 0.2 : 1;
    for (const e of this.eyes) e.scale.y = blink;
    this.mat.opacity = this.out ? 0.45 : 1;
  }

  dispose() {
    this.root.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); } });
  }
}

// ---------- VRM 캐릭터 ----------
export class VrmCharacter extends CharacterBase {
  constructor(vrm) {
    super();
    this.vrm = vrm;
    VRMUtils.removeUnnecessaryVertices(vrm.scene);
    if (VRMUtils.combineSkeletons) VRMUtils.combineSkeletons(vrm.scene);
    vrm.scene.traverse((o) => {
      o.frustumCulled = false;
      if (o.isMesh) o.castShadow = true;
    });

    // VRM 0.x는 -Z, 1.0은 +Z를 바라봄. 자리 좌표에서는 -Z(테이블 쪽)를 봐야 함
    const v0 = vrm.meta && vrm.meta.metaVersion === '0';
    this.fwd = v0 ? -1 : 1;   // 모델 기준 앞쪽 부호 (정규화 뼈 공간)
    this.side = v0 ? -1 : 1;  // 왼손 쪽 x 부호
    this.holder = new THREE.Group();
    this.holder.rotation.y = v0 ? 0 : Math.PI;
    this.holder.add(vrm.scene);
    this.root.add(this.holder);

    const hum = vrm.humanoid;
    this.bone = (name) => hum.getNormalizedBoneNode(name);
    vrm.scene.updateMatrixWorld(true);
    const hips = this.bone('hips').getWorldPosition(new THREE.Vector3()).y || 0.9;
    const headNode = this.bone('head');
    const headY = headNode ? headNode.getWorldPosition(new THREE.Vector3()).y : hips * 1.75;
    const s = TARGET_HIP_HEIGHT / hips;
    this.holder.scale.setScalar(s);
    this.holder.position.y = SEAT_HIP_Y - hips * s;
    this.headHeight = SEAT_HIP_Y + (headY - hips) * s;

    if (vrm.lookAt) {
      this.lookObj = new THREE.Object3D();
      this.root.add(this.lookObj);
      vrm.lookAt.target = this.lookObj;
    }
    this.nextBlink = 1 + Math.random() * 3;
    this.expr = { happy: 0, sad: 0, angry: 0, surprised: 0, relaxed: 0, blink: 0 };
  }

  _set(name, axis, value) {
    const b = this.bone(name);
    if (b) b.rotation[axis] = value;
  }

  update(dt) {
    const { kind, t, w } = this._step(dt);
    const F = this.fwd;
    const S = this.side;
    const breath = Math.sin(this.time * 1.8) * 0.02;
    const deg = Math.PI / 180;

    // --- 앉은 기본 자세 ---
    let lean = (this.out ? 18 : 6) * deg;  // 앞으로 숙임
    let headNod = (this.out ? 22 : 4) * deg;
    let headTurn = 0;
    let lArmZ = -S * 62 * deg;
    let rArmZ = S * 62 * deg;
    let lArmX = 0;
    let rArmX = 0;
    let lFore = -70 * deg;
    let rFore = 70 * deg;
    let bounce = 0;

    // 바라볼 곳 → 고개 돌리기 (자리 좌표 기준 -Z가 정면)
    if (this.root.parent) {
      const local = this.root.worldToLocal(this.lookTarget.clone());
      headTurn = THREE.MathUtils.clamp(Math.atan2(-local.x, -local.z), -0.7, 0.7) * 0.6;
      if (this.lookObj) this.lookObj.position.copy(local);
    }

    // --- 반응 동작 ---
    const target = { happy: 0, sad: this.out ? 0.7 : 0, angry: 0, surprised: 0, relaxed: 0 };
    if (kind === 'correct') {
      target.happy = w;
      rArmZ += (-S * 150 * deg) * w;            // 오른팔 번쩍
      rFore += (-60 * deg) * w;
      bounce = Math.abs(Math.sin(t * 8)) * 0.03 * w;
    } else if (kind === 'wrong') {
      target.sad = 0.8 * w;
      target.angry = 0.3 * w;
      headTurn += Math.sin(t * 13) * 0.4 * w;    // 고개 저음
      lean += 10 * deg * w;
      headNod += 12 * deg * w;
    } else if (kind === 'hit') {
      target.surprised = w * (t < 0.8 ? 1 : 0.3);
      target.sad = w * (t < 0.8 ? 0 : 0.8);
      lean -= 14 * deg * w;                      // 몸이 뒤로
      headNod -= 12 * deg * w;
      lArmX += -F * 30 * deg * w;
      rArmX += -F * 30 * deg * w;
    } else if (kind === 'dodge') {
      target.relaxed = 0.8 * w;
      target.happy = 0.3 * w;
      headNod += Math.sin(t * 9) * 10 * deg * w; // 끄덕
    } else if (kind === 'win') {
      target.happy = w;
      lArmZ += (S * 140 * deg) * w;              // 양팔 만세
      rArmZ += (-S * 140 * deg) * w;
      lFore *= 1 - w;
      rFore *= 1 - w;
      lArmX += Math.sin(t * 6) * 0.3 * w;
      rArmX += Math.sin(t * 6 + 1) * 0.3 * w;
      bounce = Math.abs(Math.sin(t * 5)) * 0.04 * w;
    }

    // 다리: 허벅지는 앞으로, 정강이는 아래로
    for (const sideName of ['left', 'right']) {
      this._set(`${sideName}UpperLeg`, 'x', -F * 88 * deg);
      this._set(`${sideName}LowerLeg`, 'x', F * 88 * deg);
    }
    this._set('spine', 'x', F * (lean * 0.6 + breath));
    this._set('chest', 'x', F * lean * 0.4);
    this._set('neck', 'x', F * headNod * 0.5);
    this._set('head', 'x', F * headNod * 0.5);
    this._set('neck', 'y', headTurn * 0.5);
    this._set('head', 'y', headTurn * 0.5);
    this._set('leftUpperArm', 'z', lArmZ);
    this._set('rightUpperArm', 'z', rArmZ);
    this._set('leftUpperArm', 'x', lArmX);
    this._set('rightUpperArm', 'x', rArmX);
    this._set('leftLowerArm', 'y', lFore);
    this._set('rightLowerArm', 'y', rFore);
    this.holder.position.y += (bounce - (this._lastBounce || 0));
    this._lastBounce = bounce;

    // --- 표정 (부드럽게) + 눈 깜빡임 ---
    const em = this.vrm.expressionManager;
    if (em) {
      const k = Math.min(1, dt * 8);
      for (const name of Object.keys(target)) {
        this.expr[name] += (target[name] - this.expr[name]) * k;
        em.setValue(name, this.expr[name]);
      }
      this.nextBlink -= dt;
      let blink = 0;
      if (this.nextBlink < 0) {
        blink = Math.max(0, 1 - Math.abs(this.nextBlink + 0.08) / 0.08);
        if (this.nextBlink < -0.16) this.nextBlink = 2 + Math.random() * 4;
      }
      if (this.expr.happy > 0.5) blink = 0; // 웃을 때는 이미 눈을 감은 표정이 많음
      em.setValue('blink', blink);
    }
    this.vrm.update(dt);
  }

  dispose() {
    VRMUtils.deepDispose(this.vrm.scene);
  }
}
