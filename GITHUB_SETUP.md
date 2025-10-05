# GitHub Setup Guide

This guide will help you push your PokerPro Tournament Manager project to GitHub and set it up for local development.

## From Replit to GitHub

### Method 1: Using Replit Git Pane (Recommended)

1. **Open Git Pane** in Replit
   - Click on "Tools" in the left sidebar
   - Select "Git" to open the Git pane

2. **Create GitHub Repository**
   - Go to [GitHub](https://github.com) and create a new repository
   - Name it `pokerpro-tournament-manager` (or your preferred name)
   - Don't initialize with README (we already have one)

3. **Connect Repository**
   - In Replit Git pane, click "Connect to GitHub"
   - Or manually add remote:
     ```bash
     git remote add origin https://github.com/yourusername/pokerpro-tournament-manager.git
     ```

4. **Stage All Files**
   - Review changes in Git pane
   - Stage all files you want to commit
   - The `.gitignore` will exclude sensitive files automatically

5. **Commit Changes**
   - Write a commit message: "Initial commit: PokerPro Tournament Manager"
   - Click "Commit"

6. **Push to GitHub**
   - Click "Push" to send to GitHub
   - Your code is now on GitHub!

### Method 2: Using Replit Shell

```bash
# Initialize git (if not already)
git init

# Add GitHub remote
git remote add origin https://github.com/yourusername/pokerpro-tournament-manager.git

# Stage all files
git add .

# Commit
git commit -m "Initial commit: PokerPro Tournament Manager"

# Push to GitHub
git push -u origin main
```

### Method 3: Download and Upload

1. **Download from Replit**
   - Click the three dots menu
   - Select "Download as zip"
   - Extract the zip file locally

2. **Initialize Git Locally**
   ```bash
   cd pokerpro-tournament-manager
   git init
   git add .
   git commit -m "Initial commit: PokerPro Tournament Manager"
   ```

3. **Push to GitHub**
   ```bash
   git remote add origin https://github.com/yourusername/pokerpro-tournament-manager.git
   git push -u origin main
   ```

## Files Included

Your repository now includes:

### Documentation 📚
- `README.md` - Main documentation with setup instructions
- `QUICKSTART.md` - 5-minute quick start guide
- `CONTRIBUTING.md` - Contributing guidelines
- `DEPLOYMENT.md` - Deployment instructions for various platforms
- `GITHUB_SETUP.md` - This file
- `LICENSE` - MIT License

### Configuration ⚙️
- `.env.example` - Environment variable template
- `.gitignore` - Git ignore patterns (protects `.env` and other sensitive files)
- `package.json` - Node.js dependencies and scripts
- `tsconfig.json` - TypeScript configuration
- `vite.config.ts` - Vite bundler configuration
- `tailwind.config.ts` - Tailwind CSS configuration
- `drizzle.config.ts` - Database ORM configuration

### GitHub Actions 🔄
- `.github/workflows/ci.yml` - Continuous Integration workflow

### Application Code 💻
- `client/` - Frontend React application
- `server/` - Backend Express application  
- `shared/` - Shared TypeScript types and schemas

## Clone to Local Machine

Once pushed to GitHub, clone to your local machine:

```bash
# Clone repository
git clone https://github.com/yourusername/pokerpro-tournament-manager.git

# Navigate to directory
cd pokerpro-tournament-manager

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Edit .env with your database credentials
nano .env  # or use your preferred editor

# Initialize database
npm run db:push

# Start development server
npm run dev
```

## Important: Environment Variables

The `.env` file is **NOT** pushed to GitHub (it's in `.gitignore`). 

**Always create `.env` manually on each machine:**

```bash
cp .env.example .env
# Edit with your actual values
```

**Never commit `.env` to version control** - it contains sensitive data like database passwords.

## Setting Up Secrets for CI/CD

If using GitHub Actions:

1. Go to your GitHub repository
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Add these secrets:
   - `DATABASE_URL` - Your database connection string

## Verifying the Setup

1. **Check `.gitignore` is working**:
   ```bash
   git status
   # .env should NOT appear in untracked files
   ```

2. **Verify all documentation exists**:
   ```bash
   ls -la *.md
   # Should show: README.md, QUICKSTART.md, CONTRIBUTING.md, etc.
   ```

3. **Test locally**:
   ```bash
   npm install
   npm run dev
   ```

## Updating from Replit

When you make changes in Replit:

1. **Stage changes** in Git pane
2. **Commit** with descriptive message
3. **Push** to GitHub
4. **Pull** changes on your local machine:
   ```bash
   git pull origin main
   ```

## Collaborating

### Adding Collaborators

1. Go to GitHub repository
2. Click **Settings** → **Collaborators**
3. Add GitHub usernames

### Working Together

```bash
# Get latest changes
git pull

# Create feature branch
git checkout -b feature/new-feature

# Make changes and commit
git add .
git commit -m "Add new feature"

# Push branch
git push origin feature/new-feature

# Open Pull Request on GitHub
```

## Branch Strategy

Recommended branches:

- `main` - Production-ready code
- `develop` - Development branch
- `feature/*` - Feature branches

## Troubleshooting

### Authentication Issues

If GitHub asks for authentication:

**Option 1: Personal Access Token**
1. Go to GitHub → Settings → Developer settings → Personal access tokens
2. Generate new token with `repo` scope
3. Use token as password when pushing

**Option 2: SSH Keys**
```bash
# Generate SSH key
ssh-keygen -t ed25519 -C "your_email@example.com"

# Copy public key
cat ~/.ssh/id_ed25519.pub

# Add to GitHub → Settings → SSH keys
```

### Large File Errors

If you have large files:
```bash
# Install Git LFS
git lfs install

# Track large files
git lfs track "*.zip"
git add .gitattributes
```

### .env Accidentally Committed

If you accidentally committed `.env`:

```bash
# Remove from Git but keep locally
git rm --cached .env

# Commit the removal
git commit -m "Remove .env from version control"

# Push
git push
```

**Important**: Change your database password immediately if `.env` was pushed!

## Best Practices

1. ✅ **Never commit `.env`** - Already in `.gitignore`
2. ✅ **Use meaningful commit messages**
3. ✅ **Keep `README.md` updated**
4. ✅ **Document new features**
5. ✅ **Test before pushing**
6. ✅ **Use branches for features**
7. ✅ **Review pull requests**

## Next Steps

1. ✅ Push to GitHub
2. ✅ Clone to local machine
3. ✅ Set up `.env` locally
4. ✅ Run `npm install`
5. ✅ Run `npm run db:push`
6. ✅ Start developing!

## Resources

- [GitHub Docs](https://docs.github.com)
- [Git Basics](https://git-scm.com/book/en/v2/Getting-Started-Git-Basics)
- [Our README](./README.md)
- [Quick Start Guide](./QUICKSTART.md)

---

**Your project is now ready for GitHub and local development!** 🚀
