#!/bin/bash
set -e

# Release checklist for ccinspect
# Usage: ./scripts/release.sh <version>
# Example: ./scripts/release.sh 0.2.0
#
# Prerequisites:
#   1. npm account at https://www.npmjs.com
#   2. Automation access token from https://www.npmjs.com/settings/USERNAME/tokens
#   3. NPM_TOKEN added as GitHub repo secret (Settings > Secrets > Actions)

VERSION=$1

if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/release.sh <version>"
  echo "Example: ./scripts/release.sh 0.2.0"
  exit 1
fi

echo "=== ccinspect release v${VERSION} ==="

# 1. Verify clean working tree
if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree not clean. Commit or stash changes first."
  exit 1
fi

# 2. Run tests
echo "Running tests..."
npm run test

# 3. Run lint
echo "Linting..."
npm run lint

# 4. Run build
echo "Building..."
npm run build

# 5. Verify pack contents
echo "Checking package contents..."
npm pack --dry-run

# 6. Bump version
echo "Bumping version to ${VERSION}..."
npm version "${VERSION}" --no-git-tag-version

# 7. Commit and tag
git add -A
git commit -m "release: v${VERSION}"
git tag "v${VERSION}"

echo ""
echo "=== Ready to publish ==="
echo "Review the commit, then push:"
echo "  git push origin main --tags"
echo ""
echo "GitHub Actions will handle npm publish + GitHub Release."
