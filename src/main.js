// 시작 화면(혼자 하기 / 온라인 방) ↔ 대기실 ↔ 게임 화면 연결
import { HostEngine } from './engine.js';
import { TableScene } from './scene.js';
import { Hud } from './ui.js';
import { TableController } from './table.js';
import { OnlineRoom, normalizeCode, SEAT_COUNT } from './online.js';
import { firebaseConfig } from '../firebase-config.js';

const $ = (id) => document.getElementById(id);
const scene = new TableScene($('view'));
const hud = new Hud();
hud.onViewReset(() => scene.resetView());

// ?emulator 를 붙여 열면 로컬 Firebase 에뮬레이터에 연결 (개발용, README 참고)
const params = new URLSearchParams(location.search);
const emulator = params.has('emulator')
  ? { dbHost: location.hostname, dbPort: 9000, authUrl: `http://${location.hostname}:9099` }
  : null;
const config = emulator && !firebaseConfig.apiKey
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
  return n;
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
}

// ---------- 혼자 하기 ----------
function startSolo() {
  const name = playerName();
  const seats = [
    { name, kind: 'human' },
    { name: '빨강 AI', kind: 'ai' },
    { name: '파랑 AI', kind: 'ai' },
    { name: '초록 AI', kind: 'ai' },
  ];
  let engine = null;
  const controller = new TableController({
    scene,
    hud,
    mySeat: 0,
    send: (action) => engine.submit(0, action),
    onGameOver: () => { teardown().then(startSolo); },
    overButton: '다시 하기',
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
  const list = $('lobby-seats');
  list.replaceChildren();
  const filled = info.seats.filter(Boolean).length;
  info.seats.forEach((s, i) => {
    const li = document.createElement('li');
    if (!s) {
      li.textContent = '기다리는 중…';
      li.className = 'empty';
    } else {
      li.textContent = s.name + (i === info.mySeat ? ' (나)' : '') + (s.ai ? '' : s.online ? '' : ' · 연결 끊김');
    }
    list.append(li);
  });
  $('lobby-status').textContent = info.status === 'playing'
    ? '게임을 시작하는 중…'
    : `${filled}/${SEAT_COUNT}명 — 4명이 모이면 자동으로 시작합니다.`;
  $('btn-fill-ai').hidden = !info.isHost || info.status !== 'lobby';
}

function enterRoom(room) {
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
    hud.toast(`연결 오류: ${e.message || e}`, 'bad', 3000);
  };
  setRoomInUrl(room.code);
  room.notify();
}

async function online(action) {
  if (!onlineReady) return;
  const name = playerName();
  const buttons = [$('btn-create'), $('btn-join')];
  buttons.forEach((b) => { b.disabled = true; });
  setMenuMessage('서버에 연결하는 중…');
  try {
    const db = await getDb();
    const opts = { name };
    const room = action === 'create'
      ? await OnlineRoom.create(db, opts)
      : await OnlineRoom.join(db, $('code').value, opts);
    setMenuMessage('');
    enterRoom(room);
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
$('btn-leave').addEventListener('click', () => backToMenu(''));
$('btn-fill-ai').addEventListener('click', () => current?.room?.startGame());
$('btn-copy').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}?room=${$('lobby-code').textContent}`;
  try {
    if (navigator.share) await navigator.share({ title: '다빈치 코드 3D', url });
    else { await navigator.clipboard.writeText(url); hud.toast('링크를 복사했어요'); }
  } catch { /* 공유 취소 */ }
});
$('btn-quit').addEventListener('click', () => {
  if (confirm(current?.room ? '방에서 나갈까요? 내 자리는 AI가 이어서 합니다.' : '처음 화면으로 갈까요?')) backToMenu('');
});

if (!onlineReady) {
  $('online-box').classList.add('disabled');
  $('online-note').textContent = '온라인을 하려면 firebase-config.js에 Firebase 설정을 넣어 주세요.';
}
show('menu');

// 에뮬레이터 모드에서만: 자동 테스트가 화면 상태를 읽을 수 있게 함
if (emulator) window.__davinci = { scene, get room() { return current?.room || null; } };
