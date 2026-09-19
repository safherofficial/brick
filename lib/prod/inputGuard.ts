/** Reject anomalous files before the reconstruction pipeline runs. */

export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
export const MIN_IMPORT_BYTES = 32;

const ALLOWED_TYPE_RE = /^image\/(png|jpe?g|webp|gif|bmp)$/i;
const ALLOWED_NAME_RE = /\.(png|jpe?g|jpg|webp|gif|bmp)$/i;

export function assertImportableFile(file: File, label = "IMAGE") {
  if (!file) throw new Error(`${label} REQUIRED`);
  const size = typeof file.size === "number" ? file.size : 0;
  if (size > 0 && size < MIN_IMPORT_BYTES) {
    throw new Error(`${label} FILE TOO SMALL`);
  }
  if (size > MAX_IMPORT_BYTES) {
    throw new Error(`${label} FILE TOO LARGE`);
  }
  const type = file.type || "";
  const name = file.name || "";
  if (type && type.startsWith("image/") && !ALLOWED_TYPE_RE.test(type)) {
    throw new Error(`${label} TYPE NOT SUPPORTED`);
  }
  if (!type && name && !ALLOWED_NAME_RE.test(name)) {
    throw new Error(`${label} TYPE NOT SUPPORTED`);
  }
}
