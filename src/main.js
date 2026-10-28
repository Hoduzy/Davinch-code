// 시작 화면(혼자 하기 / 온라인 방 / 상점 / 설정) ↔ 대기실 ↔ 게임 화면 연결
import { HostEngine } from './engine.js';
import { TableScene } from './scene.js';
import { Hud } from './ui.js';
import { TableController } from './table.js';
import { OnlineRoom, normalizeCode, SEAT_COUNT } from './online.js';
import { firebaseConfig } from '../firebase-config.js';
import { loadCharacters } from './loading.js';
import { randomAiLook, normalizeLook, ECONOMY } from './catalog.js';
import { Economy } from './economy.js';
import { ShopUI, formatCoins } from './shop-ui.js';
import { SettingsUI } from './settings-ui.js';

const $ = (id) => document.getElementById(id);
const scene = new TableScene($('view'));
const hud = new Hud();
hud.onViewReset(() => scene.resetView());
const toast = (text, kind = '', ms = 2200) => hud.toast(text, kind, ms);

// ?emulator 를 붙여 열면 로컬 Firebase 에뮬레이터에 연결 (개발용, README 참고)
const params = new URLSearchParams(location.search);
const emulator = params.has('emulator')
  ? { dbHost: location.hostname, dbPort: 9000, authUrl: `http://${location.hostname}:9099` }
  : null;
const config = emulator
  ? { apiKey: 'demo-key', projectId: 'demo-davinci', databaseURL: `http://${location.hostname}:9000?ns=demo-davinci` }
  : firebaseConfig;
const onlineReady = Boolean(config.apiKey && config.databaseURL);

function setRoomInUrl(code) {
  const p = new URLSearchParams(location.search);
  if (code) p.set('room', code); else p.delete('room');
  const q = p.toString().replace(/=(&|$)/g, '$1'); // ?emulator= → ?emulator
  history.replaceState(null, '', `${location.pathname}${q ? `?${q}` : ''}`);
}

let current = null; // { controller, engine?, room? }
let dbPromise = null;
/** @type {Economy|null} */
let economy = null;
// 고른 베팅액 (코인이 모자라면 '없음'으로 보이지만, 고른 값은 기억해 둠)
let preferredBet = ECONOMY.betOptions.find((b) => b > 0) ?? 0;

const shop = new ShopUI({ getEconomy: () => economy, toast, onClose: () => shop.close() });
const settings = new SettingsUI({ getEconomy: () => economy, toast, onClose: () => settings.close() });

function show(screen) {
  $('menu').hidden = screen !== 'menu';
  $('lobby').hidden = screen !== 'lobby';
  document.body.classList.toggle('in-game', screen === 'game');
}

function setMenuMessage(text, isError = false) {
  const m = $('menu-msg');
  m.textContent = text || '';
  m.classList.toggle('error', isError);
}

function playerName() {
  const n = $('name').value.trim().slice(0, 12) || '플레이어';
  try { localStorage.setItem('davinci-name', n); } catch { /* 저장 불가 무시 */ }
  if (economy && economy.ready) economy.setName(n).catch(() => {});
  return n;
}

// ---------- 코인 표시 / 베팅 선택 ----------
function canAfford(bet) {
  return bet === 0 || Boolean(economy && economy.ready && economy.coins >= bet);
}

function selectedBet() {
  return canAfford(preferredBet) ? preferredBet : 0;
}

function renderWallet() {
  const badge = $('coin-badge');
  badge.hidden = !(economy && economy.ready);
  if (economy && economy.ready) badge.textContent = formatCoins(economy.coins);
  const box = $('bet-options');
  box.replaceChildren();
  for (const bet of ECONOMY.betOptions) {
    const b = document.createElement('button');
    b.textContent = bet === 0 ? '없음' : bet.toLocaleString('ko-KR');
    b.disabled = !canAfford(bet);
    if (bet === selectedBet()) b.classList.add('on');
    b.addEventListener('click', () => { preferredBet = bet; renderWallet(); });
    box.append(b);
  }
  shop.render();
}

async function rewards({ reconcile = true } = {}) {
  if (!economy || !economy.ready) return;
  try {
    if (reconcile) {
      const r = await economy.reconcile(current && current.room ? current.room.code : null);
      if (r.payout) toast(`1등 상금 +${r.payout}`, 'good');
      if (r.refund) toast(`베팅 환불 +${r.refund}`, 'good');
    }
    const daily = await economy.claimDaily();
    if (daily) toast(`출석 보상 +${daily} ${ECONOMY.currencyName}`, 'good');
    if (economy.canBailout()) {
      const b = await economy.claimBailout();
      if (b) toast(`구제금 +${b} ${ECONOMY.currencyName} (오늘 1번)`, 'good');
    }
  } catch (e) {
    console.warn('보상 처리 실패', e);
  }
}

/** 시작할 때: 익명 계정 연결 → 지갑 만들기 → 출석/구제금/베팅 정리 */
async function initAccount() {
  if (!onlineReady) return;
  try {
    const db = await getDb();
    economy = new Economy(db);
    await economy.start();
    economy.onChange(() => { renderWallet(); bootstrapWallet(); });
    if (economy.name) $('name').value = economy.name;
    if (!economy.configured) setMenuMessage('관리자가 아직 상점·재화 설정을 서버에 올리지 않았어요. (설정 → 관리자)');
    await bootstrapWallet();
  } catch (e) {
    console.warn('계정 연결 실패', e);
  } finally {
    renderWallet();
  }
}

// 설정이 서버에 있으면 지갑 만들기 + 출석/구제금/베팅 정리 (관리자가 나중에 설정을 올려도 동작)
let bootstrapping = false;
async function bootstrapWallet() {
  if (!economy || !economy.configured || economy.wallet || bootstrapping) return;
  bootstrapping = true;
  try {
    setMenuMessage('');
    const created = await economy.ensureWallet();
    if (created) toast(`가입 선물 +${created} ${ECONOMY.currencyName}!`, 'good', 2600);
    if (!economy.name) economy.setName(playerName()).catch(() => {});
    await rewards();
  } catch (e) {
    console.warn('지갑 준비 실패', e);
  } finally {
    bootstrapping = false;
  }
}

async function teardown() {
  if (!current) return;
  const c = current;
  current = null;
  c.controller?.dispose();
  c.engine?.dispose();
  if (c.room) await c.room.leave();
  hud.closeModal();
  hud.clearActions();
}

async function backToMenu(message, isError) {
  await teardown();
  setRoomInUrl(null);
  show('menu');
  setMenuMessage(message, isError);
  rewards();
}

// ---------- 혼자 하기 ----------
async function startSolo() {
  if (current) return;
  const name = playerName();
  const myLook = economy && economy.ready ? economy.look() : normalizeLook(null);
  const seats = [
    { name, kind: 'human', look: myLook },
    { name: '빨강 AI', kind: 'ai', look: randomAiLook() },
    { name: '파랑 AI', kind: 'ai', look: randomAiLook() },
    { name: '초록 AI', kind: 'ai', look: randomAiLook() },
  ];
  current = { loading: true };
  const characters = await loadCharacters(seats.map((s) => s.look), 0);
  let engine = null;
  const controller = new TableController({
    characters,
    scene,
    hud,
    mySeat: 0,
    send: (action) => engine.submit(0, action),
    onGameOver: () => { backToMenu(''); },
    overButton: '처음 화면으로',
    onOver: (v) => {
      if (v.winner !== 0 || !economy || !economy.ready) return;
      // AI 대전 승리 보상 (하루 상한)
      economy.claimAiWin().then((r) => {
        setTimeout(() => toast(r.ok ? `승리 보상 +${r.reward} ${ECONOMY.currencyName} (오늘 ${r.left}번 남음)` : r.reason, r.ok ? 'good' : ''), 1800);
      }).catch((e) => console.warn(e));
    },
  });
  engine = HostEngine.newGame({
    seats,
    onPublish: (out) => controller.update(out.public, out.privates[0]),
  });
  current = { controller, engine };
  show('game');
  engine.start();
}

// ---------- 온라인 ----------
async function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const { loadFirebaseSdk, connectFirebase } = await import('./net/firebase.js');
      const sdk = await loadFirebaseSdk();
      return connectFirebase(config, sdk, { emulator });
    })();
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

function renderLobby(info) {
  $('lobby-code').textContent = info.code;
  $('lobby-bet').textContent = info.bet > 0
    ? `베팅 ${info.bet.toLocaleString('ko-KR')} ${ECONOMY.currencyName} · 1등은 ${(info.bet * 2).toLocaleString('ko-KR')} ${ECONOMY.currencyName}`
    : '베팅 없는 방';
  const list = $('lobby-seats');
  list.replaceChildren();
  const filled = info.seats.filter(Boolean).length;
  info.seats.forEach((s, i) => {
    const li = document.createElement('li');
    if (!s) {
      li.textContent = '기다리는 중…';
      li.className = 'empty';
    } else {
      li.textContent = s.name + (i === info.mySeat ? ' (나)' : '')
        + (s.ai ? '' : s.online ? '' : ' · 연결 끊김')
        + (info.bet > 0 && !s.ai ? (s.staked ? ' · 베팅 완료' : ' · 베팅 중…') : '');
    }
    list.append(li);
  });
  $('lobby-status').textContent = info.status === 'playing'
    ? '게임을 시작하는 중… (캐릭터 불러오는 중)'
    : `${filled}/${SEAT_COUNT}명 — 4명이 모이면 자동으로 시작합니다.`;
  $('btn-fill-ai').hidden = !info.isHost || info.status !== 'lobby';
}

function roomOptions(name) {
  const state = { characters: [] };
  return {
    state,
    opts: {
      name,
      economy: economy && economy.ready ? economy : null,
      onPrepare: async (looks, seat) => { state.characters = await loadCharacters(looks, seat); },
      onResult: (r) => {
        if (!economy || r.winner !== economy.uid || !current || !current.room) return;
        economy.claimPayout(current.room.code)
          .then((n) => { if (n) setTimeout(() => toast(`1등 상금 +${n} ${ECONOMY.currencyName}!`, 'good', 3000), 1800); })
          .catch((e) => console.warn('상금 받기 실패 (다음 접속 때 다시 시도)', e));
      },
    },
  };
}

function enterRoom(room, state) {
  let controller = null;
  current = { room, controller: null };
  room.onLobby = (info) => {
    if (current?.room !== room) return;
    show('lobby');
    renderLobby(info);
  };
  room.onGame = (pub, priv) => {
    if (current?.room !== room) return;
    if (!controller) {
      controller = new TableController({
        characters: state.characters,
        scene,
        hud,
        mySeat: room.seat,
        send: (action) => room.send(action),
        onGameOver: () => backToMenu(''),
        overButton: '나가기',
      });
      current.controller = controller;
      show('game');
    }
    controller.update(pub, priv);
  };
  room.onError = (e) => {
    console.error(e);
    toast(`연결 오류: ${e.message || e}`, 'bad', 3000);
  };
  setRoomInUrl(room.code);
  room.notify();
}

async function online(action) {
  if (!onlineReady || current) return;
  const name = playerName();
  const buttons = [$('btn-create'), $('btn-join')];
  buttons.forEach((b) => { b.disabled = true; });
  setMenuMessage('서버에 연결하는 중…');
  try {
    const db = await getDb();
    const { state, opts } = roomOptions(name);
    const room = action === 'create'
      ? await OnlineRoom.create(db, { ...opts, bet: selectedBet() })
      : await OnlineRoom.join(db, $('code').value, opts);
    setMenuMessage('');
    enterRoom(room, state);
  } catch (e) {
    console.error(e);
    setMenuMessage(e.message || String(e), true);
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
  }
}

// ---------- 시작 화면 ----------
try { $('name').value = localStorage.getItem('davinci-name') || ''; } catch { /* 무시 */ }
const roomParam = normalizeCode(params.get('room'));
if (roomParam) $('code').value = roomParam;

$('btn-solo').addEventListener('click', startSolo);
$('btn-create').addEventListener('click', () => online('create'));
$('btn-join').addEventListener('click', () => online('join'));
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') online('join'); });
$('name').addEventListener('change', () => playerName());
$('btn-shop').addEventListener('click', () => shop.open());
$('btn-settings').addEventListener('click', () => settings.open());
$('btn-leave').addEventListener('click', () => backToMenu(''));
$('btn-fill-ai').addEventListener('click', async () => {
  const reason = await current?.room?.startGame();
  if (reason) toast(reason, 'bad');
});
$('btn-copy').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}?room=${$('lobby-code').textContent}`;
  try {
    if (navigator.share) await navigator.share({ title: '다빈치 코드 3D', url });
    else { await navigator.clipboard.writeText(url); toast('링크를 복사했어요'); }
  } catch { /* 공유 취소 */ }
});
$('btn-quit').addEventListener('click', () => {
  if (confirm(current?.room ? '방에서 나갈까요? 내 자리는 AI가 이어서 합니다.' : '처음 화면으로 갈까요?')) backToMenu('');
});

if (!onlineReady) {
  $('online-box').classList.add('disabled');
  $('online-note').textContent = '온라인을 하려면 firebase-config.js에 Firebase 설정을 넣어 주세요.';
}
renderWallet();
show('menu');
initAccount();

// 에뮬레이터 모드에서만: 자동 테스트가 화면 상태를 읽을 수 있게 함
if (emulator) window.__davinci = { scene, get room() { return current?.room || null; }, get economy() { return economy; } };
