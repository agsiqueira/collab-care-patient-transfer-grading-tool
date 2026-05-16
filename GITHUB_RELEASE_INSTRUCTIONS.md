# GitHub Release Instructions

This package is ready to upload to GitHub.

## 1. Create the repository

Create a new GitHub repository, then upload or push this project folder.

Recommended repository name:

`patient-transfer-grading-support-tool`

## 2. Push the project

From inside the project folder:

```bash
git init
git add .
git commit -m "Add Patient Transfer Grading Support Tool v0.3.3"
git branch -M main
git remote add origin https://github.com/YOUR-USER-NAME/patient-transfer-grading-support-tool.git
git push -u origin main
```

## 3. Build installers manually from GitHub

In GitHub:

1. Open the repository.
2. Go to **Actions**.
3. Select **Build Installers**.
4. Click **Run workflow**.
5. Download the generated artifacts after the workflow completes.

The workflow generates:

- Windows `.exe` installer
- macOS Apple Silicon `.dmg` installer
- macOS Intel `.dmg` installer

## 4. Create a release automatically

To create a GitHub Release with the installers attached, push a version tag:

```bash
git tag v0.3.3
git push origin v0.3.3
```

The workflow will build the installers and attach them to the GitHub Release.

## 5. Important API key note

The API key is not bundled in the installer. Users enter their own API key locally after opening the app. The key is stored locally using `electron-store`.

Do not commit any `.env` file, API key file, or local settings file to GitHub.
