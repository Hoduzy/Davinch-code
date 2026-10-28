// 이펙트(정답 / 승리 연출): 가벼운 입자 효과. items.config.js의 effect.type 으로 고름
import * as THREE from 'three';

const spriteCache = new Map();

function sprite(kind) {
  if (spriteCache.has(kind)) return spriteCache.get(kind);
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#fff';
  if (kind === 'dot') {
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
  } else if (kind === 'star') {
    x.beginPath();
    for (let i = 0; i < 8; i++) {
      const r = i % 2 ? 7 : 30;
      const a = (i / 8) * Math.PI * 2;
      x.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
    }
    x.closePath();
    x.fill();
  } else if (kind === 'heart') {
    x.beginPath();
    x.moveTo(32, 54);
    x.bezierCurveTo(4, 34, 10, 8, 32, 22);
    x.bezierCurveTo(54, 8, 60, 34, 32, 54);
    x.fill();
  } else if (kind === 'square') {
    x.fillRect(18, 10, 28, 44);
  }
  const t = new THREE.CanvasTexture(c);
  spriteCache.set(kind, t);
  return t;
}

const rand = (a, b) => a + Math.random() * (b - a);

/** 입자 묶음 하나 */
class Burst {
  constructor(parent, o) {
    this.o = o;
    const n = o.count;
    this.n = n;
    this.age = -(o.delay || 0);
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.base = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    const colors = o.colors.map((c) => new THREE.Color(c));
    for (let i = 0; i < n; i++) {
      const p = o.start(i);
      const v = o.velocity(i);
      this.pos.set([p.x, p.y, p.z], i * 3);
      this.vel.set([v.x, v.y, v.z], i * 3);
      const c = colors[i % colors.length];
      this.base.set([c.r, c.g, c.b], i * 3);
      this.life[i] = o.life * rand(0.7, 1.15);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.mat = new THREE.PointsMaterial({
      size: o.size, map: sprite(o.sprite), vertexColors: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
    parent.add(this.points);
  }

  /** @returns {boolean} 끝났으면 false */
  update(dt) {
    this.age += dt;
    if (this.age < 0) return true;
    const o = this.o;
    let alive = false;
    const drag = Math.pow(o.drag ?? 1, dt * 60);
    for (let i = 0; i < this.n; i++) {
      const k = this.age / this.life[i];
      const j = i * 3;
      if (k >= 1) { this.col[j] = this.col[j + 1] = this.col[j + 2] = 0; continue; }
      alive = true;
      this.vel[j] *= drag;
      this.vel[j + 2] *= drag;
      this.vel[j + 1] = this.vel[j + 1] * drag - (o.gravity || 0) * dt;
      if (o.sway) this.vel[j] += Math.sin(this.age * 6 + i) * o.sway * dt;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      // 처음엔 밝게 → 끝에서 서서히 사라짐 (+반짝임)
      let a = k < 0.1 ? k / 0.1 : 1 - Math.pow((k - 0.1) / 0.9, 2);
      if (o.twinkle) a *= 0.55 + 0.45 * Math.sin(this.age * 25 + i * 1.7);
      this.col[j] = this.base[j] * a;
      this.col[j + 1] = this.base[j + 1] * a;
      this.col[j + 2] = this.base[j + 2] * a;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    return alive;
  }

  dispose(parent) {
    parent.remove(this.points);
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** 퍼지는 고리 (충격파) */
class Ring {
  constructor(parent, pos, color, delay) {
    this.age = -delay;
    this.mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1, 48),
      new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.mesh.position.copy(pos);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.scale.setScalar(0.01);
    this.mesh.renderOrder = 20;
    parent.add(this.mesh);
  }

  update(dt) {
    this.age += dt;
    if (this.age < 0) return true;
    const k = this.age / 0.7;
    this.mesh.scale.setScalar(0.05 + k * 0.45);
    this.mesh.material.opacity = Math.max(0, 1 - k);
    return k < 1;
  }

  dispose(parent) {
    parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const randDir = (speed) => {
  const u = rand(-1, 1);
  const a = rand(0, Math.PI * 2);
  const s = Math.sqrt(1 - u * u);
  return v3(Math.cos(a) * s * speed, u * speed, Math.sin(a) * s * speed);
};

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
  }

  /**
   * @param {{type: string, colors: string[], count: number}} fx
   * @param {THREE.Vector3} at 정답 이펙트: 맞힌 타일 위치 / 승리 이펙트: 승자 자리 쪽
   */
  play(fx, at) {
    if (!fx) return;
    const colors = fx.colors && fx.colors.length ? fx.colors : ['#ffffff'];
    const n = Math.max(1, Math.min(fx.count || 30, 400));
    const add = (o) => this.items.push(new Burst(this.scene, { colors, ...o }));
    const p = at.clone();
    switch (fx.type) {
      case 'sparkle':
        add({ count: n, sprite: 'star', size: 0.07, life: 1.1, gravity: 0.3, drag: 0.94, twinkle: true,
          start: () => p.clone().add(v3(rand(-0.08, 0.08), rand(0, 0.15), rand(-0.08, 0.08))),
          velocity: () => randDir(rand(0.3, 0.9)).add(v3(0, 0.4, 0)) });
        break;
      case 'burst':
        add({ count: n, sprite: 'dot', size: 0.09, life: 0.9, gravity: 1.2, drag: 0.92,
          start: () => p.clone(), velocity: () => randDir(rand(1.2, 2.4)).add(v3(0, 0.8, 0)) });
        add({ count: Math.ceil(n / 3), sprite: 'star', size: 0.06, life: 1.3, gravity: 0.2, drag: 0.9, twinkle: true, delay: 0.1,
          start: () => p.clone(), velocity: () => randDir(rand(0.4, 1)) });
        break;
      case 'hearts':
        add({ count: n, sprite: 'heart', size: 0.1, life: 1.8, gravity: -0.25, drag: 0.97, sway: 0.8,
          start: () => p.clone().add(v3(rand(-0.12, 0.12), rand(0, 0.1), rand(-0.12, 0.12))),
          velocity: () => v3(rand(-0.25, 0.25), rand(0.3, 0.7), rand(-0.25, 0.25)) });
        break;
      case 'ring':
        for (let i = 0; i < n; i++) this.items.push(new Ring(this.scene, p.clone().setY(0.02), colors[i % colors.length], i * 0.15));
        add({ count: 40, sprite: 'star', size: 0.06, life: 0.8, gravity: 0, drag: 0.9, twinkle: true,
          start: () => p.clone(), velocity: () => randDir(rand(0.8, 1.6)).setY(rand(0.3, 1.2)) });
        break;
      case 'confetti':
        add({ count: n, sprite: 'square', size: 0.08, life: 3.2, gravity: 0.5, drag: 0.97, sway: 1.5, twinkle: true,
          start: () => p.clone().add(v3(rand(-0.9, 0.9), rand(0.6, 1.2), rand(-0.6, 0.6))),
          velocity: () => v3(rand(-0.4, 0.4), rand(0.2, 1.2), rand(-0.4, 0.4)) });
        break;
      case 'fireworks':
        for (let i = 0; i < n; i++) {
          const c = p.clone().add(v3(rand(-1, 1), rand(0.7, 1.4), rand(-0.8, 0.4)));
          const col = [colors[i % colors.length], '#ffffff'];
          this.items.push(new Burst(this.scene, { colors: col, count: 80, sprite: 'dot', size: 0.07, life: 1.4, gravity: 0.5,
            drag: 0.95, twinkle: true, delay: i * 0.35, start: () => c.clone(), velocity: () => randDir(rand(0.9, 1.3)) }));
        }
        break;
      case 'goldrain':
        add({ count: n, sprite: 'star', size: 0.06, life: 3.4, gravity: 0.4, drag: 0.98, twinkle: true,
          start: () => v3(rand(-1.3, 1.3), rand(1.2, 2.2), rand(-1.3, 1.3)), velocity: () => v3(0, rand(-0.4, 0), 0) });
        add({ count: 40, sprite: 'dot', size: 0.14, life: 1.6, gravity: -0.3, drag: 0.95,
          start: () => p.clone(), velocity: () => randDir(rand(0.3, 0.8)) });
        break;
      default:
        add({ count: n, sprite: 'dot', size: 0.08, life: 1, gravity: 0.5, drag: 0.94,
          start: () => p.clone(), velocity: () => randDir(1) });
    }
  }

  update(dt) {
    this.items = this.items.filter((it) => {
      const alive = it.update(dt);
      if (!alive) it.dispose(this.scene);
      return alive;
    });
  }

  clear() {
    for (const it of this.items) it.dispose(this.scene);
    this.items = [];
  }
}
