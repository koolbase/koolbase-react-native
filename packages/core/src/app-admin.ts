import type {
  KoolbaseAssignableRole,
  KoolbaseMember,
  KoolbaseMemberPage,
  KoolbaseMemberRoles,
} from './types.js';

type AdminRequest = (path: string, options?: { method?: string; body?: unknown }) => Promise<any>;

function mapMember(r: Record<string, unknown>): KoolbaseMember {
  return {
    id: String(r.id),
    email: String(r.email ?? ''),
    fullName: (r.full_name as string | undefined) ?? undefined,
    avatarUrl: (r.avatar_url as string | undefined) ?? undefined,
    status: (r.status as KoolbaseMember['status']) ?? 'active',
    isAdmin: Boolean(r.is_admin),
    roles: (r.roles as Record<string, unknown>) ?? {},
    version: Number(r.version ?? 0),
    joinedAt: String(r.joined_at),
    lastSeenAt: (r.last_seen_at as string | undefined) ?? undefined,
  };
}

/**
 * Managing the app's people from inside the app, for its own admins.
 *
 * Only a signed-in person whose `app_admin` claim is true may use these; the
 * project owner gives that claim in the dashboard. Everyone else gets
 * `NotAppAdminError`. The server checks on every request, so taking the claim
 * away takes effect at once.
 *
 * When the admin has two-step sign-in on, disabling, enabling and changing
 * roles need it confirmed in the last ten minutes: catch
 * `RecentMfaRequiredError`, call `stepUpMfa`, and try again.
 *
 * Reached through `Koolbase.auth.admin`; not built by apps.
 */
export class KoolbaseAppAdmin {
  constructor(private readonly request: AdminRequest) {}

  /** The app's people, newest first. `query` matches email or name. */
  async members(options?: {
    query?: string;
    limit?: number;
    offset?: number;
  }): Promise<KoolbaseMemberPage> {
    const params = new URLSearchParams();
    if (options?.query) params.set('q', options.query);
    if (options?.limit !== undefined) params.set('limit', String(options.limit));
    if (options?.offset !== undefined) params.set('offset', String(options.offset));
    const qs = params.toString();
    const body = await this.request(`/v1/sdk/admin/members${qs ? `?${qs}` : ''}`);
    return {
      members: ((body.members as Record<string, unknown>[]) ?? []).map(mapMember),
      total: Number(body.total ?? 0),
    };
  }

  /** The roles admins may give, for a role picker. */
  async roles(): Promise<KoolbaseAssignableRole[]> {
    const body = await this.request('/v1/sdk/admin/roles');
    return ((body.roles as Record<string, unknown>[]) ?? []).map((r) => ({
      key: String(r.key),
      valueType: String(r.value_type ?? 'string'),
      allowedValues: ((r.allowed_values as unknown[]) ?? []).map(String),
      description: (r.description as string | undefined) ?? undefined,
      holders: Number(r.holders ?? 0),
      values: (r.values as Record<string, number>) ?? {},
    }));
  }

  /**
   * Invite someone by email. They get an email to set up their account, and
   * `roles` are given at once. Throws `MemberExistsError` when the email
   * already has an account.
   */
  async invite(params: {
    email: string;
    fullName?: string;
    roles?: Record<string, unknown>;
  }): Promise<KoolbaseMember> {
    const body = await this.request('/v1/sdk/admin/members/invite', {
      method: 'POST',
      body: {
        email: params.email,
        ...(params.fullName !== undefined ? { full_name: params.fullName } : {}),
        ...(params.roles && Object.keys(params.roles).length ? { roles: params.roles } : {}),
      },
    });
    return mapMember(body);
  }

  /** Stop someone signing in, and sign them out everywhere. */
  async disable(userId: string): Promise<void> {
    await this.request(`/v1/sdk/admin/members/${encodeURIComponent(userId)}/disable`, {
      method: 'POST',
    });
  }

  /** Let a disabled person sign in again. */
  async enable(userId: string): Promise<void> {
    await this.request(`/v1/sdk/admin/members/${encodeURIComponent(userId)}/enable`, {
      method: 'POST',
    });
  }

  /**
   * Change someone's roles. Only the keys given change; `null` removes a
   * role. Pass the member's `version` as `expectedVersion`: when someone else
   * changed them since, this throws `ClaimsVersionConflictError` carrying the
   * new version, and nothing is changed.
   */
  async setRoles(
    userId: string,
    roles: Record<string, unknown>,
    options: { expectedVersion: number }
  ): Promise<KoolbaseMemberRoles> {
    const body = await this.request(
      `/v1/sdk/admin/members/${encodeURIComponent(userId)}/roles`,
      { method: 'PUT', body: { roles, expected_version: options.expectedVersion } }
    );
    return {
      id: String(body.id),
      roles: (body.roles as Record<string, unknown>) ?? {},
      version: Number(body.version ?? 0),
    };
  }
}
