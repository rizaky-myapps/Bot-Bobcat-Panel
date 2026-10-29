import fs from 'node:fs/promises';
import path from 'node:path';
import { v2 as cloudinary } from 'cloudinary';
import { config, cloudinaryEnabled } from '../../utils/config.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('uploads');
let configured = false;

function ensureConfigured() {
  if (configured) return;
  cloudinary.config({
    cloud_name: config.cloudinary.cloudName,
    api_key: config.cloudinary.apiKey,
    api_secret: config.cloudinary.apiSecret,
    secure: true,
  });
  configured = true;
}

async function downloadToTemp(url, name) {
  await fs.mkdir(config.tmpDir, { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Téléchargement impossible (${res.status})`);
  const file = path.join(config.tmpDir, `${Date.now()}-${path.basename(name || 'image').replace(/[^\w.-]/g, '_')}`);
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

/**
 * Héberge une image sur Cloudinary. Sans configuration Cloudinary, retourne l'URL d'origine.
 * @returns {Promise<{url:string, publicId:string|null, stored:boolean}>}
 */
export async function storeImage(url, { folder = 'pds', name } = {}) {
  if (!cloudinaryEnabled()) return { url, publicId: null, stored: false };
  ensureConfigured();
  const options = { folder: `${config.cloudinary.folder}/${folder}`, resource_type: 'image' };
  try {
    const res = await cloudinary.uploader.upload(url, options);
    return { url: res.secure_url, publicId: res.public_id, stored: true };
  } catch (err) {
    log.warn('Upload direct impossible, passage par le dossier temporaire :', err.message);
    const file = await downloadToTemp(url, name);
    try {
      const res = await cloudinary.uploader.upload(file, options);
      return { url: res.secure_url, publicId: res.public_id, stored: true };
    } finally {
      await fs.rm(file, { force: true });
    }
  }
}
