const { getServiceClient } = require('./supabase');

const BUCKET = 'attachments';
const READ_URL_TTL_SECONDS = 3600; // 1 hora: suficiente para ver el historial sin que la URL quede utilizable para siempre

function sanitizeFileName(name) {
  return String(name || 'archivo')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(-120);
}

function buildPath(username, originalName) {
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `${username}/${stamp}-${rand}-${sanitizeFileName(originalName)}`;
}

async function createUploadUrl(username, originalName) {
  const supabase = getServiceClient();
  const path = buildPath(username, originalName);
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) throw error;
  return { path, signedUrl: data.signedUrl, token: data.token };
}

async function createReadUrl(path) {
  const supabase = getServiceClient();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, READ_URL_TTL_SECONDS);
  if (error) return null;
  return data.signedUrl;
}

module.exports = { BUCKET, createUploadUrl, createReadUrl };
