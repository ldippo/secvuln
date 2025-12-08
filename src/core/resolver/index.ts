export {
  getTargetVersion,
  calculateVersionChangeType,
  createDirectFixAction,
  applyUpgrade,
  applyResolution,
  getCurrentVersion,
} from './direct.js';

export {
  findParentFix,
  createResolutionFix,
  buildResolutionKey,
  getExistingResolutions,
  applyResolutions,
} from './transitive.js';
