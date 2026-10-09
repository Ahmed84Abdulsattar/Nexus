export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Subjects start with a backlog ID (for example "S0-01 monorepo skeleton"), which
    // the default subject-case rule rejects as sentence case.
    'subject-case': [0],
  },
};
