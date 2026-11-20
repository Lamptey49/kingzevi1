import { v2 as cloudinary } from 'cloudinary';

// Cloudinary reads CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
// automatically when those env vars are set — no explicit config call needed.
// We call it here anyway so misconfiguration fails loudly at startup.
export function initCloudinary() {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;

  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw new Error(
      'Cloudinary credentials missing — set CLOUDINARY_CLOUD_NAME, ' +
      'CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in your environment.',
    );
  }

  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key:    CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure:     true,   // always return https:// URLs
  });

  console.log(`☁️  Cloudinary ready → cloud: ${CLOUDINARY_CLOUD_NAME}`);
}

/**
 * Upload a profile picture buffer to Cloudinary.
 * Applies face-aware square crop at 400×400 and auto-format/quality.
 * Returns the full Cloudinary result (secure_url, public_id, …).
 */
export function uploadAvatar(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder:        'solace/avatars',
        resource_type: 'image',
        transformation: [
          { width: 400, height: 400, crop: 'fill', gravity: 'face', quality: 'auto', fetch_format: 'auto' },
        ],
      },
      (err, result) => (err ? reject(err) : resolve(result)),
    );
    stream.end(buffer);
  });
}

/**
 * Upload a post image buffer to Cloudinary.
 * Returns the full Cloudinary upload result (secure_url, public_id, …).
 */
export function uploadBuffer(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder:        'solace/posts',
        resource_type: 'image',
        ...options,
      },
      (err, result) => (err ? reject(err) : resolve(result)),
    );
    stream.end(buffer);
  });
}

/**
 * Delete an image from Cloudinary by its public_id.
 * Safe to call even if the image no longer exists.
 */
export async function deleteImage(publicId) {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    // Log but never throw — a failed CDN delete should not break the API
    console.warn('Cloudinary delete warning:', err.message);
  }
}
