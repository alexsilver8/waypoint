import { realpath } from 'node:fs/promises';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, type NativeImage, nativeImage, net, protocol } from 'electron';
import { fileIconSize, IconCache, iconRequestPath, loadFileIcon } from './icon-cache';

/** `palette-icon://icon?path=/Applications/Safari.app` serves the icon for that file. */
export const ICON_SCHEME = 'palette-icon';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico']);

/** Rows show icons at 24 px and the preview at 44 px; Quick Look multiplies by the screen's scale. */
const THUMBNAIL_SIZE = { width: 48, height: 48 };

const png = (image: NativeImage) => (image.isEmpty() ? undefined : new Uint8Array(image.toPNG()));

const osIcons = new IconCache((path) =>
  loadFileIcon(path, process.platform, {
    thumbnail: async (file) => png(await nativeImage.createThumbnailFromPath(file, THUMBNAIL_SIZE)),
    fileIcon: async (file) => png(await app.getFileIcon(file, { size: fileIconSize(process.platform) })),
    realpath: (file) => realpath(file),
  }),
);

/** Must run before the app is ready. */
export function registerIconScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: ICON_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

/** Image files are served as they are; for anything else the OS file icon is used. */
export function handleIconProtocol(): void {
  protocol.handle(ICON_SCHEME, async (request) => {
    // Never a file share: neither the image nor its OS icon is worth Windows signing in to one.
    const path = iconRequestPath(request.url);
    if (!path) return new Response(null, { status: 400 });
    try {
      if (IMAGE_EXTENSIONS.has(extname(path).toLowerCase())) {
        const response = await net.fetch(pathToFileURL(path).toString());
        return new Response(response.body, {
          status: response.status,
          headers: {
            'content-type': response.headers.get('content-type') ?? 'application/octet-stream',
            'cache-control': 'max-age=3600',
          },
        });
      }
      return new Response(await osIcons.get(path), {
        headers: { 'content-type': 'image/png', 'cache-control': 'max-age=3600' },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}
