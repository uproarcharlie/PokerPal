# PokerPro Tournament Manager

## Overview

PokerPro is a comprehensive poker tournament management system built with a modern full-stack architecture. The application enables poker clubs to manage tournaments, track player registrations, calculate prize pools, maintain seasonal leaderboards, and award points based on tournament performance. It provides real-time tournament administration features including player elimination tracking, rake calculations, and customizable payout structures.

## Recent Changes

**Database Migration (October 4, 2025)**
- Migrated from in-memory storage to PostgreSQL database for data persistence
- Implemented DatabaseStorage class using Drizzle ORM
- All data now persists across server restarts
- Database auto-generates UUIDs and timestamps for all entities
- Successfully tested CRUD operations with database
- Added ON DELETE CASCADE rules for data integrity:
  - Deleting a club cascades to seasons and tournaments
  - Deleting a season cascades to points systems and sets tournament.seasonId to null
  - Deleting a tournament or player cascades to tournament registrations
  - Prevents orphaned records and maintains referential integrity
- Fixed tournament schema validation:
  - Made fields with database defaults optional in insert schema
  - Added support for both numbers and strings in decimal fields using union types
  - Tournament creation now works via both API and UI

**Navigation Improvements**
- Added club details page (/clubs/:id) with tournament and season overview
- Fixed navigation buttons on clubs page to properly route to details
- Improved routing structure for better user experience

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Technology Stack:**
- React 18 with TypeScript for type-safe component development
- Vite as the build tool and development server
- Wouter for lightweight client-side routing
- TanStack Query (React Query) for server state management and API caching
- Shadcn UI component library built on Radix UI primitives for accessible, composable components
- Tailwind CSS with CSS variables for theming and responsive design

**Design Patterns:**
- Component-based architecture with reusable UI components
- Custom hooks for shared logic (mobile detection, toast notifications)
- Modal-based forms for data creation (clubs, tournaments, players, seasons)
- Optimistic updates and automatic cache invalidation via React Query
- Centralized API client with standard error handling

**Key Features:**
- Dashboard with tournament and club statistics
- Tournament management with live standings and prize pool calculations
- Player registration and elimination tracking
- Seasonal leaderboards with points allocation
- Responsive design with mobile-first approach

### Backend Architecture

**Technology Stack:**
- Express.js server with TypeScript
- Drizzle ORM for type-safe database operations
- Zod for runtime validation and schema parsing
- PostgreSQL as the primary database (via Neon serverless driver)

**API Design:**
- RESTful API endpoints following resource-based routing
- Request/response validation using Zod schemas
- Error handling with appropriate HTTP status codes
- Middleware for logging and JSON body parsing
- Development mode with Vite middleware integration

**Data Models:**
- Clubs: Organization entities that host tournaments
- Seasons: Time-bound competition periods within clubs
- Players: Participant records with contact information
- Tournaments: Events with buy-in structures, rake settings, and payout configurations
- Tournament Registrations: Player participation records with buy-ins, rebuys, addons
- Points Systems: Configurable scoring rules per season
- Points Allocations: Position-based point awards

**Business Logic:**
- Prize pool calculations with rake deduction (percentage, fixed, or none)
- Tournament status workflow (scheduled → registration → in_progress → completed)
- Player elimination tracking with timestamps
- Flexible points allocation supporting position ranges
- Rebuy and addon tracking with configurable limits

### Data Storage

**Database Configuration:**
- PostgreSQL database accessed via Neon serverless driver
- Schema defined using Drizzle ORM with type inference
- UUID-based primary keys with automatic generation
- Timestamp tracking for audit trails
- Foreign key relationships for data integrity

**Storage Layer:**
- Abstract storage interface (IStorage) for database operations
- CRUD operations for all primary entities
- Relationship queries (tournaments by club/season, registrations by tournament/player)
- Support for partial updates and soft deletion patterns

### External Dependencies

**Third-Party Services:**
- Neon Database: Serverless PostgreSQL hosting
- Drizzle Kit: Database migration tooling
- Replit-specific plugins for development environment integration

**UI Libraries:**
- Radix UI: Headless component primitives (30+ components)
- Lucide React: Icon library
- React Hook Form: Form state management with Zod resolver
- date-fns: Date manipulation and formatting
- class-variance-authority: Dynamic className management

**Development Tools:**
- tsx: TypeScript execution for development server
- esbuild: Production build bundler for server code
- Vite: Frontend build tool and dev server with HMR
- PostCSS with Tailwind and Autoprefixer

**Key Integrations:**
- Session management via connect-pg-simple (PostgreSQL session store)
- Real-time development features via Replit plugins (cartographer, dev banner, runtime error overlay)
- Path aliasing for clean imports (@/, @shared/, @assets/)