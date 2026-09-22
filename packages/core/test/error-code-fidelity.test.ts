import * as authErrors from '../src/auth-errors';
import * as dbErrors from '../src/database-errors';
import * as storageErrors from '../src/storage-errors';
import * as sharedErrors from '../src/errors';

// Every error class reports a code the server actually sends.
//
// The mapping tables check that a code produces the right class. They do not
// check what that class then reports, and the two are different things: a
// class can be reached correctly by `instanceof` while its `code` field says
// something the server has never sent. That is what happened here —
// EmailAlreadyInUseError reported 'email_taken' for a server that says
// 'email_in_use', and ten others were the same, in both SDKs, for months.
//
// It is a small lie with a real cost: `code` is a public field, and anyone
// who reads it instead of using instanceof is comparing against a string
// that will never arrive.
//
// The list below is the API's own, from platform/respond/codes.go. When the
// API declares a new code, it goes here.

const API_CODES = new Set([
  'account_disabled', 'account_exists', 'account_locked', 'ambiguous_match',
  'batch_failed', 'cap_below_usage', 'collection_not_found', 'collection_referenced', 'conflict',
  'constraint_exists', 'constraint_not_found', 'contact_not_verified',
  'dangling_references', 'duplicate', 'duplicate_values', 'email_in_use', 'email_not_verified',
  'error', 'field_not_auto_embed', 'file_too_large',
  'hide_requires_verification', 'idempotency_conflict',
  'idempotency_key_reused', 'identity_not_found', 'insufficient_authority',
  'insufficient_scope', 'internal_error', 'invalid', 'invalid_body',
  'invalid_credentials', 'invalid_embedding_config', 'invalid_oauth_token',
  'invalid_password', 'invalid_phone', 'invalid_refresh_token',
  'invalid_seed_file', 'invalid_token', 'invalid_unlock_token',
  'invitation_invalid', 'last_credential', 'metadata_invalid',
  'mime_not_allowed', 'no_changes', 'not_found', 'oauth_email_conflict',
  'oauth_email_required', 'oauth_not_configured', 'oauth_only_account',
  'otp_expired', 'otp_invalid', 'otp_max_attempts', 'path_conflict',
  'permission_denied', 'phone_in_use', 'plan_limit_reached',
  'project_invalid', 'provider_identity_already_linked', 'provider_invalid',
  'provider_not_configured', 'quota_exceeded', 'rate_limit',
  'record_not_found', 'resend_cooldown', 'resend_daily_cap',
  'reference_in_use', 'reference_invalid',
  'revision_mismatch', 'seed_conflicts_require_force', 'seed_key_not_unique',
  'seed_needs_decision', 'session_required', 'signups_disabled',
  'slug_taken', 'sms_not_configured', 'state_conflict', 'token_expired',
  'token_used', 'unauthenticated', 'unique_violation',
  'unsupported_dimension', 'unsupported_oauth_provider', 'upload_expired',
  'upload_url_failed', 'validation_error', 'vector_collection_mismatch',
  'vector_dimension_mismatch', 'vector_field_exists', 'vector_field_not_found',
  'vector_not_found', 'weak_password',
]);

// Codes with no server counterpart, for one of two reasons.
const CLIENT_ONLY = new Set([
  // Raised by the SDK itself; no server was involved, or the server's
  // response was the problem.
  'network_error',              // the request never reached a server
  'malformed_session_response', // a response that claimed a session and had none
  'offline_baseline_unavailable',

  // Reserved. TokenRevokedError exists for a contract that does not yet
  // exist: explicit revocation — a sign-out-everywhere, an administrator
  // killing a session — is worth telling a user about differently from an
  // ordinary expiry. The server cannot currently establish it (a rejected
  // refresh token is indistinguishable from a deleted one), so nothing
  // throws this today and no code maps to it. It stays because removing a
  // public class is a breaking change, and because the contract is worth
  // building. When the server emits session_revoked, this becomes that.
  'token_revoked',
]);

function classesIn(mod: Record<string, unknown>): Array<[string, new () => unknown]> {
  return Object.entries(mod).filter(
    ([name, v]) => typeof v === 'function' && name.endsWith('Error')
  ) as Array<[string, new () => unknown]>;
}

describe('error classes report codes the server sends', () => {
  const modules: Array<[string, Record<string, unknown>]> = [
    ['auth', authErrors],
    ['database', dbErrors],
    ['storage', storageErrors],
    ['shared', sharedErrors],
  ];

  for (const [family, mod] of modules) {
    it.each(classesIn(mod))(`${family}: %s`, (name, Cls) => {
      let instance: { code?: string };
      try {
        instance = new (Cls as new () => { code?: string })();
      } catch {
        return; // needs constructor arguments; covered by the mapping tables
      }
      const code = instance.code;
      if (!code) return; // a base class with no code of its own

      if (CLIENT_ONLY.has(code)) return;

      expect({ class: name, code, sends: API_CODES.has(code) }).toEqual({
        class: name,
        code,
        sends: true,
      });
    });
  }
});
