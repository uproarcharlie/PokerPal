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

Add these to your Railway project:

```env
# Enable cloud storage in production
USE_CLOUD_STORAGE=true

# Cloudflare R2 credentials
R2_ACCOUNT_ID=your_cloudflare_account_id_here
R2_ACCESS_KEY_ID=your_r2_access_key_id_here
R2_SECRET_ACCESS_KEY=your_r2_secret_access_key_here
R2_BUCKET_NAME=pokerpal-images

# Public URL (if using custom domain, otherwise leave out)
R2_PUBLIC_URL=https://your-custom-domain.com
```

**If you don't set a custom domain**, images will be accessible at:
```
https://[bucket-name].[account-id].r2.cloudflarestorage.com/[image-path]
```

### Step 7: Deploy

Push your code and Railway will automatically redeploy with cloud storage enabled!

## Alternative: AWS S3

You can also use AWS S3 or any S3-compatible storage. Just update the endpoint in `server/services/storage.ts`:

```typescript
endpoint: process.env.S3_ENDPOINT || `https://s3.${process.env.AWS_REGION}.amazonaws.com`
```

And use these environment variables instead:
- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `S3_BUCKET_NAME`

## Testing Locally

To test cloud storage in development:

```bash
# In your .env file
USE_CLOUD_STORAGE=true
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=...
```

Otherwise, images will be saved to the local `uploads/` folder (development mode).

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
