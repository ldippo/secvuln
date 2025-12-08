export {
  fetchGitHubReleases,
  getPackageRepositoryUrl,
  parseGitHubUrl,
  extractBreakingChanges,
  hasBreakingChangeIndicators,
} from './github.js';

export {
  analyzeChangelog,
  getVersionChangeType,
  isLikelySafeUpgrade,
  getUpgradeRisk,
  formatChangelogForDisplay,
} from './analyzer.js';
