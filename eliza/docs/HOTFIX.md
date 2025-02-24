# Hotfix Process

This document outlines the process for deploying hotfixes to production.

## When to Use Hotfixes

Use the hotfix workflow when you need to:

- Fix critical bugs in production
- Deploy urgent security patches
- Make emergency configuration changes

## How to Deploy a Hotfix

### Method 1: Using a Hotfix Branch

1. Create a new branch with the prefix `hotfix/`:

    ```bash
    git checkout -b hotfix/your-fix-name
    ```

2. Make your changes and commit them:

    ```bash
    git add .
    git commit -m "fix: description of your hotfix"
    ```

3. Push your changes:
    ```bash
    git push origin hotfix/your-fix-name
    ```

The GitHub workflow will automatically:

- Build and test your changes
- Create a new version with a hotfix suffix
- Create a GitHub release marked as a prerelease
- Create and push a git tag for the hotfix version

### Method 2: Manual Trigger

1. Go to the GitHub Actions tab in the repository
2. Select the "Hotfix Deployment" workflow
3. Click "Run workflow"
4. Choose the version bump type (patch/minor/major)
5. Click "Run workflow"

## Branch Synchronization

When a hotfix is merged into `main`:

1. A new PR will be automatically created to sync the changes to the `develop` branch
2. The PR will be created from a branch named `sync/hotfix/your-fix-name-to-develop`
3. The PR will include a reference to the original hotfix PR
4. Review and merge this PR to ensure the hotfix is properly synchronized

## Installing the Hotfix Version

To switch to the hotfix version:

```bash
git fetch origin
git checkout v1.2.3-hotfix.20240101123456  # Replace with actual version
pnpm install
pnpm build
```

## Post-Hotfix Steps

1. Create a pull request to merge the hotfix into the main branch
2. Review and merge the automatically created PR to sync with develop
3. Update the changelog with the hotfix details
4. Notify relevant team members about the hotfix deployment
5. Deploy the updated version to your production environment

## Version Naming Convention

Hotfix versions follow this pattern:

- Regular version: `1.2.3`
- Hotfix version: `1.2.3-hotfix.20240101123456`

The timestamp suffix ensures unique versioning for multiple hotfixes.
