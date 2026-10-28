// 공개 상태 + 내 비공개 상태 → 화면(scene/ui)이 그리는 view
// 모르는 타일은 value가 null — 화면 코드에는 남의 숨긴 숫자가 아예 들어오지 않음
import { Phase } from './game.js';

export function buildView(pub, priv) {
  const values = (priv && priv.values) || {};
  const tiles = [];
  const mk = (t, ownerId) => {
    let value = null;
    if (t.value !== undefined) value = t.value;
    else if (values[t.id] !== undefined) value = values[t.id];
    const tile = { id: t.id, color: t.color, revealed: !!t.revealed, value, ownerId };
    tiles[t.id] = tile;
    return tile;
  };

  const pile = (pub.pile || []).map((t) => mk(t, null));
  const players = pub.players.map((p, i) => ({
    id: i,
    name: p.name,
    kind: p.kind,
    isHuman: p.kind === 'human',
    offline: !!p.offline,
    eliminated: !!p.eliminated,
    hand: (p.hand || []).map((t) => mk(t, i)),
  }));
  const drawn = pub.drawn ? mk(pub.drawn, pub.current) : null;
  const pendingSetup = (pub.pending || []).map((x) => {
    mk({ id: x.tileId, color: x.color }, x.playerId);
    return { playerId: x.playerId, tileId: x.tileId };
  });

  return {
    gameId: pub.gameId,
    step: pub.step,
    phase: pub.phase,
    current: pub.current,
    winner: pub.winner === undefined ? null : pub.winner,
    tiles,
    pile,
    players,
    drawn,
    pendingSetup,
    wrongGuesses: pub.wrong || [],
    log: pub.log || [],
    logBase: pub.logBase || 0,
    announce: pub.announce || null,
    tile(id) { return tiles[id]; },
    player(id) { return players[id]; },
    get currentPlayer() { return players[this.current]; },
    guessTargets(byId) {
      const out = [];
      for (const p of players) {
        if (p.id === byId || p.eliminated) continue;
        for (const t of p.hand) if (!t.revealed) out.push({ playerId: p.id, tileId: t.id });
      }
      return out;
    },
    isOver() { return this.phase === Phase.OVER; },
  };
}
