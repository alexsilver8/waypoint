/**
 * Whether a path names a computer on the network rather than a file here: `\\server\share`,
 * `//server/share`, or the long forms Windows also takes (`\\?\UNC\server\share`). Windows opens
 * these by connecting to that computer's file share, signing in with your account (NTLM) as it
 * does, so anything that loads a path it was handed by someone else refuses them, on every system.
 * Windows device paths (`\\.\pipe\…`, `\\?\C:\…`) start the same way and are refused too.
 */
export function isNetworkPath(path: string): boolean {
  return /^[\\/]{2}/.test(path.trimStart());
}
