// Firebase 에뮬레이터(auth + database)에서 실제 SDK와 보안 규칙으로 온라인 흐름 검사
// 실행: npm run test:online   (Java 필요, 처음 실행 때 에뮬레이터를 내려받음)
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as app from 'firebase/app';
import * as auth from 'firebase/auth';
import * as database from 'firebase/database';
import { connectFirebase } from '../src/net/firebase.js';
import { OnlineRoom } from '../src/online.js';
import { Phase, validPositions } from '../src/game.js';
import { buildView } from '../src/view.js';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-davinci';
const CONFIG = { apiKey: 'demo-key', projectId: PROJECT, databaseURL: `http://127.0.0.1:9000?ns=${PROJECT}` };
const EMU = { dbHost: '127.0.0.1', dbPort: 9000, authUrl: 'http://127.0.0.1:9099' };
const FAST = { setup: 20, think: 20, announce: 20, decide: 20, place: 20 };
// Firebase SDK(auth)가 닫은 뒤에도 프로세스를 붙잡고 있어서, 테스트가 끝나면 정리 후 종료
after(() => { setTimeout(() => process.exit(), 1000).unref(); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let appCount = 0;
const dbg = process.env.DEBUG ? (...x) => console.log('[dbg]', ...x) : () => {};

async function client() {
  return connectFirebase(CONFIG, { app, auth, database }, { emulator: EMU, appName: `c${appCount++}`, persistence: 'memory' });
}

let progress = () => '';
async function until(cond, ms = 20000, what = '조건') {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`시간 초과: ${what} ${progress()}`);
    await sleep(50);
  }
}

async function denied(promise) {
  await assert.rejects(promise, /permission|PERMISSION_DENIED/i);
}

// 화면 대신 view만 보고 행동하는 플레이어
function bot(room, seed) {
  let s = seed;
  const rng = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  const state = { views: [], lastKey: null, maxForeignValues: 0 };
  room.onGame = (pub, priv) => {
    const v = buildView(pub, priv);
    state.view = v;
    state.pub = pub;
    state.priv = priv;
    const me = room.seat;
    // 남의 숨긴 타일 숫자를 하나라도 알게 되면 안 됨
    if (v.phase !== Phase.OVER) {
      for (const t of v.tiles) {
        if (t && !t.revealed && t.ownerId !== me && t.value !== null) state.leak = t;
      }
    }
    if (v.players[me].kind !== 'human') return;
    let a = null;
    if (v.phase === Phase.SETUP) {
      const p = v.pendingSetup.find((x) => x.playerId === me);
      if (p) a = { type: 'setup', tileId: p.tileId, index: 0 };
    } else if (v.current === me) {
      switch (v.phase) {
        case Phase.DRAW: a = { type: 'draw', tileId: v.pile[Math.floor(rng() * v.pile.length)].id }; break;
        case Phase.GUESS: {
          const ts = v.guessTargets(me);
          a = { type: 'guess', tileId: ts[Math.floor(rng() * ts.length)].tileId, value: Math.floor(rng() * 12) };
          break;
        }
        case Phase.DECIDE: a = { type: rng() < 0.5 ? 'continue' : 'stop' }; break;
        case Phase.PLACE: {
          const pos = validPositions(v.players[me].hand, v.drawn);
          if (pos.length > 1) a = { type: 'place', index: pos[pos.length - 1] };
          break;
        }
        case Phase.REVEAL_OWN: a = { type: 'revealOwn', tileId: v.players[me].hand.find((t) => !t.revealed).id }; break;
        default: break;
      }
    }
    const key = `${pub.step}`;
    if (a && key !== state.lastKey) {
      state.lastKey = key;
      setTimeout(() => room.send(a), 10);
    }
  };
  return state;
}

test('4명 온라인: 방 만들기 → 입장 → 자동 시작 → 비공개 규칙 → 나가면 AI → 방장 교체 → 끝까지', { timeout: 120000 }, async () => {
  const dbs = await Promise.all([client(), client(), client(), client(), client()]);
  const [a, b, c, d, outsider] = dbs;
  const lobby = {};
  const opts = (n) => ({ name: n, delays: FAST, onLobby: (info) => { lobby[n] = info; }, onError: (e) => console.error(n, e) });

  const ra = await OnlineRoom.create(a, opts('A'));
  dbg(6, progress());
  assert.match(ra.code, /^[A-Z0-9]{5}$/);
  await until(() => ra.isHost, 5000, 'A가 방장');
  dbg(8, progress());
  const rb = await OnlineRoom.join(b, ra.code.toLowerCase(), opts('B'));
  dbg(9, progress());
  const rc = await OnlineRoom.join(c, ra.code, opts('C'));
  dbg(10, progress());
  await until(() => lobby.A && lobby.A.seats.filter(Boolean).length === 3, 5000, '대기실 3명');
  dbg(11, progress());
  assert.equal(lobby.A.status, 'lobby');

  // 대기실에서 밖의 사람이 남의 자리를 지우거나 상태를 바꿀 수 없음
  await denied(outsider.remove(`rooms/${ra.code}/seats/0`));
  dbg(15, progress());
  await denied(outsider.set(`rooms/${ra.code}/meta/status`, 'playing'));
  dbg(16, progress());
  await denied(outsider.set(`rooms/${ra.code}/meta/host`, outsider.uid)); // 방장이 접속 중이면 못 뺏음
  await denied(b.set(`rooms/${ra.code}/meta/host`, b.uid)); // 멤버도 방장이 접속 중이면 못 뺏음
  dbg(17, progress());

  const bots = { A: bot(ra, 1), B: bot(rb, 2), C: bot(rc, 3) };
  const rd = await OnlineRoom.join(d, ra.code, opts('D'));
  dbg(20, progress());
  bots.D = bot(rd, 4);
  const rooms = { A: ra, B: rb, C: rc, D: rd };
  dbg(22, progress());

  // 4명이 모이면 자동 시작
  await until(() => Object.values(bots).every((s) => s.view), 10000, '모두 게임 화면');
  dbg(25, progress());
  assert.deepEqual(new Set(Object.values(rooms).map((r) => r.seat)), new Set([0, 1, 2, 3]));
  await assert.rejects(OnlineRoom.join(outsider, ra.code, opts('E')), /이미 게임이 시작/);
  dbg(27, progress());

  // 남의 비공개 상태 / secret / actions는 읽을 수 없고, public은 방장만 씀
  await denied(b.get(`rooms/${ra.code}/private/${a.uid}`));
  dbg(30, progress());
  await denied(b.get(`rooms/${ra.code}/secret`));
  dbg(31, progress());
  await denied(b.get(`rooms/${ra.code}/actions`));
  dbg(32, progress());
  await denied(b.set(`rooms/${ra.code}/public`, { json: '{}' }));
  dbg(33, progress());
  await denied(outsider.get(`rooms/${ra.code}/private/${b.uid}`));
  dbg(34, progress());
  await denied(outsider.push(`rooms/${ra.code}/actions`, { uid: outsider.uid, step: 0, action: { type: 'stop' } }));
  dbg(35, progress());
  await denied(c.push(`rooms/${ra.code}/actions`, { uid: b.uid, step: 0, action: { type: 'stop' } })); // 남 행세
  dbg(36, progress());
  const mine = await b.get(`rooms/${ra.code}/private/${b.uid}`);
  assert.ok(mine && mine.json);

  progress = () => JSON.stringify(Object.fromEntries(Object.entries(bots).map(([n, st]) => [n, st.pub && {
    step: st.pub.step, phase: st.pub.phase, cur: st.pub.current, kinds: st.pub.players.map((p) => p.kind).join(','),
  }])));
  // 게임이 좀 진행된 뒤 C가 나감 → C 자리를 AI가 맡음
  await until(() => bots.A.pub.step >= 8, 20000, '게임 진행');
  dbg(44, progress());
  const cSeat = rc.seat;
  await rc.leave();
  dbg(46, progress());
  await until(() => bots.A.pub.players[cSeat].kind === 'ai' && bots.A.pub.players[cSeat].offline, 10000, 'C 자리 AI');
  dbg(47, progress());

  // 방장 A 연결이 끊김 → 접속 중인 사람 중 자리가 가장 앞인 사람이 방장이 되어 secret으로 이어감
  const stepBefore = bots.B.pub.step;
  a.goOffline();
  const remaining = [rb, rd].sort((x, y) => x.seat - y.seat);
  dbg(52, progress());
  await until(() => remaining[0].isHost && remaining[0].engine, 15000, '방장 교체');
  dbg(53, progress());
  assert.ok(remaining[0].engine.step >= stepBefore);
  assert.equal(remaining[0].engine.seats[cSeat].kind, 'ai', '이미 AI가 맡던 자리는 방장이 바뀌어도 AI');
  // 새 방장은 A 자리를 AI로 바꿈
  await until(() => bots.B.pub.players[ra.seat].kind === 'ai', 10000, 'A 자리 AI');
  dbg(56, progress());

  // 끝까지 진행
  await until(() => bots.B.pub.phase === Phase.OVER && bots.D.pub.phase === Phase.OVER, 90000, '게임 종료');
  dbg(59, progress());
  const winner = bots.B.pub.winner;
  assert.equal(bots.D.pub.winner, winner);
  assert.equal(bots.B.pub.players.filter((p) => !p.eliminated).length, 1);
  for (const [n, s] of Object.entries(bots)) assert.equal(s.leak, undefined, `${n}가 남의 숫자를 봄`);
  await until(() => remaining[0].meta.status === 'over', 5000, '방 상태 over');
  dbg(64, progress());

  ra.leave(); // A는 연결이 끊긴 상태라 기다리지 않음 (타이머만 정리)
  await Promise.all([rb.leave(), rd.leave()]);
  dbg(66, progress());
  await Promise.all(dbs.map((x) => x.close()));
  dbg(67, progress());
});

test('대기실: 방장이 빈자리를 AI로 채우고 시작 / 대기실에서 나가면 자리 비움', { timeout: 60000 }, async () => {
  const [a, b, c] = await Promise.all([client(), client(), client()]);
  const opts = (n) => ({ name: n, delays: FAST });
  const ra = await OnlineRoom.create(a, opts('A'));
  const rb = await OnlineRoom.join(b, ra.code, opts('B'));
  const rc = await OnlineRoom.join(c, ra.code, opts('C'));
  await until(() => ra.seats.filter(Boolean).length === 3, 5000, '3명');
  await rc.leave();
  await until(() => ra.seats.filter(Boolean).length === 2, 5000, 'C 자리 비움');
  // 나간 자리는 다른 사람이 새로 들어올 수 있음
  const rc2 = await OnlineRoom.join(c, ra.code, opts('C2'));
  await until(() => ra.seats.filter(Boolean).length === 3, 5000, 'C2 입장');

  const seen = bot(rb, 7);
  await rb.startGame(); // 방장이 아니면 아무 일도 없음
  assert.equal(ra.status, 'lobby');
  await ra.startGame();
  await until(() => seen.view, 10000, 'B 게임 화면');
  assert.equal(seen.pub.players.filter((p) => p.kind === 'ai').length, 1);
  await Promise.all([ra.leave(), rb.leave(), rc2.leave()]);
  await Promise.all([a, b, c].map((x) => x.close()));
});
