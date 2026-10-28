// 게임 진행 엔진: Game을 가진 쪽(혼자 하기에서는 내 브라우저, 온라인에서는 방장 브라우저)에서만 동작
// - 플레이어 행동(action)을 검증해서 적용
// - AI 자리(처음부터 AI이거나 나간 사람 자리)를 대신 진행
// - 공개 상태 / 자리별 비공개 상태(자기 타일 숫자) / 복원용 전체 상태를 만들어 내보냄
import { Game, Phase } from './game.js';
import * as ai from './ai.js';

export const DEFAULT_DELAYS = {
  setup: 500,     // AI 조커 배치
  think: 900,     // AI 뽑기 / 추리 대상 고르기
  announce: 1400, // AI가 추리를 말한 뒤 결과까지
  decide: 1100,   // AI 계속/멈춤 결정
  place: 1300,    // 뽑은 타일을 줄에 넣기 (자리가 하나뿐이면 사람도 자동)
};

const LOG_KEEP = 60;

function publicTile(t, showValue) {
  const o = { id: t.id, color: t.color, revealed: t.revealed };
  if (showValue || t.revealed) o.value = t.value;
  return o;
}

export class HostEngine {
  /**
   * @param {object} opts
   * @param {Game} opts.game
   * @param {{name: string, kind: 'human'|'ai', offline?: boolean}[]} opts.seats
   * @param {(out: {public: object, privates: object[], secret: object}) => void} opts.onPublish
   */
  constructor({ game, seats, onPublish, delays = DEFAULT_DELAYS, rng = Math.random, step = 0, gameId }) {
    this.game = game;
    this.seats = seats.map((s) => ({ name: s.name, kind: s.kind, offline: !!s.offline }));
    this.onPublish = onPublish;
    this.delays = delays;
    this.rng = rng;
    this.step = step;
    this.gameId = gameId || Math.random().toString(36).slice(2, 10);
    this.announce = null;
    this.timer = null;
    this.disposed = false;
  }

  static newGame({ seats, firstPlayer = 0, ...opts }) {
    const rng = opts.rng || Math.random;
    const game = new Game({ players: seats.map((s) => ({ name: s.name, isHuman: s.kind === 'human' })), rng, firstPlayer });
    return new HostEngine({ game, seats, ...opts });
  }

  /** 방장이 바뀔 때 secret 상태로부터 이어서 진행 */
  static restore(secret, opts) {
    return new HostEngine({
      game: Game.fromJSON(secret.game, opts.rng),
      seats: secret.seats,
      step: secret.step,
      gameId: secret.gameId,
      ...opts,
    });
  }

  start() {
    if (this.game.phase === Phase.SETUP && this.game.players.every((p) => p.hand.length === 0)) {
      this.game.deal();
      this.step++;
    }
    this._publish();
    this._schedule();
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.timer = null;
  }

  /** 자리를 사람 ↔ AI로 바꿈 (나간 사람 자리 대신하기 / 다시 들어오기) */
  setSeat(seat, { kind, offline }) {
    const s = this.seats[seat];
    if (s.kind === kind && s.offline === offline) return;
    s.kind = kind;
    s.offline = offline;
    this.game.players[seat].isHuman = kind === 'human';
    if (this.announce && this.announce.by === seat) this.announce = null;
    this._publish();
    this._schedule();
  }

  /** 사람 플레이어의 행동. 문제가 있으면 오류 메시지, 성공하면 null */
  submit(seat, action) {
    const g = this.game;
    if (this.disposed) return '게임이 끝났습니다';
    if (!this.seats[seat] || this.seats[seat].kind !== 'human') return '지금은 AI가 맡은 자리입니다';
    try {
      if (action.type === 'setup') {
        g.placeSetupTile(seat, action.tileId, action.index);
      } else {
        if (g.current !== seat) throw new Error('내 차례가 아닙니다');
        switch (action.type) {
          case 'draw': g.draw(action.tileId); break;
          case 'guess': {
            const owner = g.ownerOf(action.tileId);
            if (!owner) throw new Error('잘못된 타일');
            g.guess(owner.id, action.tileId, action.value);
            break;
          }
          case 'continue': g.continueGuessing(); break;
          case 'stop': g.stop(); break;
          case 'place': g.placeDrawn(action.index); break;
          case 'revealOwn': g.revealOwn(action.tileId); break;
          default: throw new Error('알 수 없는 행동');
        }
      }
    } catch (e) {
      return e.message;
    }
    this.step++;
    this._publish();
    this._schedule();
    return null;
  }

  // ---------- 상태 내보내기 ----------
  publicState() {
    const g = this.game;
    const over = g.phase === Phase.OVER;
    const logBase = Math.max(0, g.log.length - LOG_KEEP);
    return {
      gameId: this.gameId,
      step: this.step,
      phase: g.phase,
      current: g.current,
      winner: g.winner,
      players: g.players.map((p, i) => ({
        name: this.seats[i].name,
        kind: this.seats[i].kind,
        offline: this.seats[i].offline,
        eliminated: p.eliminated,
        hand: p.hand.map((t) => publicTile(t, over)),
      })),
      pile: g.pile.map((t) => ({ id: t.id, color: t.color })),
      drawn: g.drawn ? publicTile(g.drawn, over) : null,
      pending: g.pendingSetup.map((x) => ({ ...x, color: g.tile(x.tileId).color })),
      wrong: g.wrongGuesses,
      log: g.log.slice(logBase),
      logBase,
      announce: this.announce,
    };
  }

  /** seat 플레이어만 알 수 있는 값: 자기 줄 / 뽑은 타일 / 배치 대기 타일의 숫자 */
  privateState(seat) {
    const g = this.game;
    const values = {};
    const add = (t) => { values[t.id] = t.value; };
    g.players[seat].hand.forEach(add);
    if (g.drawn && g.current === seat) add(g.drawn);
    for (const x of g.pendingSetup) if (x.playerId === seat) add(g.tile(x.tileId));
    return { seat, values, step: this.step, gameId: this.gameId };
  }

  secretState() {
    return { game: this.game.toJSON(), seats: this.seats, step: this.step, gameId: this.gameId };
  }

  _publish() {
    if (this.disposed) return;
    this.onPublish({
      public: this.publicState(),
      privates: this.seats.map((_, i) => this.privateState(i)),
      secret: this.secretState(),
    });
  }

  // ---------- AI / 자동 진행 ----------
  _later(ms, fn) {
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.disposed) return;
      let changed = true;
      try {
        changed = fn() !== false;
      } catch (e) {
        console.error(e);
      }
      if (changed) this.step++;
      this._publish();
      this._schedule();
    }, ms);
  }

  _schedule() {
    clearTimeout(this.timer);
    this.timer = null;
    const g = this.game;
    const d = this.delays;
    const rng = this.rng;
    if (this.disposed || g.phase === Phase.OVER) return;

    if (g.phase === Phase.SETUP) {
      const p = g.pendingSetup.find((x) => this.seats[x.playerId].kind === 'ai');
      if (p) {
        this._later(d.setup, () => g.placeSetupTile(p.playerId, p.tileId,
          ai.choosePlacement(g.player(p.playerId).hand, g.tile(p.tileId), rng)));
      }
      return;
    }

    const seat = g.current;
    const isAI = this.seats[seat].kind === 'ai';
    if (g.phase === Phase.PLACE) {
      const positions = g.drawnPositions();
      if (isAI) this._later(d.place, () => g.placeDrawn(ai.choosePlacement(g.currentPlayer.hand, g.drawn, rng)));
      else if (positions.length === 1) this._later(d.place, () => g.placeDrawn(positions[0]));
      return;
    }
    if (!isAI) return;

    switch (g.phase) {
      case Phase.DRAW:
        this._later(d.think, () => g.draw(ai.chooseDraw(g, rng)));
        break;
      case Phase.GUESS:
        if (!this.announce) {
          // 먼저 어떤 타일을 몇으로 추리하는지 보여주고, 잠시 뒤 결과 적용
          this._later(d.think, () => {
            const c = ai.chooseGuess(g, seat, rng);
            this.announce = { by: seat, playerId: c.playerId, tileId: c.tileId, value: c.value };
            return false;
          });
        } else {
          this._later(d.announce, () => {
            const a = this.announce;
            this.announce = null;
            g.guess(a.playerId, a.tileId, a.value);
          });
        }
        break;
      case Phase.DECIDE:
        this._later(d.decide, () => (ai.shouldContinue(g, seat, rng) ? g.continueGuessing() : g.stop()));
        break;
      case Phase.REVEAL_OWN:
        this._later(d.think, () => g.revealOwn(ai.chooseRevealOwn(g, seat, rng)));
        break;
      default:
        break;
    }
  }
}
