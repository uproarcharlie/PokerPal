# Cloud Storage Setup Guide

PokerPal requires cloud storage for production deployments to ensure uploaded images persist across server restarts. This guide shows you how to set up free Cloudflare R2 storage.

## Why Cloud Storage?

In production, local file storage is lost when:
- The server restarts
- You clear cache
- Your hosting provider redeploys

Cloud storage ensures your images are always available.

## Cloudflare R2 Setup (Free Tier)

Cloudflare R2 offers 10GB free storage with no egress fees - perfect for PokerPal!

### Step 1: Create Cloudflare Account

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Sign up or log in
3. Navigate to R2 in the sidebar

### Step 2: Create an R2 Bucket

1. Click **Create bucket**
2. Name your bucket (e.g., `pokerpal-images`)
3. Choose a location close to your users
4. Click **Create bucket**

### Step 3: Make Bucket Public (Optional)

For public image access:

1. Go to your bucket settings
2. Click **Settings** tab
3. Under **Public access**, click **Allow Access**
4. Or connect a custom domain for prettier URLs

### Step 4: Create API Token

1. Go to **R2** > **Manage R2 API Tokens**
2. Click **Create API Token**
3. Name it (e.g., `PokerPal Upload`)
4. Permissions: **Object Read & Write**
5. Apply to: **Specific bucket** (select your bucket)
6. Click **Create API Token**
7. **SAVE THESE VALUES** - you won't see them again:
   - Access Key ID
   - Secret Access Key

### Step 5: Get Your Account ID

1. In the Cloudflare dashboard, your Account ID is shown in the sidebar
2. Copy it for the next step

### Step 6: Configure Railway Environment Variables

Add these to your Railway project. Production always uses R2 when they are set; set **all five or none**. With only some set, the server refuses to start and names what is missing, and the healthcheck keeps the previous deployment serving.

```env
R2_ACCOUNT_ID=your_cloudflare_account_id_here
R2_ACCESS_KEY_ID=your_r2_access_key_id_here
R2_SECRET_ACCESS_KEY=your_r2_secret_access_key_here
R2_BUCKET_NAME=pokerpal-images

# Where browsers load images from: the bucket's public r2.dev URL (Step 3) or a custom domain.
R2_PUBLIC_URL=https://pub-xxxxxxxx.r2.dev
```

`R2_PUBLIC_URL` is required. It must be the bucket's public address, never the `https://<account-id>.r2.cloudflarestorage.com` API host: that host only answers signed requests, so no browser can load an image from it, and the server refuses to start with it.

Images are stored as WebP at several sizes under `<kind>/<random id>/<width>.webp` and cached for a year (each upload gets a new address, so nothing stale is ever served).

### Step 7: Deploy

Push your code and Railway will redeploy with cloud storage. The deploy log should show `Image storage: Cloudflare R2 bucket "…", served from https://…`.

## Without R2: local disk

In development and tests, images are saved under `UPLOAD_DIR` (default `./uploads`) and served at `/uploads`.

In production, images go to local disk only when `UPLOAD_DIR` names a directory explicitly, and it must be a persistent volume: a container's own disk is wiped by every redeploy. `docker-compose.yml` mounts `./uploads` at `/app/uploads` and sets `UPLOAD_DIR=/app/uploads`. With neither R2 nor `UPLOAD_DIR`, production answers image uploads with 503 instead of saving images that would vanish.

To use R2 in development, set `USE_CLOUD_STORAGE=true` and all five `R2_*` variables in your `.env`.

## Troubleshooting

### Images not uploading

- Check your API token has **Object Read & Write** permissions
- Verify your bucket name matches exactly
- Check Railway logs for error messages

### Images not displaying

- Ensure your bucket has public access enabled OR
- Set up a custom domain in R2 settings
- Check the `R2_PUBLIC_URL` matches your domain

### Cost concerns

Cloudflare R2 free tier includes:
- 10 GB storage
- 1 million Class A operations/month (uploads)
- 10 million Class B operations/month (downloads)
- **Zero egress fees**

Perfect for small to medium poker clubs!
