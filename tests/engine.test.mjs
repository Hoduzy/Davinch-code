// 실행: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Phase, validPositions } from '../src/game.js';
import { HostEngine } from '../src/engine.js';
import { buildView } from '../src/view.js';
import * as ai from '../src/ai.js';

const FAST = { setup: 0, think: 0, announce: 0, decide: 0, place: 0 };

function seeded(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

// 공개 상태에 숨긴 타일의 숫자가 없는지, 비공개 상태에는 자기 타일만 있는지 검사
function checkPrivacy(out, engine) {
  const g = engine.game;
  const pub = out.public;
  if (pub.phase !== Phase.OVER) {
    const all = [...pub.players.flatMap((p) => p.hand), ...pub.pile, ...(pub.drawn ? [pub.drawn] : [])];
    for (const t of all) {
      if (!t.revealed) assert.equal(t.value, undefined, '공개 상태에 숨긴 숫자가 있음');
    }
    assert.equal(JSON.stringify(pub).includes('"ownerId"'), false);
  }
  out.privates.forEach((priv, seat) => {
    for (const id of Object.keys(priv.values)) {
      assert.equal(g.tile(Number(id)).ownerId, seat, `자리 ${seat}가 남의 타일 숫자를 받음`);
    }
  });
}

// 사람 자리를 흉내 내는 봇: view(공개+자기 비공개)만 보고 행동
function humanAction(view, seat, rng) {
  const me = view.players[seat];
  if (view.phase === Phase.SETUP) {
    const p = view.pendingSetup.find((x) => x.playerId === seat);
    return p ? { type: 'setup', tileId: p.tileId, index: Math.floor(rng() * (me.hand.length + 1)) } : null;
  }
  if (view.current !== seat) return null;
  switch (view.phase) {
    case Phase.DRAW: return { type: 'draw', tileId: view.pile[Math.floor(rng() * view.pile.length)].id };
    case Phase.GUESS: {
      const targets = view.guessTargets(seat);
      const t = targets[Math.floor(rng() * targets.length)];
      return { type: 'guess', tileId: t.tileId, value: Math.floor(rng() * 12) };
    }
    case Phase.DECIDE: return { type: rng() < 0.5 ? 'continue' : 'stop' };
    case Phase.PLACE: {
      const pos = validPositions(me.hand, view.drawn);
      return pos.length > 1 ? { type: 'place', index: pos[0] } : null;
    }
    case Phase.REVEAL_OWN: return { type: 'revealOwn', tileId: me.hand.find((t) => !t.revealed).id };
    default: return null;
  }
}

function runGame(seed, kinds, { dropSeat = null } = {}) {
  const rng = seeded(seed);
  return new Promise((resolve, reject) => {
    let engine;
    let publishes = 0;
    const seats = kinds.map((kind, i) => ({ name: `P${i}`, kind }));
    const onPublish = (out) => {
      try {
        publishes++;
        checkPrivacy(out, engine);
        if (out.public.phase === Phase.OVER) { engine.dispose(); resolve({ engine, publishes }); return; }
        if (publishes > 5000) throw new Error('끝나지 않음');
        if (dropSeat !== null && publishes === 20) engine.setSeat(dropSeat, { kind: 'ai', offline: true });
        // 사람 자리들이 각자 자기 view로 행동 (다음 틱에)
        setTimeout(() => {
          engine.seats.forEach((s, seat) => {
            if (s.kind !== 'human' || engine.disposed) return;
            const view = buildView(engine.publicState(), engine.privateState(seat));
            const a = humanAction(view, seat, rng);
            if (a) {
              const err = engine.submit(seat, a);
              assert.equal(err, null, `행동 거절: ${JSON.stringify(a)} → ${err}`);
            }
          });
        }, 0);
      } catch (e) {
        engine.dispose();
        reject(e);
      }
    };
    engine = HostEngine.newGame({ seats, onPublish, delays: FAST, rng, firstPlayer: seed % 4 });
    engine.start();
  });
}

test('사람 4명(봇) 게임이 끝까지 진행되고 숨긴 숫자는 새지 않음', async () => {
  for (let s = 1; s <= 20; s++) {
    const { engine } = await runGame(s, ['human', 'human', 'human', 'human']);
    assert.equal(engine.game.alivePlayers().length, 1);
  }
});

test('사람 2 + AI 2, 중간에 사람 1명이 나가면 AI가 이어서 끝냄', async () => {
  for (let s = 1; s <= 20; s++) {
    const { engine } = await runGame(s, ['human', 'ai', 'human', 'ai'], { dropSeat: 2 });
    assert.equal(engine.game.phase, Phase.OVER);
    assert.equal(engine.seats[2].kind, 'ai');
  }
});

test('차례가 아닌 사람의 행동은 거절', () => {
  const engine = HostEngine.newGame({
    seats: ['human', 'human', 'human', 'human'].map((kind, i) => ({ name: `P${i}`, kind })),
    onPublish: () => {}, delays: FAST, rng: seeded(3), firstPlayer: 0,
  });
  engine.start();
  while (engine.game.pendingSetup.length) {
    const { playerId, tileId } = engine.game.pendingSetup[0];
    assert.equal(engine.submit(playerId, { type: 'setup', tileId, index: 0 }), null);
  }
  const pileId = engine.game.pile[0].id;
  assert.match(engine.submit(1, { type: 'draw', tileId: pileId }), /차례/);
  assert.equal(engine.submit(0, { type: 'draw', tileId: pileId }), null);
  engine.dispose();
});

test('secret 상태로 방장을 바꿔도 같은 게임이 이어짐', async () => {
  const rng = seeded(9);
  const seats = ['ai', 'ai', 'ai', 'ai'].map((kind, i) => ({ name: `P${i}`, kind }));
  let last = null;
  const first = HostEngine.newGame({ seats, onPublish: (o) => { last = o; }, delays: FAST, rng });
  first.start();
  await new Promise((r) => setTimeout(r, 30));
  first.dispose();
  const snapshot = JSON.parse(JSON.stringify(last.secret));
  const done = new Promise((resolve) => {
    const second = HostEngine.restore(snapshot, {
      delays: FAST,
      rng,
      onPublish: (o) => { if (o.public.phase === Phase.OVER) { second.dispose(); resolve(second); } },
    });
    assert.deepEqual(second.publicState().players.map((p) => p.hand.length), last.public.players.map((p) => p.hand.length));
    second.start();
  });
  const second = await done;
  assert.equal(second.game.alivePlayers().length, 1);
  assert.equal(second.gameId, snapshot.gameId);
});

test('AI 판단은 view에서 보이는 정보와 같은 후보를 씀', () => {
  // AI가 Game 대신 view로도 같은 후보를 계산할 수 있는지 (정보를 더 쓰지 않는지)
  const engine = HostEngine.newGame({
    seats: ['ai', 'ai', 'ai', 'ai'].map((kind, i) => ({ name: `P${i}`, kind })),
    onPublish: () => {}, delays: FAST, rng: seeded(5),
  });
  engine.game.deal();
  for (const { playerId, tileId } of [...engine.game.pendingSetup]) engine.game.placeSetupTile(playerId, tileId, 0);
  const g = engine.game;
  for (const { playerId, tileId } of g.guessTargets(0)) {
    assert.ok(ai.candidatesFor(g, 0, playerId, tileId).includes(g.tile(tileId).value));
  }
  engine.dispose();
});
