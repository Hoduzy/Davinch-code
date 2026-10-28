// 간단한 AI: 자기가 볼 수 있는 정보(내 타일, 공개된 타일, 틀린 추리 기록, 줄의 순서)만 사용
import { JOKER, NUMBERS, tileKey, validPositions } from './game.js';

function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

// pid 입장에서 값이 확정된 타일 (색:값)
function knownSet(game, pid) {
  const known = new Set();
  const me = game.player(pid);
  for (const t of me.hand) known.add(`${t.color}:${t.value}`);
  if (game.drawn && game.current === pid) known.add(`${game.drawn.color}:${game.drawn.value}`);
  for (const p of game.players) {
    for (const t of p.hand) if (t.revealed) known.add(`${t.color}:${t.value}`);
  }
  return known;
}

// owner의 줄에서 숨겨진 tile이 가질 수 있는 값 후보
export function candidatesFor(game, pid, ownerId, tileId) {
  const owner = game.player(ownerId);
  const idx = owner.hand.findIndex((t) => t.id === tileId);
  const tile = owner.hand[idx];
  const known = knownSet(game, pid);
  const wrong = new Set(game.wrongGuesses.filter((w) => w.tileId === tileId).map((w) => w.value));

  // 같은 줄에 공개된 숫자 타일로 범위 제한
  let lower = -Infinity;
  let upper = Infinity;
  owner.hand.forEach((t, i) => {
    if (!t.revealed || t.value === JOKER) return;
    if (i < idx) lower = Math.max(lower, tileKey(t));
    if (i > idx) upper = Math.min(upper, tileKey(t));
  });

  const out = [];
  for (const n of NUMBERS) {
    const k = tileKey({ value: n, color: tile.color });
    if (k > lower && k < upper && !known.has(`${tile.color}:${n}`) && !wrong.has(n)) out.push(n);
  }
  if (!known.has(`${tile.color}:${JOKER}`) && !wrong.has(JOKER)) out.push(JOKER);
  return out;
}

// 후보가 가장 적은 타일을 골라 추리 (조커는 다른 후보가 없을 때만)
export function chooseGuess(game, pid, rng = Math.random) {
  let best = null;
  for (const { playerId, tileId } of game.guessTargets(pid)) {
    const cands = candidatesFor(game, pid, playerId, tileId);
    const numbers = cands.filter((v) => v !== JOKER);
    const pool = numbers.length > 0 ? numbers : cands;
    const score = pool.length + rng() * 0.5; // 동점이면 무작위
    if (!best || score < best.score) best = { playerId, tileId, pool, score };
  }
  const value = best.pool.length > 0 ? pick(best.pool, rng) : 0;
  return { playerId: best.playerId, tileId: best.tileId, value, options: best.pool.length };
}

// 맞힌 뒤 계속할지: 확률이 꽤 높은 타일이 있을 때만 계속
export function shouldContinue(game, pid, rng = Math.random) {
  if (game.guessTargets(pid).length === 0) return false;
  const g = chooseGuess(game, pid, rng);
  if (g.options <= 1) return true;
  if (g.options === 2) return rng() < 0.6;
  if (g.options === 3) return rng() < 0.2;
  return false;
}

export function chooseDraw(game, rng = Math.random) {
  return pick(game.pile, rng).id;
}

export function choosePlacement(hand, tile, rng = Math.random) {
  return pick(validPositions(hand, tile), rng);
}

export function chooseRevealOwn(game, pid, rng = Math.random) {
  return pick(game.player(pid).hand.filter((t) => !t.revealed), rng).id;
}
