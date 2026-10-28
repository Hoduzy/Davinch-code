// Firebase Realtime Database 연결을 작은 인터페이스로 감쌈 (online.js는 이 인터페이스만 사용)
// 브라우저에서는 gstatic CDN의 Firebase SDK를 필요할 때만 불러옴 (혼자 하기는 Firebase 없이 동작)

export const SDK_VERSION = '10.12.2';
const CDN = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;

export async function loadFirebaseSdk() {
  const [app, auth, database] = await Promise.all([
    import(`${CDN}/firebase-app.js`),
    import(`${CDN}/firebase-auth.js`),
    import(`${CDN}/firebase-database.js`),
  ]);
  return { app, auth, database };
}

/**
 * @param {object} config Firebase 웹 앱 설정 (firebase-config.js)
 * @param {{app: any, auth: any, database: any}} sdk
 * @param {{emulator?: {dbHost: string, dbPort: number, authUrl: string}, appName?: string, persistence?: 'session'|'memory'}} opts
 */
export async function connectFirebase(config, sdk, opts = {}) {
  const { app: A, auth: Au, database: D } = sdk;
  const app = A.initializeApp(config, opts.appName || '[DEFAULT]');
  const auth = Au.getAuth(app);
  if (opts.emulator) Au.connectAuthEmulator(auth, opts.emulator.authUrl, { disableWarnings: true });
  // 익명 계정을 이 기기 브라우저에 계속 저장 (코인/보관함이 이 계정에 묶임)
  // 주의: 같은 기기의 탭들은 같은 사람으로 취급됨. 여러 명 테스트는 다른 기기나 개인정보 보호 창으로
  const persistence = { memory: Au.inMemoryPersistence, session: Au.browserSessionPersistence }[opts.persistence]
    || Au.browserLocalPersistence;
  await Au.setPersistence(auth, persistence);
  const cred = auth.currentUser ? { user: auth.currentUser } : await Au.signInAnonymously(auth);
  const db = D.getDatabase(app);
  if (opts.emulator) D.connectDatabaseEmulator(db, opts.emulator.dbHost, opts.emulator.dbPort);

  const r = (path) => D.ref(db, path);
  return {
    uid: cred.user.uid,
    async get(path) { return (await D.get(r(path))).val(); },
    set(path, value) { return D.set(r(path), value); },
    update(path, value) { return D.update(path ? r(path) : D.ref(db), value); },
    remove(path) { return D.remove(r(path)); },
    async push(path, value) { return (await D.push(r(path), value)).key; },
    async transaction(path, fn) {
      const res = await D.runTransaction(r(path), fn, { applyLocally: false });
      return { committed: res.committed, value: res.snapshot.val() };
    },
    on(path, cb, onError) {
      return D.onValue(r(path), (s) => cb(s.val()), (e) => onError && onError(e));
    },
    onChildAdded(path, cb, onError) {
      return D.onChildAdded(r(path), (s) => cb(s.key, s.val()), (e) => onError && onError(e));
    },
    /** 연결될 때마다(재연결 포함) cb(true), 끊기면 cb(false) */
    onConnection(cb) {
      return D.onValue(r('.info/connected'), (s) => cb(s.val() === true));
    },
    /** 서버 시각 - 내 기기 시각 (ms) */
    onServerTimeOffset(cb) {
      return D.onValue(r('.info/serverTimeOffset'), (s) => cb(s.val() || 0));
    },
    onDisconnectRemove(path) { return D.onDisconnect(r(path)).remove(); },
    cancelOnDisconnect(path) { return D.onDisconnect(r(path)).cancel(); },
    goOffline() { D.goOffline(db); },
    goOnline() { D.goOnline(db); },
    serverTime: () => D.serverTimestamp(),
    async close() { D.goOffline(db); await A.deleteApp(app); },
  };
}
