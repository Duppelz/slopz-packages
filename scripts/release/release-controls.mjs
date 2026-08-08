export function verifyReleaseControls({ repository, environment }) {
  if (repository.visibility !== 'public') {
    throw new Error('The source repository must be public for npm provenance and protected-environment controls.')
  }
  const requiredReviewers = environment.protection_rules?.find((rule) => rule.type === 'required_reviewers')
  if (requiredReviewers) {
    throw new Error('Automated next releases must not wait for a routine environment reviewer.')
  }
  if (
    environment.deployment_branch_policy?.protected_branches !== true ||
    environment.deployment_branch_policy?.custom_branch_policies !== false
  ) {
    throw new Error('The package-publishing environment must accept only protected branches.')
  }
}
