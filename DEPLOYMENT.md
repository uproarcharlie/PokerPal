# PokerPal Deployment Guide

This guide will help you deploy PokerPal to production using your GoDaddy domain and Cloudflare.

## Prerequisites

- GoDaddy domain (you already have this!)
- Cloudflare account (you already have this!)
- A hosting provider (choose one):
  - **Railway** (Recommended - easiest, free tier available)
  - **DigitalOcean** (VPS - $6/month)
  - **AWS EC2** (more complex)
  - **Render** (free tier available)

## Option 1: Railway (Recommended - Easiest)

Railway is the easiest option with a generous free tier and automatic deployments.

### Step 1: Create a Railway Account
1. Go to https://railway.app
2. Sign up with GitHub (recommended for easy deployments)

### Step 2: Set Up PostgreSQL Database
1. In Railway, click **New Project** → **Provision PostgreSQL**
2. Once created, click on the PostgreSQL service
3. Go to **Variables** tab and copy the `DATABASE_URL`

### Step 3: Deploy Your App
1. In Railway, click **New** → **GitHub Repo**
2. Connect your GitHub account and select your PokerPal repository
   - If not on GitHub yet, push your code to GitHub first:
     ```bash
     git init
     git add .
     git commit -m "Initial commit"
     git branch -M main
     git remote add origin https://github.com/yourusername/pokerpal.git
     git push -u origin main
     ```
3. Railway will auto-detect your Node.js app

### Step 4: Configure Environment Variables
In Railway, go to your app → **Variables** tab and add:

```
DATABASE_URL=<copy from PostgreSQL service>
SESSION_SECRET=<generate random string - see below>
NODE_ENV=production
PORT=3000
VITE_GOOGLE_MAPS_API_KEY=<your Google Maps API key>
```

**Generate SESSION_SECRET:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Optional, with defaults that suit Railway, so leave them unset unless you need a change (`.env.production.example` describes each):

- `TRUST_PROXY` (default `1`): how many proxies sit in front of the app, so client IPs and https are read correctly. Behind Cloudflare and Railway, keep it at `1`. The app then trusts Railway's edge only. The rate limits take the visitor's own address from `CF-Connecting-IP`, but only when the request reached Railway from a Cloudflare address (and, once `CLOUDFLARE_ORIGIN_SECRET` is set, carries that secret). A higher number would let a visitor pick their own address with `X-Forwarded-For`.
- `CLOUDFLARE_ORIGIN_SECRET` (recommended): coming from a Cloudflare address only proves a request left Cloudflare's network, not that it went through the lovepoker.club zone: anyone's Cloudflare Worker can call the `*.up.railway.app` origin with a `CF-Connecting-IP` of their choosing and so dodge the per-visitor rate limits. To close that, in this order:
  1. generate a secret (`node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`);
  2. in Cloudflare, add a Transform Rule (Rules → Transform Rules → Modify Request Header) for the zone's hostname that sets the request header `X-Origin-Auth` to that secret on every request;
  3. set `CLOUDFLARE_ORIGIN_SECRET` to the same value on Railway.
  Doing 3 before 2 is safe but keys every visitor on the Cloudflare edge address until 2 is done, so do 2 first. Optionally remove the generated `*.up.railway.app` domain once the custom domain works. Unset, the boot log says `CLOUDFLARE_ORIGIN_SECRET is not set` and the header is believed from any Cloudflare address, as before.
- `DB_POOL_MAX` (default `10`): the most Postgres connections the app holds open.
- `MIGRATE_ON_BOOT` (default `true`): apply the migrations at every start. See [When a boot migration fails](#when-a-boot-migration-fails) before setting it to `false`.
- `RATE_LIMITS_ENABLED` (default: on): `false` turns the API rate limits off, for a production-mode run that is not the live site.
- `RATE_LIMIT_PUBLIC_WRITE` (default `300`) and `RATE_LIMIT_LIVE` (default `10000`): raise one limit for a big night without touching the sign-in throttle. Phones on the venue Wi-Fi share one address. `publicWrite` counts, per 15 minutes per address (or per signed-in account): new players and their photos together (a new player with a photo is 2), and each tournament's sign-ups plus re-buy, add-on and knockout requests separately (1 each). So 60 new players with photos are about 120 in the first bucket, and 60 sign-ups plus 90 requests about 150 in that tournament's. `live` is page polling: an open tournament page polls about 360 times in 15 minutes, so 10000 covers about 27 phones watching non-stop.
- `UPLOAD_DIR`: without R2, production stores images only in the directory this names, which must be a persistent volume. With neither R2 nor `UPLOAD_DIR`, image uploads answer 503.

The server refuses to start (so the healthcheck keeps the previous deployment serving) when `SESSION_SECRET` is missing or still one of the example placeholders, when only some of the five `R2_*` variables are set, or when `R2_PUBLIC_URL` is not an http(s) URL or is the `*.r2.cloudflarestorage.com` API host. The log names the variable, never its value.

#### After a deploy: what the log should say

- `Image storage: Cloudflare R2 bucket "…", served from https://…`, and no `Image storage is not configured` line.
- On the first boot with the club-owner seed, `[seed] Central Stars owner: set; club … is now owned by charlie@eccuity.com`. Later boots say `unchanged; club … already has an owner`, or once an admin has changed or cleared the owner, `… was set before …, so it is left as it is` (the seed runs at most once per club). The seed trusts only an account that had that address before 2026-10-19 (created and last changed before then), because nothing verifies email addresses: `unchanged; no account uses charlie@eccuity.com`, `… was created or changed after …` and `… is deactivated` all mean an admin sets the owner on the club's Managers tab instead. `… clubs look like Central Stars` also needs an admin to set the owner there. Before deploying, check that the account exists on production and was created before 2026-10-19.
- After a rollback to a build before Phase 2, sessions keep working: Phase 2 still writes the session's `role` and `originalAdminRole`, which that build authorized from (remove them once a rollback could no longer go that far).
- No `Ignoring CF-Connecting-IP from non-Cloudflare peer` line. If one appears, requests are reaching the app without passing through Cloudflare, and the rate limits key on that peer address.
- With `CLOUDFLARE_ORIGIN_SECRET` set, no `Ignoring CF-Connecting-IP without a valid x-origin-auth header` line, which means the Transform Rule is missing or its value differs. Without it set, one `CLOUDFLARE_ORIGIN_SECRET is not set` line at boot.
- On the first boot with player home clubs, `[seed] Player home clubs: set; recorded the home club of N players` (every player who has registered anywhere, given the club of their first registration). Later boots say `unchanged; every registered player already has one`.
- `Rate limit "<name>" reached by …` lines are normal: one per visitor per limit per 15 minutes.

### How a deploy goes live

`railway.json` builds the `Dockerfile` and only sends traffic to a new deployment once `/api/health` answers 200, within 120 seconds. Before it listens, the server applies `migrations/*.sql` (as `npm run db:migrate` does; see SCRIPTS.md). If that fails, it exits without listening, the healthcheck never passes, and the previous deployment keeps serving.

CI builds the same image and boots it against Postgres on every push and pull request (the "Docker image" job). Railway deploys `main` as soon as it is pushed, so to have a failing CI run stop the deploy, turn on **Wait for CI** in the Railway service's settings, or merge through pull requests.

#### When a boot migration fails

The log shows `[migrate] MIGRATIONS FAILED`, and above it the file, line and reason.

1. **During a deploy** nothing is down: the previous deployment keeps serving. Fix the migration, or revert the commit, and push again.
2. **After a crash or restart**, nothing serves until a boot succeeds. If the database already has the schema the build needs (for example, the failing file is the newest one and the code does not use what it adds yet), set `MIGRATE_ON_BOOT=false` on the service to start without migrating (the boot data seeds still run, skipping any whose tables do not exist yet). Remove it as soon as the fix is deployed, or later migrations never run.
   The app checks this for you: with `MIGRATE_ON_BOOT=false` it still compares the database with every table and column the build queries, and if any is missing it logs `[migrate] SCHEMA BEHIND THIS BUILD: refusing to start …` with what is missing and exits, so the healthcheck fails and the previous deployment keeps serving. It runs the same check after applying the migrations. A deploy whose code needs a migration therefore never goes live behind a green healthcheck because the variable was left set.
3. To see what would run against a database without changing anything: `DATABASE_URL=… npm run db:migrate -- --dry-run --yes`.
4. `index … exists but is INVALID` means an earlier `CREATE INDEX CONCURRENTLY` failed part-way, leaving an index Postgres never uses. Drop the index it names with `DROP INDEX CONCURRENTLY IF EXISTS <index>`, then boot again; the migration builds it afresh.

### Step 5: Get Your Railway URL
1. Railway will deploy your app automatically
2. Go to **Settings** → **Domains** → **Generate Domain**
3. You'll get a URL like: `your-app.up.railway.app`

### Step 6: Configure Your Domain with Cloudflare

#### In Cloudflare:
1. Log into Cloudflare
2. Select your domain
3. Go to **DNS** tab
4. Add a CNAME record:
   - **Type:** CNAME
   - **Name:** @ (for root domain) or www
   - **Target:** your-app.up.railway.app
   - **Proxy status:** Proxied (orange cloud)

#### In Railway:
1. Go to **Settings** → **Domains**
2. Click **Custom Domain**
3. Enter your domain: `yourdomain.com` or `www.yourdomain.com`
4. Railway will provide verification instructions if needed

### Step 7: Enable SSL (Automatic with Cloudflare)
Cloudflare automatically provides SSL. Ensure:
1. In Cloudflare → **SSL/TLS** → Set to **Full** or **Flexible**
2. Enable **Always Use HTTPS**

---

## Option 2: DigitalOcean VPS (More Control)

### Step 1: Create a Droplet
1. Sign up at https://www.digitalocean.com
2. Create a Droplet:
   - **Image:** Ubuntu 22.04 LTS
   - **Plan:** Basic ($6/month)
   - **Datacenter:** Choose closest to your users
3. Add SSH key for secure access

### Step 2: Connect to Your Server
```bash
ssh root@your_server_ip
```

### Step 3: Install Dependencies
```bash
# Update system
apt update && apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install PostgreSQL
apt install -y postgresql postgresql-contrib

# Install Nginx (reverse proxy)
apt install -y nginx

# Install Certbot (for SSL)
apt install -y certbot python3-certbot-nginx

# Install Git
apt install -y git

# Install PM2 (process manager)
npm install -g pm2
```

### Step 4: Set Up PostgreSQL
```bash
# Switch to postgres user
sudo -u postgres psql

# In PostgreSQL:
CREATE DATABASE pokerpal;
CREATE USER pokerpal WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE pokerpal TO pokerpal;
\q
```

### Step 5: Clone and Set Up Your App
```bash
# Create app directory
mkdir -p /var/www/pokerpal
cd /var/www/pokerpal

# Clone your repository
git clone https://github.com/yourusername/pokerpal.git .

# Install dependencies
npm ci

# Create .env file
nano .env
```

Add to `.env`:
```
DATABASE_URL=postgresql://pokerpal:your_secure_password@localhost:5432/pokerpal
SESSION_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
NODE_ENV=production
PORT=3000
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_api_key
```

```bash
# Build the app
npm run build

# Database schema: the server applies migrations/ itself every time it starts.
# To check them first without running anything:
npm run db:migrate -- --dry-run --yes

# Create uploads directory
mkdir -p uploads
```

### Step 6: Set Up PM2
```bash
# Start the app with PM2
pm2 start dist/index.js --name pokerpal

# Save PM2 configuration
pm2 save

# Set up PM2 to start on boot
pm2 startup
# Follow the command it outputs
```

### Step 7: Configure Nginx
```bash
nano /etc/nginx/sites-available/pokerpal
```

Add:
```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Handle uploads
    location /uploads {
        alias /var/www/pokerpal/uploads;
    }
}
```

```bash
# Enable site
ln -s /etc/nginx/sites-available/pokerpal /etc/nginx/sites-enabled/

# Test Nginx configuration
nginx -t

# Restart Nginx
systemctl restart nginx
```

### Step 8: Configure Cloudflare DNS
1. In Cloudflare, go to **DNS** tab
2. Add an A record:
   - **Type:** A
   - **Name:** @
   - **IPv4 address:** your_server_ip
   - **Proxy status:** Proxied (orange cloud)
3. Add another A record for www (optional):
   - **Type:** A
   - **Name:** www
   - **IPv4 address:** your_server_ip
   - **Proxy status:** Proxied

### Step 9: Enable SSL with Certbot
```bash
# Get SSL certificate
certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Test auto-renewal
certbot renew --dry-run
```

---

## Option 3: Render (Free Tier Available)

### Step 1: Create a Render Account
1. Go to https://render.com
2. Sign up with GitHub

### Step 2: Create PostgreSQL Database
1. Click **New** → **PostgreSQL**
2. Choose free tier or paid
3. Note down the **Internal Database URL**

### Step 3: Create Web Service
1. Click **New** → **Web Service**
2. Connect your GitHub repository
3. Configure:
   - **Name:** pokerpal
   - **Environment:** Node
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Plan:** Free or Starter

### Step 4: Add Environment Variables
In Render dashboard, add:
```
DATABASE_URL=<from PostgreSQL service>
SESSION_SECRET=<generate random string>
NODE_ENV=production
VITE_GOOGLE_MAPS_API_KEY=<your key>
```

### Step 5: Configure Custom Domain
1. In Render → **Settings** → **Custom Domain**
2. Add your domain
3. In Cloudflare DNS:
   - Add CNAME record pointing to your Render URL

---

## Post-Deployment Checklist

- [ ] App is accessible via your domain
- [ ] SSL is working (https://)
- [ ] Database is connected and working
- [ ] File uploads are working
- [ ] WebSocket connections work (for real-time updates)
- [ ] Create your first admin user
- [ ] Test tournament creation and management
- [ ] Set up backups (database)

## Monitoring and Maintenance

### Railway
- Monitor usage in Railway dashboard
- Set up alerts for errors
- Database auto-backups included

### DigitalOcean
```bash
# View app logs
pm2 logs pokerpal

# Restart app
pm2 restart pokerpal

# Backup database
pg_dump -U pokerpal pokerpal > backup_$(date +%Y%m%d).sql
```

### Updating Your App
```bash
# Railway: Just push to GitHub, auto-deploys

# DigitalOcean:
cd /var/www/pokerpal
git pull
npm ci
npm run build
pm2 restart pokerpal  # applies any new migrations before it starts serving
```

## Cloudflare Configuration Tips

1. **SSL/TLS Mode:** Set to **Full** (not Full Strict) or **Flexible**
2. **Always Use HTTPS:** Enable this
3. **Caching:** Consider enabling for static assets
4. **Firewall:** Set up rules to protect your app
5. **Speed:** Enable Auto Minify for JS, CSS, HTML

## Getting Help

- Railway: https://railway.app/help
- DigitalOcean: https://docs.digitalocean.com
- Render: https://render.com/docs
- Cloudflare: https://support.cloudflare.com

## Recommended: Railway for Easiest Setup

I recommend starting with Railway because:
- ✅ Easiest setup (5 minutes)
- ✅ Free tier available
- ✅ Auto-deployments from GitHub
- ✅ Built-in database backups
- ✅ No server management needed
- ✅ Scales automatically

Once you're comfortable, you can migrate to DigitalOcean if you need more control.
