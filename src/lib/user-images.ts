import type { SupabaseClient } from "@supabase/supabase-js";

// Photos participants upload in the caption lab live in the private
// `user-images` bucket at "<profile_id>/<uuid>.jpg". Caption rows that point at
// one store "user-images:<path>" in image_url; pages swap it for a short-lived
// signed URL before rendering.

export const USER_IMAGE_BUCKET = "user-images";
const REF_PREFIX = "user-images:";
const SIGNED_URL_SECONDS = 60 * 60;

export function toUserImageRef(storagePath: string) {
  return `${REF_PREFIX}${storagePath}`;
}

export function userImagePath(value: string | null | undefined): string | null {
  return typeof value === "string" && value.startsWith(REF_PREFIX) ? value.slice(REF_PREFIX.length) : null;
}

export function newUserImagePath(profileId: string, id: string, contentType: string) {
  const extension = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  return `${profileId}/${id}.${extension}`;
}

/** Splits a validated base64 data URL into bytes and content type. */
export function decodeDataUrl(dataUrl: string): { contentType: string; bytes: Uint8Array } | null {
  const match = /^data:([a-z/]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return null;
  return { contentType: match[1], bytes: Uint8Array.from(Buffer.from(match[2], "base64")) };
}

export async function signStoragePaths(supabase: SupabaseClient, paths: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths)];
  const signed = new Map<string, string>();
  if (unique.length === 0) return signed;
  const { data, error } = await supabase.storage.from(USER_IMAGE_BUCKET).createSignedUrls(unique, SIGNED_URL_SECONDS);
  if (error) {
    console.error("[signStoragePaths] signing failed", error);
    return signed;
  }
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) signed.set(entry.path, entry.signedUrl);
  }
  return signed;
}

/**
 * Replaces user-image references in a list of image URLs with signed URLs.
 * Ordinary URLs pass through; references that can't be signed become null.
 */
export async function resolveImageUrls(supabase: SupabaseClient, values: (string | null)[]): Promise<(string | null)[]> {
  const paths = values.map(userImagePath).filter((path): path is string => Boolean(path));
  const signed = await signStoragePaths(supabase, paths);
  return values.map((value) => {
    const path = userImagePath(value);
    return path ? signed.get(path) ?? null : value;
  });
}
