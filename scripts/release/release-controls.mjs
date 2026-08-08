export function verifyReleaseControls({ repository, environment, reviewerLogin }) {
  if (repository.visibility !== 'public') {
    throw new Error('The source repository must be public for npm provenance and protected-environment controls.')
  }
  const requiredReviewers = environment.protection_rules?.find((rule) => rule.type === 'required_reviewers')
  if (!requiredReviewers) {
    throw new Error('The package-publishing environment must require a reviewer.')
  }
  const reviewer = requiredReviewers.reviewers?.find((entry) => entry.reviewer?.login === reviewerLogin)
  if (!reviewer) {
    throw new Error(`The package-publishing environment must allow reviewer ${reviewerLogin}.`)
  }
  if (requiredReviewers.prevent_self_review) {
    throw new Error('Self-review must remain enabled while the repository has one operator.')
  }
}
