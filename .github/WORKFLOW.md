# Repository Workflow

This document outlines our simplified workflow for managing this repository.

## Branch Structure

- `main`: Production-ready branch containing stable releases
- `develop`: Integration branch for feature development
- `feature/*`: Feature branches for new functionality
- `hotfix/*`: Emergency fixes that go directly to main

## Branch Naming Convention

Branches should follow these patterns:

- `feature/*` for all new development work
- `hotfix/*` for emergency production fixes

Examples:

- `feature/new-agent`
- `feature/improve-tests`
- `hotfix/critical-auth-fix`
- `hotfix/security-patch`

## Common Workflows

### Developing New Features

```bash
# Create feature branch
git checkout develop
git checkout -b feature/your-feature

# Update submodules if needed
git submodule update --init --recursive

# Make changes and commit
git commit -m "feat: your feature description"

# Push to origin and create PR
git push origin feature/your-feature
# Create PR to develop branch
```

### Emergency Hotfixes

```bash
# Create hotfix branch from main
git checkout main
git checkout -b hotfix/critical-fix

# Make minimal necessary changes
git commit -m "fix: critical issue description"

# Push and create urgent PR to main
git push origin hotfix/critical-fix
```

### Automated Workflow

1. Feature Development:

   - Create feature branch from develop
   - Work on your feature
   - Create PR to develop
   - After merge to develop, CI automatically creates PR to main

2. Hotfix Process:
   - Create hotfix branch from main
   - Fix critical issue
   - Create PR directly to main
   - After merge, changes should be backported to develop

## Submodule Management

When working with submodules:

1. Always initialize submodules after cloning:

   ```bash
   git submodule update --init --recursive
   ```

2. Update submodules to latest:
   ```bash
   git submodule update --remote
   ```

## CI/CD Pipeline

Our CI/CD pipeline includes:

1. Automated testing
2. Code quality checks
3. Automatic PR creation from develop to main
4. Required reviews from team members
5. Expedited review process for hotfixes

## Troubleshooting

Common issues and solutions:

```bash
# Submodule issues
git submodule update --init --recursive
git submodule sync

# Branch synchronization
git fetch --all
git reset --hard origin/develop  # Use with caution
```
