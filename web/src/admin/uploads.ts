// Images picked in the editor are held here (base64) until Publish sends them
// along with the pages; previews swap /uploads/<name> for a data: URL.

import { MAX_UPLOAD_BYTES, type PublishUpload } from "../../shared/publish";

const MAX_DIMENSION = 1600;
const pending = new Map<string, { dataBase64: string; type: string }>();

export const pendingUploads = (): PublishUpload[] =>
  [...pending].map(([name, u]) => ({ name, dataBase64: u.dataBase64 }));

export function clearUploads() {
  pending.clear();
}

/** Serializable copy for the localStorage draft. */
export function exportUploads(): Record<string, { dataBase64: string; type: string }> {
  return Object.fromEntries(pending);
}

export function importUploads(saved: Record<string, { dataBase64: string; type: string }> | undefined) {
  for (const [name, u] of Object.entries(saved ?? {})) pending.set(name, u);
}

/** Drop pending uploads no longer referenced by any page. */
export function pruneUploads(json: string) {
  for (const name of pending.keys()) if (!json.includes(`/uploads/${name}`)) pending.delete(name);
}

/** Rewrite <img src="/uploads/x"> for not-yet-published uploads in preview HTML. */
export function previewHtml(html: string): string {
  return html.replace(/src="\/uploads\/([^"]+)"/g, (m, name: string) => {
    const u = pending.get(name);
    return u ? `src="data:${u.type};base64,${u.dataBase64}"` : m;
  });
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "image";
}

async function resize(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  // Small files that don't need scaling keep their original encoding (and PNG transparency).
  if (scale === 1 && file.size <= 500_000) return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not process image"))), "image/jpeg", 0.85)
  );
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Resize + stage an image; returns the site path to use as the block's src. */
export async function prepareUpload(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error("Please choose a JPG, PNG, WebP or GIF image.");
  const blob = file.type === "image/gif" ? file : await resize(file);
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error("That image is too large even after resizing (max 3 MB).");
  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" }[blob.type] ?? "jpg";
  const date = new Date().toISOString().slice(0, 10);
  const name = `${date}-${slugify(file.name)}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
  pending.set(name, { dataBase64: await toBase64(blob), type: blob.type || "image/jpeg" });
  return `/uploads/${name}`;
}
