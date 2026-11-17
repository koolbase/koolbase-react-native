import { KoolbaseAuth } from '../src/auth';
import {
  AppAdminSelfError,
  AppAdminTargetIsAdminError,
  ClaimsVersionConflictError,
  EmailAlreadyInUseError,
  KoolbaseAuthError,
  MemberExistsError,
  NotAppAdminError,
  RateLimitError,
  RecentMfaRequiredError,
  RoleNotAssignableError,
  RoleValueNotAllowedError,
  UserDisabledError,
} from '../src/auth-errors';
import { setPlatform } from '../src/platform';
import { testPlatform } from './platform';

// In-app admin: an app's own admins (the app_admin claim) manage its people
// through /v1/sdk/admin. The server decides who may do what; the SDK sends
// the right request and turns each refusal into a type an app can catch.
// Same contract as koolbase_flutter 12.57.0.

const config = { baseUrl: 'https://api.test', publicKey: 'pk' } as never;
const user = { id: 'admin', email: 'a@b.test', verified: true };
const session = { access_token: 'at', refresh_token: 'rt', expires_at: '2026-12-01T00:00:00Z', user };

const memberJson = {
  id: 'u1',
  email: 'ama@example.test',
  full_name: 'Ama',
  status: 'invited',
  is_admin: false,
  roles: { role: 'staff' },
  version: 3,
  joined_at: '2026-11-01T10:00:00Z',
};

function respond(body: unknown, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status < 400,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as never;
}

function lastCall(): { url: string; init: RequestInit } {
  const calls = (global.fetch as jest.Mock).mock.calls;
  const [url, init] = calls[calls.length - 1];
  return { url: String(url), init };
}

async function signedIn(): Promise<KoolbaseAuth> {
  respond(session);
  const auth = new KoolbaseAuth(config);
  await auth.login({ email: 'a@b.test', password: 'password123' });
  return auth;
}

describe('in-app admin', () => {
  beforeEach(async () => {
    setPlatform(await testPlatform());
  });

  it('members sends the search and paging, and maps the page', async () => {
    const auth = await signedIn();
    respond({ members: [memberJson], total: 41 });
    const page = await auth.admin.members({ query: 'ama', limit: 20, offset: 40 });

    const { url, init } = lastCall();
    expect(url).toBe('https://api.test/v1/sdk/admin/members?q=ama&limit=20&offset=40');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer at');
    expect(page.total).toBe(41);
    expect(page.members[0]).toMatchObject({
      id: 'u1',
      fullName: 'Ama',
      status: 'invited',
      isAdmin: false,
      roles: { role: 'staff' },
      version: 3,
    });
    expect(page.members[0].lastSeenAt).toBeUndefined();
  });

  it('no search sends no query string', async () => {
    const auth = await signedIn();
    respond({ members: [], total: 0 });
    await auth.admin.members();
    expect(lastCall().url).toBe('https://api.test/v1/sdk/admin/members');
  });

  it('roles maps the counts', async () => {
    const auth = await signedIn();
    respond({
      roles: [
        {
          key: 'role',
          value_type: 'string',
          allowed_values: ['staff', 'manager'],
          holders: 5,
          values: { staff: 4, manager: 1 },
        },
      ],
    });
    const [r] = await auth.admin.roles();
    expect(r).toMatchObject({ key: 'role', allowedValues: ['staff', 'manager'], holders: 5 });
    expect(r.values.manager).toBe(1);
  });

  it('invite posts the email, name and roles', async () => {
    const auth = await signedIn();
    respond(memberJson, 201);
    const m = await auth.admin.invite({ email: 'ama@example.test', fullName: 'Ama', roles: { role: 'staff' } });
    const { url, init } = lastCall();
    expect(url).toBe('https://api.test/v1/sdk/admin/members/invite');
    expect(JSON.parse(String(init.body))).toEqual({
      email: 'ama@example.test',
      full_name: 'Ama',
      roles: { role: 'staff' },
    });
    expect(m.id).toBe('u1');
  });

  it('disable and enable post to their own routes', async () => {
    const auth = await signedIn();
    respond({ id: 'u1', disabled: true });
    await auth.admin.disable('u1');
    expect(lastCall().url).toBe('https://api.test/v1/sdk/admin/members/u1/disable');
    expect(lastCall().init.method).toBe('POST');
    await auth.admin.enable('u1');
    expect(lastCall().url).toBe('https://api.test/v1/sdk/admin/members/u1/enable');
  });

  it('setRoles sends the version and keeps a null that clears a role', async () => {
    const auth = await signedIn();
    respond({ id: 'u1', roles: { team: 'north' }, version: 4 });
    const out = await auth.admin.setRoles('u1', { role: null, team: 'north' }, { expectedVersion: 3 });
    const { url, init } = lastCall();
    expect(url).toBe('https://api.test/v1/sdk/admin/members/u1/roles');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({
      roles: { role: null, team: 'north' },
      expected_version: 3,
    });
    expect(out).toEqual({ id: 'u1', roles: { team: 'north' }, version: 4 });
  });

  describe('refusals', () => {
    async function failure(status: number, body: Record<string, unknown>): Promise<unknown> {
      const auth = await signedIn();
      respond(body, status);
      try {
        await auth.admin.disable('u1');
      } catch (e) {
        return e;
      }
      return null;
    }

    it('each admin code is its own type', async () => {
      expect(await failure(403, { code: 'app_admin_required', error: 'x' })).toBeInstanceOf(NotAppAdminError);
      expect(await failure(403, { code: 'app_admin_self', error: 'x' })).toBeInstanceOf(AppAdminSelfError);
      expect(await failure(403, { code: 'app_admin_target_is_admin', error: 'x' })).toBeInstanceOf(
        AppAdminTargetIsAdminError
      );
      expect(await failure(400, { code: 'role_not_assignable', error: 'x' })).toBeInstanceOf(RoleNotAssignableError);
      expect(await failure(400, { code: 'role_value_not_allowed', error: 'x' })).toBeInstanceOf(
        RoleValueNotAllowedError
      );
      expect(await failure(409, { code: 'member_exists', error: 'x' })).toBeInstanceOf(MemberExistsError);
      expect(await failure(403, { code: 'recent_mfa_required', error: 'x' })).toBeInstanceOf(RecentMfaRequiredError);
    });

    it('a version conflict carries the current version', async () => {
      const e = await failure(409, { code: 'claims_version_conflict', error: 'changed', version: 9 });
      expect(e).toBeInstanceOf(ClaimsVersionConflictError);
      expect((e as ClaimsVersionConflictError).currentVersion).toBe(9);
    });

    it('a plain 409, 404 or 403 keeps the server words', async () => {
      const conflict = await failure(409, { code: 'conflict', error: 'this app has no way to sign in' });
      expect(conflict).not.toBeInstanceOf(EmailAlreadyInUseError);
      expect((conflict as KoolbaseAuthError).message).toBe('this app has no way to sign in');

      const missing = await failure(404, { code: 'not_found', error: 'member not found' });
      expect((missing as KoolbaseAuthError).code).toBe('not_found');

      const refused = await failure(403, { code: 'permission_denied', error: 'no' });
      expect(refused).not.toBeInstanceOf(UserDisabledError);
    });

    it('too many requests is a rate limit', async () => {
      expect(await failure(429, { code: 'rate_limit', error: 'slow down' })).toBeInstanceOf(RateLimitError);
    });
  });
});
