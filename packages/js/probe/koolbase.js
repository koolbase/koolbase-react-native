"use strict";
var KoolbaseJS = (() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __reExport = (target, mod, secondTarget) => (__copyProps(target, mod, "default"), secondTarget && __copyProps(secondTarget, mod, "default"));
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // packages/core/dist/types.js
  var require_types = __commonJS({
    "packages/core/dist/types.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.BatchOp = exports.FunctionRuntime = exports.RestoreResult = void 0;
      var RestoreResult;
      (function(RestoreResult2) {
        RestoreResult2["NoSession"] = "no_session";
        RestoreResult2["Restored"] = "restored";
        RestoreResult2["Expired"] = "expired";
        RestoreResult2["Offline"] = "offline";
      })(RestoreResult || (exports.RestoreResult = RestoreResult = {}));
      var FunctionRuntime;
      (function(FunctionRuntime2) {
        FunctionRuntime2["Deno"] = "deno";
        FunctionRuntime2["Dart"] = "dart";
      })(FunctionRuntime || (exports.FunctionRuntime = FunctionRuntime = {}));
      exports.BatchOp = {
        insert: (collection, data) => ({ type: "insert", collection, data }),
        update: (recordId, data) => ({ type: "update", recordId, data }),
        delete: (recordId) => ({ type: "delete", recordId }),
        upsert: (collection, opts) => ({
          type: "upsert",
          collection,
          match: opts.match,
          data: opts.data
        })
      };
    }
  });

  // packages/core/dist/errors.js
  var require_errors = __commonJS({
    "packages/core/dist/errors.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.KoolbaseOfflineBaselineUnavailableError = exports.KoolbaseUnauthenticatedError = exports.KoolbaseError = void 0;
      var KoolbaseError = class extends Error {
        constructor(message, code) {
          super(message);
          this.code = code;
          this.name = "KoolbaseError";
          Object.setPrototypeOf(this, new.target.prototype);
        }
      };
      exports.KoolbaseError = KoolbaseError;
      var KoolbaseUnauthenticatedError = class extends KoolbaseError {
        constructor(message) {
          super(message, "unauthenticated");
          this.name = "KoolbaseUnauthenticatedError";
          Object.setPrototypeOf(this, new.target.prototype);
        }
      };
      exports.KoolbaseUnauthenticatedError = KoolbaseUnauthenticatedError;
      var KoolbaseOfflineBaselineUnavailableError = class extends KoolbaseError {
        constructor(message) {
          super(message, "offline_baseline_unavailable");
          this.name = "KoolbaseOfflineBaselineUnavailableError";
          Object.setPrototypeOf(this, new.target.prototype);
        }
      };
      exports.KoolbaseOfflineBaselineUnavailableError = KoolbaseOfflineBaselineUnavailableError;
    }
  });

  // packages/core/dist/conflict.js
  var require_conflict = __commonJS({
    "packages/core/dist/conflict.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.KoolbaseConflict = void 0;
      var KoolbaseConflict = class {
        constructor(id, reason, operation, collection, recordId, local, baseline, server, baseRevision, serverRevision, createdAt, resolver) {
          this.id = id;
          this.reason = reason;
          this.operation = operation;
          this.collection = collection;
          this.recordId = recordId;
          this.local = local;
          this.baseline = baseline;
          this.server = server;
          this.baseRevision = baseRevision;
          this.serverRevision = serverRevision;
          this.createdAt = createdAt;
          this.resolver = resolver;
        }
        /**
         * Fields where the user's change and the server's version disagree.
         *
         * Only the fields the change touches: a record accumulates values the write
         * never asserted, and listing those would bury the real disagreement. Empty
         * when there is no server version to compare against.
         */
        get divergentFields() {
          if (!this.local)
            return [];
          if (!this.server)
            return Object.keys(this.local);
          return Object.keys(this.local).filter((k) => JSON.stringify(this.server[k]) !== JSON.stringify(this.local[k]));
        }
        /** How long this has been waiting. Metadata, not a deletion rule. */
        get ageMs() {
          return Date.now() - new Date(this.createdAt).getTime();
        }
        /**
         * Reapplies the user's change to the record as it stands now.
         *
         * An explicit decision to overwrite the server's version of the fields that
         * disagree. Conditional where a revision is known, so a record that moved
         * again while someone was deciding produces a new conflict rather than an
         * unnoticed overwrite.
         */
        resolveWithLocal() {
          return this.resolver.resolveWithLocal(this.id);
        }
        /** Keeps the server's version and discards the user's change, as a decision. */
        resolveWithServer() {
          return this.resolver.resolveWithServer(this.id);
        }
        /** Applies something the application composed from both versions. */
        resolveWithMerge(data) {
          return this.resolver.resolveWithMerge(this.id, data);
        }
        /** Drops the change without claiming either version won. */
        abandon() {
          return this.resolver.abandon(this.id);
        }
      };
      exports.KoolbaseConflict = KoolbaseConflict;
    }
  });

  // packages/core/dist/pending-write.js
  var require_pending_write = __commonJS({
    "packages/core/dist/pending-write.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.toPendingWrite = toPendingWrite;
      function toPendingWrite(w) {
        return {
          id: w.id,
          operation: w.operation,
          collection: w.collection,
          recordId: w.recordId,
          data: w.data,
          enqueuedAt: w.enqueuedAt,
          attempts: w.retries
        };
      }
    }
  });

  // packages/core/dist/function-errors.js
  var require_function_errors = __commonJS({
    "packages/core/dist/function-errors.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.FunctionExecutionError = exports.FunctionQuotaExceededError = exports.FunctionValidationError = exports.FunctionPermissionError = exports.FunctionNotFoundError = exports.FunctionInvokeError = void 0;
      exports.functionInvokeError = functionInvokeError;
      var errors_1 = require_errors();
      var FunctionInvokeError = class extends errors_1.KoolbaseError {
        constructor(message, statusCode, code) {
          super(message, code);
          this.statusCode = statusCode;
          this.name = "FunctionInvokeError";
          Object.setPrototypeOf(this, new.target.prototype);
        }
      };
      exports.FunctionInvokeError = FunctionInvokeError;
      var FunctionNotFoundError = class extends FunctionInvokeError {
        constructor(message) {
          super(message, 404, "not_found");
          this.name = "FunctionNotFoundError";
          Object.setPrototypeOf(this, new.target.prototype);
        }
      };
      exports.FunctionNotFoundError = FunctionNotFoundError;
      var FunctionPermissionError = class extends FunctionInvokeError {
        constructor(message) {
          super(message, 403, "permission_denied");
          this.name = "FunctionPermissionError";
          Object.setPrototypeOf(this, new.target.prototype);
        }
      };
      exports.FunctionPermissionError = FunctionPermissionError;
      var FunctionValidationError = class extends FunctionInvokeError {
        constructor(message) {
          super(message, 400, "validation_error");
          this.name = "FunctionValidationError";
          Object.setPrototypeOf(this, new.target.prototype);
        }
      };
      exports.FunctionValidationError = FunctionValidationError;
      var FunctionQuotaExceededError = class extends FunctionInvokeError {
        constructor(message) {
          super(message, 402, "limit_reached");
          this.name = "FunctionQuotaExceededError";
          Object.setPrototypeOf(this, new.target.prototype);
        }
      };
      exports.FunctionQuotaExceededError = FunctionQuotaExceededError;
      var FunctionExecutionError = class extends FunctionInvokeError {
        constructor(message, statusCode) {
          super(message, statusCode, "execution_failed");
          this.name = "FunctionExecutionError";
          Object.setPrototypeOf(this, new.target.prototype);
        }
      };
      exports.FunctionExecutionError = FunctionExecutionError;
      function functionInvokeError(status, message) {
        switch (status) {
          case 401:
            return new errors_1.KoolbaseUnauthenticatedError(message);
          case 403:
            return new FunctionPermissionError(message);
          case 404:
            return new FunctionNotFoundError(message);
          case 400:
            return new FunctionValidationError(message);
          case 402:
            return new FunctionQuotaExceededError(message);
        }
        if (status >= 500)
          return new FunctionExecutionError(message, status);
        return new FunctionInvokeError(message, status);
      }
    }
  });

  // packages/core/dist/auth-errors.js
  var require_auth_errors = __commonJS({
    "packages/core/dist/auth-errors.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.GoogleEmailRequiredError = exports.InvalidGoogleTokenError = exports.GoogleSignInNotConfiguredError = exports.OAuthEmailConflictError = exports.AppleEmailRequiredError = exports.InvalidAppleTokenError = exports.AppleSignInNotConfiguredError = exports.SmsConfigMissingError = exports.PhoneAlreadyLinkedError = exports.OtpRateLimitError = exports.OtpMaxAttemptsError = exports.OtpInvalidError = exports.OtpExpiredError = exports.InvalidPhoneNumberError = exports.NetworkError = exports.RateLimitError = exports.UnlockTokenInvalidError = exports.AccountLockedError = exports.TokenRevokedError = exports.SessionExpiredError = exports.WeakPasswordError = exports.UserDisabledError = exports.EmailAlreadyInUseError = exports.InvalidCredentialsError = exports.KoolbaseAuthError = void 0;
      var errors_1 = require_errors();
      var KoolbaseAuthError = class _KoolbaseAuthError extends errors_1.KoolbaseError {
        constructor(message, code) {
          super(message, code);
          this.name = "KoolbaseAuthError";
          Object.setPrototypeOf(this, _KoolbaseAuthError.prototype);
        }
      };
      exports.KoolbaseAuthError = KoolbaseAuthError;
      var InvalidCredentialsError = class _InvalidCredentialsError extends KoolbaseAuthError {
        constructor() {
          super("Invalid email or password", "invalid_credentials");
          this.name = "InvalidCredentialsError";
          Object.setPrototypeOf(this, _InvalidCredentialsError.prototype);
        }
      };
      exports.InvalidCredentialsError = InvalidCredentialsError;
      var EmailAlreadyInUseError = class _EmailAlreadyInUseError extends KoolbaseAuthError {
        constructor() {
          super("Email is already in use", "email_taken");
          this.name = "EmailAlreadyInUseError";
          Object.setPrototypeOf(this, _EmailAlreadyInUseError.prototype);
        }
      };
      exports.EmailAlreadyInUseError = EmailAlreadyInUseError;
      var UserDisabledError = class _UserDisabledError extends KoolbaseAuthError {
        constructor() {
          super("This account has been disabled", "user_disabled");
          this.name = "UserDisabledError";
          Object.setPrototypeOf(this, _UserDisabledError.prototype);
        }
      };
      exports.UserDisabledError = UserDisabledError;
      var WeakPasswordError = class _WeakPasswordError extends KoolbaseAuthError {
        constructor() {
          super("Password must be at least 8 characters", "weak_password");
          this.name = "WeakPasswordError";
          Object.setPrototypeOf(this, _WeakPasswordError.prototype);
        }
      };
      exports.WeakPasswordError = WeakPasswordError;
      var SessionExpiredError = class _SessionExpiredError extends KoolbaseAuthError {
        constructor() {
          super("Session expired, please log in again", "session_expired");
          this.name = "SessionExpiredError";
          Object.setPrototypeOf(this, _SessionExpiredError.prototype);
        }
      };
      exports.SessionExpiredError = SessionExpiredError;
      var TokenRevokedError = class _TokenRevokedError extends KoolbaseAuthError {
        constructor() {
          super("Session has been revoked, please log in again", "token_revoked");
          this.name = "TokenRevokedError";
          Object.setPrototypeOf(this, _TokenRevokedError.prototype);
        }
      };
      exports.TokenRevokedError = TokenRevokedError;
      var AccountLockedError = class _AccountLockedError extends KoolbaseAuthError {
        constructor(lockedUntil) {
          super("Account temporarily locked due to too many failed attempts", "account_locked");
          this.lockedUntil = lockedUntil;
          this.name = "AccountLockedError";
          Object.setPrototypeOf(this, _AccountLockedError.prototype);
        }
      };
      exports.AccountLockedError = AccountLockedError;
      var UnlockTokenInvalidError = class _UnlockTokenInvalidError extends KoolbaseAuthError {
        constructor() {
          super("Unlock link is invalid or has expired", "unlock_token_invalid");
          this.name = "UnlockTokenInvalidError";
          Object.setPrototypeOf(this, _UnlockTokenInvalidError.prototype);
        }
      };
      exports.UnlockTokenInvalidError = UnlockTokenInvalidError;
      var RateLimitError = class _RateLimitError extends KoolbaseAuthError {
        constructor(message) {
          super(message ?? "Too many requests, please wait before trying again", "rate_limit");
          this.name = "RateLimitError";
          Object.setPrototypeOf(this, _RateLimitError.prototype);
        }
      };
      exports.RateLimitError = RateLimitError;
      var NetworkError = class _NetworkError extends KoolbaseAuthError {
        constructor() {
          super("Network error, please check your connection", "network_error");
          this.name = "NetworkError";
          Object.setPrototypeOf(this, _NetworkError.prototype);
        }
      };
      exports.NetworkError = NetworkError;
      var InvalidPhoneNumberError = class _InvalidPhoneNumberError extends KoolbaseAuthError {
        constructor() {
          super("Phone number must be in E.164 format (e.g. +233XXXXXXXXX)", "invalid_phone");
          this.name = "InvalidPhoneNumberError";
          Object.setPrototypeOf(this, _InvalidPhoneNumberError.prototype);
        }
      };
      exports.InvalidPhoneNumberError = InvalidPhoneNumberError;
      var OtpExpiredError = class _OtpExpiredError extends KoolbaseAuthError {
        constructor() {
          super("OTP has expired, please request a new code", "otp_expired");
          this.name = "OtpExpiredError";
          Object.setPrototypeOf(this, _OtpExpiredError.prototype);
        }
      };
      exports.OtpExpiredError = OtpExpiredError;
      var OtpInvalidError = class _OtpInvalidError extends KoolbaseAuthError {
        constructor() {
          super("Invalid OTP code", "otp_invalid");
          this.name = "OtpInvalidError";
          Object.setPrototypeOf(this, _OtpInvalidError.prototype);
        }
      };
      exports.OtpInvalidError = OtpInvalidError;
      var OtpMaxAttemptsError = class _OtpMaxAttemptsError extends KoolbaseAuthError {
        constructor() {
          super("Too many incorrect attempts, please request a new code", "otp_max_attempts");
          this.name = "OtpMaxAttemptsError";
          Object.setPrototypeOf(this, _OtpMaxAttemptsError.prototype);
        }
      };
      exports.OtpMaxAttemptsError = OtpMaxAttemptsError;
      var OtpRateLimitError = class _OtpRateLimitError extends KoolbaseAuthError {
        constructor() {
          super("Too many OTP requests, please wait before trying again", "otp_rate_limit");
          this.name = "OtpRateLimitError";
          Object.setPrototypeOf(this, _OtpRateLimitError.prototype);
        }
      };
      exports.OtpRateLimitError = OtpRateLimitError;
      var PhoneAlreadyLinkedError = class _PhoneAlreadyLinkedError extends KoolbaseAuthError {
        constructor() {
          super("Phone number is already associated with another account", "phone_taken");
          this.name = "PhoneAlreadyLinkedError";
          Object.setPrototypeOf(this, _PhoneAlreadyLinkedError.prototype);
        }
      };
      exports.PhoneAlreadyLinkedError = PhoneAlreadyLinkedError;
      var SmsConfigMissingError = class _SmsConfigMissingError extends KoolbaseAuthError {
        constructor() {
          super("SMS provider not configured for this project", "sms_config_missing");
          this.name = "SmsConfigMissingError";
          Object.setPrototypeOf(this, _SmsConfigMissingError.prototype);
        }
      };
      exports.SmsConfigMissingError = SmsConfigMissingError;
      var AppleSignInNotConfiguredError = class _AppleSignInNotConfiguredError extends KoolbaseAuthError {
        constructor() {
          super("Apple Sign-In is not configured for this environment", "apple_not_configured");
          this.name = "AppleSignInNotConfiguredError";
          Object.setPrototypeOf(this, _AppleSignInNotConfiguredError.prototype);
        }
      };
      exports.AppleSignInNotConfiguredError = AppleSignInNotConfiguredError;
      var InvalidAppleTokenError = class _InvalidAppleTokenError extends KoolbaseAuthError {
        constructor() {
          super("Invalid Apple identity token", "invalid_apple_token");
          this.name = "InvalidAppleTokenError";
          Object.setPrototypeOf(this, _InvalidAppleTokenError.prototype);
        }
      };
      exports.InvalidAppleTokenError = InvalidAppleTokenError;
      var AppleEmailRequiredError = class _AppleEmailRequiredError extends KoolbaseAuthError {
        constructor() {
          super("Apple did not return email for this sign-in. Revoke this app in iOS Settings \u2192 Apple ID and retry.", "apple_email_required");
          this.name = "AppleEmailRequiredError";
          Object.setPrototypeOf(this, _AppleEmailRequiredError.prototype);
        }
      };
      exports.AppleEmailRequiredError = AppleEmailRequiredError;
      var OAuthEmailConflictError = class _OAuthEmailConflictError extends KoolbaseAuthError {
        constructor() {
          super("Email is already in use by another account. Sign in with your existing method and link Apple from settings.", "oauth_email_conflict");
          this.name = "OAuthEmailConflictError";
          Object.setPrototypeOf(this, _OAuthEmailConflictError.prototype);
        }
      };
      exports.OAuthEmailConflictError = OAuthEmailConflictError;
      var GoogleSignInNotConfiguredError = class _GoogleSignInNotConfiguredError extends KoolbaseAuthError {
        constructor() {
          super("Google Sign-In is not configured for this environment", "google_not_configured");
          this.name = "GoogleSignInNotConfiguredError";
          Object.setPrototypeOf(this, _GoogleSignInNotConfiguredError.prototype);
        }
      };
      exports.GoogleSignInNotConfiguredError = GoogleSignInNotConfiguredError;
      var InvalidGoogleTokenError = class _InvalidGoogleTokenError extends KoolbaseAuthError {
        constructor() {
          super("Invalid Google identity token", "invalid_google_token");
          this.name = "InvalidGoogleTokenError";
          Object.setPrototypeOf(this, _InvalidGoogleTokenError.prototype);
        }
      };
      exports.InvalidGoogleTokenError = InvalidGoogleTokenError;
      var GoogleEmailRequiredError = class _GoogleEmailRequiredError extends KoolbaseAuthError {
        constructor() {
          super("Google did not return email for this sign-in. Ensure the email scope is requested in the native flow.", "google_email_required");
          this.name = "GoogleEmailRequiredError";
          Object.setPrototypeOf(this, _GoogleEmailRequiredError.prototype);
        }
      };
      exports.GoogleEmailRequiredError = GoogleEmailRequiredError;
    }
  });

  // packages/core/dist/database-errors.js
  var require_database_errors = __commonJS({
    "packages/core/dist/database-errors.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.KoolbaseVectorDimensionMismatchError = exports.KoolbaseRateLimitError = exports.KoolbasePermissionError = exports.KoolbaseValidationError = exports.KoolbaseNotFoundError = exports.KoolbaseConflictError = exports.KoolbaseDataError = void 0;
      exports.koolbaseDataError = koolbaseDataError;
      var errors_1 = require_errors();
      var KoolbaseDataError = class _KoolbaseDataError extends errors_1.KoolbaseError {
        constructor(message, code) {
          super(message, code);
          this.name = "KoolbaseDataError";
          Object.setPrototypeOf(this, _KoolbaseDataError.prototype);
        }
      };
      exports.KoolbaseDataError = KoolbaseDataError;
      var KoolbaseConflictError = class _KoolbaseConflictError extends KoolbaseDataError {
        constructor(message, field) {
          super(message ?? "Value violates a unique constraint", "unique_violation");
          this.field = field;
          this.name = "KoolbaseConflictError";
          Object.setPrototypeOf(this, _KoolbaseConflictError.prototype);
        }
      };
      exports.KoolbaseConflictError = KoolbaseConflictError;
      var KoolbaseNotFoundError = class _KoolbaseNotFoundError extends KoolbaseDataError {
        constructor(message) {
          super(message ?? "The requested resource was not found", "not_found");
          this.name = "KoolbaseNotFoundError";
          Object.setPrototypeOf(this, _KoolbaseNotFoundError.prototype);
        }
      };
      exports.KoolbaseNotFoundError = KoolbaseNotFoundError;
      var KoolbaseValidationError = class _KoolbaseValidationError extends KoolbaseDataError {
        constructor(message) {
          super(message ?? "The request was invalid", "validation_error");
          this.name = "KoolbaseValidationError";
          Object.setPrototypeOf(this, _KoolbaseValidationError.prototype);
        }
      };
      exports.KoolbaseValidationError = KoolbaseValidationError;
      var KoolbasePermissionError = class _KoolbasePermissionError extends KoolbaseDataError {
        constructor(message) {
          super(message ?? "You do not have permission to perform this action", "permission_denied");
          this.name = "KoolbasePermissionError";
          Object.setPrototypeOf(this, _KoolbasePermissionError.prototype);
        }
      };
      exports.KoolbasePermissionError = KoolbasePermissionError;
      var KoolbaseRateLimitError = class _KoolbaseRateLimitError extends KoolbaseDataError {
        constructor(message) {
          super(message ?? "Too many requests, please slow down", "rate_limit");
          this.name = "KoolbaseRateLimitError";
          Object.setPrototypeOf(this, _KoolbaseRateLimitError.prototype);
        }
      };
      exports.KoolbaseRateLimitError = KoolbaseRateLimitError;
      var KoolbaseVectorDimensionMismatchError = class _KoolbaseVectorDimensionMismatchError extends KoolbaseDataError {
        constructor(message) {
          super(message ?? "Vector dimension does not match field declaration", "vector_dimension_mismatch");
          this.name = "KoolbaseVectorDimensionMismatchError";
          Object.setPrototypeOf(this, _KoolbaseVectorDimensionMismatchError.prototype);
        }
      };
      exports.KoolbaseVectorDimensionMismatchError = KoolbaseVectorDimensionMismatchError;
      function koolbaseDataError(status, body, fallbackMessage = "Request failed") {
        const code = body?.code;
        const message = body?.error ?? fallbackMessage;
        const field = body?.details?.field;
        const attach = (err) => {
          if (err instanceof KoolbaseDataError && body?.details) {
            err.details = body.details;
          }
          return err;
        };
        if (status === 401) {
          return new errors_1.KoolbaseUnauthenticatedError(message);
        }
        switch (code) {
          case "unique_violation":
            return attach(new KoolbaseConflictError(message, field));
          case "not_found":
          case "record_not_found":
          case "collection_not_found":
          case "vector_not_found":
          case "vector_field_not_found":
            return attach(new KoolbaseNotFoundError(message));
          case "unauthenticated":
          case "session_expired":
          case "invalid_token":
            return attach(new errors_1.KoolbaseUnauthenticatedError(message));
          case "permission_denied":
            return attach(new KoolbasePermissionError(message));
          case "rate_limit":
            return attach(new KoolbaseRateLimitError(message));
          case "validation_error":
          case "vector_collection_mismatch":
          case "unsupported_dimension":
            return attach(new KoolbaseValidationError(message));
          case "vector_dimension_mismatch":
            return attach(new KoolbaseVectorDimensionMismatchError(message));
        }
        switch (status) {
          case 409:
            return attach(new KoolbaseConflictError(message));
          case 404:
            return attach(new KoolbaseNotFoundError(message));
          case 401:
            return attach(new errors_1.KoolbaseUnauthenticatedError(message));
          case 403:
            return attach(new KoolbasePermissionError(message));
          case 429:
            return attach(new KoolbaseRateLimitError(message));
          case 400:
            return attach(new KoolbaseValidationError(message));
        }
        return attach(new KoolbaseDataError(message, code));
      }
    }
  });

  // packages/core/dist/storage-errors.js
  var require_storage_errors = __commonJS({
    "packages/core/dist/storage-errors.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.KoolbaseStorageMetadataInvalidError = exports.KoolbaseStorageMimeTypeError = exports.KoolbaseStorageFileTooLargeError = exports.KoolbaseStorageQuotaError = exports.KoolbaseStoragePermissionError = exports.KoolbaseStorageValidationError = exports.KoolbaseStorageNotFoundError = exports.KoolbaseStorageConflictError = exports.KoolbaseStorageError = void 0;
      exports.koolbaseStorageError = koolbaseStorageError;
      exports.koolbaseStorageErrorFromResponse = koolbaseStorageErrorFromResponse;
      var errors_1 = require_errors();
      var KoolbaseStorageError = class _KoolbaseStorageError extends errors_1.KoolbaseError {
        constructor(message, code) {
          super(message, code);
          this.name = "KoolbaseStorageError";
          Object.setPrototypeOf(this, _KoolbaseStorageError.prototype);
        }
      };
      exports.KoolbaseStorageError = KoolbaseStorageError;
      var KoolbaseStorageConflictError = class _KoolbaseStorageConflictError extends KoolbaseStorageError {
        constructor(message, path) {
          super(message ?? "An object already exists at this path", "path_conflict");
          this.path = path;
          this.name = "KoolbaseStorageConflictError";
          Object.setPrototypeOf(this, _KoolbaseStorageConflictError.prototype);
        }
      };
      exports.KoolbaseStorageConflictError = KoolbaseStorageConflictError;
      var KoolbaseStorageNotFoundError = class _KoolbaseStorageNotFoundError extends KoolbaseStorageError {
        constructor(message) {
          super(message ?? "The requested bucket or object was not found", "not_found");
          this.name = "KoolbaseStorageNotFoundError";
          Object.setPrototypeOf(this, _KoolbaseStorageNotFoundError.prototype);
        }
      };
      exports.KoolbaseStorageNotFoundError = KoolbaseStorageNotFoundError;
      var KoolbaseStorageValidationError = class _KoolbaseStorageValidationError extends KoolbaseStorageError {
        constructor(message) {
          super(message ?? "The storage request was invalid", "validation_error");
          this.name = "KoolbaseStorageValidationError";
          Object.setPrototypeOf(this, _KoolbaseStorageValidationError.prototype);
        }
      };
      exports.KoolbaseStorageValidationError = KoolbaseStorageValidationError;
      var KoolbaseStoragePermissionError = class _KoolbaseStoragePermissionError extends KoolbaseStorageError {
        constructor(message) {
          super(message ?? "You do not have permission to perform this storage action", "permission_denied");
          this.name = "KoolbaseStoragePermissionError";
          Object.setPrototypeOf(this, _KoolbaseStoragePermissionError.prototype);
        }
      };
      exports.KoolbaseStoragePermissionError = KoolbaseStoragePermissionError;
      var KoolbaseStorageQuotaError = class _KoolbaseStorageQuotaError extends KoolbaseStorageError {
        constructor(message) {
          super(message ?? "Bucket quota exceeded", "quota_exceeded");
          this.name = "KoolbaseStorageQuotaError";
          Object.setPrototypeOf(this, _KoolbaseStorageQuotaError.prototype);
        }
      };
      exports.KoolbaseStorageQuotaError = KoolbaseStorageQuotaError;
      var KoolbaseStorageFileTooLargeError = class _KoolbaseStorageFileTooLargeError extends KoolbaseStorageError {
        constructor(message) {
          super(message ?? "File exceeds the bucket maximum file size", "file_too_large");
          this.name = "KoolbaseStorageFileTooLargeError";
          Object.setPrototypeOf(this, _KoolbaseStorageFileTooLargeError.prototype);
        }
      };
      exports.KoolbaseStorageFileTooLargeError = KoolbaseStorageFileTooLargeError;
      var KoolbaseStorageMimeTypeError = class _KoolbaseStorageMimeTypeError extends KoolbaseStorageError {
        constructor(message) {
          super(message ?? "Content-type not allowed for this bucket", "mime_not_allowed");
          this.name = "KoolbaseStorageMimeTypeError";
          Object.setPrototypeOf(this, _KoolbaseStorageMimeTypeError.prototype);
        }
      };
      exports.KoolbaseStorageMimeTypeError = KoolbaseStorageMimeTypeError;
      var KoolbaseStorageMetadataInvalidError = class _KoolbaseStorageMetadataInvalidError extends KoolbaseStorageError {
        constructor(message, detail) {
          super(message ?? "Metadata payload is invalid", "metadata_invalid");
          this.detail = detail;
          this.name = "KoolbaseStorageMetadataInvalidError";
          Object.setPrototypeOf(this, _KoolbaseStorageMetadataInvalidError.prototype);
        }
      };
      exports.KoolbaseStorageMetadataInvalidError = KoolbaseStorageMetadataInvalidError;
      function koolbaseStorageError(status, body, fallbackMessage = "Storage request failed") {
        const code = body?.code;
        const message = body?.error ?? fallbackMessage;
        switch (code) {
          case "path_conflict":
            return new KoolbaseStorageConflictError(message, body?.path);
          case "quota_exceeded":
            return new KoolbaseStorageQuotaError(message);
          case "file_too_large":
            return new KoolbaseStorageFileTooLargeError(message);
          case "mime_not_allowed":
            return new KoolbaseStorageMimeTypeError(message);
          case "metadata_invalid":
            return new KoolbaseStorageMetadataInvalidError(message, body?.detail);
        }
        switch (status) {
          case 409:
            return new KoolbaseStorageConflictError(message);
          case 413:
            return new KoolbaseStorageFileTooLargeError(message);
          case 415:
            return new KoolbaseStorageMimeTypeError(message);
          case 404:
            return new KoolbaseStorageNotFoundError(message);
          case 401:
            return new errors_1.KoolbaseUnauthenticatedError(message);
          case 403:
            return new KoolbaseStoragePermissionError(message);
          case 400:
            return new KoolbaseStorageValidationError(message);
        }
        return new KoolbaseStorageError(message, code);
      }
      async function koolbaseStorageErrorFromResponse(res, fallbackMessage = "Storage request failed") {
        let body = {};
        try {
          body = await res.json();
        } catch (_) {
        }
        return koolbaseStorageError(res.status, body, fallbackMessage);
      }
    }
  });

  // packages/core/dist/platform.js
  var require_platform = __commonJS({
    "packages/core/dist/platform.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.memoryPlatform = memoryPlatform;
      exports.setPlatform = setPlatform2;
      exports.getPlatform = getPlatform2;
      function memoryPlatform() {
        const store = /* @__PURE__ */ new Map();
        return {
          storage: {
            getItem: async (k) => store.get(k) ?? null,
            setItem: async (k, v) => {
              store.set(k, v);
            },
            removeItem: async (k) => {
              store.delete(k);
            },
            getAllKeys: async () => Array.from(store.keys())
          },
          network: {
            onChange: () => () => {
            }
          },
          lifecycle: {
            onBackground: () => () => {
            }
          },
          info: { os: "memory", version: "" },
          authStorage: () => null
        };
      }
      var current = memoryPlatform();
      function setPlatform2(adapter) {
        current = adapter;
      }
      function getPlatform2() {
        return current;
      }
    }
  });

  // packages/core/dist/device-metadata.js
  var require_device_metadata = __commonJS({
    "packages/core/dist/device-metadata.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.DeviceMetadata = exports.koolbaseSdkVersion = void 0;
      var platform_1 = require_platform();
      exports.koolbaseSdkVersion = "1.11.0";
      function generateDeviceLabel() {
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = Math.random() * 16 | 0;
          const v = c === "x" ? r : r & 3 | 8;
          return v.toString(16);
        });
      }
      var DeviceMetadata = class {
        constructor(appVersion) {
          this.cached = null;
          this.ephemeralLabel = null;
          this.appVersion = appVersion ?? "unknown";
        }
        /**
         * Build (or return cached) device headers. The first call may perform
         * an async keychain read to look up the persisted device label;
         * subsequent calls return the in-memory cache synchronously via the
         * returned Promise.
         */
        async build() {
          if (this.cached)
            return this.cached;
          const platform = (0, platform_1.getPlatform)().info.os;
          const platformVersion = (0, platform_1.getPlatform)().info.version;
          const deviceLabel = await this.getOrCreateDeviceLabel();
          const userAgent = `koolbase-react-native/${exports.koolbaseSdkVersion} (${platform} ${platformVersion})`;
          this.cached = {
            "User-Agent": userAgent,
            "x-koolbase-sdk": "react-native",
            "x-koolbase-sdk-version": exports.koolbaseSdkVersion,
            "x-koolbase-platform": platform,
            "x-koolbase-platform-version": platformVersion,
            "x-koolbase-app-version": this.appVersion,
            "x-koolbase-device-label": deviceLabel
          };
          return this.cached;
        }
        async getOrCreateDeviceLabel() {
          const key = "koolbase_device_label_v1";
          const storage = (0, platform_1.getPlatform)().storage;
          try {
            const existing = await storage.getItem(key);
            if (existing)
              return existing;
          } catch {
          }
          const newLabel = generateDeviceLabel();
          try {
            await storage.setItem(key, newLabel);
          } catch {
          }
          return newLabel;
        }
      };
      exports.DeviceMetadata = DeviceMetadata;
    }
  });

  // packages/core/dist/auth.js
  var require_auth = __commonJS({
    "packages/core/dist/auth.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.KoolbaseAuth = void 0;
      var types_1 = require_types();
      var auth_errors_1 = require_auth_errors();
      var platform_1 = require_platform();
      var device_metadata_1 = require_device_metadata();
      var KoolbaseAuth2 = class {
        constructor(config) {
          this.session = null;
          this.ongoingRefresh = null;
          this.listeners = /* @__PURE__ */ new Set();
          this.config = config;
          this.metadata = new device_metadata_1.DeviceMetadata(config.appVersion);
          this.fetchFn = config.fetch ?? ((url, init) => fetch(url, init));
          this.timeoutMs = config.authTimeout ?? 1e4;
          if (config.authStorage) {
            this.storage = config.authStorage;
          } else if ((0, platform_1.getPlatform)().authStorage()) {
            this.storage = (0, platform_1.getPlatform)().authStorage();
          } else {
            this.storage = null;
            console.warn("[Koolbase] No persistent auth storage available. Sessions will not survive app restarts. Install react-native-keychain for the default secure backend, or provide KoolbaseConfig.authStorage with your own implementation.");
          }
        }
        // ─── Auth state listener ────────────────────────────────────────────────
        /**
         * Subscribe to authentication state changes. The listener fires:
         * - Immediately on subscribe, with the current user (or null).
         * - On every successful login, register, refresh, session restoration.
         * - On logout / explicit setSession(null).
         * - On linkPhone success (user object updated with phone fields).
         *
         * Returns an unsubscribe function. Call it when the consumer no longer
         * needs updates (e.g. in a React useEffect cleanup).
         *
         * Listener errors are swallowed so a buggy listener can't break auth
         * state propagation to other listeners.
         *
         * @example
         * const unsubscribe = auth.onAuthStateChange((user) => {
         *   setCurrentUser(user);
         * });
         * // later:
         * unsubscribe();
         */
        onAuthStateChange(listener) {
          this.listeners.add(listener);
          try {
            listener(this.session?.user ?? null);
          } catch {
          }
          return () => {
            this.listeners.delete(listener);
          };
        }
        fireAuthStateChange() {
          const user = this.session?.user ?? null;
          for (const listener of this.listeners) {
            try {
              listener(user);
            } catch {
            }
          }
        }
        // ─── Headers ────────────────────────────────────────────────────────────
        /**
         * Compose the full header set for an outbound request: base headers,
         * device metadata, and optionally the Authorization bearer token.
         * Async because device metadata's first build may read from keychain.
         */
        async prepareHeaders(includeAuth) {
          const deviceHeaders = await this.metadata.build();
          return {
            "Content-Type": "application/json",
            "x-api-key": this.config.publicKey,
            ...deviceHeaders,
            ...includeAuth && this.session ? { Authorization: `Bearer ${this.session.accessToken}` } : {}
          };
        }
        // ─── Request plumbing ───────────────────────────────────────────────────
        /**
         * Low-level request helper used by every endpoint. Wires together:
         * - The injected fetch implementation (config.fetch or global fetch)
         * - Device metadata + x-api-key + auth header in one place
         * - AbortController-based timeout (config.authTimeout, default 10s)
         *
         * On timeout, fetch rejects with an AbortError; callers see this as a
         * non-KoolbaseAuthError exception, which restoreSession() treats as
         * Offline (preserving optimistic state).
         */
        async authRequest(path, options = {}) {
          const headers = await this.prepareHeaders(options.includeAuth ?? false);
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), this.timeoutMs);
          try {
            return await this.fetchFn(`${this.config.baseUrl}${path}`, {
              method: options.method ?? "GET",
              headers,
              body: options.body !== void 0 ? JSON.stringify(options.body) : void 0,
              signal: controller.signal
            });
          } finally {
            clearTimeout(timer);
          }
        }
        /**
         * Authenticated request wrapper. Refreshes the access token if it's
         * stale (within 1-min buffer of expiry) before issuing the call, then
         * delegates to {@link authRequest} with includeAuth=true.
         */
        async authedRequest(path, options = {}) {
          await this._ensureValidToken();
          return this.authRequest(path, { ...options, includeAuth: true });
        }
        // ─── Internal session lifecycle ─────────────────────────────────────────
        async setSessionInternal(session) {
          this.session = session;
          if (this.storage) {
            try {
              await this.storage.saveSession(session);
            } catch (err) {
              console.warn("[Koolbase] Failed to persist session; staying signed in for this session only:", err);
            }
          }
          this.fireAuthStateChange();
        }
        /**
         * Discards the stored session without contacting the server.
         *
         * For when the session is already known to be unusable — the server rejected
         * the token, or a build was pointed at a different project and the persisted
         * session belongs to the old one. Unlike `logout()` there is no server call:
         * the token has already been refused, and asking for it to be revoked would
         * only add a round trip that cannot succeed.
         *
         * Safe in any state, including with no session at all. The SDK calls this
         * itself when a request is rejected as unauthenticated, so most apps will not
         * need to.
         */
        async clearStoredSession() {
          await this.clearSessionInternal();
        }
        async clearSessionInternal() {
          this.session = null;
          if (this.storage) {
            try {
              await this.storage.clear();
            } catch {
            }
          }
          this.fireAuthStateChange();
        }
        // ─── Session restoration ────────────────────────────────────────────────
        async restoreSession() {
          if (!this.storage)
            return types_1.RestoreResult.NoSession;
          const persisted = await this.storage.readSession();
          if (!persisted)
            return types_1.RestoreResult.NoSession;
          this.session = persisted;
          this.fireAuthStateChange();
          const expiresAt = persisted.expiresAt ? new Date(persisted.expiresAt).getTime() : 0;
          const oneMinuteMs = 60 * 1e3;
          if (expiresAt > Date.now() + oneMinuteMs) {
            return types_1.RestoreResult.Restored;
          }
          try {
            await this.refresh(persisted.refreshToken);
            return types_1.RestoreResult.Restored;
          } catch (e) {
            if (e instanceof auth_errors_1.SessionExpiredError || e instanceof auth_errors_1.TokenRevokedError || e instanceof auth_errors_1.InvalidCredentialsError) {
              await this.clearSessionInternal();
              return types_1.RestoreResult.Expired;
            }
            return types_1.RestoreResult.Offline;
          }
        }
        // ─── Public auth API ────────────────────────────────────────────────────
        async register(params) {
          if (params.password.length < 8)
            throw new auth_errors_1.WeakPasswordError();
          const res = await this.authRequest("/v1/sdk/auth/register", {
            method: "POST",
            body: params
          });
          const session = await this.parseSessionResponse(res, false);
          await this.setSessionInternal(session);
          return session.user;
        }
        async login(params) {
          const res = await this.authRequest("/v1/sdk/auth/login", {
            method: "POST",
            body: params
          });
          const session = await this.parseSessionResponse(res, false);
          await this.setSessionInternal(session);
          return session;
        }
        /**
        * Sign in with Apple using a credential obtained from a native Apple
        * Sign-In SDK.
        *
        * The SDK is library-agnostic — use any native Apple Sign-In package
        * (`@invertase/react-native-apple-authentication`, etc.) and pass the
        * resulting `identityToken`, optional `nonce`, and optional `fullName`.
        *
        * `fullName` is meaningful only on first sign-in — Apple omits name
        * data on subsequent sign-ins. The server persists at link time and
        * ignores on subsequent sign-ins.
        *
        * On success the session is persisted via the configured storage and
        * `onAuthStateChange` fires with the resolved user.
        *
        * @throws AppleSignInNotConfiguredError when Apple is not enabled in
        *   the dashboard OAuth config for this environment (400).
        * @throws InvalidAppleTokenError when the token signature, audience,
        *   expiry, replay, or nonce check failed server-side (401).
        * @throws UserDisabledError when the account flag is set to disabled (403).
        * @throws AppleEmailRequiredError when Apple did not return email for
        *   a new-account sign-in (400).
        * @throws OAuthEmailConflictError when email matches existing user
        *   but auto-link rule blocked (409).
        */
        async signInWithApple(params) {
          const body = {
            identity_token: params.identityToken
          };
          if (params.nonce && params.nonce.length > 0) {
            body.nonce = params.nonce;
          }
          if (params.fullName) {
            const nameJson = {};
            if (params.fullName.givenName)
              nameJson.given_name = params.fullName.givenName;
            if (params.fullName.familyName)
              nameJson.family_name = params.fullName.familyName;
            if (Object.keys(nameJson).length > 0) {
              body.full_name = nameJson;
            }
          }
          const res = await this.authRequest("/v1/sdk/auth/oauth/apple", {
            method: "POST",
            body
          });
          const session = await this.parseAppleSessionResponse(res);
          await this.setSessionInternal(session);
          return session;
        }
        /**
         * Sign in with Google using an idToken from a native Google Sign-In SDK.
         *
         * The SDK is library-agnostic — use any native Google Sign-In package
         * (`@react-native-google-signin/google-signin`, etc.) and pass the
         * resulting `idToken`. Google embeds the user's name and email in the
         * idToken itself, so this method does not take a `fullName` parameter
         * (unlike `signInWithApple`).
         *
         * On success the session is persisted via the configured storage and
         * `onAuthStateChange` fires with the resolved user.
         *
         * @throws GoogleSignInNotConfiguredError when Google is not enabled
         *   in the OAuth config for this environment (400).
         * @throws InvalidGoogleTokenError when the token signature, audience,
         *   expiry, replay, or nonce check failed server-side (401).
         * @throws UserDisabledError when the account flag is set to disabled (403).
         * @throws GoogleEmailRequiredError when Google did not return email
         *   for a new-account sign-in (400).
         * @throws OAuthEmailConflictError when email matches existing user
         *   but auto-link rule blocked (409).
         */
        async signInWithGoogle(params) {
          const body = {
            identity_token: params.idToken
          };
          if (params.nonce && params.nonce.length > 0) {
            body.nonce = params.nonce;
          }
          const res = await this.authRequest("/v1/sdk/auth/oauth/google", {
            method: "POST",
            body
          });
          const session = await this.parseGoogleSessionResponse(res);
          await this.setSessionInternal(session);
          return session;
        }
        /**
         * Parses a /v1/sdk/auth/oauth/google response. Code-first: the server
         * emits unified OAuth codes (oauth_not_configured, invalid_oauth_token,
         * oauth_email_required, oauth_email_conflict) for both providers; the
         * provider distinction is made here so Google codes map to Google-specific
         * errors. Status + message logic is retained as a fallback for older servers.
         */
        async parseGoogleSessionResponse(res) {
          if (res.status === 200) {
            const data = await res.json();
            return {
              accessToken: data.access_token,
              refreshToken: data.refresh_token,
              expiresAt: data.expires_at,
              user: this.mapUser(data.user)
            };
          }
          let body = {};
          try {
            body = await res.json();
          } catch {
          }
          const code = body?.code ?? "";
          const errorMessage = body?.error ?? "";
          switch (code) {
            case "oauth_not_configured":
              throw new auth_errors_1.GoogleSignInNotConfiguredError();
            case "invalid_oauth_token":
              throw new auth_errors_1.InvalidGoogleTokenError();
            case "account_disabled":
              throw new auth_errors_1.UserDisabledError();
            case "oauth_email_required":
              throw new auth_errors_1.GoogleEmailRequiredError();
            case "oauth_email_conflict":
              throw new auth_errors_1.OAuthEmailConflictError();
            case "rate_limit":
              throw new auth_errors_1.RateLimitError(errorMessage || void 0);
          }
          if (res.status === 400) {
            if (errorMessage.includes("not configured")) {
              throw new auth_errors_1.GoogleSignInNotConfiguredError();
            }
            if (errorMessage.includes("did not return email")) {
              throw new auth_errors_1.GoogleEmailRequiredError();
            }
            throw new auth_errors_1.KoolbaseAuthError(`google sign-in failed: ${errorMessage}`, "google_signin_failed");
          }
          if (res.status === 401)
            throw new auth_errors_1.InvalidGoogleTokenError();
          if (res.status === 403)
            throw new auth_errors_1.UserDisabledError();
          if (res.status === 409)
            throw new auth_errors_1.OAuthEmailConflictError();
          if (res.status === 429)
            throw new auth_errors_1.RateLimitError(errorMessage);
          throw new auth_errors_1.KoolbaseAuthError(`google sign-in failed: ${res.status} ${errorMessage}`, `google_signin_http_${res.status}`);
        }
        /**
         * Parses a /v1/sdk/auth/oauth/apple response. Code-first; the provider
         * distinction is made here so the server's unified OAuth codes map to
         * Apple-specific errors. Status + message logic is retained as a fallback
         * for older servers.
         */
        async parseAppleSessionResponse(res) {
          if (res.status === 200) {
            const data = await res.json();
            return {
              accessToken: data.access_token,
              refreshToken: data.refresh_token,
              expiresAt: data.expires_at,
              user: this.mapUser(data.user)
            };
          }
          let body = {};
          try {
            body = await res.json();
          } catch {
          }
          const code = body?.code ?? "";
          const errorMessage = body?.error ?? "";
          switch (code) {
            case "oauth_not_configured":
              throw new auth_errors_1.AppleSignInNotConfiguredError();
            case "invalid_oauth_token":
              throw new auth_errors_1.InvalidAppleTokenError();
            case "account_disabled":
              throw new auth_errors_1.UserDisabledError();
            case "oauth_email_required":
              throw new auth_errors_1.AppleEmailRequiredError();
            case "oauth_email_conflict":
              throw new auth_errors_1.OAuthEmailConflictError();
            case "rate_limit":
              throw new auth_errors_1.RateLimitError(errorMessage || void 0);
          }
          if (res.status === 400) {
            if (errorMessage.includes("not configured")) {
              throw new auth_errors_1.AppleSignInNotConfiguredError();
            }
            if (errorMessage.includes("did not return email")) {
              throw new auth_errors_1.AppleEmailRequiredError();
            }
            throw new auth_errors_1.KoolbaseAuthError(`apple sign-in failed: ${errorMessage}`, "apple_signin_failed");
          }
          if (res.status === 401)
            throw new auth_errors_1.InvalidAppleTokenError();
          if (res.status === 403)
            throw new auth_errors_1.UserDisabledError();
          if (res.status === 409)
            throw new auth_errors_1.OAuthEmailConflictError();
          if (res.status === 429)
            throw new auth_errors_1.RateLimitError(errorMessage);
          throw new auth_errors_1.KoolbaseAuthError(`apple sign-in failed: ${res.status} ${errorMessage}`, `apple_signin_http_${res.status}`);
        }
        async refresh(refreshToken) {
          if (this.ongoingRefresh) {
            return this.ongoingRefresh;
          }
          const promise = this._doRefresh(refreshToken);
          this.ongoingRefresh = promise;
          promise.catch(() => {
          }).finally(() => {
            if (this.ongoingRefresh === promise) {
              this.ongoingRefresh = null;
            }
          });
          return promise;
        }
        async _doRefresh(refreshToken) {
          const token = refreshToken ?? this.session?.refreshToken;
          if (!token) {
            throw new auth_errors_1.SessionExpiredError();
          }
          const res = await this.authRequest("/v1/sdk/auth/refresh", {
            method: "POST",
            body: { refresh_token: token }
          });
          const session = await this.parseSessionResponse(res, true);
          await this.setSessionInternal(session);
          return session;
        }
        async logout() {
          let serverSucceeded = true;
          try {
            if (this.session) {
              const res = await this.authRequest("/v1/sdk/auth/logout", {
                method: "POST",
                includeAuth: true
              });
              if (!res.ok)
                serverSucceeded = false;
            }
          } catch {
            serverSucceeded = false;
          } finally {
            await this.clearSessionInternal();
          }
          return serverSucceeded;
        }
        async forgotPassword(email) {
          const res = await this.authRequest("/v1/sdk/auth/password-reset", {
            method: "POST",
            body: { email }
          });
          await this.checkResponse(res);
        }
        async resetPassword(token, password) {
          const res = await this.authRequest("/v1/sdk/auth/password-reset/confirm", {
            method: "POST",
            body: { token, password }
          });
          await this.checkResponse(res);
        }
        async unlock(token) {
          const res = await this.authRequest("/v1/sdk/auth/unlock", {
            method: "POST",
            body: { token }
          });
          await this.checkResponse(res);
        }
        get currentUser() {
          return this.session?.user ?? null;
        }
        get accessToken() {
          return this.session?.accessToken ?? null;
        }
        /**
         * Currently-valid access token for data-plane requests, refreshing
         * (via refresh()) if the cached one is near expiry. Returns null when no
         * session exists or refresh fails — callers then go api-key-only and the
         * server treats it as having no end-user identity. The db/storage/functions
         * clients pull from this per request so identity follows the live session.
         */
        async validAccessToken() {
          if (!this.session)
            return null;
          try {
            return await this._ensureValidToken();
          } catch {
            return null;
          }
        }
        async setSession(session) {
          if (session) {
            await this.setSessionInternal(session);
          } else {
            await this.clearSessionInternal();
          }
        }
        // ─── OAuth (DEPRECATED — see v1.10.0) ───────────────────────────────────
        /**
         * @deprecated v1.9.0: Server endpoint /v1/sdk/auth/oauth not yet
         * shipped. This method previously routed to /v1/auth/oauth (dashboard
         * developer OAuth) which never created project-scoped end-user
         * sessions. Properly implemented in v1.10.0 with provider-specific
         * server endpoints under /v1/sdk/auth/oauth/{apple,google,github}.
         * Use email/password sign-in for now.
         *
         * @throws Always throws KoolbaseAuthError('not_implemented').
         */
        async oauthLogin(_params) {
          throw new auth_errors_1.KoolbaseAuthError("OAuth sign-in is not yet implemented for the Koolbase SDK. Planned for v1.10.0 (server-side endpoints under /v1/sdk/auth/oauth/{provider}). Use email/password authentication in the meantime.", "not_implemented");
        }
        // ─── Phone OTP ──────────────────────────────────────────────────────────
        async sendOtp(params) {
          this.validatePhone(params.phoneNumber);
          const res = await this.authRequest("/v1/sdk/auth/phone/send-otp", {
            method: "POST",
            body: { phone_number: params.phoneNumber }
          });
          const data = await this.parsePhoneResponse(res);
          return { expiresAt: data.expires_at };
        }
        async verifyOtp(params) {
          this.validatePhone(params.phoneNumber);
          const res = await this.authRequest("/v1/sdk/auth/phone/verify-otp", {
            method: "POST",
            body: {
              phone_number: params.phoneNumber,
              code: params.code
            }
          });
          const data = await this.parsePhoneResponse(res);
          const session = {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: data.expires_at,
            user: this.mapUser(data.user)
          };
          await this.setSessionInternal(session);
          return { session, isNewUser: data.is_new_user ?? false };
        }
        async linkPhone(params) {
          if (!this.session) {
            throw new auth_errors_1.KoolbaseAuthError("Must be signed in to link a phone number", "unauthenticated");
          }
          this.validatePhone(params.phoneNumber);
          const res = await this.authedRequest("/v1/sdk/auth/phone/link", {
            method: "POST",
            body: {
              phone_number: params.phoneNumber,
              code: params.code
            }
          });
          const body = await this.parsePhoneResponse(res);
          if (this.session) {
            const updatedUser = body.user ? this.mapUser(body.user) : {
              ...this.session.user,
              phoneNumber: params.phoneNumber,
              phoneVerified: true
            };
            await this.setSessionInternal({
              ...this.session,
              user: updatedUser
            });
          }
        }
        // ─── Cleanup ────────────────────────────────────────────────────────────
        /**
         * Release resources held by this auth client. Clears the in-memory
         * listener set. Does not invalidate sessions or clear storage — call
         * {@link logout} for that.
         */
        dispose() {
          this.listeners.clear();
        }
        // ─── Helpers ────────────────────────────────────────────────────────────
        validatePhone(phoneNumber) {
          if (!/^\+[1-9]\d{6,14}$/.test(phoneNumber)) {
            throw new auth_errors_1.InvalidPhoneNumberError();
          }
        }
        async _ensureValidToken() {
          if (this.session && this.session.expiresAt) {
            const expiresAt = new Date(this.session.expiresAt).getTime();
            if (Date.now() < expiresAt - 60 * 1e3) {
              return this.session.accessToken;
            }
          }
          if (!this.session) {
            throw new auth_errors_1.SessionExpiredError();
          }
          try {
            const session = await this.refresh();
            return session.accessToken;
          } catch (e) {
            if (e instanceof auth_errors_1.KoolbaseAuthError)
              throw e;
            throw new auth_errors_1.SessionExpiredError();
          }
        }
        mapUser(raw) {
          return {
            id: raw.id,
            email: raw.email ?? "",
            phoneNumber: raw.phone_number,
            phoneVerified: raw.phone_verified ?? false,
            fullName: raw.full_name,
            avatarUrl: raw.avatar_url,
            verified: raw.verified ?? false,
            createdAt: raw.created_at
          };
        }
        /**
         * Parse a session-returning response (login, register, refresh).
         * Non-2xx is delegated to throwTypedError, which is code-first
         * (reads body.code) with a status/message fallback. isRefresh only
         * affects how a bare 401 (no code, older server) is interpreted.
         */
        async parseSessionResponse(res, isRefresh) {
          if (!res.ok)
            await this.throwTypedError(res, isRefresh);
          const data = await res.json();
          return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: data.expires_at,
            user: this.mapUser(data.user)
          };
        }
        async checkResponse(res) {
          if (res.ok)
            return;
          await this.throwTypedError(res);
        }
        /**
         * Map a non-2xx credential/session response to a typed error.
         *
         * Code-first: the server now emits a stable `code` on every error
         * (contract conformance), so we switch on body.code. The status +
         * message logic is retained as a fallback for older servers or any
         * response that arrives without a code. isRefresh only changes how a
         * bare 401 is interpreted in the fallback path.
         */
        async throwTypedError(res, isRefresh = false) {
          let body = {};
          try {
            body = await res.json();
          } catch {
          }
          const code = body.code ?? "";
          const msg = body.error ?? "";
          switch (code) {
            case "invalid_credentials":
              throw new auth_errors_1.InvalidCredentialsError();
            case "email_in_use":
              throw new auth_errors_1.EmailAlreadyInUseError();
            case "account_disabled":
              throw new auth_errors_1.UserDisabledError();
            case "account_locked":
              throw new auth_errors_1.AccountLockedError();
            case "invalid_refresh_token":
              throw new auth_errors_1.SessionExpiredError();
            case "token_revoked":
              throw new auth_errors_1.TokenRevokedError();
            case "invalid_unlock_token":
              throw new auth_errors_1.UnlockTokenInvalidError();
            case "rate_limit":
              throw new auth_errors_1.RateLimitError(msg || void 0);
          }
          if (res.status === 409)
            throw new auth_errors_1.EmailAlreadyInUseError();
          if (res.status === 401) {
            throw isRefresh ? new auth_errors_1.SessionExpiredError() : new auth_errors_1.InvalidCredentialsError();
          }
          if (res.status === 403)
            throw new auth_errors_1.UserDisabledError();
          if (res.status === 429) {
            if (msg.includes("account temporarily locked")) {
              throw new auth_errors_1.AccountLockedError();
            }
            throw new auth_errors_1.RateLimitError(msg || void 0);
          }
          if (msg.includes("invalid or expired unlock token")) {
            throw new auth_errors_1.UnlockTokenInvalidError();
          }
          if (msg.includes("session revoked") || msg.includes("token revoked") || msg.includes("session has been revoked")) {
            throw new auth_errors_1.TokenRevokedError();
          }
          throw new auth_errors_1.KoolbaseAuthError(msg || `Request failed: ${res.status}`, code || `http_${res.status}`);
        }
        /**
         * Parse a phone-auth response. Code-first, with a phone-specific twist:
         * the server emits the generic `rate_limit` code for the phone endpoints
         * (they share the default 429), but phone has a dedicated server-side
         * rate-limiter, so we surface OtpRateLimitError rather than RateLimitError.
         * Status + message logic is retained as a fallback for older servers.
         */
        async parsePhoneResponse(res) {
          let body = {};
          try {
            body = await res.json();
          } catch {
          }
          if (res.ok)
            return body;
          const code = body.code ?? "";
          const msg = body.error ?? "";
          switch (code) {
            case "invalid_phone":
              throw new auth_errors_1.InvalidPhoneNumberError();
            case "otp_expired":
              throw new auth_errors_1.OtpExpiredError();
            case "otp_invalid":
              throw new auth_errors_1.OtpInvalidError();
            case "otp_max_attempts":
              throw new auth_errors_1.OtpMaxAttemptsError();
            case "phone_in_use":
              throw new auth_errors_1.PhoneAlreadyLinkedError();
            case "sms_not_configured":
              throw new auth_errors_1.SmsConfigMissingError();
            case "rate_limit":
              throw new auth_errors_1.OtpRateLimitError();
          }
          if (res.status === 429)
            throw new auth_errors_1.OtpRateLimitError();
          if (res.status === 409)
            throw new auth_errors_1.PhoneAlreadyLinkedError();
          if (msg.includes("E.164"))
            throw new auth_errors_1.InvalidPhoneNumberError();
          if (msg.includes("OTP has expired"))
            throw new auth_errors_1.OtpExpiredError();
          if (msg.includes("too many incorrect attempts")) {
            throw new auth_errors_1.OtpMaxAttemptsError();
          }
          if (msg.includes("invalid OTP") || msg.includes("invalid or expired OTP")) {
            throw new auth_errors_1.OtpInvalidError();
          }
          if (msg.includes("SMS provider not configured")) {
            throw new auth_errors_1.SmsConfigMissingError();
          }
          throw new auth_errors_1.KoolbaseAuthError(msg || "An unexpected error occurred", code || void 0);
        }
      };
      exports.KoolbaseAuth = KoolbaseAuth2;
    }
  });

  // packages/core/dist/cache-store.js
  var require_cache_store = __commonJS({
    "packages/core/dist/cache-store.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.hashQuery = hashQuery;
      exports.getCached = getCached;
      exports.setCached = setCached;
      exports.invalidateCache = invalidateCache;
      exports.clearUserCache = clearUserCache;
      exports.getCachedRecord = getCachedRecord;
      exports.cacheRecord = cacheRecord;
      exports.removeCachedRecord = removeCachedRecord;
      exports.getWriteQueue = getWriteQueue;
      exports.addToWriteQueue = addToWriteQueue;
      exports.removeFromWriteQueue = removeFromWriteQueue;
      exports.incrementWriteRetry = incrementWriteRetry;
      exports.optimisticallyInsert = optimisticallyInsert;
      var platform_1 = require_platform();
      var CACHE_VERSION = "v1";
      function cacheKey(userId, collection, queryHash) {
        return `koolbase:${CACHE_VERSION}:${userId}:${collection}:${queryHash}`;
      }
      function writeQueueKey(userId) {
        return `koolbase:${CACHE_VERSION}:${userId}:write_queue`;
      }
      function hashQuery(collection, options) {
        return `${collection}:${JSON.stringify(options)}`;
      }
      async function getCached(userId, collection, queryHash) {
        try {
          const raw = await (0, platform_1.getPlatform)().storage.getItem(cacheKey(userId, collection, queryHash));
          if (!raw)
            return null;
          return JSON.parse(raw);
        } catch {
          return null;
        }
      }
      async function setCached(userId, collection, queryHash, result) {
        try {
          await (0, platform_1.getPlatform)().storage.setItem(cacheKey(userId, collection, queryHash), JSON.stringify(result));
        } catch {
        }
      }
      async function invalidateCache(userId, collection) {
        try {
          const keys = await (0, platform_1.getPlatform)().storage.getAllKeys();
          const prefix = `koolbase:${CACHE_VERSION}:${userId}:${collection}:`;
          const toDelete = keys.filter((k) => k.startsWith(prefix));
          for (const key of toDelete) {
            await (0, platform_1.getPlatform)().storage.removeItem(key);
          }
        } catch {
        }
      }
      async function clearUserCache(userId) {
        try {
          const keys = await (0, platform_1.getPlatform)().storage.getAllKeys();
          const prefix = `koolbase:${CACHE_VERSION}:${userId}:`;
          const queueKey = writeQueueKey(userId);
          const toDelete = keys.filter((k) => k.startsWith(prefix) && k !== queueKey);
          for (const key of toDelete) {
            await (0, platform_1.getPlatform)().storage.removeItem(key);
          }
        } catch {
        }
      }
      function recordCacheKey(userId, recordId) {
        return `koolbase:${CACHE_VERSION}:${userId}:record:${recordId}`;
      }
      async function getCachedRecord(userId, recordId) {
        try {
          const raw = await (0, platform_1.getPlatform)().storage.getItem(recordCacheKey(userId, recordId));
          return raw ? JSON.parse(raw) : null;
        } catch {
          return null;
        }
      }
      async function cacheRecord(userId, collection, recordId, data, revision) {
        try {
          const existing = await getCachedRecord(userId, recordId);
          if (existing?.revision !== void 0 && revision !== void 0 && revision < existing.revision) {
            return;
          }
          const entry = {
            collection,
            data,
            revision,
            cachedAt: (/* @__PURE__ */ new Date()).toISOString()
          };
          await (0, platform_1.getPlatform)().storage.setItem(recordCacheKey(userId, recordId), JSON.stringify(entry));
        } catch {
        }
      }
      async function removeCachedRecord(userId, recordId) {
        try {
          await (0, platform_1.getPlatform)().storage.removeItem(recordCacheKey(userId, recordId));
        } catch {
        }
      }
      async function getWriteQueue(userId) {
        try {
          const raw = await (0, platform_1.getPlatform)().storage.getItem(writeQueueKey(userId));
          if (!raw)
            return [];
          return JSON.parse(raw);
        } catch {
          return [];
        }
      }
      async function addToWriteQueue(userId, write) {
        try {
          const queue = await getWriteQueue(userId);
          queue.push({ ...write, retries: 0, createdAt: (/* @__PURE__ */ new Date()).toISOString() });
          await (0, platform_1.getPlatform)().storage.setItem(writeQueueKey(userId), JSON.stringify(queue));
        } catch {
        }
      }
      async function removeFromWriteQueue(userId, writeId) {
        try {
          const queue = await getWriteQueue(userId);
          const updated = queue.filter((w) => w.id !== writeId);
          await (0, platform_1.getPlatform)().storage.setItem(writeQueueKey(userId), JSON.stringify(updated));
        } catch {
        }
      }
      async function incrementWriteRetry(userId, writeId) {
        try {
          const queue = await getWriteQueue(userId);
          const updated = queue.map((w) => w.id === writeId ? { ...w, retries: w.retries + 1 } : w);
          const filtered = updated.filter((w) => w.retries <= 3);
          await (0, platform_1.getPlatform)().storage.setItem(writeQueueKey(userId), JSON.stringify(filtered));
        } catch {
        }
      }
      async function optimisticallyInsert(userId, collection, record) {
        try {
          const keys = await (0, platform_1.getPlatform)().storage.getAllKeys();
          const prefix = `koolbase:${CACHE_VERSION}:${userId}:${collection}:`;
          const collectionKeys = keys.filter((k) => k.startsWith(prefix));
          for (const key of collectionKeys) {
            const raw = await (0, platform_1.getPlatform)().storage.getItem(key);
            if (!raw)
              continue;
            const cached = JSON.parse(raw);
            cached.records = [record, ...cached.records];
            cached.total = cached.total + 1;
            await (0, platform_1.getPlatform)().storage.setItem(key, JSON.stringify(cached));
          }
        } catch {
        }
      }
    }
  });

  // packages/core/dist/offline-state.js
  var require_offline_state = __commonJS({
    "packages/core/dist/offline-state.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.OfflineStateTooLargeError = void 0;
      exports.recordKey = recordKey;
      exports.readOfflineState = readOfflineState;
      exports.mutateOfflineState = mutateOfflineState;
      exports.queueWrite = queueWrite;
      exports.migrateLegacyQueue = migrateLegacyQueue;
      var platform_1 = require_platform();
      var VERSION = "v1";
      function stateKey(userId) {
        return `koolbase:${VERSION}:${userId}:offline-state`;
      }
      function recordKey(userId, collection, recordId) {
        return `koolbase:${VERSION}:${userId}:record:${collection}:${recordId}`;
      }
      var EMPTY = { pending: [], conflicts: [] };
      var MAX_STATE_BYTES = 1e6;
      var OfflineStateTooLargeError = class extends Error {
        constructor(bytes) {
          super(`Offline state is ${bytes} bytes, above the ${MAX_STATE_BYTES} byte limit. Sync or resolve what is queued before making more offline changes.`);
          this.name = "OfflineStateTooLargeError";
          Object.setPrototypeOf(this, new.target.prototype);
        }
      };
      exports.OfflineStateTooLargeError = OfflineStateTooLargeError;
      function byteLength(s) {
        if (typeof TextEncoder !== "undefined") {
          return new TextEncoder().encode(s).length;
        }
        let bytes = 0;
        for (let i = 0; i < s.length; i++) {
          const c = s.codePointAt(i);
          if (c > 65535)
            i++;
          bytes += c < 128 ? 1 : c < 2048 ? 2 : c < 65536 ? 3 : 4;
        }
        return bytes;
      }
      var locks = /* @__PURE__ */ new Map();
      async function withLock(userId, fn) {
        const previous = locks.get(userId) ?? Promise.resolve();
        let release = () => {
        };
        const next = new Promise((resolve) => {
          release = resolve;
        });
        locks.set(userId, previous.then(() => next));
        await previous;
        try {
          return await fn();
        } finally {
          release();
          if (locks.get(userId) === next)
            locks.delete(userId);
        }
      }
      async function readOfflineState(userId) {
        try {
          const raw = await (0, platform_1.getPlatform)().storage.getItem(stateKey(userId));
          if (!raw)
            return { ...EMPTY, pending: [], conflicts: [] };
          const parsed = JSON.parse(raw);
          return { pending: parsed.pending ?? [], conflicts: parsed.conflicts ?? [] };
        } catch {
          return { pending: [], conflicts: [] };
        }
      }
      async function mutateOfflineState(userId, mutate) {
        await withLock(userId, async () => {
          const state = await readOfflineState(userId);
          mutate(state);
          const serialised = JSON.stringify(state);
          const bytes = byteLength(serialised);
          if (bytes > MAX_STATE_BYTES) {
            throw new OfflineStateTooLargeError(bytes);
          }
          await (0, platform_1.getPlatform)().storage.setItem(stateKey(userId), serialised);
        });
      }
      async function queueWrite(userId, write) {
        await mutateOfflineState(userId, (state) => {
          state.pending.push({
            ...write,
            retries: 0,
            enqueuedAt: (/* @__PURE__ */ new Date()).toISOString()
          });
        });
      }
      var LEGACY_QUEUE_VERSION = "v1";
      function legacyQueueKey(userId) {
        return `koolbase:${LEGACY_QUEUE_VERSION}:${userId}:write_queue`;
      }
      async function migrateLegacyQueue(userId) {
        const raw = await (0, platform_1.getPlatform)().storage.getItem(legacyQueueKey(userId));
        if (!raw)
          return;
        let legacy = [];
        try {
          legacy = JSON.parse(raw);
        } catch {
          await (0, platform_1.getPlatform)().storage.removeItem(legacyQueueKey(userId));
          return;
        }
        await mutateOfflineState(userId, (state) => {
          for (const w of legacy) {
            const operation = w.type;
            if (operation === "insert") {
              state.pending.push({
                id: w.id,
                operation: "insert",
                collection: w.collection,
                recordId: w.recordId,
                data: w.data,
                retries: w.retries ?? 0,
                enqueuedAt: w.createdAt ?? (/* @__PURE__ */ new Date()).toISOString()
              });
              continue;
            }
            if (!w.recordId)
              continue;
            state.conflicts.push({
              id: w.id,
              reason: "baseline_unavailable",
              operation,
              collection: w.collection ?? "",
              recordId: w.recordId,
              local: w.data,
              createdAt: w.createdAt ?? (/* @__PURE__ */ new Date()).toISOString()
            });
          }
        });
        await (0, platform_1.getPlatform)().storage.removeItem(legacyQueueKey(userId));
      }
    }
  });

  // packages/core/dist/sync-engine.js
  var require_sync_engine = __commonJS({
    "packages/core/dist/sync-engine.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.SyncEngine = void 0;
      var offline_state_1 = require_offline_state();
      var errors_1 = require_errors();
      var platform_1 = require_platform();
      var cache_store_1 = require_cache_store();
      function isTerminal(status) {
        return status === 400 || status === 403 || status === 404 || status === 409;
      }
      var TerminalRejection = class extends Error {
        constructor(message, status) {
          super(message);
          this.status = status;
          Object.setPrototypeOf(this, new.target.prototype);
        }
      };
      var RevisionMismatch = class extends Error {
        constructor(serverRecord, serverRevision) {
          super("revision mismatch");
          this.serverRecord = serverRecord;
          this.serverRevision = serverRevision;
          Object.setPrototypeOf(this, new.target.prototype);
        }
      };
      var SyncEngine = class {
        constructor(config, getUserId, getToken, onSyncComplete, onSessionExpired) {
          this.isSyncing = false;
          this.config = config;
          this.getUserId = getUserId;
          this.getToken = getToken;
          this.onSyncComplete = onSyncComplete;
          this.onSessionExpired = onSessionExpired;
        }
        start() {
          this.unsubscribe = (0, platform_1.getPlatform)().network.onChange((online) => {
            if (online)
              this.flush();
          });
        }
        stop() {
          this.unsubscribe?.();
        }
        async flush() {
          if (this.isSyncing)
            return;
          const userId = this.getUserId();
          if (!userId)
            return;
          this.isSyncing = true;
          try {
            await (0, offline_state_1.migrateLegacyQueue)(userId);
            const { pending } = await (0, offline_state_1.readOfflineState)(userId);
            if (pending.length === 0)
              return;
            const blocked = /* @__PURE__ */ new Set();
            for (const queued of pending) {
              if (queued.recordId && blocked.has(queued.recordId))
                continue;
              const state = await (0, offline_state_1.readOfflineState)(userId);
              const write = state.pending.find((w) => w.id === queued.id);
              if (!write)
                continue;
              try {
                const revision = await this.executeWrite(write);
                if (write.operation === "delete" && write.recordId) {
                  await (0, cache_store_1.removeCachedRecord)(userId, write.recordId);
                }
                await (0, cache_store_1.invalidateCache)(userId, write.collection);
                await (0, offline_state_1.mutateOfflineState)(userId, (s) => {
                  s.pending = s.pending.filter((w) => w.id !== write.id);
                  if (revision !== void 0 && write.recordId) {
                    for (const w of s.pending) {
                      if (w.recordId === write.recordId)
                        w.baseRevision = revision;
                    }
                  }
                });
              } catch (e) {
                if (e instanceof errors_1.KoolbaseUnauthenticatedError) {
                  await this.onSessionExpired?.();
                  return;
                }
                if (e instanceof RevisionMismatch) {
                  await (0, offline_state_1.mutateOfflineState)(userId, (s) => {
                    s.pending = s.pending.filter((w) => w.id !== write.id);
                    s.conflicts.push({
                      id: write.id,
                      // The record moved between the change being made and the queue
                      // reaching it — distinct from a write that never had a baseline
                      // to compare against at all.
                      reason: "concurrent_modification",
                      operation: write.operation,
                      collection: write.collection,
                      recordId: write.recordId,
                      local: write.data,
                      baseline: write.baseline,
                      server: e.serverRecord,
                      baseRevision: write.baseRevision,
                      serverRevision: e.serverRevision,
                      createdAt: (/* @__PURE__ */ new Date()).toISOString()
                    });
                  });
                  if (write.recordId)
                    blocked.add(write.recordId);
                  continue;
                }
                if (e instanceof TerminalRejection) {
                  await (0, offline_state_1.mutateOfflineState)(userId, (s) => {
                    s.pending = s.pending.filter((w) => w.id !== write.id);
                    s.conflicts.push({
                      id: write.id,
                      reason: "rejected",
                      operation: write.operation,
                      collection: write.collection,
                      recordId: write.recordId ?? "",
                      local: write.data,
                      baseline: write.baseline,
                      baseRevision: write.baseRevision,
                      message: e.message,
                      createdAt: (/* @__PURE__ */ new Date()).toISOString()
                    });
                  });
                  if (write.recordId)
                    blocked.add(write.recordId);
                  continue;
                }
                await (0, offline_state_1.mutateOfflineState)(userId, (s) => {
                  const w = s.pending.find((x) => x.id === write.id);
                  if (w)
                    w.retries += 1;
                });
              }
            }
            this.onSyncComplete?.();
          } finally {
            this.isSyncing = false;
          }
        }
        /**
         * Sends one queued write, returning the revision the record now carries.
         *
         * The revision matters to whatever is queued behind this for the same record:
         * those were composed against this one's result and cannot know its revision
         * until the server assigns it.
         */
        async executeWrite(write) {
          const token = await this.getToken();
          const headers = {
            "Content-Type": "application/json",
            "x-api-key": this.config.publicKey,
            ...token ? { Authorization: `Bearer ${token}` } : {}
          };
          const url = write.operation === "insert" ? `${this.config.baseUrl}/v1/sdk/db/insert` : `${this.config.baseUrl}/v1/sdk/db/records/${write.recordId}`;
          let res;
          if (write.operation === "insert") {
            res = await fetch(url, {
              method: "POST",
              headers,
              // The write's own id: generated at enqueue, identical on every retry.
              // Without it, an insert whose response was lost duplicated on replay —
              // the server had no way to recognise the repeat.
              body: JSON.stringify({
                collection: write.collection,
                data: write.data,
                idempotency_key: write.id
              })
            });
          } else if (write.operation === "update") {
            res = await fetch(url, {
              method: "PATCH",
              headers,
              // The revision the change was composed against. The server applies it
              // only if the record still carries that revision, so nothing can land
              // between the client deciding the write is safe and the server applying
              // it — which matters here most of all, since hours may have passed.
              body: JSON.stringify({
                data: write.data,
                ...write.baseRevision !== void 0 ? { expected_revision: write.baseRevision } : {}
              })
            });
          } else {
            const q = write.baseRevision !== void 0 ? `?expected_revision=${write.baseRevision}` : "";
            res = await fetch(`${url}${q}`, { method: "DELETE", headers });
          }
          if (res.status === 401)
            throw new errors_1.KoolbaseUnauthenticatedError("unauthorized");
          if (res.status === 409) {
            const body = await res.json().catch(() => ({}));
            if (body?.code === "revision_mismatch") {
              throw new RevisionMismatch(body?.details?.record, body?.details?.current_revision);
            }
          }
          if (!res.ok && res.status !== 204) {
            const body = await res.json().catch(() => ({}));
            const message = body?.error ?? `${write.operation} failed`;
            if (res.status === 404 && write.operation === "delete")
              return void 0;
            if (isTerminal(res.status))
              throw new TerminalRejection(message, res.status);
            throw new Error(`${write.operation} sync failed: ${res.status}`);
          }
          const text = await res.text().catch(() => "");
          if (!text)
            return void 0;
          try {
            return JSON.parse(text)?.$revision;
          } catch {
            return void 0;
          }
        }
      };
      exports.SyncEngine = SyncEngine;
    }
  });

  // packages/core/dist/record.js
  var require_record = __commonJS({
    "packages/core/dist/record.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.recordFromWire = recordFromWire;
      function recordFromWire(raw) {
        const data = {};
        for (const key of Object.keys(raw)) {
          if (!key.startsWith("$"))
            data[key] = raw[key];
        }
        return {
          id: raw["$id"],
          collection: raw["$collection"],
          createdBy: raw["$createdBy"],
          data,
          createdAt: raw["$createdAt"],
          updatedAt: raw["$updatedAt"],
          revision: typeof raw["$revision"] === "number" ? raw["$revision"] : void 0
        };
      }
    }
  });

  // packages/core/dist/database.js
  var require_database = __commonJS({
    "packages/core/dist/database.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.KoolbaseDatabase = void 0;
      var errors_1 = require_errors();
      var cache_store_1 = require_cache_store();
      var offline_state_1 = require_offline_state();
      var conflict_1 = require_conflict();
      var pending_write_1 = require_pending_write();
      var cache_store_2 = require_cache_store();
      var sync_engine_1 = require_sync_engine();
      var record_1 = require_record();
      var database_errors_1 = require_database_errors();
      function generateWriteId() {
        return "local_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      }
      function generateRecordId() {
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = Math.random() * 16 | 0;
          return (c === "x" ? r : r & 3 | 8).toString(16);
        });
      }
      function batchOpToWire(op) {
        switch (op.type) {
          case "insert":
            return { type: "insert", collection: op.collection, data: op.data };
          case "update":
            return { type: "update", record_id: op.recordId, data: op.data };
          case "delete":
            return { type: "delete", record_id: op.recordId };
          case "upsert":
            return {
              type: "upsert",
              collection: op.collection,
              match: op.match,
              data: op.data
            };
        }
      }
      var KoolbaseDatabase2 = class {
        constructor(config, getUserId, getToken, onSessionExpired) {
          this.conflictResolver = {
            resolveWithLocal: async (id) => {
              const c = await this.requireConflict(id);
              await this.applyResolution(c, c.local ?? {});
            },
            resolveWithMerge: async (id, data) => {
              const c = await this.requireConflict(id);
              await this.applyResolution(c, data);
            },
            resolveWithServer: async (id) => {
              const c = await this.requireConflict(id);
              await this.dropConflict(c.id);
            },
            abandon: async (id) => {
              const c = await this.requireConflict(id);
              await this.dropConflict(c.id);
            }
          };
          this.config = config;
          this.getUserId = getUserId;
          this.getToken = getToken;
          this.onSessionExpired = onSessionExpired;
          this.syncEngine = new sync_engine_1.SyncEngine(config, getUserId, getToken, void 0, onSessionExpired);
          this.syncEngine.start();
        }
        // getUserId is kept only for local cache keys / offline metadata; request
        // identity now comes solely from the verified access token.
        async buildHeaders() {
          const token = await this.getToken();
          return {
            "Content-Type": "application/json",
            "x-api-key": this.config.publicKey,
            ...token ? { Authorization: `Bearer ${token}` } : {}
          };
        }
        async request(method, path, body) {
          const res = await fetch(`${this.config.baseUrl}${path}`, {
            method,
            headers: await this.buildHeaders(),
            body: body ? JSON.stringify(body) : void 0
          });
          const text = await res.text();
          let data = null;
          if (text.length > 0) {
            try {
              data = JSON.parse(text);
            } catch {
            }
          }
          if (!res.ok) {
            const err = (0, database_errors_1.koolbaseDataError)(res.status, data ?? {}, `Request failed: ${res.status}`);
            if (err instanceof errors_1.KoolbaseUnauthenticatedError) {
              await this.onSessionExpired?.();
            }
            throw err;
          }
          return data;
        }
        /**
         * Like [request], but returns the status alongside the body.
         *
         * Several operations need it — upsert distinguishes create from update by a
         * 201, batch reports per-operation outcomes — and needing it was why they
         * hand-rolled their own fetch, each mapping errors slightly differently and
         * none of them clearing a rejected session. One path, two shapes of result.
         */
        async requestWithStatus(method, path, body) {
          const res = await fetch(`${this.config.baseUrl}${path}`, {
            method,
            headers: await this.buildHeaders(),
            body: body ? JSON.stringify(body) : void 0
          });
          const text = await res.text();
          let data = null;
          if (text.length > 0) {
            try {
              data = JSON.parse(text);
            } catch {
            }
          }
          if (!res.ok) {
            const err = (0, database_errors_1.koolbaseDataError)(res.status, data ?? {}, `Request failed: ${res.status}`);
            if (err instanceof errors_1.KoolbaseUnauthenticatedError) {
              await this.onSessionExpired?.();
            }
            throw err;
          }
          return { status: res.status, data };
        }
        // ─── Query (cache-first) ───────────────────────────────────────────────────
        async runQuery(collection, options) {
          const raw = await this.request("POST", "/v1/sdk/db/query", {
            collection,
            filters: options.filters ?? {},
            limit: options.limit ?? 20,
            offset: options.offset ?? 0,
            order_by: options.orderBy,
            order_desc: options.orderDesc ?? false,
            populate: options.populate ?? []
          });
          const records = raw.records.map(record_1.recordFromWire);
          const userId = this.getUserId() ?? "anonymous";
          await Promise.all(records.map((r) => r.collection ? (0, cache_store_1.cacheRecord)(userId, r.collection, r.id, r.data, r.revision) : Promise.resolve()));
          return { records, total: raw.total };
        }
        /**
         * Query records, cache-first (stale-while-revalidate).
         *
         * A cache hit is returned immediately with `isFromCache: true`, and a
         * background refresh updates the cache for the next call — so a repeat
         * query converges on the server's state one call behind it. Only a cache
         * miss awaits the network (`isFromCache: false`).
         *
         * Two consequences worth designing for: results can be one refresh stale,
         * even online — re-query if you need convergence after a known write; and
         * background refresh failures are swallowed by design (the cached result
         * has already been returned), so a dead network looks identical to a slow
         * refresh. Check `isFromCache` when the difference matters.
         *
         * The cache is per-user and persisted; it doubles as the offline baseline
         * store for `update`/`delete`.
         */
        async query(collection, options = {}) {
          const userId = this.getUserId() ?? "anonymous";
          const queryHash = (0, cache_store_2.hashQuery)(collection, options);
          const cached = await (0, cache_store_2.getCached)(userId, collection, queryHash);
          if (cached) {
            this.runQuery(collection, options).then((result2) => (0, cache_store_2.setCached)(userId, collection, queryHash, result2)).catch(() => {
            });
            return { ...cached, isFromCache: true };
          }
          const result = await this.runQuery(collection, options);
          await (0, cache_store_2.setCached)(userId, collection, queryHash, result);
          return { ...result, isFromCache: false };
        }
        // ─── Insert (online-first with offline fallback) ───────────────────────────
        /**
         * Insert a new record into a collection.
         *
         * Online-first: awaits the server so a server-side rejection (unique
         * violation, validation error, permission denial) surfaces as the typed
         * `KoolbaseDataError` subclass — `insert` now throws `KoolbaseConflictError`
         * with the offending field on a 409, matching `upsert` and `update`.
         *
         * On genuine network failure (server unreachable, timeout) the write is
         * accepted optimistically: saved to the local cache and queued for sync
         * when connectivity returns.
         */
        async insert(collection, data) {
          const userId = this.getUserId() ?? "anonymous";
          try {
            const raw = await this.request("POST", "/v1/sdk/db/insert", { collection, data });
            const record = (0, record_1.recordFromWire)(raw);
            await (0, cache_store_2.invalidateCache)(userId, collection);
            await (0, cache_store_1.cacheRecord)(userId, collection, record.id, record.data, record.revision);
            return record;
          } catch (e) {
            if (e instanceof errors_1.KoolbaseError)
              throw e;
            if (!this.getUserId()) {
              throw new errors_1.KoolbaseUnauthenticatedError("Signed out and offline \u2014 this change cannot be queued for sync.");
            }
            const recordId = generateRecordId();
            const optimisticRecord = {
              id: recordId,
              createdBy: userId,
              data: { ...data, id: recordId },
              createdAt: (/* @__PURE__ */ new Date()).toISOString(),
              updatedAt: (/* @__PURE__ */ new Date()).toISOString()
            };
            await (0, cache_store_2.optimisticallyInsert)(userId, collection, optimisticRecord);
            await (0, offline_state_1.queueWrite)(userId, {
              id: generateWriteId(),
              operation: "insert",
              collection,
              recordId: optimisticRecord.id,
              // The record's UUID travels inside the payload: the server honors a
              // caller-supplied id, which is what keeps offline identity alive across
              // the boundary — the whole reason record ids are UUIDs from birth.
              data: optimisticRecord.data
            });
            return optimisticRecord;
          }
        }
        // ─── Upsert (online-only) ─────────────────────────────────────────────────
        /**
         * Insert a record, or update the existing one matching `match`.
         *
         * The server decides: exactly one match updates it, no match inserts a new
         * record (seeded with the `match` fields), more than one match is an error.
         * Returns the resulting record and a `created` flag (true = inserted, false
         * = updated).
         *
         * Online-only by design. Unlike `insert`, an upsert is NOT queued offline:
         * the insert-vs-update decision needs the server's authoritative view of
         * what already exists, so deferring it could create a duplicate or apply a
         * wrong update on later sync. It throws on network failure instead. A raw
         * fetch is used (not `request`) so the status code is readable: 201 =
         * created, 200 = updated.
         */
        async upsert(collection, match, data) {
          const { status, data: body } = await this.requestWithStatus("POST", "/v1/sdk/db/upsert", { collection, match, data });
          const created = status === 201;
          const record = (0, record_1.recordFromWire)(body);
          const userId = this.getUserId() ?? "anonymous";
          await (0, cache_store_2.invalidateCache)(userId, collection);
          await (0, cache_store_1.cacheRecord)(userId, collection, record.id, record.data, record.revision);
          return { record, created };
        }
        // ─── Delete where (online-only) ─────────────────────────────────────────────
        /**
         * Bulk-delete every record in `collection` matching `filters`.
         *
         * The server applies the collection's delete rule (scoping to the caller for
         * owner/scoped rules) and returns the number of records deleted.
         *
         * Online-only by design — like upsert, this is NOT queued offline: a bulk
         * delete needs the server's authoritative view of what matches, so it throws
         * on network failure rather than risk deleting the wrong set on later sync.
         * The collection cache is invalidated on success.
         */
        async deleteWhere(collection, filters) {
          const body = await this.request("POST", "/v1/sdk/db/delete-where", { collection, filters });
          const userId = this.getUserId() ?? "anonymous";
          await (0, cache_store_2.invalidateCache)(userId, collection);
          return body.deleted ?? 0;
        }
        // ─── Batch (atomic, online-only) ────────────────────────────────────────────
        /**
         * Run multiple writes as a single atomic transaction.
         *
         * All `operations` commit together or none are applied — the server runs
         * them in one database transaction and rolls back entirely on any failure.
         * Operations apply in order and may span multiple collections.
         *
         * Online-only by design (like `upsert` and `deleteWhere`): atomicity needs
         * the server's authoritative view, so a batch is never queued offline — it
         * throws on network failure. A server-side rejection throws a
         * `KoolbaseDataException` whose message identifies which operation failed;
         * nothing was persisted.
         *
         * Returns one `BatchResult` per operation, in order.
         *
         * @example
         * const results = await Koolbase.db.batch([
         *   BatchOp.insert('orders', { total: 50 }),
         *   BatchOp.update(inventoryId, { stock: 9 }),
         *   BatchOp.upsert('counters', { match: { name: 'orders' }, data: { value: 1 } }),
         *   BatchOp.delete(cartItemId),
         * ]);
         */
        async batch(operations) {
          if (operations.length === 0) {
            throw new Error("batch requires at least one operation");
          }
          const body = await this.request("POST", "/v1/sdk/db/batch", {
            operations: operations.map(batchOpToWire)
          });
          const results = (body.results ?? []).map((r) => ({
            type: r.type ?? "",
            record: r.record ? (0, record_1.recordFromWire)(r.record) : void 0,
            created: r.created,
            deleted: r.deleted ?? false
          }));
          const userId = this.getUserId() ?? "anonymous";
          for (const r of results) {
            if (r.record?.collection) {
              await (0, cache_store_1.cacheRecord)(userId, r.record.collection, r.record.id, r.record.data, r.record.revision);
            }
          }
          const touched = /* @__PURE__ */ new Set();
          for (const op of operations) {
            if (op.type === "insert" || op.type === "upsert") {
              touched.add(op.collection);
            }
          }
          for (const col of touched) {
            await (0, cache_store_2.invalidateCache)(userId, col);
          }
          return results;
        }
        // ─── Get single record ──────────────────────────────────────────────────────
        // ─── Get single record ──────────────────────────────────────────────────────
        async get(recordId) {
          const raw = await this.request("GET", `/v1/sdk/db/records/${recordId}`);
          const record = (0, record_1.recordFromWire)(raw);
          if (record.collection) {
            await (0, cache_store_1.cacheRecord)(this.getUserId() ?? "anonymous", record.collection, record.id, record.data, record.revision);
          }
          return record;
        }
        // ─── Conflicts ──────────────────────────────────────────────────────────────
        /**
         * Writes that could not be applied, waiting for a decision.
         *
         * Held rather than discarded, and surviving restarts. An app that never reads
         * these accumulates them invisibly, with the changes they hold never applied —
         * so if you support offline editing, surface them somewhere.
         */
        /**
         * Changes made offline, waiting to be sent. Oldest first.
         *
         * For sync indicators ("3 changes waiting") and for warning a user who is
         * about to log out with unsynced edits — see [PendingWrite] for why that
         * moment matters. Snapshot, not a live handle; per-user.
         */
        async pendingWrites() {
          const userId = this.requireUserId("the pending-write queue");
          const { pending } = await (0, offline_state_1.readOfflineState)(userId);
          return pending.map(pending_write_1.toPendingWrite);
        }
        async conflicts() {
          const userId = this.requireUserId("the conflict list");
          const { conflicts } = await (0, offline_state_1.readOfflineState)(userId);
          return conflicts.map((c) => new conflict_1.KoolbaseConflict(c.id, c.reason, c.operation, c.collection, c.recordId, c.local, c.baseline, c.server, c.baseRevision, c.serverRevision, c.createdAt, this.conflictResolver));
        }
        /**
         * Per-user state demands a user. Signed out, "no answer" must not be
         * disguised as "empty" — tonight's fake-zero: the display read the anonymous
         * bucket while a signed-in user's writes sat unseen in theirs.
         */
        requireUserId(doing) {
          const userId = this.getUserId();
          if (!userId) {
            throw new errors_1.KoolbaseUnauthenticatedError(`Signed out \u2014 ${doing} is per-user state and has no answer without a user.`);
          }
          return userId;
        }
        async requireConflict(id) {
          const userId = this.requireUserId("conflict resolution");
          const { conflicts } = await (0, offline_state_1.readOfflineState)(userId);
          const found = conflicts.find((c) => c.id === id);
          if (!found) {
            throw new database_errors_1.KoolbaseDataError("That conflict is no longer outstanding \u2014 it may already have been resolved.", "conflict_not_found");
          }
          return found;
        }
        async dropConflict(id) {
          const userId = this.requireUserId("conflict resolution");
          await (0, offline_state_1.mutateOfflineState)(userId, (s) => {
            s.conflicts = s.conflicts.filter((c) => c.id !== id);
          });
        }
        /**
         * Issues the resolving write, conditional on the revision the refusal
         * reported, and clears the conflict only once the server accepts it.
         *
         * Clearing first would lose the change if the write then failed.
         */
        async applyResolution(c, payload) {
          const rev = c.serverRevision;
          try {
            if (c.operation === "insert") {
              await this.request("POST", "/v1/sdk/db/insert", {
                collection: c.collection,
                data: payload,
                idempotency_key: c.id
              });
            } else if (c.operation === "delete") {
              const q = rev !== void 0 ? `?expected_revision=${rev}` : "";
              await this.request("DELETE", `/v1/sdk/db/records/${c.recordId}${q}`);
            } else {
              await this.request("PATCH", `/v1/sdk/db/records/${c.recordId}`, { data: payload, ...rev !== void 0 ? { expected_revision: rev } : {} });
            }
          } catch (e) {
            const details = e instanceof database_errors_1.KoolbaseDataError ? e.details : void 0;
            const current = details?.current_revision;
            const record = details?.record;
            if (typeof current === "number") {
              await (0, offline_state_1.mutateOfflineState)(this.requireUserId("conflict resolution"), (st) => {
                const stored = st.conflicts.find((x) => x.id === c.id);
                if (!stored)
                  return;
                stored.serverRevision = current;
                if (record)
                  stored.server = record;
              });
              throw new database_errors_1.KoolbaseDataError("The record has changed again while deciding. The conflict now reflects the server's current state \u2014 review and retry.", "revision_mismatch");
            }
            throw e;
          }
          await this.dropConflict(c.id);
          await (0, cache_store_2.invalidateCache)(this.getUserId() ?? "anonymous", c.collection);
        }
        // ─── Update (online-first with offline fallback) ───────────────────────────
        /**
         * Update a record's fields by id.
         *
         * Online-first: awaits the server so a server-side rejection (unique
         * violation, not found, permission denial) surfaces as the typed
         * `KoolbaseDataError` subclass. An update that would violate a unique
         * constraint now throws `KoolbaseConflictError` with the offending field —
         * same shape as `insert` and `upsert`.
         *
         * On genuine network failure the update is queued for sync and a partial
         * optimistic record is returned so the UI can re-render the new fields
         * immediately.
         */
        /**
         * The record's state as the SDK last knew it, for composing an offline
         * mutation against.
         *
         * Two sources, in order. A record created offline is not in the cache as a
         * server record, but its queued insert holds the state a later edit builds on
         * — insert-then-correct is the ordinary offline sequence. Otherwise the cached
         * copy, with the revision it was read at.
         *
         * Null when neither exists: never seen on this device, or a queued delete has
         * already removed it locally.
         */
        async resolveBaseline(userId, recordId) {
          const state = await (0, offline_state_1.readOfflineState)(userId);
          const queued = state.pending.filter((w) => w.recordId === recordId);
          if (queued.length > 0) {
            let projected = null;
            for (const w of queued) {
              if (w.operation === "insert")
                projected = { ...w.data ?? {} };
              else if (w.operation === "update")
                projected = { ...projected ?? {}, ...w.data ?? {} };
              else if (w.operation === "delete")
                projected = null;
            }
            if (projected === null)
              return null;
            return {
              baseline: projected,
              revision: queued[queued.length - 1].baseRevision,
              collection: queued[0].collection
            };
          }
          const cached = await (0, cache_store_1.getCachedRecord)(userId, recordId);
          if (!cached)
            return null;
          return { baseline: cached.data, revision: cached.revision, collection: cached.collection };
        }
        async update(recordId, data) {
          const userId = this.getUserId() ?? "anonymous";
          const base = await this.resolveBaseline(userId, recordId);
          try {
            const raw = await this.request("PATCH", `/v1/sdk/db/records/${recordId}`, { data });
            const updated = (0, record_1.recordFromWire)(raw);
            if (updated.collection) {
              await (0, cache_store_1.cacheRecord)(userId, updated.collection, updated.id, updated.data, updated.revision);
            }
            return updated;
          } catch (e) {
            if (e instanceof errors_1.KoolbaseError)
              throw e;
            if (!base) {
              throw new errors_1.KoolbaseOfflineBaselineUnavailableError("This record must be read at least once before it can be updated offline.");
            }
            await (0, offline_state_1.queueWrite)(userId, {
              id: generateWriteId(),
              operation: "update",
              collection: base.collection,
              recordId,
              data,
              baseline: base.baseline,
              baseRevision: base.revision
            });
            const merged = { ...base.baseline, ...data };
            await (0, cache_store_1.cacheRecord)(userId, base.collection, recordId, merged, base.revision);
            return {
              id: recordId,
              collection: base.collection,
              data: merged,
              createdAt: "",
              updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
              revision: base.revision
            };
          }
        }
        // ─── Delete ─────────────────────────────────────────────────────────────────
        async delete(recordId) {
          const userId = this.getUserId() ?? "anonymous";
          const base = await this.resolveBaseline(userId, recordId);
          try {
            await this.request("DELETE", `/v1/sdk/db/records/${recordId}`);
            await (0, cache_store_1.removeCachedRecord)(userId, recordId);
          } catch (e) {
            if (e instanceof errors_1.KoolbaseError)
              throw e;
            if (!base) {
              throw new errors_1.KoolbaseOfflineBaselineUnavailableError("This record must be read at least once before it can be deleted offline.");
            }
            await (0, offline_state_1.queueWrite)(userId, {
              id: generateWriteId(),
              operation: "delete",
              collection: base.collection,
              recordId,
              baseline: base.baseline,
              baseRevision: base.revision
            });
            await (0, cache_store_1.removeCachedRecord)(userId, recordId);
          }
        }
        // ─── Vectors ────────────────────────────────────────────────────────────────
        /**
         * Write (or replace) a vector for a record on the named `field`.
         *
         * The field must already be declared on the collection via the dashboard
         * or CLI. `vector.length` must match the field's declared dimension;
         * otherwise throws `KoolbaseVectorDimensionMismatchError`.
         *
         * Online-only — vectors are not cached locally or queued offline because
         * HNSW similarity search has no useful offline semantics.
         *
         * @example
         * await Koolbase.db.setVector(
         *   articleId,
         *   'embedding',
         *   await myEmbeddingModel.encode(article.content),
         * );
         */
        async setVector(recordId, field, vector) {
          await this.request("POST", "/v1/sdk/db/set-vector", {
            record_id: recordId,
            field,
            vector
          });
        }
        /**
         * Read a record's stored vector on the named `field`.
         *
         * Throws `KoolbaseNotFoundError` if either the field is not declared or
         * no vector has been set for this record on this field. Throws
         * `KoolbasePermissionError` if the caller cannot read this record per
         * the collection's read rule.
         *
         * Online-only.
         *
         * @example
         * const v = await Koolbase.db.getVector(articleId, 'embedding');
         * console.log(`${v.vector.length}-dim, updated ${v.updatedAt}`);
         */
        async getVector(recordId, field) {
          const raw = await this.request("POST", "/v1/sdk/db/get-vector", { record_id: recordId, field });
          return {
            recordId: raw.record_id,
            fieldName: raw.field_name,
            vector: raw.vector,
            createdAt: raw.created_at,
            updatedAt: raw.updated_at
          };
        }
        /**
         * Remove a record's stored vector on the named `field`.
         *
         * Online-only. Throws `KoolbaseNotFoundError` if no vector is set for
         * `(recordId, field)`; throws `KoolbasePermissionError` if the caller
         * cannot write this record per the collection's write rule.
         *
         * Note: this removes the vector from the dimension table but does NOT
         * remove the field declaration itself — the field stays on the
         * collection and is still settable on other records.
         */
        async deleteVector(recordId, field) {
          await this.request("POST", "/v1/sdk/db/delete-vector", {
            record_id: recordId,
            field
          });
        }
        /**
         * Queue an embedding job for a record's vector field. The server's
         * embedding worker picks it up within ~1 second.
         *
         * If `text` is omitted, the vector field's configured `source_field`
         * value on the record is used.
         *
         * @example
         * await Koolbase.db.embedText({
         *   collection: 'articles',
         *   recordId: article.$id,
         *   vectorField: 'content_embedding',
         * });
         */
        async embedText(opts) {
          const body = {
            collection: opts.collection,
            record_id: opts.recordId,
            vector_field: opts.vectorField
          };
          if (opts.text && opts.text.length > 0) {
            body.text = opts.text;
          }
          await this.request("POST", "/v1/sdk/db/embed-text", body);
        }
        /**
         * Search for records based on their semantic similarity to a query.
         *
         * @example
         * // Server-side embedding — most common:
         * const result = await Koolbase.db.searchSemantic({
         *   collection: 'articles',
         *   field: 'content_embedding',
         *   queryText: 'how do I configure CI/CD?',
         *   limit: 10,
         * });
         *
         * // Client-side embedding:
         * const result = await Koolbase.db.searchSemantic({
         *   collection: 'articles',
         *   field: 'content_embedding',
         *   queryVector: precomputed,
         *   limit: 10,
         * });
         *
         * // Hybrid search (vector + BM25, RRF-fused):
         * const result = await Koolbase.db.searchSemantic({
         *   collection: 'articles',
         *   field: 'content_embedding',
         *   queryText: 'how do I configure CI/CD?',
         *   mode: 'hybrid',
         *   minSimilarity: 70,
         * });
         *
         * `mode` selects the retrieval strategy:
         * - `'semantic'` (default) — pure vector search via HNSW
         * - `'lexical'` — pure BM25 over the field's source text
         * - `'hybrid'` — vector + lexical, RRF-fused (k=60)
         *
         * `minSimilarity` (0..100, optional) filters out results below the
         * given similarity percentage server-side. Saves bandwidth on weak
         * matches. Only valid for semantic and hybrid; rejected by the
         * server on lexical mode.
         */
        async searchSemantic(opts) {
          const hasVector = Array.isArray(opts.queryVector) && opts.queryVector.length > 0;
          const hasText = typeof opts.queryText === "string" && opts.queryText.trim().length > 0;
          if (!hasVector && !hasText) {
            throw new Error("searchSemantic: provide either queryVector or queryText.");
          }
          if (hasVector && hasText) {
            throw new Error("searchSemantic: provide only one of queryVector or queryText.");
          }
          if (opts.minSimilarity !== void 0 && (opts.minSimilarity < 0 || opts.minSimilarity > 100)) {
            throw new Error(`searchSemantic: minSimilarity must be between 0 and 100, got ${opts.minSimilarity}.`);
          }
          const body = {
            collection: opts.collection,
            field: opts.field,
            limit: opts.limit ?? 20,
            // Always send mode so the server uses the SDK's intent rather
            // than its own default. Omitting for 'semantic' would also work
            // (server defaults to semantic) but explicit is safer if the
            // server's default ever shifts.
            mode: opts.mode ?? "semantic"
          };
          if (hasVector)
            body.query_vector = opts.queryVector;
          if (hasText)
            body.query_text = opts.queryText;
          if (opts.where && Object.keys(opts.where).length > 0) {
            body.where = opts.where;
          }
          if (opts.minSimilarity !== void 0) {
            body.min_similarity = opts.minSimilarity;
          }
          const raw = await this.request("POST", "/v1/sdk/db/search-semantic", body);
          const hits = (raw.results ?? []).map((r) => ({
            record: (0, record_1.recordFromWire)(r.record),
            distance: r.distance
          }));
          const searchUserId = this.getUserId() ?? "anonymous";
          await Promise.all(hits.map((h) => h.record.collection ? (0, cache_store_1.cacheRecord)(searchUserId, h.record.collection, h.record.id, h.record.data, h.record.revision) : Promise.resolve()));
          return {
            hits,
            total: raw.total ?? (raw.results ?? []).length
          };
        }
        // ─── Manual sync ────────────────────────────────────────────────────────────
        async syncPendingWrites() {
          await this.syncEngine.flush();
        }
      };
      exports.KoolbaseDatabase = KoolbaseDatabase2;
    }
  });

  // packages/core/dist/flags.js
  var require_flags = __commonJS({
    "packages/core/dist/flags.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.KoolbaseFlags = void 0;
      var KoolbaseFlags2 = class {
        constructor(config, deviceId) {
          this.payload = null;
          this.config = config;
          this.deviceId = deviceId;
        }
        async fetch(appVersion, platform) {
          try {
            const res = await fetch(`${this.config.baseUrl}/v1/bootstrap?public_key=${this.config.publicKey}&device_id=${this.deviceId}&app_version=${appVersion}&platform=${platform}`);
            if (res.ok) {
              this.payload = await res.json();
            }
          } catch (_) {
          }
        }
        isEnabled(key) {
          const flag = this.payload?.flags[key];
          if (!flag || !flag.enabled || flag.kill_switch)
            return false;
          const bucket = this.stableHash(`${this.deviceId}:${key}`) % 100;
          return bucket < flag.rollout_percentage;
        }
        getString(key, fallback = "") {
          const val = this.payload?.config[key];
          return val !== void 0 ? String(val) : fallback;
        }
        getNumber(key, fallback = 0) {
          const val = this.payload?.config[key];
          return typeof val === "number" ? val : Number(val) || fallback;
        }
        getBool(key, fallback = false) {
          const val = this.payload?.config[key];
          if (typeof val === "boolean")
            return val;
          return val === "true" ? true : fallback;
        }
        checkVersion(currentVersion) {
          const policy = this.payload?.version;
          if (!policy?.min_version) {
            return { status: "up_to_date", message: "", latestVersion: "" };
          }
          const current = this.parseVersion(currentVersion);
          const min = this.parseVersion(policy.min_version);
          const latest = this.parseVersion(policy.latest_version);
          if (current < min) {
            return {
              status: "force_update",
              message: policy.update_message,
              latestVersion: policy.latest_version
            };
          }
          if (policy.latest_version && current < latest) {
            return {
              status: policy.force_update ? "force_update" : "soft_update",
              message: policy.update_message,
              latestVersion: policy.latest_version
            };
          }
          return { status: "up_to_date", message: "", latestVersion: policy.latest_version };
        }
        parseVersion(v) {
          const parts = v.split(".").map(Number);
          return (parts[0] ?? 0) * 1e4 + (parts[1] ?? 0) * 100 + (parts[2] ?? 0);
        }
        stableHash(s) {
          let hash = 0;
          for (let i = 0; i < s.length; i++) {
            hash = Math.imul(31, hash) + s.charCodeAt(i) | 0;
          }
          return Math.abs(hash);
        }
      };
      exports.KoolbaseFlags = KoolbaseFlags2;
    }
  });

  // packages/core/dist/functions.js
  var require_functions = __commonJS({
    "packages/core/dist/functions.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.KoolbaseFunctions = void 0;
      var function_errors_1 = require_function_errors();
      var errors_1 = require_errors();
      var types_1 = require_types();
      var KoolbaseFunctions2 = class {
        constructor(config, getUserAccessToken, onSessionExpired) {
          this.config = config;
          this.onSessionExpired = onSessionExpired;
          this.getUserAccessToken = getUserAccessToken;
        }
        // ─── Deploy ────────────────────────────────────────────────────────────────
        async deploy(options) {
          const runtime = options.runtime ?? types_1.FunctionRuntime.Deno;
          const res = await fetch(`${this.config.baseUrl}/v1/sdk/functions/deploy`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": this.config.publicKey
            },
            body: JSON.stringify({
              name: options.name,
              code: options.code,
              runtime,
              timeout_ms: options.timeoutMs ?? 1e4
            })
          });
          const data = await res.json().catch(() => null);
          if (!res.ok) {
            const message = data?.error ?? "Function deploy failed";
            const err = (0, function_errors_1.functionInvokeError)(res.status, message);
            if (err instanceof errors_1.KoolbaseUnauthenticatedError) {
              await this.onSessionExpired?.();
            }
            throw err;
          }
          const d = data;
          return {
            id: d.id,
            name: d.name,
            runtime: d.runtime,
            version: d.version,
            isActive: d.is_active,
            timeoutMs: d.timeout_ms,
            lastDeployedAt: d.last_deployed_at
          };
        }
        // ─── Invoke ────────────────────────────────────────────────────────────────
        async invoke(name, body) {
          const headers = {
            "Content-Type": "application/json",
            "x-api-key": this.config.publicKey
          };
          const userToken = await this.getUserAccessToken?.();
          if (userToken) {
            headers["Authorization"] = `Bearer ${userToken}`;
          }
          const res = await fetch(`${this.config.baseUrl}/v1/sdk/functions/${name}`, {
            method: "POST",
            headers,
            body: JSON.stringify({ body: body ?? {} })
          });
          const data = await res.json().catch(() => null);
          const success = res.status >= 200 && res.status < 300;
          if (!success) {
            const message = data?.error ?? "Function invocation failed";
            const err = (0, function_errors_1.functionInvokeError)(res.status, message);
            if (err instanceof errors_1.KoolbaseUnauthenticatedError) {
              await this.onSessionExpired?.();
            }
            throw err;
          }
          return {
            statusCode: res.status,
            data,
            success
          };
        }
      };
      exports.KoolbaseFunctions = KoolbaseFunctions2;
    }
  });

  // packages/core/dist/realtime.js
  var require_realtime = __commonJS({
    "packages/core/dist/realtime.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.KoolbaseRealtime = void 0;
      var cache_store_1 = require_cache_store();
      var record_1 = require_record();
      var EVENT_TYPE_MAP = {
        "db.record.created": "created",
        "db.record.updated": "updated",
        "db.record.deleted": "deleted"
      };
      function projectIdFromToken(token) {
        try {
          const part = token.split(".")[1];
          if (!part)
            return null;
          const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
          const g = globalThis;
          let json;
          if (typeof g.atob === "function") {
            const bin = g.atob(b64);
            json = decodeURIComponent(bin.split("").map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join(""));
          } else if (g.Buffer) {
            json = g.Buffer.from(b64, "base64").toString("utf8");
          } else {
            return null;
          }
          return JSON.parse(json).project_id ?? null;
        } catch {
          return null;
        }
      }
      var KoolbaseRealtime2 = class {
        constructor(config, getToken, getUserId) {
          this.ws = null;
          this.projectId = null;
          this.listeners = /* @__PURE__ */ new Map();
          this.reconnectAttempts = 0;
          this.reconnectTimer = null;
          this.connecting = false;
          this.config = config;
          this.getToken = getToken;
          this.getUserId = getUserId;
        }
        /** Files a record seen over the socket, if we know whose it is. */
        async cacheSeenRecord(collection, record) {
          const userId = this.getUserId?.();
          if (!userId)
            return;
          await (0, cache_store_1.cacheRecord)(userId, collection, record.id, record.data, record.revision);
        }
        async forgetSeenRecord(recordId) {
          const userId = this.getUserId?.();
          if (!userId)
            return;
          await (0, cache_store_1.removeCachedRecord)(userId, recordId);
        }
        subscribe(collection, callback) {
          if (!this.listeners.has(collection))
            this.listeners.set(collection, []);
          this.listeners.get(collection).push(callback);
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.sendSubscribe(collection);
          } else {
            void this.connect();
          }
          return () => {
            const callbacks = this.listeners.get(collection) ?? [];
            const i = callbacks.indexOf(callback);
            if (i > -1)
              callbacks.splice(i, 1);
            if (callbacks.length === 0) {
              this.listeners.delete(collection);
              this.sendUnsubscribe(collection);
            }
          };
        }
        async connect() {
          if (this.connecting)
            return;
          if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING))
            return;
          const token = await this.getToken();
          if (!token) {
            this.scheduleReconnect();
            return;
          }
          this.projectId = projectIdFromToken(token);
          this.connecting = true;
          const wsUrl = this.config.baseUrl.replace("https://", "wss://").replace("http://", "ws://");
          const ws = new WebSocket(`${wsUrl}/v1/realtime/ws?token=${encodeURIComponent(token)}`);
          this.ws = ws;
          ws.onopen = () => {
            this.connecting = false;
            this.reconnectAttempts = 0;
            for (const collection of this.listeners.keys())
              this.sendSubscribe(collection);
          };
          ws.onmessage = (event) => {
            let raw;
            try {
              raw = JSON.parse(event.data);
            } catch {
              return;
            }
            const mapped = EVENT_TYPE_MAP[raw?.type];
            if (!mapped)
              return;
            const payload = raw.payload;
            if (!payload || !payload.collection)
              return;
            let msg;
            if (mapped === "deleted") {
              msg = { type: "deleted", collection: payload.collection, recordId: payload.record_id };
              void this.forgetSeenRecord(payload.record_id);
            } else if (payload.record) {
              const record = (0, record_1.recordFromWire)(payload.record);
              msg = { type: mapped, collection: payload.collection, record };
              void this.cacheSeenRecord(payload.collection, record);
            } else {
              return;
            }
            (this.listeners.get(payload.collection) ?? []).forEach((cb) => cb(msg));
          };
          ws.onclose = () => {
            this.connecting = false;
            if (this.ws === ws)
              this.ws = null;
            this.scheduleReconnect();
          };
          ws.onerror = () => {
          };
        }
        sendSubscribe(collection) {
          if (!this.projectId || !this.ws || this.ws.readyState !== WebSocket.OPEN)
            return;
          this.ws.send(JSON.stringify({ action: "subscribe", project_id: this.projectId, collection }));
        }
        sendUnsubscribe(collection) {
          if (!this.projectId || !this.ws || this.ws.readyState !== WebSocket.OPEN)
            return;
          this.ws.send(JSON.stringify({ action: "unsubscribe", project_id: this.projectId, collection }));
        }
        /**
         * Reconnects with backoff, rather than every three seconds forever.
         *
         * A fixed interval is fine while a connection is merely interrupted and
         * costly when it is not: a device with no network, a wrong URL, or a session
         * the server will not accept retried indefinitely, draining battery and data
         * the user cannot see or stop.
         *
         * Doubling from three seconds to a minute keeps a brief interruption
         * recovering quickly while a lasting one settles into an interval that costs
         * almost nothing. The counter resets when a connection opens, so a flaky link
         * does not accumulate delay.
         */
        scheduleReconnect() {
          if (this.listeners.size === 0 || this.reconnectTimer)
            return;
          const delay = Math.min(3e3 * Math.pow(2, this.reconnectAttempts), 6e4);
          this.reconnectAttempts += 1;
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void this.connect();
          }, delay);
        }
        disconnect() {
          if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }
          this.ws?.close();
          this.ws = null;
          this.projectId = null;
          this.listeners.clear();
        }
      };
      exports.KoolbaseRealtime = KoolbaseRealtime2;
    }
  });

  // packages/core/dist/storage.js
  var require_storage = __commonJS({
    "packages/core/dist/storage.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.KoolbaseStorage = void 0;
      var errors_1 = require_errors();
      var storage_errors_1 = require_storage_errors();
      function clampInt(v, min, max) {
        return Math.max(min, Math.min(max, Math.floor(v)));
      }
      function serializeTransform(t) {
        const parts = [];
        if (t.width != null)
          parts.push(`width=${clampInt(t.width, 1, 2e3)}`);
        if (t.height != null)
          parts.push(`height=${clampInt(t.height, 1, 2e3)}`);
        if (t.format)
          parts.push(`format=${t.format}`);
        if (t.quality != null)
          parts.push(`quality=${clampInt(t.quality, 1, 100)}`);
        if (t.fit)
          parts.push(`fit=${t.fit}`);
        if (t.dpr != null)
          parts.push(`dpr=${clampInt(t.dpr, 1, 3)}`);
        if (t.gravity)
          parts.push(`gravity=${t.gravity}`);
        return parts.join(",");
      }
      var KoolbaseStorage2 = class _KoolbaseStorage {
        constructor(config, getToken, onSessionExpired) {
          this.config = config;
          this.getToken = getToken;
          this.onSessionExpired = onSessionExpired;
        }
        /**
         * Builds the error for a failed response and clears the session when the
         * credentials were refused, before the error reaches the caller.
         */
        async error(res, fallback) {
          const err = await (0, storage_errors_1.koolbaseStorageErrorFromResponse)(res, fallback);
          if (err instanceof errors_1.KoolbaseUnauthenticatedError) {
            await this.onSessionExpired?.();
          }
          return err;
        }
        async buildHeaders() {
          const token = await this.getToken();
          return {
            "x-api-key": this.config.publicKey,
            ...token ? { Authorization: `Bearer ${token}` } : {}
          };
        }
        /**
         * Upload a file to a bucket. Returns the object metadata and a download URL.
         *
         * By default (`overwrite: false`), uploads to a path where an object
         * already exists are **rejected** with a {@link KoolbaseStorageConflictError}.
         * Catch it to prompt the user, then retry with `overwrite: true` to replace
         * the existing object — or with a different `path`.
         *
         * Set `overwrite: true` for true upsert semantics — silently replace any
         * existing object at this path.
         *
         * Pass `options.metadata` to attach arbitrary user-defined key/value pairs
         * to the object at confirm time. Subject to the limits documented on
         * {@link KoolbaseObject.metadata}; violations throw
         * `KoolbaseStorageMetadataInvalidError`. On the `overwrite: true` path the
         * metadata REPLACES any prior metadata at this path (matches GCS semantics).
         * Use {@link updateMetadata} for post-upload merge changes.
         *
         * **Breaking change in v5.0.0**: the default flipped from silent overwrite
         * (legacy behavior) to safe-by-default. If you previously relied on uploads
         * overwriting silently, pass `overwrite: true` explicitly.
         */
        async upload(options) {
          const overwrite = options.overwrite ?? false;
          const contentType = options.file.type;
          const urlRes = await fetch(`${this.config.baseUrl}/v1/sdk/storage/upload-url`, {
            method: "POST",
            headers: {
              ...await this.buildHeaders(),
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              bucket: options.bucket,
              path: options.path,
              content_type: contentType,
              overwrite
            })
          });
          if (!urlRes.ok) {
            throw await this.error(urlRes, "Failed to get upload URL");
          }
          const { upload_url } = await urlRes.json();
          const fileResp = await fetch(options.file.uri);
          const fileBlob = await fileResp.blob();
          const fileSize = fileBlob.size;
          const uploadRes = await fetch(upload_url, {
            method: "PUT",
            headers: { "Content-Type": contentType },
            body: fileBlob
          });
          if (!uploadRes.ok) {
            throw new storage_errors_1.KoolbaseStorageError(`Upload to storage failed: ${uploadRes.status}`);
          }
          const etag = uploadRes.headers.get("etag") ?? "";
          const confirmBody = {
            bucket: options.bucket,
            path: options.path,
            size: fileSize,
            content_type: contentType,
            etag,
            overwrite
          };
          if (options.metadata !== void 0) {
            confirmBody.metadata = options.metadata;
          }
          const confirmRes = await fetch(`${this.config.baseUrl}/v1/sdk/storage/confirm`, {
            method: "POST",
            headers: {
              ...await this.buildHeaders(),
              "Content-Type": "application/json"
            },
            body: JSON.stringify(confirmBody)
          });
          if (!confirmRes.ok) {
            throw await this.error(confirmRes, "Failed to confirm upload");
          }
          const raw = await confirmRes.json();
          const object = mapObjectFromServer(raw);
          const downloadUrl = await this.getDownloadUrl(options.bucket, options.path);
          return { object, downloadUrl };
        }
        /**
         * Apply a partial metadata update to an existing object. Returns the
         * post-update {@link KoolbaseObject} with the merged metadata.
         *
         * **Merge semantics** (mirrors the server's JSONB merge):
         *
         * - Keys with a non-null string value are SET — added if missing,
         *   replacing any existing value at the key otherwise.
         * - Keys with `null` are DELETED from the stored metadata.
         * - Keys ABSENT from `metadata` are untouched — pre-existing entries
         *   for those keys remain unchanged.
         *
         * Validation runs server-side against the same rules as upload-time
         * metadata; violations throw `KoolbaseStorageMetadataInvalidError`,
         * whose `detail` field names the failing key and rule. The check is
         * performed against the projected post-merge state, so adding a key
         * that would push the object past the 50-key or 8KB ceiling is
         * rejected before the row is mutated.
         *
         * @example
         * // Add a tag, update an existing key, and drop another in one call:
         * const updated = await Koolbase.storage.updateMetadata(
         *   'photos',
         *   'sunset.jpg',
         *   {
         *     category: 'landscape',  // SET or UPDATE
         *     tag:      'sunset',     // SET or UPDATE
         *     owner:    null,         // DELETE
         *   }
         * );
         * console.log(updated.metadata);
         * // -> { category: 'landscape', tag: 'sunset' }
         */
        async updateMetadata(bucket, path, metadata) {
          const res = await fetch(`${this.config.baseUrl}/v1/sdk/storage/objects/metadata`, {
            method: "PATCH",
            headers: {
              ...await this.buildHeaders(),
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ bucket, path, metadata })
          });
          if (!res.ok) {
            throw await this.error(res, "Failed to update metadata");
          }
          const raw = await res.json();
          return mapObjectFromServer(raw);
        }
        /**
         * Get a signed download URL for a file.
         */
        async getDownloadUrl(bucket, path, versionId) {
          let url = `${this.config.baseUrl}/v1/sdk/storage/download-url?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`;
          if (versionId) {
            url += `&version_id=${encodeURIComponent(versionId)}`;
          }
          const res = await fetch(url, { headers: await this.buildHeaders() });
          if (!res.ok) {
            throw await this.error(res, "Failed to get download URL");
          }
          const data = await res.json();
          return data.url;
        }
        /**
         * Build the stable public CDN URL for a file in a public bucket.
         *
         * Returns the URL unconditionally — no check on whether the file
         * exists or whether the bucket is actually public. Use when you
         * know the file is in a public bucket and want the URL without a
         * network round-trip (build-time URL generation, server-side
         * rendering, batch image processing, etc.).
         *
         * For safer construction from an Object you already have, use
         * {@link KoolbaseStorage.publicUrlForObject} — it checks the stored
         * `r2Bucket` value and returns `null` when the object isn't in the
         * public R2 bucket.
         */
        static publicUrl(args) {
          const encoded = args.path.split("/").map(encodeURIComponent).join("/");
          const opts = args.transform ? serializeTransform(args.transform) : "";
          if (!opts) {
            return `https://cdn.koolbase.com/${args.projectId}/${args.bucket}/${encoded}`;
          }
          return `https://cdn.koolbase.com/cdn-cgi/image/${opts}/${args.projectId}/${args.bucket}/${encoded}`;
        }
        /**
         * Returns the stable CDN URL for an object when its bytes physically
         * live in the public R2 bucket, `null` otherwise.
         *
         * Returns `null` for:
         * - Files in private buckets (no public URL ever)
         * - Legacy files in public buckets whose bytes still live in the
         *   private R2 bucket from before Gap #2 (no permanent URL until
         *   they're re-uploaded)
         *
         * The bucket name must be supplied because {@link KoolbaseObject}
         * carries only the bucket ID, not its name. Typically the caller
         * already knows which bucket they queried.
         */
        static publicUrlForObject(obj, bucket, options) {
          if (obj.r2Bucket !== "koolbase-storage-public")
            return null;
          return _KoolbaseStorage.publicUrl({
            projectId: obj.projectId,
            bucket,
            path: obj.path,
            transform: options?.transform
          });
        }
        /**
         * Builds a named-preset CDN URL. The preset is resolved at the Cloudflare
         * edge by the koolbase-cdn-worker, which looks up
         * `preset:{project_id}:{preset_name}` in Workers KV and applies the stored
         * transformation options. Presets are managed in the dashboard under
         * Storage → Presets.
         *
         * Unknown preset names yield a 404 at the edge — the URL itself always
         * constructs successfully without a network round-trip.
         *
         * For safer construction from an Object you already have, use
         * {@link KoolbaseStorage.publicUrlForObjectWithPreset} — it checks the
         * stored `r2Bucket` value and returns `null` when the object isn't in the
         * public R2 bucket.
         */
        static publicUrlWithPreset(args) {
          const encoded = args.path.split("/").map(encodeURIComponent).join("/");
          return `https://cdn.koolbase.com/p/${args.projectId}/${args.presetName}/${args.bucket}/${encoded}`;
        }
        /**
         * Returns the named-preset CDN URL for the given object, or `null` if the
         * object isn't in the public R2 bucket.
         */
        static publicUrlForObjectWithPreset(obj, bucket, presetName) {
          if (obj.r2Bucket !== "koolbase-storage-public")
            return null;
          return _KoolbaseStorage.publicUrlWithPreset({
            projectId: obj.projectId,
            presetName,
            bucket,
            path: obj.path
          });
        }
        /**
         * Delete a file from a bucket.
         */
        async delete(bucket, path, forcePurge) {
          const url = forcePurge ? `${this.config.baseUrl}/v1/sdk/storage/object?force_purge=true` : `${this.config.baseUrl}/v1/sdk/storage/object`;
          const res = await fetch(url, {
            method: "DELETE",
            headers: {
              ...await this.buildHeaders(),
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ bucket, path })
          });
          if (res.status === 204)
            return;
          if (!res.ok) {
            throw await this.error(res, "Failed to delete file");
          }
        }
        /**
         * List all versions of a file path, newest-first. Returns a flat list
         * mixing the current row (with `isCurrent: true`) and all history
         * rows. Delete markers are included so callers can render the full
         * timeline; filter client-side to hide them if the UI only wants
         * restorable versions.
         *
         * Returns an empty array (not an error) when the path has no history
         * and no current row.
         */
        async listVersions(bucket, path) {
          const url = `${this.config.baseUrl}/v1/sdk/storage/object-versions?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`;
          const res = await fetch(url, { headers: await this.buildHeaders() });
          if (!res.ok) {
            throw await this.error(res, "Failed to list versions");
          }
          const data = await res.json();
          const list = Array.isArray(data.versions) ? data.versions : [];
          return list.map((v) => fromVersionJson(v));
        }
        /**
         * Fetch metadata for a single version by id. Works against both the
         * current row and any history row — the response's `isCurrent` tells
         * you which.
         */
        async getVersion(bucket, path, versionId) {
          const url = `${this.config.baseUrl}/v1/sdk/storage/object-versions/${encodeURIComponent(versionId)}?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`;
          const res = await fetch(url, { headers: await this.buildHeaders() });
          if (!res.ok) {
            throw await this.error(res, "Failed to fetch version");
          }
          return fromVersionJson(await res.json());
        }
        /**
         * Bring a history version back as the current version. The
         * previously-current row (if any) is snapshotted into history first,
         * so this operation is itself a versioned event you can undo. The
         * restored row gets a freshly-minted version_id; the target stays in
         * history at its original version_id.
         *
         * Throws if the bucket has versioning off, if the target is the
         * already-current version, or if the target is a delete marker.
         */
        async restoreVersion(bucket, path, versionId) {
          const url = `${this.config.baseUrl}/v1/sdk/storage/object-versions/${encodeURIComponent(versionId)}/restore?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`;
          const res = await fetch(url, {
            method: "POST",
            headers: await this.buildHeaders()
          });
          if (!res.ok) {
            throw await this.error(res, "Failed to restore version");
          }
          return mapObjectFromServer(await res.json());
        }
        /**
         * Hard-remove a single history version — both the metadata row and
         * the .versions/ R2 bytes (or just the row, for delete markers).
         * Refuses to operate on the current version; use {@link delete} with
         * `forcePurge: true` to wipe everything for a path.
         */
        async purgeVersion(bucket, path, versionId) {
          const url = `${this.config.baseUrl}/v1/sdk/storage/object-versions/${encodeURIComponent(versionId)}?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`;
          const res = await fetch(url, {
            method: "DELETE",
            headers: await this.buildHeaders()
          });
          if (res.status === 204)
            return;
          if (!res.ok) {
            throw await this.error(res, "Failed to purge version");
          }
        }
      };
      exports.KoolbaseStorage = KoolbaseStorage2;
      function mapObjectFromServer(raw) {
        return {
          id: raw.id,
          projectId: raw.project_id,
          bucketId: raw.bucket_id,
          userId: raw.user_id ?? null,
          path: raw.path,
          size: raw.size ?? 0,
          contentType: raw.content_type ?? null,
          metadata: raw.metadata ?? {},
          r2Bucket: raw.r2_bucket ?? "koolbase-storage",
          createdAt: raw.created_at,
          updatedAt: raw.updated_at
        };
      }
      function fromVersionJson(j) {
        const rawMeta = j.metadata;
        const metadata = {};
        if (rawMeta && typeof rawMeta === "object") {
          for (const [k, v] of Object.entries(rawMeta)) {
            if (typeof v === "string")
              metadata[k] = v;
          }
        }
        return {
          versionId: j.version_id ?? null,
          path: j.path,
          size: Number(j.size ?? 0),
          contentType: j.content_type ?? null,
          etag: j.etag ?? null,
          metadata,
          r2Bucket: j.r2_bucket ?? "",
          userId: j.user_id ?? null,
          isDeleteMarker: Boolean(j.is_delete_marker),
          isCurrent: Boolean(j.is_current),
          createdAt: j.created_at
        };
      }
    }
  });

  // packages/core/dist/device-id.js
  var require_device_id = __commonJS({
    "packages/core/dist/device-id.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.getOrCreateDeviceId = getOrCreateDeviceId2;
      var platform_1 = require_platform();
      var DEVICE_ID_KEY = "koolbase:device_id";
      var _cached = null;
      async function getOrCreateDeviceId2() {
        if (_cached)
          return _cached;
        try {
          const existing = await (0, platform_1.getPlatform)().storage.getItem(DEVICE_ID_KEY);
          if (existing) {
            _cached = existing;
            return existing;
          }
          const newId = generateUUID();
          await (0, platform_1.getPlatform)().storage.setItem(DEVICE_ID_KEY, newId);
          _cached = newId;
          return newId;
        } catch {
          return generateUUID();
        }
      }
      function generateUUID() {
        const bytes = new Uint8Array(16);
        const c = typeof crypto !== "undefined" ? crypto : void 0;
        if (c && typeof c.getRandomValues === "function") {
          c.getRandomValues(bytes);
        } else {
          for (let i = 0; i < 16; i++)
            bytes[i] = Math.random() * 256 | 0;
        }
        bytes[6] = bytes[6] & 15 | 64;
        bytes[8] = bytes[8] & 63 | 128;
        const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      }
    }
  });

  // packages/core/dist/analytics.js
  var require_analytics = __commonJS({
    "packages/core/dist/analytics.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.KoolbaseAnalytics = void 0;
      var platform_1 = require_platform();
      var device_id_1 = require_device_id();
      var SDK_VERSION = "1.3.0";
      var FLUSH_INTERVAL_MS = 3e4;
      var MAX_BATCH_SIZE = 20;
      var KoolbaseAnalytics2 = class {
        constructor(config) {
          this.queue = [];
          this.deviceId = "";
          this.userProperties = {};
          this.sessionId = "";
          this.appVersion = "1.0.0";
          this.initialized = false;
          this.config = config;
        }
        // ─── Init ─────────────────────────────────────────────────────────────────
        async init(appVersion) {
          if (this.initialized)
            return;
          this.deviceId = await (0, device_id_1.getOrCreateDeviceId)();
          this.sessionId = `${this.deviceId}-${Date.now()}`;
          this.appVersion = appVersion ?? "1.0.0";
          (0, platform_1.getPlatform)().lifecycle.onBackground(() => {
            this.flush();
          });
          this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
          this.track("app_open");
          this.initialized = true;
        }
        // ─── Public API ───────────────────────────────────────────────────────────
        track(eventName, properties) {
          const event = {
            device_id: this.deviceId,
            user_id: this.userId,
            environment_id: this.environmentId,
            event_name: eventName,
            properties: properties ?? {},
            user_properties: { ...this.userProperties },
            platform: (0, platform_1.getPlatform)().info.os,
            app_version: this.appVersion,
            sdk_version: SDK_VERSION,
            session_id: this.sessionId,
            occurred_at: (/* @__PURE__ */ new Date()).toISOString()
          };
          this.queue.push(event);
          if (this.queue.length >= MAX_BATCH_SIZE) {
            this.flush();
          }
        }
        screenView(screenName, properties) {
          this.track("screen_view", {
            screen_name: screenName,
            ...properties
          });
        }
        identify(userId) {
          this.userId = userId;
        }
        setUserProperty(key, value) {
          this.userProperties[key] = value;
        }
        setUserProperties(properties) {
          Object.assign(this.userProperties, properties);
        }
        setEnvironment(environmentId) {
          this.environmentId = environmentId;
        }
        reset() {
          this.userId = void 0;
          this.userProperties = {};
        }
        // ─── Flush ────────────────────────────────────────────────────────────────
        async flush() {
          if (this.queue.length === 0)
            return;
          const batch = [...this.queue];
          this.queue = [];
          try {
            const response = await fetch(`${this.config.baseUrl}/v1/analytics/events`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": this.config.publicKey
              },
              body: JSON.stringify({ events: batch })
            });
            if (!response.ok) {
              this.queue.unshift(...batch.slice(0, MAX_BATCH_SIZE - this.queue.length));
            }
          } catch {
            this.queue.unshift(...batch.slice(0, MAX_BATCH_SIZE - this.queue.length));
          }
        }
        async dispose() {
          if (this.flushTimer)
            clearInterval(this.flushTimer);
          this.track("session_end");
          await this.flush();
        }
      };
      exports.KoolbaseAnalytics = KoolbaseAnalytics2;
    }
  });

  // packages/core/dist/messaging.js
  var require_messaging = __commonJS({
    "packages/core/dist/messaging.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.KoolbaseMessaging = void 0;
      var KoolbaseMessaging = class {
        constructor(config) {
          this.deviceId = "";
          this.config = config;
        }
        setDeviceId(deviceId) {
          this.deviceId = deviceId;
        }
        // ─── Register token ───────────────────────────────────────────────────────
        async registerToken(options) {
          try {
            const response = await fetch(`${this.config.baseUrl}/v1/messaging/register`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": this.config.publicKey
              },
              body: JSON.stringify({
                device_id: this.deviceId,
                token: options.token,
                platform: options.platform,
                ...options.userId && { user_id: options.userId }
              })
            });
            return response.ok;
          } catch {
            return false;
          }
        }
      };
      exports.KoolbaseMessaging = KoolbaseMessaging;
    }
  });

  // packages/core/dist/index.js
  var require_dist = __commonJS({
    "packages/core/dist/index.js"(exports) {
      "use strict";
      var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
        if (k2 === void 0) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
          desc = { enumerable: true, get: function() {
            return m[k];
          } };
        }
        Object.defineProperty(o, k2, desc);
      }) : (function(o, m, k, k2) {
        if (k2 === void 0) k2 = k;
        o[k2] = m[k];
      }));
      var __exportStar = exports && exports.__exportStar || function(m, exports2) {
        for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p)) __createBinding(exports2, m, p);
      };
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.memoryPlatform = exports.getPlatform = exports.setPlatform = exports.RestoreResult = exports.koolbaseSdkVersion = exports.getOrCreateDeviceId = exports.KoolbaseMessaging = exports.KoolbaseAnalytics = exports.KoolbaseStorage = exports.KoolbaseRealtime = exports.KoolbaseFunctions = exports.KoolbaseFlags = exports.KoolbaseDatabase = exports.KoolbaseAuth = void 0;
      __exportStar(require_types(), exports);
      __exportStar(require_errors(), exports);
      __exportStar(require_conflict(), exports);
      __exportStar(require_pending_write(), exports);
      __exportStar(require_function_errors(), exports);
      __exportStar(require_auth_errors(), exports);
      __exportStar(require_database_errors(), exports);
      __exportStar(require_storage_errors(), exports);
      var auth_1 = require_auth();
      Object.defineProperty(exports, "KoolbaseAuth", { enumerable: true, get: function() {
        return auth_1.KoolbaseAuth;
      } });
      var database_1 = require_database();
      Object.defineProperty(exports, "KoolbaseDatabase", { enumerable: true, get: function() {
        return database_1.KoolbaseDatabase;
      } });
      var flags_1 = require_flags();
      Object.defineProperty(exports, "KoolbaseFlags", { enumerable: true, get: function() {
        return flags_1.KoolbaseFlags;
      } });
      var functions_1 = require_functions();
      Object.defineProperty(exports, "KoolbaseFunctions", { enumerable: true, get: function() {
        return functions_1.KoolbaseFunctions;
      } });
      var realtime_1 = require_realtime();
      Object.defineProperty(exports, "KoolbaseRealtime", { enumerable: true, get: function() {
        return realtime_1.KoolbaseRealtime;
      } });
      var storage_1 = require_storage();
      Object.defineProperty(exports, "KoolbaseStorage", { enumerable: true, get: function() {
        return storage_1.KoolbaseStorage;
      } });
      var analytics_1 = require_analytics();
      Object.defineProperty(exports, "KoolbaseAnalytics", { enumerable: true, get: function() {
        return analytics_1.KoolbaseAnalytics;
      } });
      var messaging_1 = require_messaging();
      Object.defineProperty(exports, "KoolbaseMessaging", { enumerable: true, get: function() {
        return messaging_1.KoolbaseMessaging;
      } });
      var device_id_1 = require_device_id();
      Object.defineProperty(exports, "getOrCreateDeviceId", { enumerable: true, get: function() {
        return device_id_1.getOrCreateDeviceId;
      } });
      var device_metadata_1 = require_device_metadata();
      Object.defineProperty(exports, "koolbaseSdkVersion", { enumerable: true, get: function() {
        return device_metadata_1.koolbaseSdkVersion;
      } });
      var types_1 = require_types();
      Object.defineProperty(exports, "RestoreResult", { enumerable: true, get: function() {
        return types_1.RestoreResult;
      } });
      var platform_1 = require_platform();
      Object.defineProperty(exports, "setPlatform", { enumerable: true, get: function() {
        return platform_1.setPlatform;
      } });
      Object.defineProperty(exports, "getPlatform", { enumerable: true, get: function() {
        return platform_1.getPlatform;
      } });
      Object.defineProperty(exports, "memoryPlatform", { enumerable: true, get: function() {
        return platform_1.memoryPlatform;
      } });
    }
  });

  // packages/js/src/index.ts
  var index_exports = {};
  __export(index_exports, {
    BrowserAuthStorage: () => BrowserAuthStorage,
    Koolbase: () => Koolbase,
    browserPlatform: () => browserPlatform
  });
  __reExport(index_exports, __toESM(require_dist()));

  // packages/js/src/auth-storage.ts
  var import_core = __toESM(require_dist());
  var KEY = "koolbase_session_v1";
  var BrowserAuthStorage = class {
    async readSession() {
      const raw = await (0, import_core.getPlatform)().storage.getItem(KEY);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        await this.clear();
        return null;
      }
    }
    async saveSession(session) {
      await (0, import_core.getPlatform)().storage.setItem(KEY, JSON.stringify(session));
    }
    async clear() {
      await (0, import_core.getPlatform)().storage.removeItem(KEY);
    }
  };

  // packages/js/src/platform.ts
  var DB_NAME = "koolbase";
  var STORE = "kv";
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
    });
  }
  function tx(db, mode, run) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("indexedDB request failed"));
    });
  }
  function indexedDBStorage() {
    let dbp = null;
    const db = () => dbp ??= openDB();
    return {
      // Not part of PlatformStorage. Test harnesses call it between cases so
      // deleteDatabase is not blocked by a live connection.
      close: async () => {
        if (!dbp) return;
        (await dbp).close();
        dbp = null;
      },
      getItem: async (k) => {
        const v = await tx(await db(), "readonly", (s) => s.get(k));
        return v ?? null;
      },
      setItem: async (k, v) => {
        await tx(await db(), "readwrite", (s) => s.put(v, k));
      },
      removeItem: async (k) => {
        await tx(await db(), "readwrite", (s) => s.delete(k));
      },
      getAllKeys: async () => {
        const keys = await tx(await db(), "readonly", (s) => s.getAllKeys());
        return keys.map(String);
      }
    };
  }
  function localStorageStorage() {
    return {
      getItem: async (k) => localStorage.getItem(k),
      setItem: async (k, v) => {
        localStorage.setItem(k, v);
      },
      removeItem: async (k) => {
        localStorage.removeItem(k);
      },
      getAllKeys: async () => {
        const out = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k !== null) out.push(k);
        }
        return out;
      }
    };
  }
  function browserVersion() {
    if (typeof navigator === "undefined") return "";
    const ua = navigator.userAgent;
    const m = /(Chrome|Firefox|Safari|Edg)\/([\d.]+)/.exec(ua);
    return m ? `${m[1]} ${m[2]}` : "";
  }
  function browserPlatform() {
    const hasIDB = typeof indexedDB !== "undefined";
    return {
      storage: hasIDB ? indexedDBStorage() : localStorageStorage(),
      network: {
        onChange: (cb) => {
          if (typeof window === "undefined") return () => {
          };
          const on = () => cb(true);
          const off = () => cb(false);
          window.addEventListener("online", on);
          window.addEventListener("offline", off);
          return () => {
            window.removeEventListener("online", on);
            window.removeEventListener("offline", off);
          };
        }
      },
      lifecycle: {
        onBackground: (cb) => {
          if (typeof document === "undefined" || typeof window === "undefined") return () => {
          };
          const handler = () => {
            if (document.visibilityState === "hidden") cb();
          };
          document.addEventListener("visibilitychange", handler);
          window.addEventListener("pagehide", cb);
          return () => {
            document.removeEventListener("visibilitychange", handler);
            window.removeEventListener("pagehide", cb);
          };
        }
      },
      info: {
        os: "web",
        version: browserVersion()
      },
      // IndexedDB-backed; see auth-storage.ts for what that does and does not
      // protect against.
      authStorage: () => new BrowserAuthStorage()
    };
  }

  // packages/js/src/index.ts
  var import_core2 = __toESM(require_dist());
  var _auth = null;
  var _db = null;
  var _storage = null;
  var _realtime = null;
  var _functions = null;
  var _flags = null;
  var _analytics = null;
  var _initialized = false;
  function ensureInitialized() {
    if (!_initialized) {
      throw new Error("Koolbase not initialized. Call Koolbase.initialize(config) first.");
    }
  }
  var Koolbase = {
    async initialize(config) {
      if (_initialized) return;
      (0, import_core2.setPlatform)(config.platform ?? browserPlatform());
      _auth = new import_core2.KoolbaseAuth(config);
      _db = new import_core2.KoolbaseDatabase(
        config,
        () => _auth?.currentUser?.id ?? null,
        () => _auth?.validAccessToken() ?? Promise.resolve(null),
        async () => {
          await _auth?.clearStoredSession();
        }
      );
      _storage = new import_core2.KoolbaseStorage(
        config,
        () => _auth?.validAccessToken() ?? Promise.resolve(null),
        async () => {
          await _auth?.clearStoredSession();
        }
      );
      _realtime = new import_core2.KoolbaseRealtime(
        config,
        () => _auth?.validAccessToken() ?? Promise.resolve(null),
        () => _auth?.currentUser?.id ?? null
      );
      _functions = new import_core2.KoolbaseFunctions(
        config,
        () => _auth?.validAccessToken() ?? Promise.resolve(null),
        async () => {
          await _auth?.clearStoredSession();
        }
      );
      const deviceId = await (0, import_core2.getOrCreateDeviceId)();
      _flags = new import_core2.KoolbaseFlags(config, deviceId);
      if (config.analyticsEnabled !== false) {
        _analytics = new import_core2.KoolbaseAnalytics(config);
        await _analytics.init(config.appVersion);
      }
      _initialized = true;
    },
    get auth() {
      ensureInitialized();
      return _auth;
    },
    get db() {
      ensureInitialized();
      return _db;
    },
    get storage() {
      ensureInitialized();
      return _storage;
    },
    get realtime() {
      ensureInitialized();
      return _realtime;
    },
    get functions() {
      ensureInitialized();
      return _functions;
    },
    get analytics() {
      ensureInitialized();
      if (!_analytics) throw new Error("Analytics is disabled (analyticsEnabled: false).");
      return _analytics;
    },
    isEnabled(key) {
      ensureInitialized();
      return _flags.isEnabled(key);
    },
    configString(key, fallback = "") {
      ensureInitialized();
      return _flags.getString(key, fallback);
    },
    configNumber(key, fallback = 0) {
      ensureInitialized();
      return _flags.getNumber(key, fallback);
    },
    configBool(key, fallback = false) {
      ensureInitialized();
      return _flags.getBool(key, fallback);
    },
    checkVersion(currentVersion) {
      ensureInitialized();
      return _flags.checkVersion(currentVersion);
    }
  };
  return __toCommonJS(index_exports);
})();
