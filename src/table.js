// 한 자리(mySeat)의 화면 진행: 받은 상태를 그리고, 내 차례면 입력을 받아 행동(action)을 보냄
// 혼자 하기와 온라인이 같은 코드를 씀 — 차이는 send()가 어디로 가느냐뿐
import { Phase, validPositions, valueLabel, colorLabel } from './game.js';
import { buildView } from './view.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export class TableController {
  /**
   * @param {object} opts
   * @param {import('./scene.js').TableScene} opts.scene
   * @param {import('./ui.js').Hud} opts.hud
   * @param {number} opts.mySeat
   * @param {(action: object) => (string|null|Promise<string|null>)} opts.send 오류 메시지 또는 null
   * @param {() => void} opts.onGameOver 게임 종료 창의 버튼을 눌렀을 때
   * @param {string} opts.overButton
   * @param {object[]} [opts.characters] 플레이어 번호별 미리 만든 캐릭터 (characters.js)
   * @param {(view: object) => void} [opts.onOver] 게임이 끝났을 때 한 번 (보상 처리 등)
   */
  constructor({ scene, hud, mySeat, send, onGameOver, overButton = '다시 하기', characters = [], onOver = null }) {
    this.characters = characters;
    this.onOver = onOver;
    this.scene = scene;
    this.hud = hud;
    this.mySeat = mySeat;
    this.sendFn = send;
    this.onGameOver = onGameOver;
    this.overButton = overButton;
    this.view = null;
    this.gameId = null;
    this.modeKey = null;
    this.token = 0;
    this.tapWaiter = null;
    this.selected = null;
    this.logSeen = null;
    this.disposed = false;
    this.watchdog = null;
    scene.onTap = (id) => this._onTap(id);
  }

  dispose() {
    this.disposed = true;
    this.token++;
    clearTimeout(this.watchdog);
    this._cancelUI();
    this.hud.setPrompt('');
    this.scene.onTap = null;
  }

  update(pub, priv) {
    if (this.disposed || !pub) return;
    const v = buildView(pub, priv);
    const fresh = v.gameId !== this.gameId;
    this.view = v;
    if (fresh) {
      this.gameId = v.gameId;
      this.scene.setLooks(v.players.map((p) => p.look));
      this.scene.reset(v);
      this.scene.setCharacters(this.characters, this.mySeat);
      this.logSeen = v.logBase + v.log.length;
      this.modeKey = null;
    }
    this._toasts(v);
    this.scene.setSelected(this.selected ?? (v.announce ? v.announce.tileId : null));
    this._updateFocus(v);
    this.scene.sync(v, { humanId: this.mySeat, revealAll: v.phase === Phase.OVER, stagger: fresh ? 0.06 : 0 });
    this.hud.render(v, this.mySeat);
    this._refreshMode();
  }

  // ---------- 알림 ----------
  _name(id) { return id === this.mySeat ? '나' : this.view.player(id).name; }

  // 상대 캐릭터들이 바라볼 곳: 추리 중인 타일 → 차례인 사람
  _updateFocus(v) {
    const tile = this.selected ?? (v.announce ? v.announce.tileId : null);
    if (tile !== null && tile !== undefined) this.scene.setFocus(this.scene.tilePosition(tile));
    else if (v.phase === Phase.DRAW) this.scene.setFocus(null);
    else this.scene.setFocus(this.scene.playerPoint(v.current));
  }

  _look(pid) {
    const p = this.view.players[pid];
    return (p && p.look) || {};
  }

  _toasts(v) {
    const end = v.logBase + v.log.length;
    let msg = null;
    for (let i = Math.max(this.logSeen, v.logBase); i < end; i++) {
      const e = v.log[i - v.logBase];
      // 캐릭터 반응과 이펙트 (모두에게 같은 장면)
      if (e.type === 'guess') {
        this.scene.react(e.by, e.correct ? 'correct' : 'wrong');
        this.scene.react(e.target, e.correct ? 'hit' : 'dodge');
        if (e.correct) this.scene.playEffect(this._look(e.by).effectCorrect, 'effectCorrect', { tileId: e.tileId });
      } else if (e.type === 'eliminated') {
        this.scene.react(e.by, 'lose');
      } else if (e.type === 'over' && e.winner !== null) {
        this.scene.react(e.winner, 'win');
        this.scene.playEffect(this._look(e.winner).effectWin, 'effectWin', { pid: e.winner });
        if (this.onOver) this.onOver(v);
      }
      if (e.type === 'guess') {
        const val = valueLabel(e.value);
        if (e.by === this.mySeat) {
          msg = e.correct ? [`정답! ${val}`, 'good'] : ['틀렸어요…', 'bad'];
        } else if (e.target === this.mySeat) {
          msg = e.correct ? [`${this._name(e.by)}이(가) 내 ${val}을(를) 맞혔어요`, 'bad'] : [`${this._name(e.by)}: "${val}" 틀림`, 'good'];
        } else {
          msg = [`${this._name(e.by)} → ${this._name(e.target)}: "${val}" ${e.correct ? '정답!' : '틀림'}`, e.correct ? 'good' : 'bad'];
        }
      } else if (e.type === 'eliminated') {
        msg = [e.by === this.mySeat ? '탈락했어요…' : `${this._name(e.by)} 탈락!`, 'bad'];
      }
    }
    this.logSeen = end;
    if (msg) this.hud.toast(msg[0], msg[1], 1600);
  }

  // ---------- 입력 모드 ----------
  _mode() {
    const v = this.view;
    const me = this.mySeat;
    if (v.phase === Phase.OVER) return 'over';
    if (v.players[me].kind !== 'human') return 'none';
    if (v.phase === Phase.SETUP) return v.pendingSetup.some((p) => p.playerId === me) ? 'setup' : 'none';
    if (v.current !== me) return 'none';
    switch (v.phase) {
      case Phase.DRAW: return 'draw';
      case Phase.GUESS: return 'guess';
      case Phase.DECIDE: return 'decide';
      case Phase.REVEAL_OWN: return 'revealOwn';
      case Phase.PLACE: return validPositions(v.players[me].hand, v.drawn).length > 1 ? 'place' : 'none';
      default: return 'none';
    }
  }

  _refreshMode() {
    const mode = this._mode();
    if (mode === 'none') this._waitingPrompt();
    const key = `${mode}|${mode === 'over' ? '' : this.view.step}`;
    if (key === this.modeKey) return;
    this.modeKey = key;
    clearTimeout(this.watchdog);
    this._cancelUI();
    const token = ++this.token;
    this._run(mode, token).catch((e) => console.error(e));
  }

  _waitingPrompt() {
    const v = this.view;
    if (v.phase === Phase.SETUP) { this.hud.setPrompt('다른 플레이어가 조커 자리를 고르는 중…'); return; }
    const cur = v.currentPlayer;
    if (v.announce) {
      const t = v.tile(v.announce.tileId);
      this.hud.setPrompt(`${cur.name}: "${this._name(v.announce.playerId)}의 ${colorLabel(t.color)} 타일은 ${valueLabel(v.announce.value)}!"`);
    } else if (v.current === this.mySeat) {
      this.hud.setPrompt(v.players[this.mySeat].kind === 'human' ? '' : 'AI가 내 자리를 대신하는 중…');
    } else if (v.phase === Phase.DECIDE) {
      this.hud.setPrompt(`${cur.name}: 계속할지 고민 중…`);
    } else {
      this.hud.setPrompt(`${cur.name}의 차례${cur.kind === 'ai' ? ' (생각 중…)' : ''}`);
    }
  }

  _cancelUI() {
    this.hud.closeModal();
    this.hud.clearActions();
    this.scene.setInteractive([]);
    this.tapWaiter = null;
    if (this.selected !== null) {
      this.selected = null;
      if (this.view) this.scene.setSelected(this.view.announce ? this.view.announce.tileId : null);
      if (this.view) this.scene.sync(this.view, { humanId: this.mySeat, revealAll: this.view.phase === Phase.OVER });
    }
  }

  _onTap(id) {
    if (this.tapWaiter && this.tapWaiter.ids.has(id)) {
      const w = this.tapWaiter;
      this.tapWaiter = null;
      this.scene.setInteractive([]);
      w.resolve(id);
    }
  }

  _waitTap(ids) {
    this.scene.setInteractive(ids);
    return new Promise((resolve) => { this.tapWaiter = { ids: new Set(ids), resolve }; });
  }

  _select(id) {
    this.selected = id;
    this.scene.setSelected(id);
    this.scene.sync(this.view, { humanId: this.mySeat });
  }

  async _send(action, token) {
    if (token !== this.token) return;
    this.scene.setInteractive([]);
    this.hud.setPrompt('');
    const err = await this.sendFn(action);
    if (token !== this.token) return;
    if (err) {
      this.hud.toast(err, 'bad');
      this.modeKey = null;
      this._refreshMode();
      return;
    }
    // 응답(새 상태)이 오지 않으면 다시 입력을 받음
    this.watchdog = setTimeout(() => {
      if (token === this.token) { this.modeKey = null; this._refreshMode(); }
    }, 6000);
  }

  async _run(mode, token) {
    const v = this.view;
    const me = this.mySeat;
    const alive = () => token === this.token && !this.disposed;
    const hand = () => this.view.players[me].hand;

    switch (mode) {
      case 'draw': {
        this.hud.setPrompt('가운데 더미에서 타일을 하나 탭해서 뽑으세요');
        const tileId = await this._waitTap(v.pile.map((t) => t.id));
        if (alive()) await this._send({ type: 'draw', tileId }, token);
        break;
      }
      case 'guess': {
        if (!v.drawn && v.pile.length === 0) this.hud.toast('더미가 비었어요. 뽑지 않고 추리합니다', '', 1600);
        for (;;) {
          this.hud.setPrompt('추리할 상대 타일을 탭하세요 (화면을 좌우로 끌면 고개를 돌려요)');
          const targets = v.guessTargets(me);
          const tileId = await this._waitTap(targets.map((t) => t.tileId));
          if (!alive()) return;
          const target = targets.find((t) => t.tileId === tileId);
          this._select(tileId);
          this.hud.setPrompt('');
          const tile = v.tile(tileId);
          const value = await this.hud.pickNumber({
            color: tile.color,
            ownerName: this._name(target.playerId),
            tried: v.wrongGuesses.filter((w) => w.tileId === tileId).map((w) => w.value),
          });
          if (!alive()) return;
          if (value === null) { this._select(null); continue; }
          await this._send({ type: 'guess', tileId, value }, token);
          return;
        }
      }
      case 'decide': {
        this.hud.setPrompt('계속 추리할까요?');
        const choice = await this.hud.choose([
          { key: 'continue', label: '계속 추리' },
          { key: 'stop', label: '멈추기', secondary: true },
        ]);
        if (alive() && choice) await this._send({ type: choice }, token);
        break;
      }
      case 'place': {
        await wait(700); // 공개되는 애니메이션을 잠깐 보여줌
        if (!alive()) return;
        const index = await this.hud.pickPlacement({
          hand: hand(), tile: v.drawn, positions: validPositions(hand(), v.drawn), title: '뽑은 타일을 어디에 놓을까요?',
        });
        if (alive() && index !== null) await this._send({ type: 'place', index }, token);
        break;
      }
      case 'revealOwn': {
        await wait(900);
        if (!alive()) return;
        const tileId = await this.hud.pickOwnTile({ hand: hand() });
        if (alive() && tileId !== null) await this._send({ type: 'revealOwn', tileId }, token);
        break;
      }
      case 'setup': {
        this.hud.setPrompt('');
        const { tileId } = v.pendingSetup.find((p) => p.playerId === me);
        const h = hand();
        const index = await this.hud.pickPlacement({
          hand: h, tile: v.tile(tileId), positions: [...Array(h.length + 1).keys()], title: '조커를 어디에 놓을까요?',
        });
        if (alive() && index !== null) await this._send({ type: 'setup', tileId, index }, token);
        break;
      }
      case 'over': {
        this.hud.setPrompt('');
        await wait(1500);
        if (!alive()) return;
        const won = v.winner === me;
        const meOut = v.players[me].eliminated;
        const ok = await this.hud.gameOver({
          title: won ? '🏆 승리했어요!' : '게임 종료',
          message: won ? '마지막까지 살아남았습니다.'
            : `${v.winner === null ? '승자 없음' : `${this._name(v.winner)}의 승리입니다.`}${meOut ? ' (나는 탈락)' : ''}`,
          button: this.overButton,
        });
        if (alive() && ok) this.onGameOver();
        break;
      }
      default:
        break;
    }
  }
}
