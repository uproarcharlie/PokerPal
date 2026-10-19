# Project Files Overview

Complete list of files and documentation for PokerPro Tournament Manager.

## 📚 Documentation Files

All documentation files are now included in your project:

| File | Description |
|------|-------------|
| `README.md` | Main documentation with complete setup instructions |
| `QUICKSTART.md` | 5-minute quick start guide to get running fast |
| `GITHUB_SETUP.md` | Guide to push to GitHub and clone locally |
| `CONTRIBUTING.md` | Guidelines for contributing to the project |
| `DEPLOYMENT.md` | Deployment instructions for various platforms |
| `LICENSE` | MIT License file |
| `PROJECT_FILES.md` | This file - overview of all project files |

## ⚙️ Configuration Files

| File | Description |
|------|-------------|
| `.env.example` | Template for environment variables |
| `.gitignore` | Git ignore patterns (protects sensitive files) |
| `package.json` | Node.js dependencies and scripts |
| `package-lock.json` | Locked dependency versions |
| `tsconfig.json` | TypeScript configuration |
| `vite.config.ts` | Vite bundler configuration |
| `tailwind.config.ts` | Tailwind CSS configuration |
| `postcss.config.js` | PostCSS configuration |
| `drizzle.config.ts` | drizzle-kit configuration (studio, throwaway pushes; never writes `migrations/`) |
| `components.json` | Shadcn UI components configuration |

## 🔄 GitHub Actions

| File | Description |
|------|-------------|
| `.github/workflows/ci.yml` | Continuous Integration workflow |

## 💻 Source Code Structure

```
pokerpro-tournament-manager/
├── client/                   # Frontend React application
│   ├── src/
│   │   ├── pages/           # Page components (Dashboard, Tournaments, etc.)
│   │   ├── components/      # Reusable UI components
│   │   │   ├── ui/          # Shadcn UI components
│   │   │   ├── layout/      # Layout components (Sidebar, etc.)
│   │   │   ├── modals/      # Modal dialogs
│   │   │   └── tournament/  # Tournament-specific components
│   │   ├── lib/             # Utilities and configurations
│   │   ├── hooks/           # Custom React hooks
│   │   └── index.css        # Global styles and Tailwind
│   └── index.html           # HTML entry point
│
├── server/                  # Backend Express application
│   ├── index.ts             # Server entry point
│   ├── app.ts               # Express app (middleware + routes)
│   ├── routes/              # API routes, one module per domain
│   ├── repositories/        # Database operations, one module per domain
│   └── vite.ts              # Vite middleware setup
│
└── shared/                  # Shared types and schemas
    └── schema.ts            # Drizzle database schema and types
```

## 🗄️ Database Schema

The database includes these tables:

- **clubs** - Poker clubs/organizations
- **seasons** - Tournament seasons
- **tournaments** - Tournament events with settings
- **players** - Registered players
- **tournament_registrations** - Player registrations with payment status
- **points_systems** - Points allocation rules
- **points_allocations** - Position-based points

## 📋 Available Scripts

```bash
# Development
npm run dev              # Start development server
npm run check           # TypeScript type checking

# Database
npm run db:migrate      # Apply the migrations (also done on every start)

# Production
npm run build           # Build for production
npm start              # Start production server
```

## 🌐 API Endpoints

The full list, with who may call each endpoint, is in [README.md, "API Endpoints"](README.md#api-endpoints).

## 🔐 Environment Variables

Required in `.env` file:

```env
DATABASE_URL=postgresql://...     # PostgreSQL connection string
PORT=5000                          # Server port
NODE_ENV=development               # Environment (development/production)
```

## ✅ Ready to Use

Your project is fully documented and ready to:

1. ✅ **Push to GitHub**
   - Use Git pane in Replit or shell commands
   - See `GITHUB_SETUP.md` for detailed instructions

2. ✅ **Clone and Run Locally**
   - Clone from GitHub
   - Follow `QUICKSTART.md` for setup
   - See `README.md` for full documentation

3. ✅ **Deploy to Production**
   - Multiple deployment options in `DEPLOYMENT.md`
   - Platforms: Replit, Vercel, Railway, Render, Docker

4. ✅ **Collaborate with Team**
   - Contributing guidelines in `CONTRIBUTING.md`
   - GitHub Actions CI/CD ready
   - Clear code structure and patterns

## 🚀 Next Steps

1. **Push to GitHub** (see `GITHUB_SETUP.md`)
   ```bash
   git init
   git add .
   git commit -m "Initial commit: PokerPro Tournament Manager"
   git remote add origin https://github.com/yourusername/pokerpro-tournament-manager.git
   git push -u origin main
   ```

2. **Clone Locally** (see `QUICKSTART.md`)
   ```bash
   git clone https://github.com/yourusername/pokerpro-tournament-manager.git
   cd pokerpro-tournament-manager
   npm install
   cp .env.example .env
   # Edit .env with your database URL
   npm run db:migrate
   npm run dev
   ```

3. **Start Developing**
   - Read `CONTRIBUTING.md` for guidelines
   - Check `README.md` for feature documentation
   - Deploy using `DEPLOYMENT.md` when ready

## 📞 Support

- **Documentation**: All `.md` files in root directory
- **Issues**: Open on GitHub repository
- **Questions**: Check existing issues or create new one

## 🎉 You're All Set!

Your PokerPro Tournament Manager project is fully documented and ready for:
- ✅ GitHub repository
- ✅ Local development
- ✅ Team collaboration
- ✅ Production deployment

**Happy coding!** 🎰♠️♥️♣️♦️
