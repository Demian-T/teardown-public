import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
const privateFiles = files.filter(file => /^(?:\.local|\.cookies|output|personas|persona-runs)(?:\/|$)/.test(file) || /\.(mp4|webm|mov|mkv|avi)(?:\.part)?$/i.test(file))
if (privateFiles.length) {
  console.error(`Fichiers locaux ou vidéos présents dans l’index Git :\n${privateFiles.join('\n')}`)
  process.exitCode = 1
} else console.log('Aucun fichier des dossiers privés, output local ou vidéo dans l’index Git.')
