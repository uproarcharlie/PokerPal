# Deployment Guide

This guide covers deploying PokerPro Tournament Manager to various platforms.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Building for Production](#building-for-production)
- [Deploy to Replit](#deploy-to-replit)
- [Deploy to Vercel](#deploy-to-vercel)
- [Deploy to Railway](#deploy-to-railway)
- [Deploy to Render](#deploy-to-render)
- [Self-Hosted Deployment](#self-hosted-deployment)

## Prerequisites

- A PostgreSQL database (recommend [Neon](https://neon.tech) for serverless)
- Node.js 18+ runtime
- Environment variables configured

## Building for Production

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Build the application**:
   ```bash
   npm run build
   ```

3. **Set environment variables**:
   ```bash
   export NODE_ENV=production
   export DATABASE_URL="your-production-database-url"
   export PORT=5000
   ```

4. **Start the server**:
   ```bash
   npm start
   ```

## Deploy to Replit

### Using Replit Deployments

1. **Open your Repl** in Replit

2. **Click "Deploy"** in the top right

3. **Configure deployment**:
   - Select deployment type (Autoscale or Reserved VM)
   - Set environment variables in Secrets
   - Click "Deploy"

4. **Set environment variables** in Replit Secrets:
   ```
   DATABASE_URL=your-neon-database-url
   NODE_ENV=production
   ```

5. **Your app is deployed!** Replit provides a `.replit.app` URL

### Custom Domain

1. Go to Deployments settings
2. Click "Add custom domain"
3. Follow DNS configuration instructions

## Deploy to Vercel

> **Note**: Vercel is best for frontend. For full-stack, consider using Vercel for frontend + separate backend.

### Frontend Only

1. **Install Vercel CLI**:
   ```bash
   npm i -g vercel
   ```

2. **Deploy**:
   ```bash
   vercel
   ```

3. **Set environment variables** in Vercel dashboard:
   - `DATABASE_URL`
   - `NODE_ENV=production`

### Full-Stack (with serverless functions)

You'll need to adapt the Express backend to Vercel serverless functions. Consider using a separate backend deployment instead.

## Deploy to Railway

1. **Install Railway CLI**:
   ```bash
   npm i -g @railway/cli
   ```

2. **Login**:
   ```bash
   railway login
   ```

3. **Initialize project**:
   ```bash
   railway init
   ```

4. **Add PostgreSQL**:
   ```bash
   railway add postgresql
   ```

5. **Set environment variables**:
   ```bash
   railway variables set NODE_ENV=production
   ```

6. **Deploy**:
   ```bash
   railway up
   ```

7. **Get your URL**:
   ```bash
   railway domain
   ```

## Deploy to Render

1. **Create a new Web Service** on [Render](https://render.com)

2. **Connect your GitHub repository**

3. **Configure the service**:
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Environment**: Node

4. **Add environment variables**:
   - `DATABASE_URL` - Your PostgreSQL connection string
   - `NODE_ENV` - `production`

5. **Add PostgreSQL database** (optional):
   - Create a new PostgreSQL database
   - Copy the Internal Database URL
   - Set as `DATABASE_URL` environment variable

6. **Deploy** - Render will automatically deploy on every push

## Self-Hosted Deployment

### Using PM2 (Process Manager)

1. **Install PM2**:
   ```bash
   npm install -g pm2
   ```

2. **Build the application**:
   ```bash
   npm run build
   ```

3. **Create PM2 ecosystem file** (`ecosystem.config.js`):
   ```javascript
   module.exports = {
     apps: [{
       name: 'pokerpro',
       script: './dist/index.js',
       instances: 'max',
       exec_mode: 'cluster',
       env: {
         NODE_ENV: 'production',
         PORT: 5000
       }
     }]
   };
   ```

4. **Start with PM2**:
   ```bash
   pm2 start ecosystem.config.js
   ```

5. **Setup PM2 startup**:
   ```bash
   pm2 startup
   pm2 save
   ```

### Using Docker

1. **Create `Dockerfile`**:
   ```dockerfile
   FROM node:20-alpine

   WORKDIR /app

   COPY package*.json ./
   RUN npm ci --only=production

   COPY . .
   RUN npm run build

   EXPOSE 5000

   CMD ["npm", "start"]
   ```

2. **Create `.dockerignore`**:
   ```
   node_modules
   npm-debug.log
   .env
   .git
   dist
   ```

3. **Build image**:
   ```bash
   docker build -t pokerpro .
   ```

4. **Run container**:
   ```bash
   docker run -p 5000:5000 \
     -e DATABASE_URL="your-database-url" \
     -e NODE_ENV=production \
     pokerpro
   ```

### Using Docker Compose

1. **Create `docker-compose.yml`**:
   ```yaml
   version: '3.8'

   services:
     app:
       build: .
       ports:
         - "5000:5000"
       environment:
         - NODE_ENV=production
         - DATABASE_URL=${DATABASE_URL}
       depends_on:
         - db

     db:
       image: postgres:15-alpine
       environment:
         - POSTGRES_DB=pokerpro
         - POSTGRES_USER=postgres
         - POSTGRES_PASSWORD=password
       volumes:
         - postgres_data:/var/lib/postgresql/data

   volumes:
     postgres_data:
   ```

2. **Start services**:
   ```bash
   docker-compose up -d
   ```

## Nginx Reverse Proxy

If deploying behind Nginx:

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

## SSL/HTTPS

### Using Certbot (Let's Encrypt)

```bash
sudo certbot --nginx -d yourdomain.com
```

### Using Cloudflare

1. Add your domain to Cloudflare
2. Update nameservers
3. Enable "Full (strict)" SSL mode
4. Point DNS A record to your server IP

## Environment Variables

All platforms need these environment variables:

```bash
# Required
DATABASE_URL=postgresql://user:password@host:port/database
NODE_ENV=production

# Optional
PORT=5000
SESSION_SECRET=your-random-secret-key
```

## Database Setup

After deployment:

```bash
npm run db:push
```

Or with force flag if needed:

```bash
npm run db:push --force
```

## Health Checks

Most platforms support health checks. Your app responds to:

- `GET /` - Returns the app (can check for 200 OK)

## Monitoring

Consider adding monitoring:

- **Railway**: Built-in metrics
- **Render**: Built-in metrics  
- **Self-hosted**: 
  - PM2 monitoring: `pm2 monit`
  - Add logging service (Winston, Pino)
  - Use uptime monitoring (UptimeRobot, Pingdom)

## Troubleshooting

### Build Failures

- Check Node.js version (needs 18+)
- Verify all dependencies are in `package.json`
- Check build logs for specific errors

### Database Connection Issues

- Verify `DATABASE_URL` format
- Check database is accessible from deployment platform
- Ensure SSL mode is set correctly for remote databases
- Test connection locally first

### Port Issues

- Some platforms assign ports dynamically
- Use `process.env.PORT` in your code
- Default to 5000 if PORT not set

### Memory Issues

- Increase memory allocation on platform
- Optimize database queries
- Consider caching strategies

## Scaling

### Horizontal Scaling

- Use Railway/Render autoscaling
- Deploy behind load balancer
- Ensure database can handle connections

### Database Scaling

- Use connection pooling
- Consider read replicas for heavy reads
- Monitor slow queries

## Backup Strategy

1. **Database backups**:
   - Neon: Automatic backups
   - Self-hosted: Use `pg_dump`

2. **Code backups**:
   - Git repository (GitHub/GitLab)
   - Multiple deployment branches

## Rollback Strategy

1. **Using Git**:
   ```bash
   git revert <commit-hash>
   git push
   ```

2. **Using deployment platform**:
   - Most platforms keep deployment history
   - Can rollback to previous deployment

## Security Checklist

- [ ] Environment variables secured
- [ ] Database uses SSL
- [ ] HTTPS enabled
- [ ] CORS configured properly
- [ ] Rate limiting enabled
- [ ] Secrets not in code
- [ ] Dependencies updated
- [ ] Logs don't expose sensitive data

## Cost Optimization

- Use serverless databases (Neon free tier)
- Enable autoscaling only when needed
- Use CDN for static assets
- Optimize images and assets
- Monitor resource usage

## Support

For platform-specific issues:
- Replit: [Replit Docs](https://docs.replit.com)
- Vercel: [Vercel Docs](https://vercel.com/docs)
- Railway: [Railway Docs](https://docs.railway.app)
- Render: [Render Docs](https://render.com/docs)
