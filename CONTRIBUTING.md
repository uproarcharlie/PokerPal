# Contributing to PokerPro Tournament Manager

Thank you for your interest in contributing! This guide will help you get started.

## Development Setup

1. **Fork the repository** on GitHub

2. **Clone your fork**:
   ```bash
   git clone https://github.com/yourusername/pokerpro-tournament-manager.git
   cd pokerpro-tournament-manager
   ```

3. **Install dependencies**:
   ```bash
   npm install
   ```

4. **Set up environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env with your database credentials
   ```

5. **Initialize database**:
   ```bash
   npm run db:push
   ```

6. **Start development server**:
   ```bash
   npm run dev
   ```

## Development Workflow

### Creating a Feature

1. Create a new branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes following the code style guidelines

3. Test your changes thoroughly

4. Commit your changes:
   ```bash
   git add .
   git commit -m "feat: add your feature description"
   ```

5. Push to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```

6. Open a Pull Request on GitHub

### Commit Message Convention

Use conventional commits format:

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, etc.)
- `refactor:` - Code refactoring
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks

Examples:
```
feat: add tournament filtering by status
fix: resolve player count display issue
docs: update installation instructions
```

## Code Style Guidelines

### TypeScript

- Use TypeScript for all new code
- Define proper types, avoid `any`
- Use interfaces for object shapes
- Follow existing naming conventions

### React Components

- Use functional components with hooks
- Keep components focused and single-purpose
- Use proper prop typing
- Follow the existing component structure

### File Organization

- Place page components in `client/src/pages/`
- Place reusable components in `client/src/components/`
- Place API routes in `server/routes.ts`
- Define shared types in `shared/schema.ts`

### Styling

- Use Tailwind CSS utility classes
- Follow the existing design system
- Use shadcn/ui components when possible
- Maintain consistent spacing and layout

## Database Changes

### Adding New Tables

1. Update `shared/schema.ts` with Drizzle ORM schema
2. Add insert/select schemas and types
3. Run `npm run db:push` to sync the database
4. Update storage interface in `server/storage.ts`

### Modifying Existing Tables

1. Update schema in `shared/schema.ts`
2. Run `npm run db:push`
3. If you get warnings, use `npm run db:push --force`
4. Update affected TypeScript types

## Testing Your Changes

### Manual Testing

1. Test all affected features in the UI
2. Check both desktop and mobile views
3. Verify API responses in browser DevTools
4. Test error cases and edge conditions

### Database Testing

1. Test with empty database state
2. Test with populated data
3. Verify data integrity after operations

## Pull Request Guidelines

### Before Submitting

- [ ] Code follows the style guidelines
- [ ] Changes are well-tested
- [ ] No console errors or warnings
- [ ] Database migrations work correctly
- [ ] Documentation is updated if needed

### PR Description

Include in your PR:

1. **What** - Brief description of changes
2. **Why** - Reason for the changes
3. **How** - Implementation approach
4. **Testing** - How you tested the changes
5. **Screenshots** - For UI changes

### Review Process

- Maintainers will review your PR
- Address any requested changes
- Once approved, your PR will be merged

## Common Issues

### Database Connection

If you have database connection issues:
- Verify `DATABASE_URL` in `.env`
- Check database is accessible
- Ensure SSL mode is correct for remote databases

### Port Conflicts

If port 5000 is in use:
- Change `PORT` in `.env`
- Restart the dev server

### Type Errors

Run type checking:
```bash
npm run check
```

## Getting Help

- Open an issue for bugs
- Discuss new features in issues first
- Ask questions in discussions

## Code Review

Your code will be reviewed for:

- Functionality and correctness
- Code quality and style
- Performance implications
- Security considerations
- Test coverage

## Thank You!

Your contributions help make PokerPro Tournament Manager better for everyone!
