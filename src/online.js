// 온라인 방: 방 만들기 / 코드로 입장 / 4명 모이면 시작 / 나간 자리는 AI / 방장 교체
//
// 데이터 구조 (rooms/{코드}/...)
//   meta/host, meta/status('lobby'|'playing'|'over')   방장 uid, 상태
//   seats/{0..3}: {uid, name} | {ai: true, name}         자리
//   members/{uid}: "자리번호"                              방에 들어온 사람
//   presence/{uid}: true                                   접속 중 (끊기면 자동 삭제)
//   public: {json}          모두가 보는 상태 (숨긴 숫자 없음)          — 방장만 씀
//   private/{uid}: {json}   그 사람 타일의 숫자 (본인만 읽기 가능)      — 방장만 씀
//   secret: {json}          방장 교체 때 이어서 하기 위한 전체 상태 (방장만 읽기 가능)
//   actions/{id}: {uid, step, action}   플레이어 행동 → 방장이 처리 후 삭제
import { HostEngine, DEFAULT_DELAYS } from './engine.js';

export const SEAT_COUNT = 4;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LOBBY_GRACE = 5000;   // 대기실에서 연결이 이만큼 끊기면 자리 비움
const GAME_GRACE = 3000;    // 게임 중 연결이 이만큼 끊기면 AI가 대신함
const HOST_GRACE = 4000;    // 방장 연결이 이만큼 끊기면 다른 사람이 방장을 맡음

function randomCode(len = 5) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

export function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function seatsArray(val) {
  const out = [];
  for (let i = 0; i < SEAT_COUNT; i++) out.push((val && val[i]) || null);
  return out;
}

export class OnlineRoom {
  /**
   * @param {ReturnType<typeof import('./net/firebase.js').connectFirebase> extends Promise<infer T> ? T : never} db
   * @param {string} code
   * @param {{name: string, delays?: object, onLobby?: Function, onGame?: Function, onError?: Function}} opts
   */
  constructor(db, code, opts) {
    this.db = db;
    this.code = code;
    this.base = `rooms/${code}`;
    this.name = opts.name;
    this.delays = opts.delays || DEFAULT_DELAYS;
    this.onLobby = opts.onLobby || (() => {});
    this.onGame = opts.onGame || (() => {});
    this.onError = opts.onError || ((e) => console.error(e));
    this.seat = null;
    this.meta = null;
    this.seats = seatsArray(null);
    this.presence = {};
    this.presenceLoaded = false;
    this.absentSince = {};
    this.pub = null;
    this.priv = null;
    this.isHost = false;
    this.engine = null;
    this.unsubs = [];
    this.actionsUnsub = null;
    this.closed = false;
    this.busy = false; // 방장 전환/게임 시작 중복 방지
  }

  get uid() { return this.db.uid; }

  static async create(db, opts) {
    for (let tries = 0; tries < 10; tries++) {
      const code = randomCode();
      let res;
      try {
        res = await db.transaction(`rooms/${code}/meta/host`, (cur) => (cur === null ? db.uid : undefined));
      } catch {
        continue; // 이미 있는 방 코드
      }
      if (!res.committed || res.value !== db.uid) continue;
      await db.update(`rooms/${code}/meta`, { status: 'lobby', createdAt: db.serverTime() });
      const room = new OnlineRoom(db, code, opts);
      room.meta = { host: db.uid, status: 'lobby' };
      await room._claimSeat();
      await room._enter();
      return room;
    }
    throw new Error('방을 만들지 못했어요. 잠시 뒤 다시 해 주세요.');
  }

  static async join(db, rawCode, opts) {
    const code = normalizeCode(rawCode);
    if (!code) throw new Error('방 코드를 입력하세요.');
    const meta = await db.get(`rooms/${code}/meta`);
    if (!meta || !meta.host) throw new Error(`"${code}" 방이 없어요.`);
    const room = new OnlineRoom(db, code, opts);
    room.meta = meta;
    const mine = await db.get(`rooms/${code}/members/${db.uid}`);
    if (mine !== null && mine !== undefined) {
      room.seat = Number(mine); // 같은 탭에서 다시 들어옴 → 원래 자리
    } else {
      if (meta.status !== 'lobby') throw new Error('이미 게임이 시작된 방이에요.');
      await room._claimSeat();
    }
    await room._enter();
    return room;
  }

  async _claimSeat() {
    for (let i = 0; i < SEAT_COUNT; i++) {
      try {
        const res = await this.db.transaction(`${this.base}/seats/${i}`,
          (cur) => (cur === null ? { uid: this.uid, name: this.name } : undefined));
        if (res.committed && res.value && res.value.uid === this.uid) {
          await this.db.set(`${this.base}/members/${this.uid}`, String(i));
          this.seat = i;
          return;
        }
      } catch {
        // 권한 없음(이미 시작함 등) → 다음 자리
      }
    }
    throw new Error('방이 가득 찼어요.');
  }

  async _enter() {
    const { db, base, uid } = this;
    const err = (e) => this.onError(e);
    this.unsubs.push(db.onConnection((on) => {
      if (!on || this.closed) return;
      db.onDisconnectRemove(`${base}/presence/${uid}`)
        .then(() => db.set(`${base}/presence/${uid}`, true))
        .catch(err);
    }));
    this.unsubs.push(db.on(`${base}/meta`, (v) => { this.meta = v; this._evaluate(); this.notify(); }, err));
    this.unsubs.push(db.on(`${base}/seats`, (v) => { this.seats = seatsArray(v); this._evaluate(); this.notify(); }, err));
    this.unsubs.push(db.on(`${base}/presence`, (v) => {
      this.presence = v || {};
      this.presenceLoaded = true;
      this._evaluate();
      this.notify();
    }, err));
    this.unsubs.push(db.on(`${base}/public`, (v) => {
      if (this.isHost) return;
      this.pub = v && v.json ? JSON.parse(v.json) : null;
      this.notify();
    }, err));
    this.unsubs.push(db.on(`${base}/private/${uid}`, (v) => {
      if (this.isHost) return;
      this.priv = v && v.json ? JSON.parse(v.json) : null;
      this.notify();
    }, err));
    this.ticker = setInterval(() => this._evaluate(), 1000);
  }

  /** 나가기: 대기실이면 자리를 비우고, 게임 중이면 AI가 이어받음 */
  async leave() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.ticker);
    this.unsubs.forEach((u) => u());
    if (this.actionsUnsub) this.actionsUnsub();
    if (this.engine) this.engine.dispose();
    const { db, base, uid } = this;
    try {
      if (this.meta && this.meta.status === 'lobby' && this.seat !== null) {
        await db.remove(`${base}/seats/${this.seat}`);
        await db.remove(`${base}/members/${uid}`);
      }
      await db.cancelOnDisconnect(`${base}/presence/${uid}`);
      await db.remove(`${base}/presence/${uid}`);
    } catch (e) {
      console.warn(e);
    }
  }

  // ---------- 화면에 알리기 ----------
  get status() { return this.meta ? this.meta.status : null; }

  notify() {
    if (this.closed) return;
    if (this.status && this.status !== 'lobby' && this.pub) {
      // 공개 상태와 내 비공개 상태가 같은 단계일 때만 그림 (한쪽만 먼저 도착한 순간은 건너뜀)
      const priv = this.priv && this.priv.gameId === this.pub.gameId && this.priv.step === this.pub.step ? this.priv : null;
      if (!priv && this.pub.phase !== 'over') return;
      this.onGame(this.pub, priv || this.priv);
    } else {
      this.onLobby({
        code: this.code,
        seats: this.seats.map((s) => (s ? { name: s.name, ai: !!s.ai, online: !!(s.uid && this.presence[s.uid]) } : null)),
        mySeat: this.seat,
        isHost: this.isHost,
        status: this.status,
      });
    }
  }

  /** 내 행동 보내기. 방장이면 바로 처리, 아니면 actions에 올림 */
  async send(action) {
    if (this.isHost && this.engine) return this.engine.submit(this.seat, action);
    if (!this.pub) return '아직 게임 상태를 받지 못했어요';
    await this.db.push(`${this.base}/actions`, { uid: this.uid, step: this.pub.step, action });
    return null;
  }

  // ---------- 역할 판단 (상태가 바뀔 때마다, 그리고 1초마다) ----------
  _absentFor(uid) {
    const now = Date.now();
    if (this.presence[uid]) { delete this.absentSince[uid]; return 0; }
    if (!(uid in this.absentSince)) this.absentSince[uid] = now;
    return now - this.absentSince[uid];
  }

  _evaluate() {
    if (this.closed || !this.meta) return;
    const amHost = this.meta.host === this.uid;
    if (amHost && !this.isHost) {
      this.isHost = true;
      this._becomeHost().catch((e) => this.onError(e));
      return;
    }
    if (!amHost && this.isHost) this._stopHosting();
    if (this.isHost) this._hostDuties();
    else this._maybeTakeOver();
  }

  // 방장 연결이 끊긴 채로 있으면, 접속 중인 사람 중 자리 번호가 가장 작은 사람이 방장을 맡음
  _maybeTakeOver() {
    if (!this.presenceLoaded || this.busy || this.status === 'over') return;
    const host = this.meta.host;
    if (!host || this._absentFor(host) < HOST_GRACE) return;
    const online = this.seats
      .map((s, i) => (s && s.uid && this.presence[s.uid] ? i : null))
      .filter((i) => i !== null);
    if (online[0] !== this.seat) return;
    this.busy = true;
    this.db.transaction(`${this.base}/meta/host`, (cur) => (cur === host ? this.uid : undefined))
      .catch((e) => console.warn('방장 넘겨받기 실패', e))
      .finally(() => { this.busy = false; });
  }

  async _becomeHost() {
    this.busy = true;
    try {
      const secret = await this.db.get(`${this.base}/secret`);
      if (secret && secret.json) {
        this.engine = HostEngine.restore(JSON.parse(secret.json), {
          delays: this.delays,
          onPublish: (out) => this._hostPublish(out),
        });
        this._listenActions();
        this._syncSeatsToEngine();
        this.engine.start();
      }
    } finally {
      this.busy = false;
    }
    this._hostDuties();
  }

  _stopHosting() {
    this.isHost = false;
    if (this.engine) this.engine.dispose();
    this.engine = null;
    if (this.actionsUnsub) this.actionsUnsub();
    this.actionsUnsub = null;
  }

  _hostDuties() {
    if (this.busy || !this.presenceLoaded) return;
    const { db, base } = this;
    if (this.status === 'lobby' && !this.engine) {
      // 대기실에서 오래 끊긴 사람 자리 비우기
      this.seats.forEach((s, i) => {
        if (s && s.uid && s.uid !== this.uid && this._absentFor(s.uid) > LOBBY_GRACE) {
          db.remove(`${base}/seats/${i}`).catch(() => {});
          db.remove(`${base}/members/${s.uid}`).catch(() => {});
        }
      });
      // 4자리가 모두 차고, 모두 접속 표시까지 마친 뒤 시작 (접속 표시는 멤버 등록 뒤에 하므로 등록도 끝난 상태)
      if (this.seats.every((s) => s && (s.ai || this.presence[s.uid]))) this.startGame();
      return;
    }
    if (this.engine) {
      this._syncSeatsToEngine();
      if (this.engine.game.phase === 'over' && this.status !== 'over') {
        db.set(`${base}/meta/status`, 'over').catch(() => {});
      }
    }
  }

  // 접속 상태 → 엔진의 사람/AI 자리 반영
  // 접속 중이면 사람, 일정 시간 넘게 끊겨 있으면 AI, 그 사이에는 그대로 둠
  // (방장이 바뀐 직후에도 이미 AI가 맡던 자리가 사람으로 잠깐 돌아가지 않도록)
  _syncSeatsToEngine() {
    this.seats.forEach((s, i) => {
      if (!s || !s.uid) return;
      if (s.uid === this.uid || this.presence[s.uid]) {
        this._absentFor(s.uid);
        this.engine.setSeat(i, { kind: 'human', offline: false });
      } else if (this._absentFor(s.uid) > GAME_GRACE) {
        this.engine.setSeat(i, { kind: 'ai', offline: true });
      }
    });
  }

  /** 방장: 게임 시작 (빈 자리는 AI로 채움) */
  async startGame() {
    if (!this.isHost || this.engine || this.busy || this.status !== 'lobby') return;
    this.busy = true;
    try {
      const { db, base } = this;
      const fill = {};
      this.seats.forEach((s, i) => { if (!s) fill[i] = { ai: true, name: `AI ${i + 1}` }; });
      if (Object.keys(fill).length) await db.update(`${base}/seats`, fill);
      this.seats = this.seats.map((s, i) => s || fill[i]);
      this.engine = HostEngine.newGame({
        seats: this.seats.map((s) => ({ name: s.name, kind: s.ai ? 'ai' : 'human' })),
        firstPlayer: Math.floor(Math.random() * SEAT_COUNT),
        delays: this.delays,
        onPublish: (out) => this._hostPublish(out),
      });
      this._listenActions();
      this.engine.start(); // 첫 상태(공개/비공개/secret)를 먼저 올리고
      await db.set(`${base}/meta/status`, 'playing'); // 그다음 시작을 알림
    } catch (e) {
      this.onError(e);
    } finally {
      this.busy = false;
    }
  }

  _hostPublish(out) {
    const upd = {
      public: { json: JSON.stringify(out.public) },
      secret: { json: JSON.stringify(out.secret) },
    };
    this.seats.forEach((s, i) => {
      if (s && s.uid) upd[`private/${s.uid}`] = { json: JSON.stringify(out.privates[i]) };
    });
    this.db.update(this.base, upd).catch((e) => this.onError(e));
    this.pub = out.public;
    this.priv = out.privates[this.seat];
    this.notify();
  }

  _listenActions() {
    if (this.actionsUnsub) return;
    this.actionsUnsub = this.db.onChildAdded(`${this.base}/actions`, (key, val) => {
      this.db.remove(`${this.base}/actions/${key}`).catch(() => {});
      if (!this.engine || !val || !val.action) return;
      const seat = this.seats.findIndex((s) => s && s.uid === val.uid);
      if (seat < 0) return;
      if (val.step !== this.engine.step) return; // 예전 화면을 보고 보낸 행동은 무시
      const err = this.engine.submit(seat, val.action);
      if (err) console.warn(`행동 거절 (자리 ${seat}):`, err);
    }, (e) => this.onError(e));
  }
}
