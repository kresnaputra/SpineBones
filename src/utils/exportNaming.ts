/**
 * Naming shared by the archive exporters.
 *
 * PNG sequences and sprite sheets both name their *contents* after the archive
 * the user chose to save, so a stem taken from a save dialog ends up as file
 * names inside a zip. That value is cleaned here, in one place, rather than
 * once per exporter where the two rules could drift apart.
 */

/**
 * Reduce an arbitrary file stem to something safe to write into an archive.
 *
 * Letters and digits of any script survive, along with dot, underscore and
 * dash; every other run collapses to a single dash. Leading and trailing dots
 * and dashes are dropped — a leading dot would make the frames hidden files on
 * Unix, and a trailing one is invalid on Windows.
 *
 * A name with nothing left falls back to `frame`, which is what archives
 * written before these exporters took a name contain.
 */
export const sanitizeBaseName = (name: string, fallback = 'frame') => {
  const cleaned = name
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return cleaned || fallback;
};
