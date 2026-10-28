// 다빈치 코드 게임 규칙 (순수 로직 — DOM / Three.js 의존성 없음)

export const COLORS = ['black', 'white'];
export const JOKER = 'J';
export const NUMBERS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
export const ALL_VALUES = [...NUMBERS, JOKER];

export const Phase = {
  SETUP: 'setup',         // 초기 패에 조커 배치 대기
  DRAW: 'draw',           // 더미에서 뽑기
  GUESS: 'guess',         // 상대 타일 추리
  DECIDE: 'decide',       // 맞힌 뒤: 계속 추리 / 멈추기
  PLACE: 'place',         // 뽑은 타일을 내 줄에 넣기
  REVEAL_OWN: 'revealOwn',// 더미가 비어 뽑은 타일 없이 틀림 → 내 타일 하나 공개
  OVER: 'over',
};

export function valueLabel(value) {
  return value === JOKER ? '조커' : String(value);
}

export function colorLabel(color) {
  return color === 'black' ? '검정' : '흰색';
}

// 정렬 키: 숫자 오름차순, 같은 숫자면 검정이 왼쪽
export function tileKey(tile) {
  return tile.value * 2 + (tile.color === 'black' ? 0 : 1);
}

export function makeTiles() {
  const tiles = [];
  let id = 0;
  for (const color of COLORS) {
    for (const value of ALL_VALUES) {
      tiles.push({ id: id++, color, value, revealed: false, ownerId: null });
    }
  }
  return tiles;
}

export function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// tile을 hand에 넣을 수 있는 인덱스 목록 (조커는 어디든, 숫자는 숫자 타일 순서를 지키는 곳)
export function validPositions(hand, tile) {
  const all = [];
  for (let i = 0; i <= hand.length; i++) all.push(i);
  if (tile.value === JOKER) return all;
  const k = tileKey(tile);
  return all.filter((i) =>
    hand.slice(0, i).every((t) => t.value === JOKER || tileKey(t) < k) &&
    hand.slice(i).every((t) => t.value === JOKER || tileKey(t) > k));
}

export class Game {
  /**
   * @param {{players: {name: string, isHuman?: boolean}[], handSize?: number, rng?: () => number, firstPlayer?: number}} opts
   */
  constructor({ players, handSize = 3, rng = Math.random, firstPlayer = 0 }) {
    this.rng = rng;
    this.handSize = handSize;
    this.tiles = makeTiles();
    this.pile = shuffle(this.tiles.slice(), rng);
    this.players = players.map((p, i) => ({
      id: i, name: p.name, isHuman: !!p.isHuman, hand: [], eliminated: false,
    }));
    this.current = firstPlayer;
    this.phase = Phase.SETUP;
    this.drawn = null;           // 이번 차례에 뽑은 타일 (아직 줄에 넣지 않음)
    this.correctThisTurn = 0;
    this.lastGuess = null;
    this.wrongGuesses = [];      // 공개 정보: { by, tileId, value }
    this.log = [];
    this.winner = null;
    this.pendingSetup = [];      // 초기 패에서 자리를 직접 골라야 하는 조커들
  }

  tile(id) { return this.tiles[id]; }
  player(id) { return this.players[id]; }
  get currentPlayer() { return this.players[this.current]; }
  alivePlayers() { return this.players.filter((p) => !p.eliminated); }
  ownerOf(tileId) {
    return this.players.find((p) => p.hand.some((t) => t.id === tileId)) || null;
  }

  // 각자 handSize개씩 나눠줌. 숫자 타일은 자동 정렬, 조커는 pendingSetup으로 남김
  deal() {
    this._assert(this.phase === Phase.SETUP && this.players.every((p) => p.hand.length === 0), 'deal 불가');
    for (const p of this.players) {
      const got = this.pile.splice(0, this.handSize);
      got.forEach((t) => { t.ownerId = p.id; });
      for (const t of got.filter((t) => t.value !== JOKER)) {
        p.hand.splice(validPositions(p.hand, t)[0], 0, t);
      }
      for (const t of got.filter((t) => t.value === JOKER)) {
        this.pendingSetup.push({ playerId: p.id, tileId: t.id });
      }
    }
    this._push({ type: 'deal' });
    if (this.pendingSetup.length === 0) this._startTurn();
  }

  placeSetupTile(playerId, tileId, index) {
    this._assert(this.phase === Phase.SETUP, 'setup 단계가 아님');
    const i = this.pendingSetup.findIndex((p) => p.playerId === playerId && p.tileId === tileId);
    this._assert(i >= 0, '배치 대기 중인 타일이 아님');
    const p = this.player(playerId);
    const t = this.tile(tileId);
    this._assert(validPositions(p.hand, t).includes(index), '놓을 수 없는 위치');
    p.hand.splice(index, 0, t);
    this.pendingSetup.splice(i, 1);
    if (this.pendingSetup.length === 0) this._startTurn();
  }

  draw(tileId) {
    this._assert(this.phase === Phase.DRAW, '뽑기 단계가 아님');
    const i = this.pile.findIndex((t) => t.id === tileId);
    this._assert(i >= 0, '더미에 없는 타일');
    const [t] = this.pile.splice(i, 1);
    t.ownerId = this.current;
    this.drawn = t;
    this.phase = Phase.GUESS;
    this._push({ type: 'draw', by: this.current, color: t.color });
  }

  // 지금 추리할 수 있는 상대 타일들
  guessTargets(byId = this.current) {
    const out = [];
    for (const p of this.players) {
      if (p.id === byId || p.eliminated) continue;
      for (const t of p.hand) if (!t.revealed) out.push({ playerId: p.id, tileId: t.id });
    }
    return out;
  }

  guess(targetPlayerId, tileId, value) {
    this._assert(this.phase === Phase.GUESS, '추리 단계가 아님');
    this._assert(ALL_VALUES.includes(value), '잘못된 값');
    const target = this.player(targetPlayerId);
    this._assert(target && target.id !== this.current && !target.eliminated, '잘못된 대상');
    const t = target.hand.find((x) => x.id === tileId);
    this._assert(t && !t.revealed, '추리할 수 없는 타일');

    const correct = t.value === value;
    const result = { correct, by: this.current, targetPlayerId, tileId, value, eliminated: false, gameOver: false };
    this.lastGuess = result;
    this._push({ type: 'guess', by: this.current, target: targetPlayerId, tileId, color: t.color, value, correct });

    if (correct) {
      t.revealed = true;
      this.correctThisTurn++;
      result.eliminated = this._checkEliminated(target);
      result.gameOver = this._checkGameOver();
      if (!result.gameOver) this.phase = Phase.DECIDE;
    } else {
      this.wrongGuesses.push({ by: this.current, tileId, value });
      if (this.drawn) {
        this.drawn.revealed = true;
        this.phase = Phase.PLACE;
      } else {
        this.phase = Phase.REVEAL_OWN;
      }
    }
    return result;
  }

  continueGuessing() {
    this._assert(this.phase === Phase.DECIDE, '결정 단계가 아님');
    this.phase = Phase.GUESS;
  }

  stop() {
    this._assert(this.phase === Phase.DECIDE, '결정 단계가 아님');
    this._push({ type: 'stop', by: this.current });
    if (this.drawn) this.phase = Phase.PLACE;
    else this._endTurn();
  }

  // 뽑은 타일을 넣을 수 있는 위치 (PLACE 단계)
  drawnPositions() {
    if (!this.drawn) return [];
    return validPositions(this.currentPlayer.hand, this.drawn);
  }

  placeDrawn(index) {
    this._assert(this.phase === Phase.PLACE && this.drawn, '배치 단계가 아님');
    const p = this.currentPlayer;
    this._assert(validPositions(p.hand, this.drawn).includes(index), '놓을 수 없는 위치');
    p.hand.splice(index, 0, this.drawn);
    this.drawn = null;
    this._checkEliminated(p);
    if (!this._checkGameOver()) this._endTurn();
  }

  revealOwn(tileId) {
    this._assert(this.phase === Phase.REVEAL_OWN, '공개 단계가 아님');
    const p = this.currentPlayer;
    const t = p.hand.find((x) => x.id === tileId);
    this._assert(t && !t.revealed, '공개할 수 없는 타일');
    t.revealed = true;
    this._push({ type: 'revealOwn', by: p.id, tileId, color: t.color, value: t.value });
    this._checkEliminated(p);
    if (!this._checkGameOver()) this._endTurn();
  }

  _startTurn() {
    this.drawn = null;
    this.correctThisTurn = 0;
    this.lastGuess = null;
    this.phase = this.pile.length > 0 ? Phase.DRAW : Phase.GUESS;
    this._push({ type: 'turn', by: this.current });
  }

  _endTurn() {
    const n = this.players.length;
    let next = this.current;
    do { next = (next + 1) % n; } while (this.players[next].eliminated);
    this.current = next;
    this._startTurn();
  }

  _checkEliminated(p) {
    if (!p.eliminated && p.hand.length > 0 && p.hand.every((t) => t.revealed)) {
      p.eliminated = true;
      this._push({ type: 'eliminated', by: p.id });
      return true;
    }
    return false;
  }

  _checkGameOver() {
    const alive = this.alivePlayers();
    if (alive.length <= 1) {
      // 들고 있던 뽑은 타일은 숨긴 채 줄에 넣고 종료
      if (this.drawn) {
        const p = this.currentPlayer;
        p.hand.splice(validPositions(p.hand, this.drawn)[0], 0, this.drawn);
        this.drawn = null;
      }
      this.winner = alive[0] ? alive[0].id : null;
      this.phase = Phase.OVER;
      this._push({ type: 'over', winner: this.winner });
      return true;
    }
    return false;
  }

  _push(entry) { this.log.push(entry); }

  _assert(cond, msg) { if (!cond) throw new Error(msg); }
}
