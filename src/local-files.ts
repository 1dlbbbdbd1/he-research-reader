const DB_NAME = 'research-agent-workbench'
const STORE_NAME = 'source-files'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function saveLocalFile(id: string, file: File) {
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(file, id)
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error)
  })
  database.close()
}

export async function getLocalFile(id: string) {
  const database = await openDatabase()
  const file = await new Promise<File | undefined>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id)
    request.onsuccess = () => resolve(request.result as File | undefined); request.onerror = () => reject(request.error)
  })
  database.close()
  return file
}
