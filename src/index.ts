// Main entry point for programmatic usage
export { runFixCommand } from './commands/fix.js';
export { runTestsCommand } from './commands/test.js';

// Core modules
export * from './types/index.js';
export * from './core/audit/index.js';
export * from './core/changelog/index.js';
export * from './core/resolver/index.js';
export * from './core/workspace/detector.js';
export * from './core/package-manager.js';
