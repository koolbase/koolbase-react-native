export class KoolbaseAuthError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
    this.name = 'KoolbaseAuthError';
    Object.setPrototypeOf(this, KoolbaseAuthError.prototype);
  }
}

export class InvalidPhoneNumberError extends KoolbaseAuthError {
  constructor() {
    super(
      'Phone number must be in E.164 format (e.g. +233XXXXXXXXX)',
      'invalid_phone'
    );
    this.name = 'InvalidPhoneNumberError';
    Object.setPrototypeOf(this, InvalidPhoneNumberError.prototype);
  }
}

export class OtpExpiredError extends KoolbaseAuthError {
  constructor() {
    super('OTP has expired, please request a new code', 'otp_expired');
    this.name = 'OtpExpiredError';
    Object.setPrototypeOf(this, OtpExpiredError.prototype);
  }
}

export class OtpInvalidError extends KoolbaseAuthError {
  constructor() {
    super('Invalid OTP code', 'otp_invalid');
    this.name = 'OtpInvalidError';
    Object.setPrototypeOf(this, OtpInvalidError.prototype);
  }
}

export class OtpMaxAttemptsError extends KoolbaseAuthError {
  constructor() {
    super(
      'Too many incorrect attempts, please request a new code',
      'otp_max_attempts'
    );
    this.name = 'OtpMaxAttemptsError';
    Object.setPrototypeOf(this, OtpMaxAttemptsError.prototype);
  }
}

export class OtpRateLimitError extends KoolbaseAuthError {
  constructor() {
    super(
      'Too many OTP requests, please wait before trying again',
      'otp_rate_limit'
    );
    this.name = 'OtpRateLimitError';
    Object.setPrototypeOf(this, OtpRateLimitError.prototype);
  }
}

export class PhoneAlreadyLinkedError extends KoolbaseAuthError {
  constructor() {
    super(
      'Phone number is already associated with another account',
      'phone_taken'
    );
    this.name = 'PhoneAlreadyLinkedError';
    Object.setPrototypeOf(this, PhoneAlreadyLinkedError.prototype);
  }
}

export class SmsConfigMissingError extends KoolbaseAuthError {
  constructor() {
    super('SMS provider not configured for this project', 'sms_config_missing');
    this.name = 'SmsConfigMissingError';
    Object.setPrototypeOf(this, SmsConfigMissingError.prototype);
  }
}
