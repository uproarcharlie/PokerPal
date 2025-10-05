# Quick Start Guide

Get PokerPro Tournament Manager running locally in 5 minutes!

## Prerequisites

- Node.js 18+ installed ([Download](https://nodejs.org))
- Git installed ([Download](https://git-scm.com))

## Step 1: Clone the Repository

```bash
git clone https://github.com/yourusername/pokerpro-tournament-manager.git
cd pokerpro-tournament-manager
```

Or download from Replit:
```bash
# In your Replit, use the Git pane to push to GitHub
# Then clone from GitHub to your local machine
```

## Step 2: Install Dependencies

```bash
npm install
```

## Step 3: Set Up Database

### Option A: Use Neon (Recommended - Free)

1. Go to [neon.tech](https://neon.tech) and sign up
2. Create a new project
3. Copy the connection string

### Option B: Use Local PostgreSQL

```bash
# Install PostgreSQL locally
# Create a database
createdb pokerpro
```

## Step 4: Configure Environment

Create `.env` file:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# For Neon
DATABASE_URL=postgresql://user:password@host.neon.tech/database?sslmode=require

# For Local PostgreSQL
# DATABASE_URL=postgresql://postgres:password@localhost:5432/pokerpro

PORT=5000
NODE_ENV=development
```

## Step 5: Initialize Database

```bash
npm run db:push
```

If you get errors, force push:
```bash
npm run db:push --force
```

## Step 6: Start the App

```bash
npm run dev
```

Open [http://localhost:5000](http://localhost:5000) in your browser.

## Step 7: Create Your First Tournament

1. Click **"New Tournament"** button
2. Fill in the details:
   - Tournament Name
   - Select or create a Club
   - Set Buy-in amount
   - Set Max players
   - Choose start date/time
3. Click **"Create Tournament"**

## Step 8: Share Registration Link

1. Go to **"Tournaments"** page
2. Click **"Copy Link"** for your tournament
3. Share the link with players
4. Or click **"Copy QR"** to get a QR code link

## Next Steps

### Monitor Registrations

1. Click **"Registrations"** button for any tournament
2. View incoming registrations in real-time (auto-refreshes every 3 seconds)
3. Click **"Confirm Payment"** when players pay
4. View confirmed players in the "Confirmed Players" section

### View Dashboard

- See active tournaments
- Monitor total players
- Track total prize pool
- View club statistics

### Manage Players

1. Go to **"Players"** page
2. View all registered players
3. See their tournament history

## Common Commands

```bash
# Development
npm run dev              # Start dev server with hot reload
npm run check           # Run TypeScript type checking

# Database
npm run db:push         # Sync database schema
npm run db:push --force # Force sync if issues

# Production
npm run build           # Build for production
npm start              # Start production server
```

## Troubleshooting

### Can't connect to database?

- Check `DATABASE_URL` in `.env`
- Ensure database is running
- For Neon, verify `?sslmode=require` is in URL

### Port 5000 already in use?

Change port in `.env`:
```env
PORT=3000
```

### TypeScript errors?

```bash
npm run check
```

### Database schema issues?

```bash
npm run db:push --force
```

## Useful Links

- [Full Documentation](./README.md)
- [Deployment Guide](./DEPLOYMENT.md)
- [Contributing Guide](./CONTRIBUTING.md)

## Get Help

- Check [README.md](./README.md) for detailed docs
- Open an issue on GitHub
- Review existing issues for solutions

## What's Next?

- Customize tournament settings
- Set up seasons for tracking
- Configure points systems
- Create leaderboards
- Deploy to production

---

**Ready to run your poker tournaments like a pro!** 🎰♠️♥️♣️♦️
