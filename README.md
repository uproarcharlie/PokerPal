# PokerPro Tournament Manager

A comprehensive poker tournament management system built with React, Express, and PostgreSQL. Manage tournaments, track players, handle registrations, and monitor real-time payments.

## Features

- **Tournament Management**: Create and manage poker tournaments with customizable settings
- **Club Organization**: Organize tournaments by poker clubs
- **Player Registration**: Public registration pages with QR code support
- **Real-time Updates**: Live registration tracking with auto-refresh
- **Payment Tracking**: Confirm player payments and track confirmed registrations
- **Leaderboards**: Season-based player rankings and statistics
- **Dashboard Analytics**: Overview of active tournaments, players, and prize pools

## Tech Stack

### Frontend
- React 18 with TypeScript
- Wouter for routing
- TanStack Query for data fetching
- Tailwind CSS for styling
- Shadcn/ui components
- Lucide React icons

### Backend
- Express.js
- Drizzle ORM
- PostgreSQL (Neon)
- TypeScript

## Prerequisites

Before running this project locally, make sure you have:

- **Node.js** (v18 or higher)
- **npm** (v8 or higher)
- **PostgreSQL** database (or a Neon database URL)
- **Git** (for cloning from GitHub)

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/pokerpro-tournament-manager.git
cd pokerpro-tournament-manager
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Setup

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Edit the `.env` file with your configuration:

```env
# Database Configuration
DATABASE_URL=postgresql://user:password@host:port/database?sslmode=require

# Server Configuration
PORT=5000
NODE_ENV=development
```

**Getting a Database URL:**
- **Neon (Recommended)**: Sign up at [neon.tech](https://neon.tech) for a free PostgreSQL database
- **Local PostgreSQL**: Use `postgresql://postgres:password@localhost:5432/pokerpro`

### 4. Database Setup

Push the database schema:

```bash
npm run db:push
```

If you encounter any issues, force push the schema:

```bash
npm run db:push --force
```

### 5. Start Development Server

```bash
npm run dev
```

The application will be available at `http://localhost:5000`

## Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run check` - Run TypeScript type checking
- `npm run db:push` - Push database schema changes

## Project Structure

```
.
├── client/                 # Frontend React application
│   ├── src/
│   │   ├── pages/         # Page components
│   │   ├── components/    # Reusable UI components
│   │   └── lib/           # Utilities and configurations
├── server/                # Backend Express application
│   ├── index.ts          # Server entry point
│   ├── routes.ts         # API routes
│   ├── storage.ts        # Database operations
│   └── vite.ts           # Vite middleware
├── shared/               # Shared types and schemas
│   └── schema.ts         # Drizzle database schema
└── package.json
```

## Key Features Guide

### Creating a Tournament

1. Navigate to the Dashboard
2. Click "New Tournament"
3. Fill in tournament details (name, club, buy-in, etc.)
4. Set maximum players and start time
5. Click "Create Tournament"

### Managing Registrations

1. Go to "Tournaments" page
2. Click "Registrations" for any tournament
3. View pending registrations in real-time
4. Click "Confirm Payment" to confirm player payments
5. View confirmed players in the "Confirmed Players" section

### Public Registration

1. Get the registration link for a tournament
2. Share the link or QR code with players
3. Players can register themselves
4. Admin confirms payments from the registrations page

### Copying Links

From the tournaments list, you can:
- **Copy Registration Link** - Share with players for self-registration
- **Copy QR Link** - Display QR code for easy mobile registration
- **View Registrations** - Monitor and confirm payments in real-time

## Database Schema

The application uses the following main tables:

- **clubs** - Poker clubs/organizations
- **seasons** - Tournament seasons for tracking
- **tournaments** - Individual tournament events
- **players** - Registered players
- **tournament_registrations** - Player registrations with payment status
- **points_systems** - Points allocation rules
- **points_allocations** - Position-based points

## API Endpoints

### Tournaments
- `GET /api/tournaments` - List all tournaments with player counts
- `GET /api/tournaments/:id` - Get tournament details
- `POST /api/tournaments` - Create new tournament
- `PUT /api/tournaments/:id` - Update tournament

### Registrations
- `GET /api/tournaments/:id/pending-registrations` - Get pending payments
- `GET /api/tournaments/:id/confirmed-registrations` - Get confirmed players
- `PATCH /api/registrations/:id/confirm-payment` - Confirm payment

### Players
- `GET /api/players` - List all players
- `POST /api/players` - Create new player

## Deployment

### Building for Production

```bash
npm run build
```

This creates:
- Frontend build in `dist/client`
- Backend build in `dist/index.js`

### Running Production Build

```bash
npm start
```

### Environment Variables for Production

Set `NODE_ENV=production` and ensure `DATABASE_URL` points to your production database.

## Troubleshooting

### Database Connection Issues

- Verify your `DATABASE_URL` is correct
- Check database is accessible from your network
- For Neon, ensure SSL mode is set: `?sslmode=require`

### Port Already in Use

Change the port in `.env`:
```env
PORT=3000
```

### TypeScript Errors

Run type checking:
```bash
npm run check
```

### Database Schema Sync Issues

Force push schema:
```bash
npm run db:push --force
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License.

## Support

For issues and questions:
- Open an issue on GitHub
- Check existing issues for solutions

## Acknowledgments

- Built with [Replit](https://replit.com)
- UI components from [shadcn/ui](https://ui.shadcn.com)
- Icons from [Lucide](https://lucide.dev)
