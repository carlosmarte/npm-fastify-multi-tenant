/**
 * Common Validators using Utility Pattern
 */

export class ValidationError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = "ValidationError";
    this.field = field;
  }
}

export class CommonValidators {
  static validateTenantId(tenantId) {
    if (!tenantId || typeof tenantId !== "string") {
      throw new ValidationError("Tenant ID must be a non-empty string");
    }

    if (!/^[a-zA-Z0-9\-_]+$/.test(tenantId)) {
      throw new ValidationError("Tenant ID contains invalid characters");
    }

    return tenantId;
  }

  static validateEmail(email) {
    if (!email || typeof email !== "string") {
      throw new ValidationError("Email must be a non-empty string", "email");
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email)) {
      throw new ValidationError("Invalid email format", "email");
    }

    return email.toLowerCase();
  }

  static validateString(value, fieldName, options = {}) {
    if (!value || typeof value !== "string") {
      throw new ValidationError(
        `${fieldName} must be a non-empty string`,
        fieldName
      );
    }

    if (options.minLength && value.length < options.minLength) {
      throw new ValidationError(
        `${fieldName} must be at least ${options.minLength} characters`,
        fieldName
      );
    }

    if (options.maxLength && value.length > options.maxLength) {
      throw new ValidationError(
        `${fieldName} must be no more than ${options.maxLength} characters`,
        fieldName
      );
    }

    return value.trim();
  }
}

export default CommonValidators;
