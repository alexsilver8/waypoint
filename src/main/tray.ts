import { join } from 'node:path';
import { app, Menu, nativeImage, Tray } from 'electron';
import { type UpdateMode, type UpdateStatus, updateMenuLabel } from '../shared/updates';

export interface TrayOptions {
  /** The shortcut that currently works, if any. */
  hotkey: () => string | undefined;
  onOpen(): void;
  onOpenNotes(): void;
  onOpenSettings(): void;
  onOpenExtensionsFolder(): void;
  onReloadExtensions(): void;
  /** Where updates stand; no update item when this copy doesn't update (run from source). */
  updates: () => { status: UpdateStatus; mode: UpdateMode };
  onUpdate(): void;
}

function trayIcon(): Electron.NativeImage {
  // macOS template images adapt to light and dark menu bars automatically.
  const file = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png';
  const image = nativeImage.createFromPath(join(app.getAppPath(), 'resources', file));
  if (process.platform === 'darwin') image.setTemplateImage(true);
  return image;
}

export class AppTray {
  private readonly tray: Tray;

  constructor(private readonly options: TrayOptions) {
    this.tray = new Tray(trayIcon());
    this.tray.setToolTip('Waypoint');
    // On Windows and Linux a click usually means "open"; macOS shows the menu instead.
    if (process.platform !== 'darwin') this.tray.on('click', () => options.onOpen());
    this.refresh();
  }

  /** Rebuilds the menu, e.g. after the hotkey changed. */
  refresh(): void {
    const { options } = this;
    const updates = options.updates();
    const update: Electron.MenuItemConstructorOptions[] =
      updates.mode === 'off'
        ? []
        : [{ ...updateMenuLabel(updates.status, updates.mode), click: () => options.onUpdate() }];
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: 'Waypoint',
          accelerator: options.hotkey(),
          registerAccelerator: false,
          click: () => options.onOpen(),
        },
        { label: 'Notes', click: () => options.onOpenNotes() },
        { type: 'separator' },
        { label: 'Settings…', click: () => options.onOpenSettings() },
        { label: 'Open Extensions Folder', click: () => options.onOpenExtensionsFolder() },
        { label: 'Reload Extensions', click: () => options.onReloadExtensions() },
        { type: 'separator' },
        { label: `Waypoint ${app.getVersion()}`, enabled: false },
        ...update,
        { label: 'Quit', role: 'quit' },
      ]),
    );
  }

  destroy(): void {
    this.tray.destroy();
  }
}
