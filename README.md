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

The server applies the SQL migrations in `migrations/` every time it starts, so `npm run dev` builds the schema
on an empty database by itself. To apply them without starting the server:

```bash
npm run db:migrate             # add -- --dry-run to only check them and see what would run
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
- `npm run db:migrate` - Apply the database migrations (the server also does this on every start)

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
│   ├── app.ts            # Express app (middleware + routes)
│   ├── routes/           # API routes, one module per domain
│   ├── repositories/     # Database operations, one module per domain
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

Every endpoint is under `/api` and answers JSON. Errors are `{ "error": "<sentence>", "code": "<CODE>", "details"?: … }`.
**Who** is checked on the server for every request, from the database:

- **anyone**: no sign-in. Public reads never include an email, phone or account id.
- **anyone (limited)**: a deliberate player self-service write (QR sign-up, player requests, player photos), with a narrow body and a cap per visitor, or per account when signed in, of 300 per 15 minutes (sign-ups and requests counted per tournament; `RATE_LIMIT_PUBLIC_WRITE` changes it) and 100 uploads.
- **signed in**: any active account.
- **staff**: a platform admin, the club's owner, or one of the club's managers.
- **owner**: a platform admin or the club's owner (managers cannot).
- **admin**: platform admins only.

`test/api/authz-matrix.api.test.ts` checks every write and staff-only read against this, and `test/api/public-pii.api.test.ts` checks every public read.

| Method | Path | Who | What |
|---|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` | anyone | Sign up (5 per address per hour), sign in (failures: 10 per address and email, 30 per address, 30 per email; successes: 20 per account; anything that checks a password: 60 per address; each per 15 minutes), sign out |
| GET | `/api/auth/me` | signed in | The account, the admin behind an impersonation, and the clubs it runs |
| PUT | `/api/auth/profile` | signed in | Name, email, phone |
| POST | `/api/auth/change-password` | signed in | Also signs out the account's other sessions (10 attempts per account per 15 minutes) |
| GET | `/api/admin/users`, `/api/admin/audit-log` | admin | Accounts and players; the audit log |
| PUT | `/api/admin/users/:userId` | admin | Edit an account (not your own role or status) |
| POST | `/api/admin/users/:userId/impersonate` | admin | View the app as a non-admin account |
| POST | `/api/admin/stop-impersonation` | signed in | Back to the admin account |
| GET | `/api/clubs`, `/api/clubs/:id`, `/api/clubs/slug/:slug` | anyone | Clubs, with `viewer.canManage` and `viewer.canOwn` (`?limit=` for the first few, oldest first) |
| GET | `/api/clubs/member-counts`, `/api/clubs/:id/members-count` | anyone | Players per club (those who played there or were added by it, as its Players list shows) |
| POST | `/api/clubs` | signed in | Create a club; you become its owner (5 per account and 10 per address per hour; at most 10 clubs per account, admins excepted) |
| PUT | `/api/clubs/:id` | staff | Edit a club (including its AP label, `rakeLabel`) |
| DELETE | `/api/clubs/:id` | owner | Delete a club |
| GET | `/api/clubs/:id/managers` | owner | The owner, managers and open invitations |
| POST | `/api/clubs/:id/invites` | owner (an owner invitation: admin) | Invite someone by email: answers a link to send them, shown once (20 staff changes per 15 minutes) |
| DELETE | `/api/clubs/:id/invites/:inviteId` | owner (an owner invitation: admin) | Withdraw an invitation |
| POST | `/api/staff-invites/accept` | signed in | Accept an invitation: only the account that uses the invited address, once, within 7 days |
| DELETE | `/api/clubs/:id/managers/:userId` | owner | Remove a manager |
| PUT | `/api/clubs/:id/owner` | admin | Set a club's owner to an account picked by id, or none |
| GET | `/api/seasons`, `/api/seasons/:id`, `/api/seasons/:id/leaderboard` | anyone | Seasons and their points leaderboard |
| POST | `/api/seasons` | staff | Create a season |
| PUT | `/api/seasons/:id` | staff | Edit a season |
| DELETE | `/api/seasons/:id` | owner | Delete a season |
| GET | `/api/seasons/:id/points-systems`, `/api/points-systems/:id`, `/api/points-systems/:id/allocations` | anyone | Points systems |
| POST | `/api/seasons/:id/points-systems` | staff | Create a points system with its allocations |
| DELETE | `/api/points-systems/:id` | staff | Delete a points system |
| POST | `/api/points-systems/:id/allocations` | staff | Add an allocation (no overlapping positions) |
| GET | `/api/players` | signed in | Players who have played at, or were added by, the clubs you run (every player for an admin); contact details only for players whose home club (the club that added them, else their first registration; recorded once) is yours |
| POST | `/api/players` | anyone (limited) | QR sign-up (`tournamentId`) or staff (`clubId`): that club becomes a new player's home club; the same name and phone returns the existing player (of legacy duplicates, the one with the history); answers a sign-up token for registering them |
| PUT | `/api/players/:id` | staff of the player's home club | Edit a player |
| GET | `/api/public/tournaments/:id/players?q=` | anyone | Name search for the QR register page (the club's players; its staff also find players from other clubs) |
| GET | `/api/tournaments`, `/api/tournaments/:id` | anyone | Tournaments (filters `clubId`, `seasonId`, `status`, `upcoming=true` (scheduled or open, starting no more than 12 hours ago), `limit`); paid counts and finalize warnings only for your own clubs |
| POST | `/api/tournaments` | staff | Create a tournament (30 per account and 60 per address per hour; at most 100 upcoming per club) |
| PUT | `/api/tournaments/:id` | staff | Edit, change status, lock the pool, set a manual pool or AP rates (the same rules as the prize-pool endpoints) |
| DELETE | `/api/tournaments/:id` | owner | Delete a tournament (staff can cancel instead) |
| GET | `/api/tournaments/:id/prize-pool` | anyone | Pool, AP and payouts (what was paid, once finalized) |
| PUT | `/api/tournaments/:id/prize-pool/adjustment` | staff | Manual AP total or manual prize pool, with a reason |
| PUT | `/api/tournaments/:id/prize-pool/rates` | staff | AP rates |
| POST | `/api/tournaments/:id/finalize/preview` | staff | What finalize would write (no changes), and the player requests it would discard |
| POST | `/api/tournaments/:id/finalize` | staff | Finishing order, prizes and points, in one go (again, forced, to correct a finalized order, scoring points with the rules first used) |
| GET | `/api/tournaments/:id/activity` | anyone | The activity feed (payments and AP rate changes for staff only) |
| GET | `/api/tournaments/:id/registrations` | anyone | Who is registered (names and photos only; who has paid for the club's staff only) |
| POST | `/api/tournaments/:id/registrations` | anyone (limited) | Register one of the club's players, or the player just entered on the QR page (its sign-up token); staff may register anyone and set counts and payment |
| GET | `/api/tournaments/:id/pending-registrations`, `/api/tournaments/:id/confirmed-registrations` | staff | The payment desk |
| PUT | `/api/registrations/:id` | staff | Eliminate or restore, payment, high hand (the server works out each award; a tie splits a winner's prize) |
| DELETE | `/api/registrations/:id` | staff | Take out a sign-up nothing has happened to yet (audited) |
| POST | `/api/registrations/:id/counts` | staff | Add or remove re-buys (one for a player who is out puts them back in), add-ons, knockouts |
| PATCH | `/api/registrations/:id/confirm-payment` | staff | Confirm payment (pressing twice changes nothing) |
| GET | `/api/tournaments/:id/pending-actions` | staff | Players' waiting requests |
| POST | `/api/tournaments/:id/pending-actions` | anyone (limited) | A player asks for a re-buy, add-on (only where the tournament sells one) or knockout |
| POST | `/api/pending-actions/:id/confirm` | staff | Apply a request (exactly once; a re-buy or add-on asked for before the lock still counts; a re-buy asked for before the player went out needs `reenter`) |
| DELETE | `/api/pending-actions/:id` | staff | Dismiss a request (audited) |
| GET | `/api/dashboard/stats` | signed in | Totals for the clubs you run |
| POST | `/api/images/:kind` | anyone (limited) for `player_avatar`, else signed in | Upload an image; answers every stored size |
| POST | `/api/upload`, `/api/upload/public` | signed in; anyone (limited) | Older upload endpoints (aliases of `/api/images/:kind`) |
| GET | `/api/health` | anyone | App, database and migration status (the deploy healthcheck) |

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

### Database Schema Issues

The server refuses to start if a migration fails, and logs why. Check the migrations without running them:
```bash
npm run db:migrate -- --dry-run
```
On a deployed server, see "When a boot migration fails" in DEPLOYMENT.md.

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
