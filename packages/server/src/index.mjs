// main.mjs
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import Fastify from "fastify";
import { existsSync } from "fs";
import fastGlob from "fast-glob";
import closeWithGrace from "close-with-grace";
import merge from "deepmerge";
import { resolve } from "import-meta-resolve";
import { findUp } from "find-up";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Security utility for input validation
 */
class SecurityValidator {
  static validateTenantId(tenantId) {
    if (!tenantId || typeof tenantId !== "string") {
      throw new Error("Tenant ID must be a non-empty string");
    }

    const sanitized = tenantId.replace(/[^a-zA-Z0-9\-_]/g, "");
    if (sanitized !== tenantId || sanitized.length === 0) {
      throw new Error("Tenant ID contains invalid characters");
    }
    return sanitized;
  }

  static validatePluginName(pluginName) {
    if (!pluginName || typeof pluginName !== "string") {
      throw new Error("Plugin name must be a non-empty string");
    }

    const sanitized = pluginName.replace(/[^a-zA-Z0-9\-_]/g, "");
    if (sanitized !== pluginName || sanitized.length === 0) {
      throw new Error("Plugin name contains invalid characters");
    }
    return sanitized;
  }
}

/**
 * Configuration management using Singleton pattern
 */
class ConfigurationManager {
  constructor(overrides = {}) {
    this.config = merge(this.getDefaultConfig(), overrides);
  }

  getDefaultConfig() {
    return {
      server: {
        port: process.env.PORT || 3002,
        host: process.env.HOST || "0.0.0.0",
      },
      logger: {
        level: process.env.LOG_LEVEL || "info",
      },
      plugins: {
        coreOrder: [
          "database",
          "auth",
          "cookie",
          "exception",
          "logger",
          "request",
          "static",
        ],
        npmPattern: "fastify-multitenant-*",
      },
      tenants: {
        npmPattern: "fastify-multitenant-*",
        maxConcurrent: 50,
        autoLoad: true,
      },
      security: {
        validateInputs: true,
      },
    };
  }

  get(key) {
    return key ? this.config[key] : this.config;
  }

  merge(overrides) {
    this.config = merge(this.config, overrides);
  }
}

/**
 * Enhanced Path resolver with NPM package support
 */
class PathResolver {
  constructor(baseDir = __dirname) {
    this.baseDir = path.resolve(baseDir);
    this.trustedPackagePaths = new Set(); // Trusted NPM package paths
  }

  // Add trusted package path (for NPM packages)
  addTrustedPath(packagePath) {
    this.trustedPackagePaths.add(path.resolve(packagePath));
  }

  // Check if path is in a trusted package
  isTrustedPath(filePath) {
    const resolved = path.resolve(filePath);
    for (const trustedPath of this.trustedPackagePaths) {
      if (resolved.startsWith(trustedPath)) {
        return true;
      }
    }
    return false;
  }

  async getModuleInfo(specifier) {
    try {
      const resolvedUrl = await resolve(specifier, import.meta.url);
      const entryPath = fileURLToPath(resolvedUrl);
      const rootDir = path.dirname(entryPath);

      const packageJsonPath = await findUp("package.json", { cwd: rootDir });
      if (!packageJsonPath) {
        throw new Error("Module root not found");
      }

      const packageJson = JSON.parse(
        await fs.readFile(packageJsonPath, "utf8")
      );

      const packageRoot = path.dirname(packageJsonPath);

      // Add package root as trusted path
      this.addTrustedPath(packageRoot);

      return {
        specifier,
        entryPath,
        rootDir: packageRoot, // Use package root, not entry directory
        packageJson,
        resolvedUrl,
        packageJsonPath,
      };
    } catch (err) {
      throw new Error(`Error resolving module ${specifier}: ${err.message}`);
    }
  }

  resolvePath(relativePath, options = {}) {
    if (path.isAbsolute(relativePath)) {
      // For absolute paths, check if it's trusted (for NPM packages)
      if (options.allowTrusted && this.isTrustedPath(relativePath)) {
        return relativePath;
      }
      return relativePath;
    }

    const resolved = path.resolve(this.baseDir, relativePath);

    // Security check: ensure resolved path is within baseDir OR is trusted
    if (!resolved.startsWith(this.baseDir) && !this.isTrustedPath(resolved)) {
      throw new Error(`Path traversal attempt detected: ${relativePath}`);
    }

    return resolved;
  }

  async pathExists(filePath, options = {}) {
    try {
      // Allow trusted paths (NPM packages) to bypass base directory restriction
      const resolvedPath = options.allowTrusted
        ? filePath
        : this.resolvePath(filePath, options);
      await fs.access(resolvedPath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Plugin management with improved error handling
 */
class PluginManager {
  constructor(logger, pathResolver) {
    this.logger = logger;
    this.pathResolver = pathResolver;
    this.pluginCache = new Map();
  }

  async loadLocalPlugin(app, pluginName, options = {}) {
    const sanitizedName = SecurityValidator.validatePluginName(pluginName);
    const cacheKey = `local:${sanitizedName}`;

    try {
      if (this.pluginCache.has(cacheKey)) {
        const plugin = this.pluginCache.get(cacheKey);
        await app.register(plugin, { ...options, fastify: app });
        this.logger.debug(`Registered cached plugin ${sanitizedName}`);
        return { success: true, plugin };
      }

      const pluginPath = path.join(
        this.pathResolver.baseDir,
        "plugins",
        sanitizedName,
        "index.mjs"
      );

      if (!(await this.pathResolver.pathExists(pluginPath))) {
        this.logger.warn(`Plugin ${sanitizedName} not found at ${pluginPath}`);
        return { success: false, error: `Plugin not found: ${sanitizedName}` };
      }

      const pluginModule = await import(`file://${pluginPath}`);
      const plugin = pluginModule.default || pluginModule;

      if (typeof plugin !== "function") {
        return {
          success: false,
          error: `Plugin is not a function: ${sanitizedName}`,
        };
      }

      this.pluginCache.set(cacheKey, plugin);
      await app.register(plugin, { ...options, fastify: app });
      this.logger.debug(`Registered plugin ${sanitizedName}`);

      return { success: true, plugin };
    } catch (err) {
      this.logger.error({ err }, `Failed to load plugin ${sanitizedName}`);
      return { success: false, error: err.message };
    }
  }

  async getNPMPluginNames(pattern = "fastify-multitenant-*") {
    const packageJsonPath = path.join(process.cwd(), "package.json");

    try {
      const packageJson = JSON.parse(
        await fs.readFile(packageJsonPath, "utf8")
      );
      const dependencies = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      return Object.keys(dependencies).filter((dep) => {
        return new RegExp(pattern.replace("*", ".*")).test(dep);
      });
    } catch (err) {
      throw new Error(`Failed to load package.json: ${err.message}`);
    }
  }

  async loadNPMPlugin(app, pluginName, options = {}) {
    const cacheKey = `npm:${pluginName}`;

    try {
      if (this.pluginCache.has(cacheKey)) {
        const plugin = this.pluginCache.get(cacheKey);
        await app.register(plugin, options);
        this.logger.debug(`Registered cached NPM plugin ${pluginName}`);
        return { success: true, plugin };
      }

      const pluginModule = await import(pluginName);
      const plugin = pluginModule.default || pluginModule;

      if (typeof plugin !== "function") {
        return {
          success: false,
          error: `Plugin is not a function: ${pluginName}`,
        };
      }

      this.pluginCache.set(cacheKey, plugin);
      await app.register(plugin, options);
      this.logger.info(`✅ Loaded NPM plugin [${pluginName}]`);

      return { success: true, plugin };
    } catch (err) {
      this.logger.error({ err }, `Failed to load NPM plugin ${pluginName}`);
      return { success: false, error: err.message };
    }
  }

  async loadLocalPlugins(app, pluginNames, options = {}) {
    const results = [];
    let successCount = 0;

    for (const pluginName of pluginNames) {
      try {
        const result = await this.loadLocalPlugin(
          app,
          pluginName,
          options[pluginName] || {}
        );
        results.push({ plugin: pluginName, ...result });
        if (result.success) successCount++;
      } catch (err) {
        this.logger.error({ err }, `Failed to load local plugin ${pluginName}`);
        results.push({
          plugin: pluginName,
          success: false,
          error: err.message,
        });
      }
    }

    this.logger.info(
      `✅ Successfully loaded ${successCount}/${pluginNames.length} local plugins`
    );
    return { successCount, total: pluginNames.length, results };
  }

  async loadNPMPlugins(app, pattern) {
    try {
      const pluginNames = await this.getNPMPluginNames(pattern);
      this.logger.info(
        `🔍 Found ${pluginNames.length} NPM plugins matching pattern ${pattern}`
      );

      const results = [];
      let successCount = 0;

      for (const pluginName of pluginNames) {
        try {
          const result = await this.loadNPMPlugin(app, pluginName);
          results.push({ plugin: pluginName, ...result });
          if (result.success) successCount++;
        } catch (err) {
          this.logger.error({ err }, `Failed to load NPM plugin ${pluginName}`);
          results.push({
            plugin: pluginName,
            success: false,
            error: err.message,
          });
        }
      }

      this.logger.info(
        `✅ Successfully loaded ${successCount}/${pluginNames.length} NPM plugins`
      );
      return { successCount, total: pluginNames.length, results };
    } catch (err) {
      this.logger.error({ err }, "Failed to load NPM plugins");
      return { successCount: 0, total: 0, results: [] };
    }
  }
}

/**
 * Enhanced Resource loader with NPM package support
 */
class ResourceLoader {
  constructor(logger, pathResolver) {
    this.logger = logger;
    this.pathResolver = pathResolver;
    this.loadedResources = new Map();
  }

  async loadServices(servicesPath, options = {}) {
    const cacheKey = `services:${servicesPath}`;

    if (this.loadedResources.has(cacheKey)) {
      this.logger.debug(`Returning cached services for ${servicesPath}`);
      return this.loadedResources.get(cacheKey);
    }

    try {
      // For NPM packages, use the path directly if it's trusted
      const absolutePath = options.isTrustedPath
        ? servicesPath
        : this.pathResolver.resolvePath(servicesPath);

      if (
        !(await this.pathResolver.pathExists(absolutePath, {
          allowTrusted: options.isTrustedPath,
        }))
      ) {
        this.logger.debug(`No services directory found at ${servicesPath}`);
        return {};
      }

      const serviceFiles = await fastGlob("**/*.{js,mjs}", {
        cwd: absolutePath,
        absolute: true,
      });

      this.logger.info(
        `Found ${serviceFiles.length} service files in ${servicesPath}`
      );

      const services = {};

      for (const file of serviceFiles) {
        try {
          const serviceName = path.basename(file, path.extname(file));
          const serviceModule = await import(`file://${file}`);
          const ServiceClass = serviceModule.default || serviceModule;

          if (typeof ServiceClass === "function") {
            services[serviceName] = /^[A-Z]/.test(ServiceClass.name)
              ? new ServiceClass(options.db, options.config)
              : ServiceClass(options.db, options.config);
          } else {
            services[serviceName] = ServiceClass;
          }

          this.logger.debug(`Loaded service ${serviceName} from ${file}`);
        } catch (err) {
          this.logger.error({ err }, `Failed to load service from ${file}`);
        }
      }

      this.loadedResources.set(cacheKey, services);
      return services;
    } catch (err) {
      this.logger.error(
        { err },
        `Failed to load services from ${servicesPath}`
      );
      return {};
    }
  }

  async loadPlugin(app, pluginPath, options = {}) {
    try {
      // For NPM packages, use the path directly if it's trusted
      const absolutePath = options.isTrustedPath
        ? pluginPath
        : this.pathResolver.resolvePath(pluginPath);

      const indexPath = path.join(absolutePath, "index.mjs");

      if (
        !(await this.pathResolver.pathExists(indexPath, {
          allowTrusted: options.isTrustedPath,
        }))
      ) {
        this.logger.warn(
          `Plugin file not found at ${indexPath} ${options.namespace}`
        );
        return false;
      }

      const pluginModule = await import(`file://${indexPath}`);
      const pluginFunc = pluginModule.default || pluginModule;

      if (typeof pluginFunc !== "function") {
        this.logger.warn(`Plugin at ${indexPath} does not export a function`);
        return false;
      }

      await app.register(pluginFunc, options);
      this.logger.info(`Loaded plugin from ${pluginPath} ${options.namespace}`);
      return true;
    } catch (err) {
      this.logger.error(
        { err },
        `Failed to load plugin from ${pluginPath} ${options.namespace}`
      );
      return false;
    }
  }

  async loadSchemas(app, schemaPath, options = {}) {
    try {
      // For NPM packages, use the path directly if it's trusted
      const absolutePath = options.isTrustedPath
        ? schemaPath
        : this.pathResolver.resolvePath(schemaPath);

      if (
        !(await this.pathResolver.pathExists(absolutePath, {
          allowTrusted: options.isTrustedPath,
        }))
      ) {
        this.logger.debug(`No schemas directory found at ${schemaPath}`);
        return false;
      }

      const schemaFiles = await fastGlob("**/*.{json,js,mjs}", {
        cwd: absolutePath,
        absolute: true,
      });

      this.logger.info(
        `Found ${schemaFiles.length} schema files in ${schemaPath}`
      );

      for (const file of schemaFiles) {
        try {
          let schemaData;

          if (file.endsWith(".json")) {
            const content = await fs.readFile(file, "utf8");
            schemaData = JSON.parse(content);
          } else {
            const schemaModule = await import(`file://${file}`);
            schemaData = schemaModule.default || schemaModule;
          }

          if (!schemaData.$id) {
            this.logger.warn(`Schema at ${file} does not have an $id property`);
            continue;
          }

          app.addSchema(schemaData);
          this.logger.debug(`Loaded schema ${schemaData.$id} from ${file}`);
        } catch (err) {
          this.logger.error({ err }, `Failed to load schema from ${file}`);
        }
      }

      return { success: true };
    } catch (err) {
      this.logger.error({ err }, `Failed to load schemas from ${schemaPath}`);
      return { success: false, error: err.message };
    }
  }

  async loadConfig(configPath, defaults = {}, options = {}) {
    try {
      // For NPM packages, use the path directly if it's trusted
      const absolutePath = options.isTrustedPath
        ? configPath
        : this.pathResolver.resolvePath(configPath);

      let config = { ...defaults };

      const configFiles = await fastGlob("config.{json,js,mjs}", {
        cwd: absolutePath,
        absolute: true,
      });

      if (configFiles.length === 0) {
        this.logger.debug(`No config files found in ${absolutePath}`);
        return config;
      }

      for (const file of configFiles) {
        try {
          if (file.endsWith(".json")) {
            const content = await fs.readFile(file, "utf8");
            config = merge(config, JSON.parse(content));
          } else {
            const configModule = await import(`file://${file}`);
            config = merge(config, configModule.default || configModule);
          }
          this.logger.debug(`Loaded configuration from ${file}`);
        } catch (err) {
          this.logger.error({ err }, `Failed to load config from ${file}`);
        }
      }

      return config;
    } catch (err) {
      this.logger.error({ err }, `Failed to load config from ${configPath}`);
      return defaults;
    }
  }
}

/**
 * Tenant context value object
 */
class TenantContext {
  constructor(id, config, adapter) {
    this.id = SecurityValidator.validateTenantId(id);
    this.config = config;
    this.adapter = adapter;
    this.services = {};
    this.plugins = new Set();
    this.routes = new Set();
    this.schemas = new Set();
    this.active = config.active !== false;
    this.createdAt = new Date();
    this.type = adapter.getType();
  }

  addService(name, service) {
    this.services[name] = service;
  }

  getService(name) {
    return this.services[name] || null;
  }

  listServices() {
    return Object.keys(this.services);
  }

  addPlugin(pluginName) {
    this.plugins.add(pluginName);
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      config: this.config,
      services: Object.keys(this.services),
      plugins: Array.from(this.plugins),
      routes: Array.from(this.routes),
      schemas: Array.from(this.schemas),
      active: this.active,
      createdAt: this.createdAt,
    };
  }
}

/**
 * Abstract base class for tenant adapters using Template Method pattern
 */
class TenantAdapter {
  constructor(logger, pathResolver, resourceLoader) {
    this.logger = logger;
    this.pathResolver = pathResolver;
    this.resourceLoader = resourceLoader;
  }

  getType() {
    throw new Error("getType must be implemented by subclass");
  }

  async loadConfig(tenantPath, defaults) {
    throw new Error("loadConfig must be implemented by subclass");
  }

  async loadResources(app, tenantContext) {
    throw new Error("loadResources must be implemented by subclass");
  }

  async canHandle(source) {
    throw new Error("canHandle must be implemented by subclass");
  }
}

/**
 * Local file-system tenant adapter
 */
class LocalTenantAdapter extends TenantAdapter {
  getType() {
    return "local";
  }

  async canHandle(source) {
    return await this.pathResolver.pathExists(source);
  }

  async loadConfig(tenantPath, defaults) {
    return await this.resourceLoader.loadConfig(tenantPath, defaults);
  }

  async loadResources(app, tenantContext) {
    const tenantPath = tenantContext.config.path || tenantContext.config.source;
    const { id: tenantId, config } = tenantContext;

    console.log({
      tenantId,
      tenantPath,
      config: tenantContext.config,
    });
    try {
      // Load schemas first
      const schemaPath = path.join(tenantPath, "schemas");
      if (await this.pathResolver.pathExists(schemaPath)) {
        const result = await this.resourceLoader.loadSchemas(app, schemaPath);
        if (result.success) {
          tenantContext.schemas.add(schemaPath);
        }
      }

      // Load services
      const servicesPath = path.join(tenantPath, "services");
      if (await this.pathResolver.pathExists(servicesPath)) {
        const services = await this.resourceLoader.loadServices(servicesPath, {
          db: app.db,
          config,
          tenantId,
        });

        Object.entries(services).forEach(([name, service]) => {
          tenantContext.addService(name, service);
        });

        this.logger.info(
          `Loaded ${Object.keys(services).length} services for tenant ${tenantId}`
        );
      }

      // Load plugins
      const pluginsPath = path.join(tenantPath, "plugins");
      if (await this.pathResolver.pathExists(pluginsPath)) {
        const pluginDirs = await fs.readdir(pluginsPath);
        for (const pluginName of pluginDirs) {
          const pluginPath = path.join(pluginsPath, pluginName);
          const success = await this.resourceLoader.loadPlugin(
            app,
            pluginPath,
            {
              tenant: tenantId,
              config,
              fastify: app,
              namespace: `/Local/${tenantId}/Plugin`,
            }
          );

          if (success) {
            tenantContext.addPlugin(pluginName);
          }
        }
      }

      // Load routes
      const routesPath = path.join(tenantPath, "routes");
      if (await this.pathResolver.pathExists(routesPath)) {
        const success = await this.resourceLoader.loadPlugin(app, routesPath, {
          tenant: tenantId,
          config,
          prefix: `/${tenantId}`,
          fastify: app,
          namespace: `/Local/${tenantId}/Routes`,
        });

        if (success) {
          tenantContext.routes.add(routesPath);
        }
      }
    } catch (err) {
      this.logger.error(
        { err },
        `Failed to load resources for local tenant ${tenantId}`
      );
      throw err;
    }
  }
}

/**
 * Enhanced NPM package tenant adapter
 */
class NPMTenantAdapter extends TenantAdapter {
  constructor(logger, pathResolver, resourceLoader) {
    super(logger, pathResolver, resourceLoader);
    this.moduleCache = new Map();
  }

  getType() {
    return "npm";
  }

  async canHandle(source) {
    try {
      await this.pathResolver.getModuleInfo(source);
      return true;
    } catch {
      return false;
    }
  }

  async loadConfig(packageName, defaults) {
    try {
      const moduleInfo = await this.pathResolver.getModuleInfo(packageName);

      // Try to load the main tenant module
      const mainModule = await import(packageName);
      const tenantConfig = mainModule.default || mainModule;

      // Extract tenant configuration
      let config = { ...defaults };

      if (typeof tenantConfig === "object" && tenantConfig.config) {
        config = merge(config, tenantConfig.config);
      }

      // Set path to module root directory
      config.path = moduleInfo.rootDir;
      config.packageName = packageName;
      config.packageJson = moduleInfo.packageJson;
      config.isTrustedPath = true; // Mark as trusted NPM package

      // Try to get tenant name from module export or package name
      if (tenantConfig.NAME) {
        config.name = tenantConfig.NAME;
      } else {
        // Extract tenant name from package name (remove prefix)
        config.name = packageName.replace(/^fastify-multitenant-/, "");
      }

      // Load additional config from package if it exists
      const packageConfig = await this.resourceLoader.loadConfig(
        config.path,
        {},
        { isTrustedPath: true }
      );
      config = merge(config, packageConfig);

      return config;
    } catch (err) {
      this.logger.error(
        { err },
        `Failed to load NPM tenant config for ${packageName}`
      );
      return { ...defaults, path: null, error: err.message };
    }
  }

  async loadResources(app, tenantContext) {
    const { id: tenantId, config } = tenantContext;
    const packageName = config.packageName;

    try {
      // Load the main tenant module first
      const mainModule = await import(packageName);
      const tenantExport = mainModule.default || mainModule;

      // If the tenant exports a function, register it as a plugin
      if (typeof tenantExport === "function") {
        await app.register(tenantExport, {
          tenant: tenantId,
          config,
          prefix: `/${tenantId}`,
          fastify: app,
        });

        tenantContext.addPlugin(packageName);
        this.logger.info(`Registered NPM tenant ${tenantId} as plugin`);
      }

      // Load additional resources from package structure
      if (config.path && config.isTrustedPath) {
        await this.loadPackageResources(app, tenantContext);
      }
    } catch (err) {
      this.logger.error(
        { err },
        `Failed to load resources for NPM tenant ${tenantId}`
      );
      throw err;
    }
  }

  async loadPackageResources(app, tenantContext) {
    const { id: tenantId, config } = tenantContext;
    const packagePath = config.path;

    this.logger.info(`Loading package resources from: ${packagePath}`);

    try {
      // Load schemas first
      const schemaPath = path.join(packagePath, "schemas");
      if (
        await this.pathResolver.pathExists(schemaPath, { allowTrusted: true })
      ) {
        const result = await this.resourceLoader.loadSchemas(app, schemaPath, {
          isTrustedPath: true,
        });
        if (result.success) {
          tenantContext.schemas.add(schemaPath);
          this.logger.info(`Loaded schemas for NPM tenant ${tenantId}`);
        }
      }

      // Load services
      const servicesPath = path.join(packagePath, "services");
      if (
        await this.pathResolver.pathExists(servicesPath, { allowTrusted: true })
      ) {
        const services = await this.resourceLoader.loadServices(servicesPath, {
          db: app.db,
          config,
          tenantId,
          isTrustedPath: true,
        });

        Object.entries(services).forEach(([name, service]) => {
          tenantContext.addService(name, service);
        });

        this.logger.info(
          `Loaded ${Object.keys(services).length} services for NPM tenant ${tenantId}`
        );
      }

      // Load additional plugins
      const pluginsPath = path.join(packagePath, "plugins");
      if (
        await this.pathResolver.pathExists(pluginsPath, { allowTrusted: true })
      ) {
        try {
          const pluginDirs = await fs.readdir(pluginsPath);
          for (const pluginName of pluginDirs) {
            const pluginPath = path.join(pluginsPath, pluginName);
            const success = await this.resourceLoader.loadPlugin(
              app,
              pluginPath,
              {
                tenant: tenantId,
                config,
                fastify: app,
                isTrustedPath: true,
                namespace: `/NPM/${tenantId}/Plugin`,
              }
            );

            if (success) {
              tenantContext.addPlugin(pluginName);
            }
          }
        } catch (err) {
          this.logger.debug(
            { err },
            `No additional plugins found for NPM tenant ${tenantId}`
          );
        }
      }

      // Load routes
      const routesPath = path.join(packagePath, "routes");
      if (
        await this.pathResolver.pathExists(routesPath, { allowTrusted: true })
      ) {
        const success = await this.resourceLoader.loadPlugin(app, routesPath, {
          tenant: tenantId,
          config,
          prefix: `/${tenantId}`,
          fastify: app,
          isTrustedPath: true,
          namespace: `/NPM/${tenantId}/Routes`,
        });

        if (success) {
          tenantContext.routes.add(routesPath);
          this.logger.info(`Loaded routes for NPM tenant ${tenantId}`);
        }
      }
    } catch (err) {
      this.logger.error(
        { err },
        `Failed to load package resources for NPM tenant ${tenantId}`
      );
      throw err;
    }
  }
}

/**
 * Tenant factory using Factory pattern
 */
class TenantFactory {
  constructor(logger, pathResolver, resourceLoader) {
    this.logger = logger;
    this.adapters = [
      new LocalTenantAdapter(logger, pathResolver, resourceLoader),
      new NPMTenantAdapter(logger, pathResolver, resourceLoader),
    ];
  }

  async createTenant(app, source, tenantId = null) {
    // Find appropriate adapter
    for (const adapter of this.adapters) {
      if (await adapter.canHandle(source)) {
        return await this.buildTenant(app, source, adapter, tenantId);
      }
    }

    throw new Error(`No adapter found for tenant source: ${source}`);
  }

  async buildTenant(app, source, adapter, customTenantId = null) {
    try {
      // Determine tenant ID
      let tenantId = customTenantId;

      if (!tenantId) {
        if (adapter.getType() === "npm") {
          // Extract from package name
          tenantId = source.replace(/^fastify-multitenant-/, "");
        } else {
          // Use directory name
          tenantId = path.basename(source);
        }
      }

      // Load configuration
      const config = await adapter.loadConfig(source, {
        id: tenantId,
        name: tenantId,
        active: true,
        source,
      });

      if (!config.active) {
        this.logger.info(`Tenant ${tenantId} is inactive, skipping`);
        return null;
      }

      // Create tenant context
      const tenantContext = new TenantContext(
        config.name || tenantId,
        config,
        adapter
      );

      // Load tenant resources
      await adapter.loadResources(app, tenantContext);

      this.logger.info(
        `Tenant '${tenantContext.id}' (${adapter.getType()}) loaded successfully`
      );

      return tenantContext;
    } catch (err) {
      this.logger.error({ err }, `Failed to build tenant from ${source}`);
      return null;
    }
  }
}

/**
 * Tenant identification strategy interface
 */
class TenantIdentificationStrategy {
  extractTenantId(request) {
    throw new Error("extractTenantId must be implemented by subclass");
  }
}

/**
 * Multi-source tenant identification strategy
 */
class MultiSourceTenantStrategy extends TenantIdentificationStrategy {
  extractTenantId(request) {
    try {
      // Strategy 1: Check hostname subdomain
      const hostnameMatch = request.hostname?.match(/^([^.]+)\./);
      if (hostnameMatch) {
        return SecurityValidator.validateTenantId(hostnameMatch[1]);
      }

      // Strategy 2: Check URL path
      const pathMatch = request.url?.match(/^\/([^/]+)/);
      if (pathMatch && pathMatch[1] !== "api" && pathMatch[1] !== "health") {
        return SecurityValidator.validateTenantId(pathMatch[1]);
      }

      // Strategy 3: Check header
      if (request.headers["x-tenant-id"]) {
        return SecurityValidator.validateTenantId(
          request.headers["x-tenant-id"]
        );
      }

      return "default-tenant";
    } catch (err) {
      return "default-tenant";
    }
  }
}

/**
 * Tenant registry using Repository pattern
 */
class TenantRegistry {
  constructor(logger, maxTenants = 50) {
    this.logger = logger;
    this.tenants = new Map();
    this.maxTenants = maxTenants;
    this.identificationStrategy = new MultiSourceTenantStrategy();
  }

  setIdentificationStrategy(strategy) {
    if (!(strategy instanceof TenantIdentificationStrategy)) {
      throw new Error("Strategy must extend TenantIdentificationStrategy");
    }
    this.identificationStrategy = strategy;
  }

  register(tenant) {
    if (this.tenants.size >= this.maxTenants) {
      throw new Error(`Maximum number of tenants (${this.maxTenants}) reached`);
    }

    this.tenants.set(tenant.id, tenant);
    this.logger.info(`Tenant '${tenant.id}' registered in registry`);
  }

  unregister(tenantId) {
    const success = this.tenants.delete(tenantId);
    if (success) {
      this.logger.info(`Tenant '${tenantId}' unregistered from registry`);
    }
    return success;
  }

  getTenant(tenantId) {
    return this.tenants.get(tenantId) || null;
  }

  getAllTenants() {
    return Array.from(this.tenants.values());
  }

  getActiveTenants() {
    return this.getAllTenants().filter((tenant) => tenant.active);
  }

  getTenantIdFromRequest(request) {
    try {
      return this.identificationStrategy.extractTenantId(request);
    } catch (err) {
      this.logger.warn({ err }, "Failed to extract tenant ID from request");
      return "default-tenant";
    }
  }

  getStats() {
    const tenants = this.getAllTenants();
    return {
      total: tenants.length,
      active: tenants.filter((t) => t.active).length,
      inactive: tenants.filter((t) => !t.active).length,
      types: tenants.reduce((acc, t) => {
        acc[t.type] = (acc[t.type] || 0) + 1;
        return acc;
      }, {}),
      servicesLoaded: tenants.reduce(
        (sum, t) => sum + t.listServices().length,
        0
      ),
    };
  }
}

/**
 * Tenant management service using Facade pattern
 */
class TenantManager {
  constructor(logger, pathResolver, resourceLoader, pluginManager) {
    this.logger = logger;
    this.pathResolver = pathResolver;
    this.resourceLoader = resourceLoader;
    this.pluginManager = pluginManager;
    this.tenantFactory = new TenantFactory(
      logger,
      pathResolver,
      resourceLoader
    );
    this.tenantRegistry = new TenantRegistry(logger);
  }

  setMaxTenants(max) {
    this.tenantRegistry.maxTenants = max;
  }

  getTenantIdFromRequest(request) {
    return this.tenantRegistry.getTenantIdFromRequest(request);
  }

  getTenant(tenantId) {
    return this.tenantRegistry.getTenant(tenantId);
  }

  getAllTenants() {
    return this.tenantRegistry.getAllTenants();
  }

  getStats() {
    return this.tenantRegistry.getStats();
  }

  async loadTenant(app, source, customTenantId = null) {
    try {
      const tenant = await this.tenantFactory.createTenant(
        app,
        source,
        customTenantId
      );

      if (tenant) {
        this.tenantRegistry.register(tenant);
        return tenant;
      }

      return null;
    } catch (err) {
      this.logger.error({ err }, `Failed to load tenant from ${source}`);
      return null;
    }
  }

  async loadAllTenants(app, config) {
    const loadResults = {
      local: 0,
      npm: 0,
      failed: 0,
    };

    // Load NPM package tenants
    if (config.tenants?.npmPattern) {
      try {
        const npmPackageNames = await this.pluginManager.getNPMPluginNames(
          config.tenants.npmPattern
        );

        this.logger.info(
          `🔍 Found ${npmPackageNames.length} NPM tenant packages matching pattern ${config.tenants.npmPattern}`
        );

        for (const packageName of npmPackageNames) {
          try {
            const tenant = await this.loadTenant(app, packageName);
            if (tenant) {
              loadResults.npm++;
              this.logger.info(
                `✅ NPM tenant '${tenant.id}' loaded successfully`
              );
            } else {
              loadResults.failed++;
            }
          } catch (err) {
            this.logger.error(
              { err },
              `Failed to load NPM tenant ${packageName}`
            );
            loadResults.failed++;
          }
        }
      } catch (err) {
        this.logger.warn({ err }, "Failed to load NPM tenants");
      }
    }

    // Load local tenants
    try {
      const tenantsPath = path.join(this.pathResolver.baseDir, "tenants");

      if (await this.pathResolver.pathExists(tenantsPath)) {
        const tenantDirs = (await fs.readdir(tenantsPath)).filter(
          (dir) => !dir.startsWith(".")
        );

        this.logger.info(
          `🔍 Found ${tenantDirs.length} local tenant directories`
        );

        for (const tenantId of tenantDirs) {
          try {
            const tenantDirPath = path.join(tenantsPath, tenantId);
            const stat = await fs.stat(tenantDirPath);

            if (!stat.isDirectory()) continue;

            const tenant = await this.loadTenant(app, tenantDirPath, tenantId);
            if (tenant) {
              loadResults.local++;
              this.logger.info(
                `✅ Local tenant '${tenant.id}' loaded successfully`
              );
            } else {
              loadResults.failed++;
            }
          } catch (err) {
            this.logger.error(
              { err },
              `Failed to load local tenant ${tenantId}`
            );
            loadResults.failed++;
          }
        }
      }
    } catch (err) {
      this.logger.warn({ err }, "Failed to load local tenants");
    }

    const totalLoaded = loadResults.local + loadResults.npm;
    this.logger.info(
      `🧩 Tenant loading complete: ${totalLoaded} successful (${loadResults.local} local, ${loadResults.npm} npm), ${loadResults.failed} failed`
    );

    return totalLoaded > 0;
  }

  async reloadTenant(app, tenantId) {
    const existingTenant = this.getTenant(tenantId);
    if (!existingTenant) {
      throw new Error(`Tenant ${tenantId} not found`);
    }

    // Get source from existing tenant
    const source = existingTenant.config.source;

    // Unregister existing tenant
    this.tenantRegistry.unregister(tenantId);

    // Reload tenant
    return await this.loadTenant(app, source, tenantId);
  }

  async unloadTenant(tenantId) {
    return this.tenantRegistry.unregister(tenantId);
  }
}

/**
 * Main multi-tenant server class using Facade pattern
 */
class MultiTenantServer {
  constructor(options = {}) {
    this.configManager = new ConfigurationManager(options);
    this.pathResolver = new PathResolver();
    this.resourceLoader = null;
    this.pluginManager = null;
    this.tenantManager = null;
    this.app = null;
  }

  async start(options = {}) {
    try {
      // Merge configuration
      this.configManager.merge(options);
      const config = this.configManager.get();

      // Initialize Fastify
      this.app = Fastify({
        logger: {
          transport: {
            target: "pino-pretty",
            options: {
              translateTime: "HH:MM:ss Z",
              ignore: "pid,hostname",
            },
          },
          level: config.logger.level,
        },
        trustProxy: true,
      });

      // Initialize managers with logger
      this.resourceLoader = new ResourceLoader(this.app.log, this.pathResolver);
      this.pluginManager = new PluginManager(this.app.log, this.pathResolver);
      this.tenantManager = new TenantManager(
        this.app.log,
        this.pathResolver,
        this.resourceLoader,
        this.pluginManager
      );

      // Set max tenants from config
      this.tenantManager.setMaxTenants(config.tenants?.maxConcurrent || 50);

      // Decorate app with managers
      this.app.decorate("tenantManager", this.tenantManager);
      this.app.decorate("resourceLoader", this.resourceLoader);
      this.app.decorate("pluginManager", this.pluginManager);
      this.app.decorate("configManager", this.configManager);

      // Setup request hooks
      this.setupRequestHooks();

      // Setup health check endpoint
      this.setupHealthCheck();

      // Load core plugins
      await this.loadCorePlugins(config);

      // Load NPM plugins (separate from tenants)
      await this.pluginManager.loadNPMPlugins(
        this.app,
        config.plugins?.npmPattern || "fastify-multitenant-*"
      );

      // Load all tenants
      await this.tenantManager.loadAllTenants(this.app, config);

      // Setup graceful shutdown
      this.setupGracefulShutdown();

      // Start server
      await this.app.listen({
        port: config.server.port,
        host: config.server.host,
      });

      this.app.log.info(`Server listening on port ${config.server.port}`);
      this.app.log.info(
        `✅ Loaded ${this.tenantManager.getAllTenants().length} tenants`
      );

      // Setup ready hook
      this.app.ready(async () => {
        this.app.log.info("Server routes:");
        this.app.log.info(this.app.printRoutes({ commonPrefix: false }));

        // Only sync database if explicitly configured for development
        if (process.env.NODE_ENV === "development" && this.app.db?.sync) {
          this.app.log.warn("Running database sync in development mode");
          await this.app.db.sync({ force: false });
        }
      });

      return this.app;
    } catch (err) {
      this.app?.log?.error({ err }, "Failed to start server") ||
        console.error("Failed to start server:", err);
      throw err;
    }
  }

  setupRequestHooks() {
    // Request logging and tenant resolution
    this.app.addHook("onRequest", async (request, reply) => {
      try {
        const tenantId = this.tenantManager.getTenantIdFromRequest(request);
        const tenant = this.tenantManager.getTenant(tenantId);

        request.tenantId = tenantId;
        request.tenant = tenant;
        request.log = request.log.child({ tenant: tenantId });

        if (!tenant && request.url.startsWith("/api/")) {
          reply.code(404).send({
            success: false,
            error: `Tenant '${tenantId}' not found`,
            availableTenants: this.tenantManager
              .getAllTenants()
              .map((t) => t.id),
          });
        }
      } catch (err) {
        request.log.error({ err }, "Error in tenant resolution");
        reply.code(400).send({
          success: false,
          error: "Invalid tenant identifier",
        });
      }
    });

    // Security headers
    this.app.addHook("onSend", async (request, reply, payload) => {
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("X-Frame-Options", "DENY");
      reply.header("X-XSS-Protection", "1; mode=block");
      return payload;
    });

    // Error handling
    this.app.setErrorHandler(async (error, request, reply) => {
      request.log.error({ err: error }, "Request error");

      const isDev = process.env.NODE_ENV === "development";

      reply.code(error.statusCode || 500).send({
        success: false,
        error: isDev ? error.message : "Internal server error",
        ...(isDev && { stack: error.stack }),
      });
    });
  }

  setupHealthCheck() {
    this.app.get("/health", async (request, reply) => {
      const tenantStats = this.tenantManager.getStats();

      return {
        status: "healthy",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        tenants: tenantStats,
        version: process.env.npm_package_version || "unknown",
      };
    });

    this.app.get("/tenants", async (request, reply) => {
      const tenants = this.tenantManager.getAllTenants().map((t) => t.toJSON());

      return {
        success: true,
        data: tenants,
        count: tenants.length,
      };
    });
  }

  async loadCorePlugins(config) {
    const pluginsDir = path.join(this.pathResolver.baseDir, "plugins");

    if (!(await this.pathResolver.pathExists(pluginsDir))) {
      this.app.log.warn("No core plugins directory found");
      return;
    }

    try {
      const pluginDirs = await fs.readdir(pluginsDir);
      const coreOrder = config.plugins?.coreOrder || [];

      const orderedPlugins = [
        ...coreOrder.filter((name) => pluginDirs.includes(name)),
        ...pluginDirs.filter(
          (name) => !coreOrder.includes(name) && !name.startsWith(".")
        ),
      ];

      const result = await this.pluginManager.loadLocalPlugins(
        this.app,
        orderedPlugins,
        config.plugins || {}
      );

      this.app.log.info("Core plugins loaded successfully");
      return result;
    } catch (err) {
      this.app.log.error({ err }, "Failed to load core plugins");
      throw err;
    }
  }

  setupGracefulShutdown() {
    const closeListeners = closeWithGrace(
      { delay: 500 },
      async ({ signal, err }) => {
        if (err) {
          this.app.log.error({ err }, "Server closing due to error");
        } else {
          this.app.log.info(`Server closing due to ${signal}`);
        }

        try {
          await this.app.close();
        } catch (closeErr) {
          this.app.log.error({ err: closeErr }, "Error during server close");
        }
      }
    );

    this.app.addHook("onClose", (instance, done) => {
      closeListeners.uninstall();
      done();
    });

    process.on("uncaughtException", (err) => {
      this.app.log.fatal({ err }, "Uncaught exception");
      process.exit(1);
    });

    process.on("unhandledRejection", (reason, promise) => {
      this.app.log.fatal({ reason, promise }, "Unhandled rejection");
      process.exit(1);
    });
  }

  async initTenant(tenantId, options = {}) {
    if (!this.app) {
      throw new Error("Server not started. Call start() first.");
    }

    const tenant = await this.tenantManager.loadTenant(this.app, tenantId);

    if (!tenant) {
      throw new Error(`Failed to initialize tenant ${tenantId}`);
    }

    return tenant;
  }

  async reloadTenant(tenantId) {
    if (!this.app) {
      throw new Error("Server not started. Call start() first.");
    }

    return await this.tenantManager.reloadTenant(this.app, tenantId);
  }

  async getTenantStats() {
    return this.tenantManager.getStats();
  }

  async stop() {
    if (this.app) {
      await this.app.close();
      this.app = null;
    }
  }
}

/**
 * Factory function for backward compatibility
 */
export async function start(options = {}) {
  const server = new MultiTenantServer(options);
  return await server.start();
}

/**
 * Export classes for advanced usage
 */
export {
  MultiTenantServer,
  ConfigurationManager,
  PluginManager,
  TenantManager,
  TenantRegistry,
  TenantFactory,
  ResourceLoader,
  PathResolver,
  SecurityValidator,
  TenantContext,
  TenantAdapter,
  LocalTenantAdapter,
  NPMTenantAdapter,
  TenantIdentificationStrategy,
  MultiSourceTenantStrategy,
};

/**
 * Default export for convenience
 */
export default {
  start,
  MultiTenantServer,
  ConfigurationManager,
  PluginManager,
  TenantManager,
  ResourceLoader,
  PathResolver,
};

/**
 * Auto-start server if this file is run directly
 */
if (import.meta.url === `file://${__filename}`) {
  start().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}
