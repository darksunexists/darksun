# DarkSun Eliza Workflow

This document outlines our workflow for managing our custom version of Eliza while tracking upstream changes.

## Branch Structure

- `main`: Our stable, production-ready branch with custom features
- `develop`: Main development branch where features are integrated
- `feature/*`: Feature branches for new custom functionality (e.g., `feature/add-custom-provider`)
- `release/v*-ds`: Release preparation branches
- `upstream-v*`: Branches tracking upstream releases

## Feature Branch Naming Convention

Feature branches should follow this naming pattern:

- `feature/add-*` for new features
- `feature/improve-*` for improvements
- `feature/fix-*` for bug fixes
- `feature/update-*` for updates

Examples:

- `feature/add-custom-provider`
- `feature/improve-error-handling`
- `feature/fix-memory-leak`
- `feature/update-dependencies`

## Tag Structure

- `v{MAJOR}.{MINOR}.{PATCH}-ds`: Our release versions
- `upstream/v{MAJOR}.{MINOR}.{PATCH}`: Tracked upstream versions

## Common Workflows

### Tracking New Upstream Releases

```bash
# Fetch latest upstream changes and tags
git fetch upstream --tags

# Create branch from upstream tag
git checkout -b upstream-v1.2.3 upstream/v1.2.3

# Merge upstream into develop
git checkout develop
git merge upstream-v1.2.3
```

### Developing Custom Features

```bash
# Create feature branch
git checkout develop
git checkout -b feature/your-feature

# Make changes and commit
git commit -m "feat: your feature description"

# Push to origin and create PR
git push origin feature/your-feature
# Create PR to develop branch
```

### Release Process

```bash
# Create release branch
git checkout develop
git checkout -b release/v1.2.3-ds

# Testing and final adjustments
# ... make any necessary fixes ...

# Tag and merge to main
git tag v1.2.3-ds
git checkout main
git merge release/v1.2.3-ds
git push origin main --tags
```

## Version Compatibility

We maintain compatibility with upstream versions by:

1. Tracking upstream releases via tags
2. Testing our custom features against each major upstream version
3. Maintaining a compatibility matrix in our releases

## Production Deployment

For production deployments:

1. Always use tagged versions
2. Use our `-ds` suffixed tags for our custom version
3. Reference upstream version compatibility in deployment docs

## Troubleshooting

If you encounter issues with branch synchronization:

```bash
# Reset tracking
git fetch --all
git branch -u origin/main main  # for main branch
git branch -u origin/develop develop  # for develop branch

# Force update if necessary (use with caution)
git fetch --all
git reset --hard origin/main  # or origin/develop
```
