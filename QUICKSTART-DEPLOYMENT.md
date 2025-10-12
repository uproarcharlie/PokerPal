# 🚀 Quick Start: Deploy PokerPal in 15 Minutes

This is the fastest way to get PokerPal online with your GoDaddy domain and Cloudflare.

## 🎯 Recommended Path: Railway

I'll walk you through the easiest deployment option.

### Part 1: Prepare Your Code (5 minutes)

#### 1. Get Your Code on GitHub
```bash
# Initialize git if not already done
git init
git add .
git commit -m "Ready for deployment"

# Create a new repository on GitHub
# Go to: https://github.com/new
# Name it: pokerpal

# Connect and push
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/pokerpal.git
git push -u origin main
```

#### 2. Generate Your Session Secret
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
**Save this output somewhere safe!** You'll need it in a moment.

---

### Part 2: Deploy to Railway (5 minutes)

#### 1. Sign Up for Railway
- Go to https://railway.app
- Click **Login with GitHub**
- Authorize Railway

#### 2. Create a New Project
- Click **New Project**
- Select **Deploy from GitHub repo**
- Choose your `pokerpal` repository
- Railway will start building automatically

#### 3. Add PostgreSQL Database
- In your project, click **New**
- Select **Database** → **Add PostgreSQL**
- Railway creates the database instantly

#### 4. Configure Environment Variables
- Click on your **pokerpal** service (not the database)
- Go to **Variables** tab
- Click **Raw Editor** and paste:

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
NODE_ENV=production
PORT=3000
SESSION_SECRET=paste_the_secret_you_generated_earlier
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_key_if_you_have_one
```

- Click **Update Variables**
- Railway will automatically redeploy

#### 5. Get Your Railway URL
- Go to **Settings** tab
- Under **Domains**, click **Generate Domain**
- You'll get something like: `pokerpal-production-abc123.up.railway.app`
- Click the URL to verify your app is running!

---

### Part 3: Connect Your Domain (5 minutes)

#### Setup in GoDaddy (Change Nameservers)

1. **Log into GoDaddy**
   - Go to https://dcc.godaddy.com/domains
   - Find your domain and click **DNS**

2. **Change Nameservers to Cloudflare**
   - You'll get these from Cloudflare in the next step
   - Write them down or keep the tab open

#### Setup in Cloudflare

1. **Add Your Domain to Cloudflare**
   - Log into https://dash.cloudflare.com
   - Click **Add a Site**
   - Enter your domain name
   - Choose the Free plan
   - Cloudflare will scan your DNS records

2. **Copy Cloudflare Nameservers**
   - Cloudflare shows you 2 nameservers like:
     ```
     ns1.cloudflare.com
     ns2.cloudflare.com
     ```
   - Copy these

3. **Go Back to GoDaddy**
   - In DNS settings, find **Nameservers**
   - Click **Change**
   - Select **Custom**
   - Paste Cloudflare's nameservers
   - Save

   ⏰ **Wait 1-24 hours** for nameserver propagation (usually 1-2 hours)

4. **Back in Cloudflare - Add DNS Record**
   - Once nameservers are active, go to **DNS** → **Records**
   - Click **Add record**
   - Type: **CNAME**
   - Name: **@** (for root domain) or **www**
   - Target: **pokerpal-production-abc123.up.railway.app** (your Railway URL)
   - Proxy status: **Proxied** (orange cloud)
   - Click **Save**

5. **Enable SSL in Cloudflare**
   - Go to **SSL/TLS** tab
   - Set mode to **Flexible** or **Full**
   - Go to **SSL/TLS** → **Edge Certificates**
   - Enable **Always Use HTTPS**

#### Connect Domain in Railway

1. **Back in Railway**
   - Go to your app → **Settings** → **Domains**
   - Click **Custom Domain**
   - Enter: `yourdomain.com` (or `www.yourdomain.com`)
   - Click **Add**

2. **Wait a few minutes**
   - Railway will configure SSL
   - Test: `https://yourdomain.com`

---

## ✅ You're Live!

Your PokerPal app should now be accessible at your domain!

### 🎉 Next Steps

1. **Create Your First Admin User**
   - Visit: `https://yourdomain.com/register`
   - Create an account
   - You'll need to manually set this user as admin in the database initially

2. **Set First User as Admin (One-Time Setup)**
   - In Railway, click on **PostgreSQL** service
   - Click **Query** tab
   - Run:
   ```sql
   UPDATE users SET role = 'admin' WHERE email = 'your_email@example.com';
   ```

3. **Create Your First Club**
   - Log in to your app
   - Go to Clubs → Create New Club
   - Add club details and logo

4. **Start Adding Tournaments!**

---

## 🔧 Managing Your App

### View Logs
- Railway → Your App → **Deployments** → Click latest deployment

### Update Your App
```bash
# Make changes locally
git add .
git commit -m "Update description"
git push

# Railway automatically deploys!
```

### Monitor Usage
- Railway → Your App → **Metrics**
- Free tier includes:
  - 500 hours/month compute
  - 5 GB bandwidth
  - 1 GB database

---

## 🆘 Troubleshooting

### App won't start
- Check **Logs** in Railway
- Verify all environment variables are set
- Make sure `DATABASE_URL` points to your PostgreSQL service

### Domain not working
- Wait longer for nameserver propagation (can take 24 hours)
- Verify CNAME record in Cloudflare points to Railway URL
- Check SSL/TLS mode is **Flexible** or **Full**

### Database connection errors
- Verify `DATABASE_URL` in environment variables
- Check PostgreSQL service is running in Railway

---

## 💰 Cost Estimate

**Railway Free Tier:**
- ✅ $5 free credit per month
- ✅ Enough for small clubs (under 100 active users)

**When You Need to Upgrade:**
- ~$5-10/month for small-medium clubs
- ~$20-30/month for large clubs

**Cloudflare:**
- ✅ Free forever for most features

---

## 🎊 Success! 

You now have a production-ready poker tournament management system running on your own domain!

**Questions?** Check [DEPLOYMENT.md](DEPLOYMENT.md) for more detailed guides and alternative deployment options.
