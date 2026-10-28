// 재화 보안 규칙 테스트 (Firebase 에뮬레이터, 실제 SDK + database.rules.json)
// 실행: npm run test:online
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { client, resetWithConfig, TEST_ECONOMY } from './emu-helpers.mjs';
import { Economy } from '../src/economy.js';
import { dayIndex } from '../src/catalog.js';

after(() => { setTimeout(() => process.exit(), 1000).unref(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const denied = (p) => assert.rejects(p, /permission|PERMISSION_DENIED|거절/i);

let admin;
test.before(async () => {
  admin = await resetWithConfig();
  assert.equal((await admin.get('admins'))[admin.uid], true);
});

test('관리자: 처음 한 명만 스스로 등록, 관리자가 아니면 설정을 못 바꿈', async () => {
  const x = await client();
  await denied(x.set(`admins/${x.uid}`, true));
  await denied(x.set('config/economy/startCoins', 999999));
  await denied(x.set('shop/items/skin_shinku/price', 0));
});

test('지갑: 시작 코인 / 출석 / 구매 / 구제금 / 장착, 그리고 위조 시도는 모두 거절', async () => {
  const db = await client();
  const eco = new Economy(db);
  await eco.start();
  const W = `users/${db.uid}/wallet`;

  // 시작 코인을 부풀려서 만들기 → 거절
  await denied(db.set(W, { coins: 999999, tx: { type: 'create' }, dailyDay: 0, bailoutDay: 0, aiDay: 0, aiCount: 0, aiLastAt: 0, createdAt: db.serverTime() }));
  assert.equal(await eco.ensureWallet(), 150);
  assert.equal(await eco.ensureWallet(), false);
  // 다시 create로 덮어쓰기 → 거절
  await denied(db.set(W, { coins: 150, tx: { type: 'create' }, dailyDay: 0, bailoutDay: 0, aiDay: 0, aiCount: 0, aiLastAt: 0, createdAt: db.serverTime() }));
  // 코인만 직접 바꾸기 → 거절
  await denied(db.set(`${W}/coins`, 100000));
  await denied(db.update(W, { coins: 100000 }));
  // 지갑 지우기 / 일부 지우기 → 거절
  await denied(db.remove(W));
  await denied(db.remove(`${W}/dailyDay`));
  await denied(db.update(W, { aiCount: null }));
  // 남의 지갑 읽기 → 거절
  const other = await client();
  await denied(other.get(W));

  // 출석: 한 번만
  assert.equal(await eco.claimDaily(), 20);
  assert.equal(await eco.claimDaily(), 0);
  let w = await db.get(W);
  assert.equal(w.coins, 170);
  await denied(db.set(W, { ...w, coins: w.coins + 20, dailyDay: w.dailyDay + 1, tx: { type: 'daily' } })); // 내일 날짜로 미리
  await denied(db.set(W, { ...w, coins: w.coins + 20, tx: { type: 'daily' } })); // 같은 날 또

  // 구매
  await denied(db.set(`users/${db.uid}/inventory/skin_shinku`, true)); // 공짜로 보관함에 넣기
  await denied(db.update('', { [W]: { ...w, coins: w.coins - 1, tx: { type: 'buy', item: 'skin_shinku' } }, [`users/${db.uid}/inventory/skin_shinku`]: true }));
  await denied(db.update('', { [W]: { ...w, coins: w.coins, tx: { type: 'buy', item: 'skin_basic' } }, [`users/${db.uid}/inventory/skin_basic`]: true }));
  await eco.buy('skin_shinku');
  assert.equal((await db.get(W)).coins, 70);
  assert.equal(await db.get(`users/${db.uid}/inventory/skin_shinku`), true);
  await assert.rejects(eco.buy('skin_shinku'), /이미/);
  w = await db.get(W);
  await denied(db.update('', { [W]: { ...w, coins: w.coins - 100, tx: { type: 'buy', item: 'skin_shinku' } } })); // 같은 아이템 또 (보관함 없이)

  // 장착: 가진 것 / 무료만
  await eco.equip('skin', 'skin_shinku');
  await denied(db.set(`users/${db.uid}/profile/equipped/tile`, 'tile_jade')); // 안 산 것
  await denied(db.set(`users/${db.uid}/profile/equipped/tile`, 'skin_basic')); // 다른 칸
  await db.set(`users/${db.uid}/profile/equipped/tile`, 'tile_classic');
  assert.equal((await other.get(`users/${db.uid}/profile/equipped/skin`)), 'skin_shinku', '장착은 남도 볼 수 있음');

  // 구제금: 100 미만일 때 하루 1번
  assert.equal(eco.canBailout(), true);
  assert.equal(await eco.claimBailout(), 50);
  assert.equal((await db.get(W)).coins, 120);
  w = await db.get(W);
  await denied(db.set(W, { ...w, coins: w.coins + 50, bailoutDay: w.bailoutDay, tx: { type: 'bailout' } }));
  assert.equal(await eco.claimBailout(), 0);
  eco.stop();
});

test('AI 대전 보상: 최소 간격과 하루 상한', async () => {
  const db = await client();
  const eco = new Economy(db);
  await eco.start();
  await eco.ensureWallet();
  const W = `users/${db.uid}/wallet`;
  await sleep(1100); // 지갑 만든 직후(aiLastAt=0)라 간격 문제는 없음
  assert.deepEqual((await eco.claimAiWin()).ok, true);
  let w = await db.get(W);
  // 바로 또 (서버 시각 기준 간격 미달) → 거절
  await denied(db.set(W, { ...w, coins: w.coins + 10, aiCount: w.aiCount + 1, aiLastAt: db.serverTime(), tx: { type: 'aiWin' } }));
  // aiLastAt을 옛날로 위조 → 거절
  await denied(db.set(W, { ...w, coins: w.coins + 10, aiCount: w.aiCount + 1, aiLastAt: 1, tx: { type: 'aiWin' } }));
  await sleep(1100);
  assert.equal((await eco.claimAiWin()).ok, true);
  await sleep(1100);
  const third = await eco.claimAiWin();
  assert.equal(third.ok, false); // 하루 2번 상한 (클라이언트가 먼저 막음)
  w = await db.get(W);
  // 상한 넘어 직접 쓰기 / 횟수 되돌리기 → 거절
  await denied(db.set(W, { ...w, coins: w.coins + 10, aiCount: 3, aiLastAt: db.serverTime(), tx: { type: 'aiWin' } }));
  await denied(db.set(W, { ...w, coins: w.coins + 10, aiCount: 1, aiLastAt: db.serverTime(), tx: { type: 'aiWin' } }));
  await denied(db.set(W, { ...w, coins: w.coins + 10, aiDay: w.aiDay + 1, aiCount: 1, aiLastAt: db.serverTime(), tx: { type: 'aiWin' } }));
  assert.equal(w.coins, 150 + 20);
  // 오늘 날짜 계산이 서버와 같은지
  assert.equal(w.aiDay, dayIndex(eco.serverNow(), TEST_ECONOMY.dayOffsetMs));
  eco.stop();
});

test('베팅: 대기실 환불, 게임 중 환불 불가, 승자만 2배 한 번', async () => {
  const [host, b, c] = await Promise.all([client(), client(), client()]);
  const ecoB = new Economy(b);
  const ecoC = new Economy(c);
  await Promise.all([ecoB.start(), ecoC.start()]);
  await ecoB.ensureWallet();
  await ecoC.ensureWallet();
  const code = `T${Date.now().toString(36).slice(-5).toUpperCase()}`;
  const R = `rooms/${code}`;
  await host.set(`${R}/meta/host`, host.uid);
  await host.update(`${R}/meta`, { status: 'lobby', bet: 20 });
  await denied(host.set(`${R}/meta/bet`, 999)); // 베팅액은 한 번 정하면 못 바꿈
  await b.set(`${R}/seats/1`, { uid: b.uid, name: 'B' });
  await c.set(`${R}/seats/2`, { uid: c.uid, name: 'C' });

  const WB = `users/${b.uid}/wallet`;
  // 돈은 안 내고 베팅만 기록 → 거절 / 다른 금액 → 거절
  await denied(b.set(`${R}/stakes/${b.uid}`, 20));
  let w = await b.get(WB);
  await denied(b.update('', { [WB]: { ...w, coins: w.coins - 1, tx: { type: 'bet', room: code } }, [`${R}/stakes/${b.uid}`]: 1 }));
  await ecoB.stake(code, 20);
  await ecoC.stake(code, 20);
  assert.equal((await b.get(WB)).coins, 130);
  await assert.rejects(ecoB.stake(code, 20)); // 두 번 → 거절
  // 대기실에서는 환불 가능
  assert.equal(await ecoB.refund(code), 20);
  assert.equal((await b.get(WB)).coins, 150);
  await ecoB.stake(code, 20);

  // 게임 시작 → 자리에 앉은 사람은 환불 불가
  await host.set(`${R}/meta/status`, 'playing');
  await denied(ecoB.refund(code));
  // 결과 전 상금 → 거절, 결과는 방장만 한 번
  await denied(ecoB.claimPayout(code));
  await denied(b.set(`${R}/result`, { winner: b.uid }));
  await host.set(`${R}/result`, { winner: b.uid, at: 1 });
  await denied(host.set(`${R}/result`, { winner: host.uid, at: 2 }));
  // 진 사람은 상금 못 받음
  w = await c.get(`users/${c.uid}/wallet`);
  await denied(c.update('', {
    [`users/${c.uid}/wallet`]: { ...w, coins: w.coins + 40, tx: { type: 'payout', room: code } },
    [`${R}/payouts/${c.uid}`]: true,
  }));
  // 승자는 2배 한 번
  assert.equal(await ecoB.claimPayout(code), 40);
  assert.equal((await b.get(WB)).coins, 130 + 40);
  assert.equal(await ecoB.claimPayout(code), 0);
  w = await b.get(WB);
  await denied(b.set(WB, { ...w, coins: w.coins + 40, tx: { type: 'payout', room: code } }));

  // 정리: 진 사람은 기록만 지움, 승자 기록은 이미 지워짐
  await host.set(`${R}/meta/status`, 'over');
  const rc = await ecoC.reconcile();
  assert.deepEqual(rc, { payout: 0, refund: 0 });
  assert.equal(await c.get(`users/${c.uid}/pending/${code}`), null);
  assert.equal((await c.get(`users/${c.uid}/wallet`)).coins, 130);
  ecoB.stop();
  ecoC.stop();
});

test('베팅: 대기실에서 쫓겨나 자리가 없으면 나중에 환불 (reconcile)', async () => {
  const [host, b] = await Promise.all([client(), client()]);
  const eco = new Economy(b);
  await eco.start();
  await eco.ensureWallet();
  const code = `K${Date.now().toString(36).slice(-5).toUpperCase()}`;
  const R = `rooms/${code}`;
  await host.set(`${R}/meta/host`, host.uid);
  await host.update(`${R}/meta`, { status: 'lobby', bet: 30 });
  await b.set(`${R}/seats/1`, { uid: b.uid, name: 'B' });
  await eco.stake(code, 30);
  await host.remove(`${R}/seats/1`); // 연결이 끊겨 방장이 자리를 비움
  await host.set(`${R}/meta/status`, 'playing');
  const rc = await eco.reconcile();
  assert.equal(rc.refund, 30);
  assert.equal((await b.get(`users/${b.uid}/wallet`)).coins, 150);
  eco.stop();
});
