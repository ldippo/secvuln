export {
  getTargetVersion,
  calculateVersionChangeType,
  createDirectFixAction,
  applyUpgrade,
  applyResolution,
  getCurrentVersion,
} from './direct.js';

export {
  fetchPackageInfo,
  findParentFix,
  createResolutionFix,
  buildResolutionKey,
  getExistingResolutions,
  applyResolutions,
  removeResolutions,
} from './transitive.js';

export { auditResolutions } from './audit-resolutions.js';
