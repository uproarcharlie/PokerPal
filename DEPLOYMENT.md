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

# Push database schema
npm run db:push

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
npm run db:push
pm2 restart pokerpal
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
