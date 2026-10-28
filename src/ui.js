// 화면 위 2D UI: 공개 정보 / 차례 표시, 숫자 선택, 버튼, 토스트
import { ALL_VALUES, JOKER, Phase, valueLabel, colorLabel } from './game.js';

const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const shortValue = (v) => (v === JOKER ? '–' : String(v));

function miniTile(tile, { showValue, mine = false, wrong = [] } = {}) {
  const m = el('div', `mt ${tile.color}`);
  if (tile.revealed) m.classList.add('open');
  else m.classList.add('hidden-tile');
  if (mine) m.classList.add('mine');
  m.append(document.createTextNode(showValue ? shortValue(tile.value) : '?'));
  if (!tile.revealed && wrong.length) m.append(el('span', 'no', `≠${wrong.map(shortValue).join(',')}`));
  return m;
}

export class Hud {
  constructor() {
    this.toastTimer = null;
    $('btn-log').addEventListener('click', () => { $('log').hidden = !$('log').hidden; });
  }

  onViewReset(cb) { $('btn-view').addEventListener('click', cb); }

  render(game, humanId = 0) {
    const cur = game.currentPlayer;
    const turn = $('turn');
    if (game.phase === Phase.OVER) {
      turn.textContent = '게임 종료';
      turn.className = '';
    } else if (game.phase === Phase.SETUP) {
      turn.textContent = '준비 중';
      turn.className = 'ai';
    } else {
      turn.textContent = cur.id === humanId ? '나의 차례' : `${cur.name}의 차례`;
      turn.className = cur.id === humanId ? '' : 'ai';
    }
    $('pile-count').textContent = `더미 ${game.pile.length}개`;

    const wrongBy = new Map();
    for (const w of game.wrongGuesses) {
      if (!wrongBy.has(w.tileId)) wrongBy.set(w.tileId, []);
      const list = wrongBy.get(w.tileId);
      if (!list.includes(w.value)) list.push(w.value);
    }

    const box = $('players');
    box.replaceChildren();
    for (const p of game.players) {
      const mine = p.id === humanId;
      const card = el('div', 'pcard');
      if (p.id === game.current && game.phase !== Phase.OVER) card.classList.add('active');
      if (p.eliminated) card.classList.add('dead');
      const hidden = p.hand.filter((t) => !t.revealed).length;
      const name = el('div', 'pname', p.name);
      name.append(el('span', 'meta', p.eliminated ? '탈락' : `숨김 ${hidden}개`));
      if (game.winner === p.id) name.append(el('span', 'meta', '🏆 승리'));
      const row = el('div', 'row');
      for (const t of p.hand) {
        row.append(miniTile(t, {
          showValue: t.revealed || mine || game.phase === Phase.OVER,
          mine,
          wrong: wrongBy.get(t.id) || [],
        }));
      }
      if (game.drawn && game.current === p.id) {
        const d = miniTile(game.drawn, { showValue: mine || game.drawn.revealed, mine });
        d.classList.add('held');
        d.title = '뽑은 타일';
        row.append(d);
      }
      card.append(name, row);
      box.append(card);
    }

    this._renderLog(game, humanId);
  }

  _renderLog(game, humanId) {
    const name = (id) => (id === humanId ? '나' : game.player(id).name);
    const ol = $('log');
    ol.replaceChildren();
    const entries = game.log.filter((e) => ['guess', 'eliminated', 'revealOwn', 'stop', 'over', 'draw'].includes(e.type));
    for (const e of entries.slice(-40).reverse()) {
      let text = '';
      let cls = '';
      switch (e.type) {
        case 'draw': text = `${name(e.by)}: ${colorLabel(e.color)} 타일을 뽑음`; break;
        case 'guess':
          text = `${name(e.by)} → ${name(e.target)}의 ${colorLabel(e.color)} 타일 "${valueLabel(e.value)}" ${e.correct ? '정답!' : '틀림'}`;
          cls = e.correct ? 'good' : 'bad';
          break;
        case 'stop': text = `${name(e.by)}: 추리를 멈춤`; break;
        case 'revealOwn': text = `${name(e.by)}: 자기 타일 ${colorLabel(e.color)} ${valueLabel(e.value)} 공개`; break;
        case 'eliminated': text = `${name(e.by)} 탈락`; cls = 'bad'; break;
        case 'over': text = `${e.winner === null ? '무승부' : `${name(e.winner)} 승리!`}`; cls = 'good'; break;
        default: break;
      }
      const li = el('li', cls, text);
      ol.append(li);
    }
  }

  setPrompt(text) { $('prompt').textContent = text || ''; }

  toast(text, kind = '', ms = 1300) {
    const t = $('toast');
    t.textContent = text;
    t.className = `show ${kind}`;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { t.className = ''; }, ms);
  }

  /** 아래쪽 큰 버튼들. [{key, label, secondary}] → 누른 key */
  choose(buttons) {
    const box = $('actions');
    return new Promise((resolve) => {
      box.replaceChildren();
      for (const b of buttons) {
        const btn = el('button', `big${b.secondary ? ' secondary' : ''}`, b.label);
        btn.addEventListener('click', () => { box.replaceChildren(); resolve(b.key); }, { once: true });
        box.append(btn);
      }
    });
  }

  _openModal(build) {
    const modal = $('modal');
    const card = $('modal-card');
    return new Promise((resolve) => {
      card.replaceChildren();
      const done = (v) => { modal.hidden = true; card.replaceChildren(); resolve(v); };
      build(card, done);
      modal.hidden = false;
    });
  }

  /** 숫자 선택 (0~11, 조커). 취소하면 null */
  pickNumber({ color, ownerName, tried = [] }) {
    return this._openModal((card, done) => {
      card.append(el('h2', '', `${ownerName}의 ${colorLabel(color)} 타일`));
      card.append(el('p', '', '숫자를 골라 추리하세요.'));
      const grid = el('div', 'num-grid');
      for (const v of ALL_VALUES) {
        const b = el('button', `num ${color}${v === JOKER ? ' joker' : ''}`, v === JOKER ? '조커 –' : String(v));
        if (tried.includes(v)) b.classList.add('tried');
        b.addEventListener('click', () => done(v));
        grid.append(b);
      }
      card.append(grid);
      const foot = el('div', 'modal-foot');
      const cancel = el('button', 'big secondary', '다른 타일 고르기');
      cancel.addEventListener('click', () => done(null));
      foot.append(cancel);
      card.append(foot);
    });
  }

  /** 타일을 넣을 자리 고르기 → 인덱스 */
  pickPlacement({ hand, tile, positions, title }) {
    return this._openModal((card, done) => {
      card.append(el('h2', '', title || '어디에 놓을까요?'));
      const p = el('p', '', `넣을 타일: ${colorLabel(tile.color)} ${valueLabel(tile.value)} — 노란 칸을 누르세요.`);
      card.append(p);
      const row = el('div', 'place-row');
      for (let i = 0; i <= hand.length; i++) {
        if (positions.includes(i)) {
          const g = el('button', 'gap-btn', '＋');
          g.addEventListener('click', () => done(i));
          row.append(g);
        }
        if (i < hand.length) row.append(miniTile(hand[i], { showValue: true, mine: true }));
      }
      card.append(row);
    });
  }

  /** 내 숨긴 타일 중 하나 공개 → tileId */
  pickOwnTile({ hand }) {
    return this._openModal((card, done) => {
      card.append(el('h2', '', '틀렸어요! 더미가 비어 있어요'));
      card.append(el('p', '', '내 숨긴 타일 중 하나를 골라 공개해야 합니다.'));
      const row = el('div', 'place-row');
      for (const t of hand) {
        if (t.revealed) { row.append(miniTile(t, { showValue: true })); continue; }
        const b = el('button', `own-btn ${t.color}`, shortValue(t.value));
        b.addEventListener('click', () => done(t.id));
        row.append(b);
      }
      card.append(row);
    });
  }

  gameOver({ title, message }) {
    return this._openModal((card, done) => {
      card.append(el('h2', '', title));
      card.append(el('p', '', message));
      const foot = el('div', 'modal-foot');
      const again = el('button', 'big', '다시 하기');
      again.addEventListener('click', () => done());
      foot.append(again);
      card.append(foot);
    });
  }
}
