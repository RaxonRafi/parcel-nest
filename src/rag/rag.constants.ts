import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Where uploaded PDFs sit while they are being indexed. The OS temp directory
 * is `/tmp` on Vercel — the only writable path there — and the right place on
 * every other platform too.
 */
export const UPLOAD_DIR = join(tmpdir(), 'uploads');
