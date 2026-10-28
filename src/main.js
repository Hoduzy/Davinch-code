// 게임 진행: 로직(game.js) ↔ 3D 화면(scene.js) ↔ UI(ui.js) 연결
import { Game, Phase, valueLabel, colorLabel } from './game.js';
import * as ai from './ai.js';
import { TableScene } from './scene.js';
import { Hud } from './ui.js';

const HUMAN = 0;
const PLAYERS = [
  { name: '나', isHuman: true },
  { name: '빨강 AI' },
  { name: '파랑 AI' },
  { name: '초록 AI' },
];

const scene = new TableScene(document.getElementById('view'));
const hud = new Hud();
hud.onViewReset(() => scene.resetView());

let game = null;
let tapWaiter = null;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

scene.onTap = (tileId) => {
  if (tapWaiter && tapWaiter.ids.has(tileId)) {
    const w = tapWaiter;
    tapWaiter = null;
    scene.setInteractive([]);
    w.resolve(tileId);
  }
};

function waitTap(ids) {
  scene.setInteractive(ids);
  return new Promise((resolve) => { tapWaiter = { ids: new Set(ids), resolve }; });
}

function refresh(opts = {}) {
  scene.sync(game, { humanId: HUMAN, revealAll: game.phase === Phase.OVER, ...opts });
  hud.render(game, HUMAN);
}

const nameOf = (pid) => (pid === HUMAN ? '나' : game.player(pid).name);

function triedValues(tileId) {
  return game.wrongGuesses.filter((w) => w.tileId === tileId).map((w) => w.value);
}

// ---------- 내 차례 ----------
async function humanTurn() {
  if (game.phase === Phase.DRAW) {
    hud.setPrompt('가운데 더미에서 타일을 하나 탭해서 뽑으세요');
    const id = await waitTap(game.pile.map((t) => t.id));
    game.draw(id);
    hud.setPrompt('');
    refresh();
    await wait(700);
  } else {
    hud.toast('더미가 비었어요. 뽑지 않고 추리합니다', '', 1600);
  }

  for (;;) {
    // 추리할 타일 고르기
    hud.setPrompt('추리할 상대 타일을 탭하세요 (화면을 좌우로 끌면 고개를 돌려요)');
    const targets = game.guessTargets(HUMAN);
    const tileId = await waitTap(targets.map((t) => t.tileId));
    const target = targets.find((t) => t.tileId === tileId);
    scene.setSelected(tileId);
    refresh();
    hud.setPrompt('');
    const tile = game.tile(tileId);
    const value = await hud.pickNumber({
      color: tile.color, ownerName: nameOf(target.playerId), tried: triedValues(tileId),
    });
    if (value === null) {
      scene.setSelected(null);
      refresh();
      continue;
    }

    const res = game.guess(target.playerId, tileId, value);
    scene.setSelected(null);
    refresh();
    if (res.correct) {
      hud.toast(`정답! ${valueLabel(value)}`, 'good');
      await wait(1100);
      if (res.eliminated) { hud.toast(`${nameOf(target.playerId)} 탈락!`, 'bad'); await wait(1200); }
      if (game.phase === Phase.OVER) return;
      hud.setPrompt('계속 추리할까요?');
      const choice = await hud.choose([
        { key: 'go', label: '계속 추리' },
        { key: 'stop', label: '멈추기', secondary: true },
      ]);
      hud.setPrompt('');
      if (choice === 'go') { game.continueGuessing(); continue; }
      game.stop();
    } else {
      hud.toast(game.drawn ? '틀렸어요… 뽑은 타일을 공개합니다' : '틀렸어요…', 'bad', 1500);
      await wait(1300);
    }
    break;
  }

  if (game.phase === Phase.PLACE) {
    const positions = game.drawnPositions();
    let index = positions[0];
    if (positions.length > 1) {
      index = await hud.pickPlacement({
        hand: game.currentPlayer.hand, tile: game.drawn, positions, title: '뽑은 타일을 어디에 놓을까요?',
      });
    }
    game.placeDrawn(index);
    refresh();
    await wait(900);
  } else if (game.phase === Phase.REVEAL_OWN) {
    const id = await hud.pickOwnTile({ hand: game.currentPlayer.hand });
    game.revealOwn(id);
    refresh();
    await wait(1000);
  } else {
    refresh();
  }
}

// ---------- AI 차례 ----------
async function aiTurn() {
  const pid = game.current;
  const me = game.player(pid);
  hud.setPrompt(`${me.name}이(가) 생각 중…`);
  await wait(800);

  if (game.phase === Phase.DRAW) {
    game.draw(ai.chooseDraw(game));
    refresh();
    await wait(900);
  }

  for (;;) {
    const g = ai.chooseGuess(game, pid);
    scene.setSelected(g.tileId);
    refresh();
    const t = game.tile(g.tileId);
    hud.setPrompt(`${me.name}: "${nameOf(g.playerId)}의 ${colorLabel(t.color)} 타일은 ${valueLabel(g.value)}!"`);
    await wait(1400);
    const res = game.guess(g.playerId, g.tileId, g.value);
    scene.setSelected(null);
    refresh();
    if (res.correct) {
      hud.toast(`${me.name} 정답! (${valueLabel(g.value)})`, 'good');
      await wait(1200);
      if (res.eliminated) { hud.toast(`${nameOf(g.playerId)} 탈락!`, 'bad'); await wait(1300); }
      if (game.phase === Phase.OVER) return;
      if (ai.shouldContinue(game, pid)) {
        game.continueGuessing();
        hud.setPrompt(`${me.name}: 계속 추리합니다`);
        await wait(700);
        continue;
      }
      game.stop();
      hud.setPrompt(`${me.name}: 여기서 멈춥니다`);
    } else {
      hud.toast(`${me.name} 틀림`, 'bad');
      await wait(1100);
    }
    break;
  }

  if (game.phase === Phase.PLACE) {
    game.placeDrawn(ai.choosePlacement(me.hand, game.drawn));
  } else if (game.phase === Phase.REVEAL_OWN) {
    game.revealOwn(ai.chooseRevealOwn(game, pid));
  }
  refresh();
  await wait(1000);
  hud.setPrompt('');
}

// ---------- 게임 전체 ----------
async function runGame() {
  game = new Game({ players: PLAYERS, firstPlayer: HUMAN });
  scene.reset(game);
  hud.render(game, HUMAN);
  hud.setPrompt('타일을 나눠주는 중…');
  await wait(500);

  game.deal();
  refresh({ stagger: 0.08 });
  await wait(1800);

  // 초기 패에 조커가 있으면 자리 정하기
  while (game.pendingSetup.length > 0) {
    const { playerId, tileId } = game.pendingSetup[0];
    const p = game.player(playerId);
    const tile = game.tile(tileId);
    let index;
    if (playerId === HUMAN) {
      hud.setPrompt('');
      index = await hud.pickPlacement({
        hand: p.hand, tile, positions: [...Array(p.hand.length + 1).keys()], title: '조커를 어디에 놓을까요?',
      });
    } else {
      index = ai.choosePlacement(p.hand, tile);
    }
    game.placeSetupTile(playerId, tileId, index);
    refresh();
    await wait(500);
  }
  hud.setPrompt('');

  while (game.phase !== Phase.OVER) {
    if (game.current === HUMAN) await humanTurn();
    else await aiTurn();
  }

  scene.setInteractive([]);
  refresh();
  hud.setPrompt('');
  const won = game.winner === HUMAN;
  await wait(1200);
  await hud.gameOver({
    title: won ? '🏆 승리했어요!' : '게임 종료',
    message: won ? '마지막까지 살아남았습니다.' : `${nameOf(game.winner)}의 승리입니다.${game.player(HUMAN).eliminated ? ' (나는 탈락)' : ''}`,
  });
  runGame();
}

runGame();
