// Minimal nanoid replacement (no dependency needed)
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
export function nanoid(size = 12): string {
  let id = '';
  const arr = new Uint8Array(size);
  crypto.getRandomValues(arr);
  for (let i = 0; i < size; i++) id += ALPHABET[arr[i] % ALPHABET.length];
  return id;
}
