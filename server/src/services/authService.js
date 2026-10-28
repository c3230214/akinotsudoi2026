import { tx } from '../db/connection.js';
import {
  deleteExpiredSessions, deleteSession, findSession, findStaffByLogin,
  insertSession, insertStaff, listStaff, setSessionMachine, updateStaff,
} from '../db/repos/staffRepo.js';
import { appendActionLog } from '../db/repos/drawRepo.js';
import { fail, invalid } from '../domain/errors.js';
import { addMs } from '../time.js';
import { createRateLimiter } from './rateLimiter.js';
import { DUMMY_PASSCODE_HASH, hashPasscode, randomToken, sha256, verifyPasscode } from './secrets.js';

export const ROLES = Object.freeze(['admin', 'operator', 'prize', 'printer']);
export const ROLE_LABELS = Object.freeze({ admin: '管理者', operator: '台担当', prize: '景品担当', printer: '発券端末' });
const LOGIN_RE = /^[a-z0-9._-]{3,32}$/;
// TODO(DECISION-C23): session lifetime is a proposal (covers the event day).
const SESSION_TTL_MS = 14 * 60 * 60 * 1000;

export function createAuthService({ db, clock, machineExists }) {
  const failuresByName = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 5 });
  const failuresByIp = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 30 });

  async function login(loginName, passcode, ip) {
    if (typeof loginName !== 'string' || typeof passcode !== 'string') invalid('ログイン名とパスコードを入力してください');
    const name = loginName.trim().toLowerCase();
    const ipKey = `ip:${ip}`;
    const nameKey = `name:${name}`;
    if (failuresByName.blocked(nameKey) || failuresByIp.blocked(ipKey)) {
      fail('TOO_MANY_ATTEMPTS', 'ログイン失敗が続いたため、しばらく待ってから再試行してください', { status: 429 });
    }
    // A hit is recorded only on failure.
    const staff = LOGIN_RE.test(name) ? findStaffByLogin(db, name) : null;
    const ok = await verifyPasscode(passcode, staff?.passcodeHash ?? DUMMY_PASSCODE_HASH).catch(() => false);
    if (!ok || !staff || !staff.active) {
      const a = failuresByName.hit(nameKey);
      const b = failuresByIp.hit(ipKey);
      tx(db, () => appendActionLog(db, { at: clock(), actor: { kind: 'anonymous', ip }, type: 'login', action: { loginName: name }, result: 'rejected:LOGIN_FAILED' }));
      if (!a.allowed || !b.allowed) fail('TOO_MANY_ATTEMPTS', 'ログイン失敗が続いたため、しばらく待ってから再試行してください', { status: 429 });
      fail('LOGIN_FAILED', 'ログイン名またはパスコードが違います', { status: 401 });
    }
    failuresByName.reset(nameKey);
    const token = randomToken(32);
    const at = clock();
    tx(db, () => {
      deleteExpiredSessions(db, at);
      insertSession(db, { sessionHash: sha256(token), staffId: staff.id, at, expiresAt: addMs(at, SESSION_TTL_MS) });
      appendActionLog(db, { at, actor: { kind: 'staff', id: staff.id, name: staff.displayName, role: staff.role }, type: 'login', action: {}, result: 'ok' });
    });
    return { token, staff: publicStaff(staff), maxAgeSec: SESSION_TTL_MS / 1000 };
  }

  function authenticate(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    const s = findSession(db, sha256(token));
    if (!s || !s.staff.active) return null;
    if (Date.parse(s.expiresAt) < Date.parse(clock())) return null;
    return { sessionHash: s.sessionHash, machineId: s.machineId, staff: publicStaff(s.staff) };
  }

  function logout(token) {
    if (typeof token === 'string') tx(db, () => deleteSession(db, sha256(token)));
  }

  function selectMachine(auth, machineId) {
    if (machineId !== null && !machineExists(machineId)) fail('UNKNOWN_MACHINE', '台が見つかりません', { status: 404 });
    tx(db, () => setSessionMachine(db, auth.sessionHash, machineId));
    return { machineId };
  }

  async function createStaff({ loginName, displayName, role, passcode }, by) {
    const name = String(loginName ?? '').trim().toLowerCase();
    if (!LOGIN_RE.test(name)) invalid('ログイン名は英小文字・数字・._- の3〜32文字です');
    if (!ROLES.includes(role)) invalid('役割が正しくありません');
    if (typeof displayName !== 'string' || !displayName.trim() || displayName.length > 40) invalid('表示名を入力してください（40文字以内）');
    if (typeof passcode !== 'string' || passcode.length < 8) invalid('パスコードは8文字以上にしてください');
    const passcodeHash = await hashPasscode(passcode);
    const at = clock();
    try {
      return tx(db, () => {
        const id = insertStaff(db, { loginName: name, displayName: displayName.trim(), role, passcodeHash, at });
        appendActionLog(db, { at, actor: by, type: 'createStaff', action: { loginName: name, role }, result: 'ok' });
        return id;
      });
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) fail('LOGIN_TAKEN', 'そのログイン名は使われています');
      throw error;
    }
  }

  async function changeStaff(staffId, { displayName, role, passcode, active }, by) {
    if (role !== undefined && !ROLES.includes(role)) invalid('役割が正しくありません');
    if (passcode !== undefined && (typeof passcode !== 'string' || passcode.length < 8)) invalid('パスコードは8文字以上にしてください');
    if (by.id === staffId && (active === false || (role && role !== 'admin'))) fail('SELF_LOCKOUT', '自分自身を無効化・降格できません');
    const passcodeHash = passcode ? await hashPasscode(passcode) : undefined;
    const at = clock();
    const ok = tx(db, () => {
      const r = updateStaff(db, staffId, { displayName, role, passcodeHash, active });
      if (r) appendActionLog(db, { at, actor: by, type: 'updateStaff', action: { staffId, role, active, passcodeChanged: Boolean(passcode) }, result: 'ok' });
      return r;
    });
    if (!ok) fail('UNKNOWN_STAFF', 'スタッフが見つかりません', { status: 404 });
  }

  return {
    login, authenticate, logout, selectMachine, createStaff, changeStaff, listStaff: () => listStaff(db),
  };
}

function publicStaff(s) {
  return { id: s.id, loginName: s.loginName, displayName: s.displayName, role: s.role };
}
