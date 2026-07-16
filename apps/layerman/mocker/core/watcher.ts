import chokidar, { type FSWatcher } from 'chokidar'
import { resolve } from 'path'

export function watchMockDir(
  dir: string,
  onChange: (filePath: string) => Promise<void>
): FSWatcher {
  const absDir = resolve(dir)

  const notify = (path: string) => {
    console.log(`[mocker] File changed: ${path}`)
    onChange(path).catch(err => console.error('[mocker] Hot reload error:', err))
  }

  return chokidar
    .watch(`${absDir}/**/*.ts`, { ignoreInitial: true, persistent: true })
    .on('change', notify)
    .on('add', notify)
    .on('unlink', notify)
}
