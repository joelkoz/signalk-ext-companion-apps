// The app list on disk (REQUIREMENTS.md §7.2): <dataDir>/apps.json,
// { version: 1, revision, apps }. Writes are atomic (temp file + rename); a
// file that fails to parse or validate is moved aside, never overwritten.

const fs = require('fs')
const path = require('path')
const { cleanList } = require('./validate')

const FILE_VERSION = 1

class StaleRevisionError extends Error {
  constructor(revision) {
    super('The app list was changed elsewhere.')
    this.revision = revision
  }
}

function createStore(dataDir, { error = () => {}, fsImpl = fs } = {}) {
  const file = path.join(dataDir, 'apps.json')
  const tmp = `${file}.tmp`
  let current = { revision: 0, apps: [] }

  function load() {
    let text
    try {
      text = fsImpl.readFileSync(file, 'utf8')
    } catch (err) {
      if (err.code === 'ENOENT') {
        current = { revision: 0, apps: [] }
        return current
      }
      throw err
    }
    try {
      const data = JSON.parse(text)
      if (!data || typeof data !== 'object' || !Number.isInteger(data.revision) || data.revision < 0) {
        throw new Error('missing or invalid revision')
      }
      current = { revision: data.revision, apps: cleanList(data.apps) }
    } catch (err) {
      const aside = `${file}.corrupt-${Date.now()}`
      try {
        fsImpl.renameSync(file, aside)
      } catch (renameErr) {
        error(`apps.json is unreadable (${err.message}) and could not be moved aside: ${renameErr.message}`)
        throw renameErr
      }
      error(`apps.json is unreadable (${err.message}); moved to ${path.basename(aside)}, starting with an empty list`)
      current = { revision: 0, apps: [] }
    }
    return current
  }

  /** Replace the list. Throws ValidationError or StaleRevisionError. */
  function save(revision, apps) {
    const clean = cleanList(apps)
    if (revision !== current.revision) throw new StaleRevisionError(current.revision)
    const next = { revision: current.revision + 1, apps: clean }
    fsImpl.mkdirSync(dataDir, { recursive: true })
    const body = JSON.stringify({ version: FILE_VERSION, ...next }, null, 2)
    try {
      fsImpl.writeFileSync(tmp, body)
      fsImpl.renameSync(tmp, file)
    } catch (err) {
      try {
        fsImpl.rmSync(tmp, { force: true })
      } catch {
        // best effort
      }
      throw err
    }
    current = next
    return current
  }

  return {
    file,
    load,
    save,
    get: () => current
  }
}

module.exports = { createStore, StaleRevisionError }
