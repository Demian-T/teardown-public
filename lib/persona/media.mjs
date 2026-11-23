import { open, stat } from 'node:fs/promises'
import { extname } from 'node:path'

export async function inspectVideo(path) {
  const extension = extname(path).toLowerCase()
  if (!['.mp4', '.webm'].includes(extension)) throw new Error('Vidéo attendue au format MP4 ou WebM')
  const info = await stat(path)
  if (!info.isFile() || info.size < 12) throw new Error('Fichier vidéo vide ou invalide')
  const file = await open(path, 'r')
  const header = Buffer.alloc(12)
  try { await file.read(header, 0, 12, 0) } finally { await file.close() }
  const valid = extension === '.mp4' ? header.toString('ascii', 4, 8) === 'ftyp' : header.readUInt32BE(0) === 0x1a45dfa3
  if (!valid) throw new Error('Le contenu du fichier ne correspond pas au format vidéo annoncé')
  return { mimeType: extension === '.mp4' ? 'video/mp4' : 'video/webm', bytes: info.size }
}
