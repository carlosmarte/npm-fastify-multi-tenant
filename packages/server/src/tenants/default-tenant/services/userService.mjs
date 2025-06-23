/**
 * User Service using Service Layer Pattern
 * Implements business logic with clear separation of concerns
 */

export class UserService {
  constructor(repository, config = {}) {
    this.repository = repository;
    this.config = config;
    this.validator = new UserValidator();
  }

  async getAll() {
    return await this.repository.findAll();
  }

  async getById(id) {
    this.validator.validateId(id);
    return await this.repository.findById(id);
  }

  async create(userData) {
    // Business logic validation
    this.validator.validateCreateData(userData);

    // Check for duplicate email
    const existingUser = await this.repository.findByEmail(userData.email);
    if (existingUser) {
      throw new Error("User with this email already exists");
    }

    // Create user with defaults
    const user = {
      ...userData,
      id: this.generateId(),
      role: userData.role || "user",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    return await this.repository.create(user);
  }

  async update(id, userData) {
    this.validator.validateId(id);
    this.validator.validateUpdateData(userData);

    const existingUser = await this.repository.findById(id);
    if (!existingUser) {
      throw new Error("User not found");
    }

    const updatedUser = {
      ...existingUser,
      ...userData,
      updatedAt: new Date().toISOString(),
    };

    return await this.repository.update(id, updatedUser);
  }

  async delete(id) {
    this.validator.validateId(id);
    return await this.repository.delete(id);
  }

  generateId() {
    return `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * User Repository using Repository Pattern
 * Handles data persistence abstraction
 */
export class UserRepository {
  constructor(dataStore) {
    this.store = dataStore; // Could be database, memory, etc.
  }

  async findAll() {
    if (this.store instanceof Map) {
      return Array.from(this.store.values());
    }
    throw new Error("Unsupported data store");
  }

  async findById(id) {
    if (this.store instanceof Map) {
      return this.store.get(id) || null;
    }
    throw new Error("Unsupported data store");
  }

  async findByEmail(email) {
    if (this.store instanceof Map) {
      return (
        Array.from(this.store.values()).find((user) => user.email === email) ||
        null
      );
    }
    throw new Error("Unsupported data store");
  }

  async create(user) {
    if (this.store instanceof Map) {
      this.store.set(user.id, user);
      return user;
    }
    throw new Error("Unsupported data store");
  }

  async update(id, userData) {
    if (this.store instanceof Map) {
      if (!this.store.has(id)) {
        throw new Error("User not found");
      }
      this.store.set(id, userData);
      return userData;
    }
    throw new Error("Unsupported data store");
  }

  async delete(id) {
    if (this.store instanceof Map) {
      return this.store.delete(id);
    }
    throw new Error("Unsupported data store");
  }
}

/**
 * User Validator using Validator Pattern
 */
export class UserValidator {
  validateId(id) {
    if (!id || typeof id !== "string") {
      throw new Error("Invalid user ID");
    }
  }

  validateCreateData(data) {
    if (!data || typeof data !== "object") {
      throw new Error("Invalid user data");
    }

    if (!data.name || typeof data.name !== "string") {
      throw new Error("Name is required");
    }

    if (!data.email || !this.isValidEmail(data.email)) {
      throw new Error("Valid email is required");
    }
  }

  validateUpdateData(data) {
    if (!data || typeof data !== "object") {
      throw new Error("Invalid user data");
    }

    if (data.name && typeof data.name !== "string") {
      throw new Error("Name must be a string");
    }

    if (data.email && !this.isValidEmail(data.email)) {
      throw new Error("Email must be valid");
    }
  }

  isValidEmail(email) {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailPattern.test(email);
  }
}

// Factory function for service creation
export default function createUserService(dataStore, config = {}) {
  const repository = new UserRepository(dataStore);
  return new UserService(repository, config);
}
