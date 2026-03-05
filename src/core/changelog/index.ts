export {
  fetchGitHubReleases,
  getPackageRepositoryUrl,
  parseGitHubUrl,
  extractBreakingChanges,
  hasBreakingChangeIndicators,
  parseChangelogMarkdown,
} from './github.js';

export {
  analyzeChangelog,
  getVersionChangeType,
  isLikelySafeUpgrade,
  getUpgradeRisk,
  formatChangelogForDisplay,
} from './analyzer.js';
