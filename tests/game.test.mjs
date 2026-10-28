// 실행: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, Phase, JOKER, tileKey, validPositions } from '../src/game.js';
import * as ai from '../src/ai.js';

function seeded(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const PLAYERS = [{ name: '나', isHuman: true }, { name: 'A' }, { name: 'B' }, { name: 'C' }];

function assertSorted(hand) {
  const nums = hand.filter((t) => t.value !== JOKER).map(tileKey);
  for (let i = 1; i < nums.length; i++) assert.ok(nums[i - 1] < nums[i], 'hand not sorted');
}

function playOut(rng) {
  const g = new Game({ players: PLAYERS, rng });
  g.deal();
  for (const { playerId, tileId } of [...g.pendingSetup]) {
    g.placeSetupTile(playerId, tileId, ai.choosePlacement(g.player(playerId).hand, g.tile(tileId), rng));
  }
  let steps = 0;
  while (g.phase !== Phase.OVER) {
    assert.ok(++steps < 5000, 'game did not end');
    const pid = g.current;
    switch (g.phase) {
      case Phase.DRAW: g.draw(ai.chooseDraw(g, rng)); break;
      case Phase.GUESS: {
        const c = ai.chooseGuess(g, pid, rng);
        // AI 후보에는 항상 정답이 포함돼야 함 (정보를 잘못 쓰지 않는지)
        const actual = g.tile(c.tileId).value;
        const cands = ai.candidatesFor(g, pid, c.playerId, c.tileId);
        assert.ok(cands.includes(actual), `candidates miss real value ${actual}`);
        g.guess(c.playerId, c.tileId, c.value);
        break;
      }
      case Phase.DECIDE:
        if (ai.shouldContinue(g, pid, rng)) g.continueGuessing(); else g.stop();
        break;
      case Phase.PLACE: g.placeDrawn(ai.choosePlacement(g.currentPlayer.hand, g.drawn, rng)); break;
      case Phase.REVEAL_OWN: g.revealOwn(ai.chooseRevealOwn(g, pid, rng)); break;
      default: throw new Error(`unexpected phase ${g.phase}`);
    }
    for (const p of g.players) {
      assertSorted(p.hand);
      assert.equal(p.eliminated, p.hand.every((t) => t.revealed));
    }
  }
  return g;
}

test('정렬 위치: 같은 숫자면 검정이 왼쪽', () => {
  const hand = [{ value: 3, color: 'black' }, { value: 5, color: 'white' }];
  assert.deepEqual(validPositions(hand, { value: 3, color: 'white' }), [1]);
  assert.deepEqual(validPositions(hand, { value: 5, color: 'black' }), [1]);
  assert.deepEqual(validPositions(hand, { value: 0, color: 'white' }), [0]);
});

test('조커는 어디든, 조커 옆 숫자는 여러 자리 가능', () => {
  const hand = [{ value: 2, color: 'black' }, { value: JOKER, color: 'white' }, { value: 8, color: 'black' }];
  assert.deepEqual(validPositions(hand, { value: JOKER, color: 'black' }), [0, 1, 2, 3]);
  assert.deepEqual(validPositions(hand, { value: 5, color: 'black' }), [1, 2]);
});

test('틀리면 뽑은 타일 공개 후 줄에 들어가고 차례가 넘어감', () => {
  const g = new Game({ players: PLAYERS, rng: seeded(1) });
  g.deal();
  while (g.pendingSetup.length) {
    const { playerId, tileId } = g.pendingSetup[0];
    g.placeSetupTile(playerId, tileId, 0);
  }
  const drawId = g.pile[0].id;
  g.draw(drawId);
  const target = g.player(1).hand.find((t) => !t.revealed);
  const wrong = target.value === 0 ? 1 : 0;
  const r = g.guess(1, target.id, wrong);
  assert.equal(r.correct, false);
  assert.equal(g.phase, Phase.PLACE);
  assert.ok(g.tile(drawId).revealed);
  g.placeDrawn(g.drawnPositions()[0]);
  assert.equal(g.current, 1);
  assert.ok(g.player(0).hand.some((t) => t.id === drawId));
});

test('맞히고 멈추면 뽑은 타일은 숨긴 채 들어감', () => {
  const g = new Game({ players: PLAYERS, rng: seeded(2) });
  g.deal();
  while (g.pendingSetup.length) {
    const { playerId, tileId } = g.pendingSetup[0];
    g.placeSetupTile(playerId, tileId, 0);
  }
  const drawId = g.pile[0].id;
  g.draw(drawId);
  const target = g.player(2).hand[0];
  assert.equal(g.guess(2, target.id, target.value).correct, true);
  assert.ok(target.revealed);
  g.stop();
  g.placeDrawn(g.drawnPositions()[0]);
  assert.equal(g.tile(drawId).revealed, false);
});

test('AI끼리 300판: 항상 승자 1명으로 끝남', () => {
  for (let s = 1; s <= 300; s++) {
    const g = playOut(seeded(s));
    assert.equal(g.alivePlayers().length, 1);
    assert.equal(g.winner, g.alivePlayers()[0].id);
  }
});
