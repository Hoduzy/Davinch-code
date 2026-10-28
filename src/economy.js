// 재화(코인), 보관함, 장착, 베팅 — 모두 Firebase에 저장
// 코인 변경은 항상 "거래(tx)"로 씀: 보안 규칙(database.rules.json)이 거래마다 금액과 중복 여부를 검사하므로
// 클라이언트가 코인 숫자를 마음대로 바꾸면 서버가 거절함
import { serverCatalog, dayIndex, getItem, normalizeLook, isFree, SLOTS } from './catalog.js';

const sameJSON = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function sortKeys(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
  return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
}

export class Economy {
  constructor(db) {
    this.db = db;
    this.uid = db.uid;
    this.wallet = null;
    this.inventory = {};
    this.profile = null;
    this.config = null;
    this.shop = null;
    this.offset = 0;
    this.listeners = new Set();
    this.unsubs = [];
  }

  /** 상태가 바뀌면 cb() */
  onChange(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  _emit() { for (const cb of this.listeners) cb(this); }

  async start() {
    const { db, uid } = this;
    const loaded = (path, assign) => new Promise((resolve) => {
      let first = true;
      this.unsubs.push(db.on(path, (v) => {
        assign(v);
        if (first) { first = false; resolve(); }
        this._emit();
      }, () => resolve()));
    });
    this.unsubs.push(db.onServerTimeOffset((o) => { this.offset = o; }));
    await Promise.all([
      loaded('config/economy', (v) => { this.config = v; }),
      loaded('shop/items', (v) => { this.shop = v; }),
      loaded(`users/${uid}/wallet`, (v) => { this.wallet = v; }),
      loaded(`users/${uid}/inventory`, (v) => { this.inventory = v || {}; }),
      loaded(`users/${uid}/profile`, (v) => { this.profile = v; }),
    ]);
  }

  stop() { this.unsubs.forEach((u) => u()); this.unsubs = []; }

  /** 관리자가 아직 설정(가격/보상)을 서버에 올리지 않았으면 false */
  get configured() { return Boolean(this.config); }
  get ready() { return Boolean(this.config && this.wallet); }
  get coins() { return this.wallet ? this.wallet.coins : 0; }

  serverNow() { return Date.now() + this.offset; }
  today() { return dayIndex(this.serverNow(), this.config.dayOffsetMs); }

  /** 가격: 서버(보안 규칙이 쓰는 값)가 기준, 아직 없으면 설정 파일 값 */
  price(id) {
    const server = this.shop && this.shop[id];
    if (server) return server.price;
    const it = getItem(id);
    return it ? it.price : null;
  }

  owns(id) {
    const it = getItem(id);
    return Boolean(it && (this.price(id) === 0 || isFree(it) && !this.shop || this.inventory[id]));
  }

  look() {
    const eq = (this.profile && this.profile.equipped) || {};
    const look = normalizeLook(eq);
    for (const s of SLOTS) if (!this.owns(look[s])) look[s] = normalizeLook(null)[s];
    return look;
  }

  get name() { return (this.profile && this.profile.name) || ''; }

  // ---------- 지갑 거래 ----------
  async _freshWallet() {
    this.wallet = await this.db.get(`users/${this.uid}/wallet`);
    return this.wallet;
  }

  async _write(wallet, extra = {}) {
    try {
      await this.db.update('', { [`users/${this.uid}/wallet`]: wallet, ...extra });
    } catch (e) {
      throw new Error(/permission/i.test(e.message) ? '서버가 거절했어요 (조건이 맞지 않거나 설정이 바뀌었어요)' : e.message);
    }
  }

  /** 처음 접속하면 지갑 만들기 (시작 코인) */
  async ensureWallet() {
    if (!this.config) return false;
    if (await this._freshWallet()) return false;
    await this._write({
      coins: this.config.startCoins, tx: { type: 'create' },
      dailyDay: 0, bailoutDay: 0, aiDay: 0, aiCount: 0, aiLastAt: 0, createdAt: this.db.serverTime(),
    });
    return this.config.startCoins;
  }

  /** 매일 첫 접속 보상. 받은 코인 (이미 받았으면 0) */
  async claimDaily() {
    const w = await this._freshWallet();
    const day = this.today();
    if (!w || w.dailyDay >= day) return 0;
    await this._write({ ...w, coins: w.coins + this.config.dailyBonus, dailyDay: day, tx: { type: 'daily' } });
    return this.config.dailyBonus;
  }

  canBailout() {
    const w = this.wallet;
    return Boolean(this.config && w && w.coins < this.config.bailoutBelow && w.bailoutDay < this.today());
  }

  /** 잔액이 적으면 하루 1번 구제금 */
  async claimBailout() {
    const w = await this._freshWallet();
    if (!w || w.coins >= this.config.bailoutBelow || w.bailoutDay >= this.today()) return 0;
    await this._write({ ...w, coins: w.coins + this.config.bailoutAmount, bailoutDay: this.today(), tx: { type: 'bailout' } });
    return this.config.bailoutAmount;
  }

  /** AI 대전 승리 보상: {ok, reward} 또는 {ok:false, reason} */
  async claimAiWin() {
    const w = await this._freshWallet();
    if (!w) return { ok: false, reason: '지갑이 없어요' };
    const day = this.today();
    const count = w.aiDay === day ? w.aiCount + 1 : 1;
    if (count > this.config.aiDailyCap) return { ok: false, reason: `오늘 AI 대전 보상은 다 받았어요 (하루 ${this.config.aiDailyCap}번)` };
    if (this.serverNow() - w.aiLastAt < this.config.aiMinIntervalMs) return { ok: false, reason: '보상을 너무 자주 받을 수 없어요' };
    await this._write({
      ...w, coins: w.coins + this.config.aiWinReward, aiDay: day, aiCount: count, aiLastAt: this.db.serverTime(), tx: { type: 'aiWin' },
    });
    return { ok: true, reward: this.config.aiWinReward, left: this.config.aiDailyCap - count };
  }

  /** 아이템 구매 */
  async buy(itemId) {
    const it = getItem(itemId);
    if (!it || it.enabled === false) throw new Error('없는 아이템이에요');
    if (this.owns(itemId)) throw new Error('이미 가지고 있어요');
    const price = this.price(itemId);
    const w = await this._freshWallet();
    if (!w || w.coins < price) throw new Error('코인이 부족해요');
    await this._write({ ...w, coins: w.coins - price, tx: { type: 'buy', item: itemId } },
      { [`users/${this.uid}/inventory/${itemId}`]: true });
  }

  async equip(slot, itemId) {
    if (!this.owns(itemId)) throw new Error('가지고 있지 않은 아이템이에요');
    await this.db.update(`users/${this.uid}/profile/equipped`, { [slot]: itemId });
  }

  async setName(name) {
    const n = String(name || '').trim().slice(0, 12);
    if (n && n !== this.name) await this.db.set(`users/${this.uid}/profile/name`, n);
  }

  // ---------- 온라인 베팅 ----------
  async stake(code, bet) {
    const w = await this._freshWallet();
    if (!w || w.coins < bet) throw new Error(`코인이 부족해요 (베팅 ${bet})`);
    await this._write({ ...w, coins: w.coins - bet, tx: { type: 'bet', room: code } }, {
      [`rooms/${code}/stakes/${this.uid}`]: bet,
      [`users/${this.uid}/pending/${code}`]: true,
    });
  }

  async refund(code) {
    const stake = await this.db.get(`rooms/${code}/stakes/${this.uid}`);
    if (!stake) { await this.db.remove(`users/${this.uid}/pending/${code}`); return 0; }
    const w = await this._freshWallet();
    await this._write({ ...w, coins: w.coins + stake, tx: { type: 'refund', room: code } }, {
      [`rooms/${code}/stakes/${this.uid}`]: null,
      [`users/${this.uid}/pending/${code}`]: null,
    });
    return stake;
  }

  async claimPayout(code) {
    const [stake, paid] = await Promise.all([
      this.db.get(`rooms/${code}/stakes/${this.uid}`),
      this.db.get(`rooms/${code}/payouts/${this.uid}`),
    ]);
    if (!stake || paid) return 0;
    const w = await this._freshWallet();
    await this._write({ ...w, coins: w.coins + 2 * stake, tx: { type: 'payout', room: code } }, {
      [`rooms/${code}/payouts/${this.uid}`]: true,
      [`users/${this.uid}/pending/${code}`]: null,
    });
    return 2 * stake;
  }

  /**
   * 베팅해 둔 방 정리: 이긴 판 상금 받기 / 시작 안 했거나 빠진 방 환불 / 진 판 기록 지우기
   * @returns {Promise<{payout: number, refund: number}>}
   */
  async reconcile(activeCode = null) {
    const out = { payout: 0, refund: 0 };
    const pending = (await this.db.get(`users/${this.uid}/pending`)) || {};
    for (const code of Object.keys(pending)) {
      if (code === activeCode) continue;
      try {
        const [meta, stake, result, seats] = await Promise.all([
          this.db.get(`rooms/${code}/meta`),
          this.db.get(`rooms/${code}/stakes/${this.uid}`),
          this.db.get(`rooms/${code}/result`),
          this.db.get(`rooms/${code}/seats`),
        ]);
        const seated = [0, 1, 2, 3].some((i) => seats && seats[i] && seats[i].uid === this.uid);
        if (!stake) await this.db.remove(`users/${this.uid}/pending/${code}`);
        else if (result && result.winner === this.uid) out.payout += await this.claimPayout(code);
        else if (!result && (!meta || meta.status === 'lobby' || !seated)) out.refund += await this.refund(code);
        else if (result || (meta && meta.status === 'over')) await this.db.remove(`users/${this.uid}/pending/${code}`);
      } catch (e) {
        console.warn('베팅 정리 실패', code, e);
      }
    }
    return out;
  }

  // ---------- 관리자 ----------
  async adminState() {
    const admins = (await this.db.get('admins')) || {};
    return { exists: Object.keys(admins).length > 0, me: admins[this.uid] === true };
  }

  claimAdmin() { return this.db.set(`admins/${this.uid}`, true); }

  /** items.config.js 값과 서버 값 비교: 'same' | 'different' | 'missing' */
  async catalogStatus() {
    const [economy, items] = await Promise.all([this.db.get('config/economy'), this.db.get('shop/items')]);
    if (!economy || !items) return 'missing';
    const local = serverCatalog();
    return sameJSON(local.economy, economy) && sameJSON(local.items, items) ? 'same' : 'different';
  }

  /** items.config.js의 가격/보상 값을 서버(보안 규칙이 읽는 곳)에 올림 */
  async syncCatalog() {
    const { items, economy } = serverCatalog();
    await this.db.update('', { 'config/economy': economy, 'shop/items': items });
  }
}
