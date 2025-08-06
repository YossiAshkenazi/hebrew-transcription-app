const logger = require('./logger');
const moment = require('moment');
const { v4: uuidv4 } = require('uuid');

/**
 * Advanced Template Engine
 * Provides comprehensive template processing with custom functions, conditionals, and filters
 */
class TemplateEngine {
  constructor() {
    this.templates = new Map();
    this.customFunctions = new Map();
    this.filters = new Map();
    this.partials = new Map();
    this.globalVariables = new Map();
    
    // Template compilation cache
    this.compiledTemplates = new Map();
    
    this.initializeBuiltInFunctions();
    this.initializeBuiltInFilters();
    this.initializeGlobalVariables();
  }

  /**
   * Initialize built-in template functions
   */
  initializeBuiltInFunctions() {
    const functions = {
      // Date and time functions
      now: () => new Date().toISOString(),
      formatDate: (date, format = 'YYYY-MM-DD HH:mm:ss') => {
        return moment(date).format(format);
      },
      addDays: (date, days) => {
        return moment(date).add(days, 'days').toISOString();
      },
      subtractDays: (date, days) => {
        return moment(date).subtract(days, 'days').toISOString();
      },
      
      // String functions
      uppercase: (str) => String(str).toUpperCase(),
      lowercase: (str) => String(str).toLowerCase(),
      capitalize: (str) => {
        return String(str).charAt(0).toUpperCase() + String(str).slice(1).toLowerCase();
      },
      truncate: (str, length = 100, suffix = '...') => {
        const text = String(str);
        return text.length > length ? text.substring(0, length) + suffix : text;
      },
      replace: (str, search, replacement) => {
        return String(str).replace(new RegExp(search, 'g'), replacement);
      },
      
      // Number functions
      round: (num, decimals = 0) => {
        return Number(Math.round(num + 'e' + decimals) + 'e-' + decimals);
      },
      percentage: (value, total) => {
        return Math.round((value / total) * 100);
      },
      
      // Array functions
      length: (arr) => Array.isArray(arr) ? arr.length : 0,
      join: (arr, separator = ', ') => Array.isArray(arr) ? arr.join(separator) : '',
      first: (arr) => Array.isArray(arr) && arr.length > 0 ? arr[0] : null,
      last: (arr) => Array.isArray(arr) && arr.length > 0 ? arr[arr.length - 1] : null,
      
      // Hebrew-specific functions
      hebrewDate: (date) => {
        // Simplified Hebrew date conversion
        return moment(date).format('DD/MM/YYYY') + ' (Hebrew date placeholder)';
      },
      isShabbat: (date) => {
        const day = moment(date).day();
        return day === 6; // Saturday
      },
      
      // Utility functions
      uuid: () => uuidv4(),
      random: (min = 0, max = 100) => Math.floor(Math.random() * (max - min + 1)) + min,
      default: (value, defaultValue) => value !== undefined && value !== null ? value : defaultValue,
      
      // Conditional functions
      if: (condition, trueValue, falseValue = '') => condition ? trueValue : falseValue,
      unless: (condition, trueValue, falseValue = '') => !condition ? trueValue : falseValue,
      
      // Object functions
      keys: (obj) => typeof obj === 'object' ? Object.keys(obj) : [],
      values: (obj) => typeof obj === 'object' ? Object.values(obj) : [],
      hasProperty: (obj, prop) => typeof obj === 'object' && obj.hasOwnProperty(prop),
      
      // Math functions
      min: (...args) => Math.min(...args.filter(arg => typeof arg === 'number')),
      max: (...args) => Math.max(...args.filter(arg => typeof arg === 'number')),
      sum: (arr) => Array.isArray(arr) ? arr.reduce((sum, val) => sum + (Number(val) || 0), 0) : 0,
      average: (arr) => {
        if (!Array.isArray(arr) || arr.length === 0) {return 0;}
        const sum = arr.reduce((total, val) => total + (Number(val) || 0), 0);
        return sum / arr.length;
      }
    };

    for (const [name, func] of Object.entries(functions)) {
      this.customFunctions.set(name, func);
    }

    logger.info(`Loaded ${this.customFunctions.size} built-in template functions`);
  }

  /**
   * Initialize built-in filters
   */
  initializeBuiltInFilters() {
    const filters = {
      // Text filters
      upper: (value) => String(value).toUpperCase(),
      lower: (value) => String(value).toLowerCase(),
      title: (value) => String(value).replace(/\w\S*/g, (txt) => 
        txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()),
      
      // Number filters
      currency: (value, currency = 'USD') => {
        const num = Number(value) || 0;
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: currency
        }).format(num);
      },
      
      // Date filters
      dateFormat: (value, format = 'YYYY-MM-DD') => moment(value).format(format),
      timeAgo: (value) => moment(value).fromNow(),
      
      // Array filters
      sort: (arr, key) => {
        if (!Array.isArray(arr)) {return arr;}
        return arr.sort((a, b) => {
          const aVal = key ? a[key] : a;
          const bVal = key ? b[key] : b;
          return aVal > bVal ? 1 : -1;
        });
      },
      reverse: (arr) => Array.isArray(arr) ? [...arr].reverse() : arr,
      unique: (arr) => Array.isArray(arr) ? [...new Set(arr)] : arr,
      
      // Formatting filters
      json: (value) => JSON.stringify(value, null, 2),
      escape: (value) => {
        return String(value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#x27;');
      },
      
      // Hebrew-specific filters
      rtl: (value) => `<span dir="rtl">${value}</span>`,
      hebrew: (value) => {
        // Simple Hebrew text processing
        const hebrewPattern = /[\u0590-\u05FF]/;
        return hebrewPattern.test(value) ? `<span lang="he" dir="rtl">${value}</span>` : value;
      }
    };

    for (const [name, filter] of Object.entries(filters)) {
      this.filters.set(name, filter);
    }

    logger.info(`Loaded ${this.filters.size} built-in template filters`);
  }

  /**
   * Initialize global variables
   */
  initializeGlobalVariables() {
    this.globalVariables.set('app', {
      name: 'Hebrew Transcription Service',
      version: '1.0.0',
      url: process.env.BASE_URL || 'http://localhost:3001'
    });

    this.globalVariables.set('system', {
      timestamp: () => new Date().toISOString(),
      timezone: process.env.TZ || 'UTC',
      environment: process.env.NODE_ENV || 'development'
    });
  }

  /**
   * Register custom template
   */
  registerTemplate(name, template, metadata = {}) {
    this.templates.set(name, {
      name,
      template,
      metadata: {
        ...metadata,
        createdAt: new Date().toISOString(),
        compiledAt: null
      }
    });

    // Clear compiled cache
    this.compiledTemplates.delete(name);

    logger.debug(`Registered template: ${name}`);
  }

  /**
   * Register custom function
   */
  registerFunction(name, func, description = '') {
    if (typeof func !== 'function') {
      throw new Error('Custom function must be a function');
    }

    this.customFunctions.set(name, func);
    logger.debug(`Registered custom function: ${name}`);
  }

  /**
   * Register custom filter
   */
  registerFilter(name, filter, description = '') {
    if (typeof filter !== 'function') {
      throw new Error('Custom filter must be a function');
    }

    this.filters.set(name, filter);
    logger.debug(`Registered custom filter: ${name}`);
  }

  /**
   * Register partial template
   */
  registerPartial(name, template) {
    this.partials.set(name, template);
    logger.debug(`Registered partial template: ${name}`);
  }

  /**
   * Process template with data
   */
  async processTemplate(templateName, data = {}, options = {}) {
    try {
      if (!this.templates.has(templateName)) {
        throw new Error(`Template not found: ${templateName}`);
      }

      const templateData = this.templates.get(templateName);
      const compiled = await this.compileTemplate(templateName, templateData.template);
      
      // Merge data with global variables
      const contextData = {
        ...this.getGlobalVariables(),
        ...data,
        ...options.additionalContext
      };

      const result = await this.executeTemplate(compiled, contextData, options);
      
      logger.debug(`Template processed: ${templateName}`);
      return result;

    } catch (error) {
      logger.error(`Template processing failed for ${templateName}:`, error);
      throw error;
    }
  }

  /**
   * Process template string directly
   */
  async processTemplateString(templateString, data = {}, options = {}) {
    try {
      const compiled = await this.compileTemplateString(templateString);
      
      const contextData = {
        ...this.getGlobalVariables(),
        ...data,
        ...options.additionalContext
      };

      return await this.executeTemplate(compiled, contextData, options);

    } catch (error) {
      logger.error('Template string processing failed:', error);
      throw error;
    }
  }

  /**
   * Compile template for better performance
   */
  async compileTemplate(templateName, templateString) {
    if (this.compiledTemplates.has(templateName)) {
      return this.compiledTemplates.get(templateName);
    }

    const compiled = await this.compileTemplateString(templateString);
    this.compiledTemplates.set(templateName, compiled);

    // Update metadata
    const template = this.templates.get(templateName);
    if (template) {
      template.metadata.compiledAt = new Date().toISOString();
    }

    return compiled;
  }

  /**
   * Compile template string
   */
  async compileTemplateString(templateString) {
    // Parse template and create executable instructions
    const instructions = this.parseTemplate(templateString);
    
    return {
      instructions,
      originalTemplate: templateString,
      compiledAt: new Date().toISOString()
    };
  }

  /**
   * Parse template into executable instructions
   */
  parseTemplate(templateString) {
    const instructions = [];
    let position = 0;
    const template = String(templateString);

    // Regular expressions for different template syntax
    const patterns = {
      variable: /\{\{\s*([^}]+?)\s*\}\}/g,
      function: /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*([^)]*?)\s*\)\s*\}\}/g,
      conditional: /\{\{\s*#if\s+([^}]+?)\s*\}\}(.*?)\{\{\s*\/if\s*\}\}/gs,
      loop: /\{\{\s*#each\s+([^}]+?)\s*\}\}(.*?)\{\{\s*\/each\s*\}\}/gs,
      partial: /\{\{\s*>\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g
    };

    while (position < template.length) {
      let nearestMatch = null;
      let nearestPosition = template.length;
      let matchType = null;

      // Find the nearest template expression
      for (const [type, pattern] of Object.entries(patterns)) {
        pattern.lastIndex = position;
        const match = pattern.exec(template);
        
        if (match && match.index < nearestPosition) {
          nearestMatch = match;
          nearestPosition = match.index;
          matchType = type;
        }
      }

      // Add literal text before the match
      if (nearestPosition > position) {
        instructions.push({
          type: 'literal',
          value: template.substring(position, nearestPosition)
        });
      }

      if (nearestMatch) {
        // Add template instruction
        instructions.push({
          type: matchType,
          match: nearestMatch,
          expression: nearestMatch[1],
          content: nearestMatch[2] || null
        });

        position = nearestMatch.index + nearestMatch[0].length;
      } else {
        // Add remaining literal text
        if (position < template.length) {
          instructions.push({
            type: 'literal',
            value: template.substring(position)
          });
        }
        break;
      }
    }

    return instructions;
  }

  /**
   * Execute compiled template
   */
  async executeTemplate(compiled, data, options = {}) {
    let result = '';

    for (const instruction of compiled.instructions) {
      try {
        switch (instruction.type) {
        case 'literal':
          result += instruction.value;
          break;

        case 'variable':
          const value = this.resolveVariable(instruction.expression, data);
          result += this.applyFilters(value, instruction.expression);
          break;

        case 'function':
          const funcResult = await this.executeFunction(instruction.match, data);
          result += String(funcResult || '');
          break;

        case 'conditional':
          const conditionResult = await this.executeConditional(instruction, data, options);
          result += conditionResult;
          break;

        case 'loop':
          const loopResult = await this.executeLoop(instruction, data, options);
          result += loopResult;
          break;

        case 'partial':
          const partialResult = await this.executePartial(instruction.expression, data, options);
          result += partialResult;
          break;

        default:
          logger.warn(`Unknown instruction type: ${instruction.type}`);
        }
      } catch (error) {
        if (options.strict) {
          throw error;
        }
        logger.warn('Template instruction failed:', error);
        result += options.errorPlaceholder || `[ERROR: ${error.message}]`;
      }
    }

    return result;
  }

  /**
   * Resolve variable value from data
   */
  resolveVariable(expression, data) {
    // Handle filters (variable | filter1 | filter2:arg)
    const parts = expression.split('|').map(part => part.trim());
    const variablePath = parts[0];
    const filterChain = parts.slice(1);

    // Get variable value
    let value = this.getNestedValue(data, variablePath);

    // Apply filters
    for (const filterExpr of filterChain) {
      const [filterName, ...args] = filterExpr.split(':').map(arg => arg.trim());
      
      if (this.filters.has(filterName)) {
        const filter = this.filters.get(filterName);
        const filterArgs = args.map(arg => this.parseArgument(arg, data));
        value = filter(value, ...filterArgs);
      }
    }

    return value;
  }

  /**
   * Apply filters to value
   */
  applyFilters(value, expression) {
    // Filters are handled in resolveVariable
    return value !== undefined && value !== null ? String(value) : '';
  }

  /**
   * Execute template function
   */
  async executeFunction(match, data) {
    const funcName = match[1];
    const argsString = match[2] || '';

    if (!this.customFunctions.has(funcName)) {
      throw new Error(`Unknown function: ${funcName}`);
    }

    const func = this.customFunctions.get(funcName);
    const args = this.parseArguments(argsString, data);

    try {
      const result = await func(...args);
      return result;
    } catch (error) {
      throw new Error(`Function ${funcName} failed: ${error.message}`);
    }
  }

  /**
   * Execute conditional block
   */
  async executeConditional(instruction, data, options) {
    const condition = this.evaluateCondition(instruction.expression, data);
    
    if (condition) {
      return await this.processTemplateString(instruction.content, data, options);
    }

    return '';
  }

  /**
   * Execute loop block
   */
  async executeLoop(instruction, data, options) {
    const expression = instruction.expression.trim();
    const [itemVar, arrayPath] = expression.split(' in ').map(part => part.trim());
    
    const array = this.getNestedValue(data, arrayPath);
    if (!Array.isArray(array)) {
      return '';
    }

    let result = '';
    for (let i = 0; i < array.length; i++) {
      const item = array[i];
      const loopData = {
        ...data,
        [itemVar]: item,
        index: i,
        first: i === 0,
        last: i === array.length - 1,
        length: array.length
      };

      const loopResult = await this.processTemplateString(instruction.content, loopData, options);
      result += loopResult;
    }

    return result;
  }

  /**
   * Execute partial template
   */
  async executePartial(partialName, data, options) {
    if (!this.partials.has(partialName)) {
      throw new Error(`Partial not found: ${partialName}`);
    }

    const partialTemplate = this.partials.get(partialName);
    return await this.processTemplateString(partialTemplate, data, options);
  }

  /**
   * Evaluate condition expression
   */
  evaluateCondition(expression, data) {
    try {
      // Simple condition evaluation
      // In production, use a proper expression parser
      const sanitizedExpression = expression.replace(/[^a-zA-Z0-9_.() !=<>]/g, '');
      
      // Replace variables with their values
      let evaluableExpression = sanitizedExpression.replace(/([a-zA-Z_][a-zA-Z0-9_.]*)/g, (match) => {
        const value = this.getNestedValue(data, match);
        if (typeof value === 'string') {
          return `"${value}"`;
        }
        return JSON.stringify(value);
      });

      // Use Function constructor for safe evaluation
      const func = new Function('return ' + evaluableExpression);
      return func();
    } catch (error) {
      logger.warn(`Condition evaluation failed: ${expression}`, error);
      return false;
    }
  }

  /**
   * Parse function arguments
   */
  parseArguments(argsString, data) {
    if (!argsString.trim()) {
      return [];
    }

    const args = argsString.split(',').map(arg => arg.trim());
    return args.map(arg => this.parseArgument(arg, data));
  }

  /**
   * Parse single argument
   */
  parseArgument(arg, data) {
    // String literal
    if ((arg.startsWith('"') && arg.endsWith('"')) || 
        (arg.startsWith('\'') && arg.endsWith('\''))) {
      return arg.slice(1, -1);
    }

    // Number literal
    if (/^-?\d+(\.\d+)?$/.test(arg)) {
      return parseFloat(arg);
    }

    // Boolean literal
    if (arg === 'true') {return true;}
    if (arg === 'false') {return false;}
    if (arg === 'null') {return null;}
    if (arg === 'undefined') {return undefined;}

    // Variable reference
    return this.getNestedValue(data, arg);
  }

  /**
   * Get nested value from object using dot notation
   */
  getNestedValue(obj, path) {
    if (!path || !obj) {return obj;}
    
    return path.split('.').reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : undefined;
    }, obj);
  }

  /**
   * Get global variables with functions evaluated
   */
  getGlobalVariables() {
    const globals = {};
    
    for (const [key, value] of this.globalVariables.entries()) {
      if (typeof value === 'object') {
        globals[key] = {};
        for (const [subKey, subValue] of Object.entries(value)) {
          globals[key][subKey] = typeof subValue === 'function' ? subValue() : subValue;
        }
      } else {
        globals[key] = typeof value === 'function' ? value() : value;
      }
    }

    return globals;
  }

  /**
   * Get all registered templates
   */
  getAllTemplates() {
    const templates = {};
    for (const [name, template] of this.templates.entries()) {
      templates[name] = {
        name: template.name,
        metadata: template.metadata
      };
    }
    return templates;
  }

  /**
   * Get template by name
   */
  getTemplate(name) {
    return this.templates.get(name);
  }

  /**
   * Remove template
   */
  removeTemplate(name) {
    this.templates.delete(name);
    this.compiledTemplates.delete(name);
    logger.debug(`Removed template: ${name}`);
  }

  /**
   * Clear all compiled templates (force recompilation)
   */
  clearCompiledCache() {
    this.compiledTemplates.clear();
    logger.debug('Cleared compiled template cache');
  }

  /**
   * Validate template syntax
   */
  validateTemplate(templateString) {
    const errors = [];
    const warnings = [];

    try {
      const instructions = this.parseTemplate(templateString);
      
      // Check for unmatched brackets
      const openTags = [];
      for (const instruction of instructions) {
        if (instruction.type === 'conditional') {
          // Check if conditional is properly closed
          if (!instruction.content.includes('{{/if}}')) {
            errors.push('Unclosed conditional block');
          }
        }
        
        if (instruction.type === 'loop') {
          // Check if loop is properly closed
          if (!instruction.content.includes('{{/each}}')) {
            errors.push('Unclosed loop block');
          }
        }
      }

      // Check for undefined partials
      instructions.forEach(instruction => {
        if (instruction.type === 'partial' && !this.partials.has(instruction.expression)) {
          warnings.push(`Partial not found: ${instruction.expression}`);
        }
      });

    } catch (error) {
      errors.push(`Template parsing failed: ${error.message}`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Get template usage statistics
   */
  getUsageStatistics() {
    return {
      totalTemplates: this.templates.size,
      compiledTemplates: this.compiledTemplates.size,
      customFunctions: this.customFunctions.size,
      customFilters: this.filters.size,
      partials: this.partials.size,
      globalVariables: this.globalVariables.size
    };
  }
}

module.exports = new TemplateEngine();