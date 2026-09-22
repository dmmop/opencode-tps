module.exports = {
  extends: ["@commitlint/config-conventional"],
  defaultIgnores: false,
  ignores: [(message) => /^Merge (branch|pull request|remote-tracking branch|tag) /.test(message)],
  rules: {
    "subject-case": [0],
    "header-max-length": [2, "always", 70],
    "type-enum": [2, "always", ["build", "chore", "ci", "docs", "feat", "fix", "perf", "ref", "refactor", "revert", "style", "test", "meta", "license"]],
  },
};
