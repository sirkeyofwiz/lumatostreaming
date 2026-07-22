const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');

function isConfigured() {
  return !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET_NAME && process.env.R2_PUBLIC_URL);
}

function client() {
  if (!isConfigured()) {
    throw Object.assign(new Error('File uploads are not configured on this server.'), { code: 'NO_R2_CONFIG' });
  }
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

function sanitizeFilename(name) {
  return (name || 'file').replace(/[^a-zA-Z0-9._-]/g, '-').slice(-100);
}

// Returns a short-lived URL the browser can PUT the file to directly, plus
// the permanent public URL it'll have once uploaded (to store in
// poster_url/video_url on the title/episode).
async function presignUpload({ filename, contentType, folder }) {
  const key = `${folder}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${sanitizeFilename(filename)}`;

  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    ContentType: contentType || 'application/octet-stream',
  });

  const uploadUrl = await getSignedUrl(client(), command, { expiresIn: 300 }); // 5 minutes
  const publicUrl = `${process.env.R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`;

  return { uploadUrl, publicUrl };
}

module.exports = { isConfigured, presignUpload };
