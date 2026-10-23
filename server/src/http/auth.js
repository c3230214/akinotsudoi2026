import { DomainError } from '../domain/errors.js';
import { COOKIES } from './security.js';

export function staffActor(auth) {
  return { kind: 'staff', id: auth.staff.id, name: auth.staff.displayName, role: auth.staff.role, machineId: auth.machineId };
}

/** Server-side role check (§5). Roles never come from URL or body. */
export function requireStaff(auth, ...roles) {
  return async function staffHook(request) {
    const a = auth.authenticate(request.cookies[COOKIES.staff]);
    if (!a) throw new DomainError('UNAUTHENTICATED', 'ログインしてください', { status: 401 });
    if (roles.length && !roles.includes(a.staff.role)) throw new DomainError('FORBIDDEN', 'この操作の権限がありません', { status: 403 });
    request.staffAuth = a;
  };
}

export function requireKiosk(auth) {
  return async function kioskHook(request) {
    const k = auth.authenticateKiosk(request.cookies[COOKIES.kiosk]);
    if (!k) throw new DomainError('UNAUTHENTICATED', '案内端末が登録されていません', { status: 401 });
    request.kiosk = k;
  };
}

export function requireDevice(devices) {
  return async function deviceHook(request) {
    const header = request.headers.authorization ?? '';
    const m = header.match(/^Bearer ([A-Za-z0-9_-]{20,200})$/);
    const machineId = m ? devices.authenticate(m[1]) : null;
    if (!machineId) throw new DomainError('UNAUTHENTICATED', 'invalid device token', { status: 401 });
    request.deviceMachineId = machineId;
  };
}
