import type { MainRequest } from '../../shared/extension-protocol';
import type { WakeLocks } from '../power';
import type { HostServices } from './host-client';

/**
 * What the main process does for extensions, asked through the extension host. What comes in
 * is checked, as extension code could have sent it.
 */
export function hostServices(wakeLocks: WakeLocks): HostServices {
  return (request: MainRequest) => {
    const { extension } = request.params;
    if (typeof extension !== 'string' || !extension) throw new Error('No extension was named.');
    switch (request.method) {
      case 'keepAwake': {
        const { until } = (request as MainRequest<'keepAwake'>).params;
        if (until !== null && typeof until !== 'number') {
          throw new Error('`until` has to be a time, in milliseconds since 1970.');
        }
        return wakeLocks.keepAwake(extension, until);
      }
      case 'allowSleep':
        wakeLocks.allowSleep(extension);
        return null;
      case 'wakeLock':
        return wakeLocks.wakeLock(extension);
      default:
        throw new Error(`Waypoint can't do "${String((request as MainRequest).method)}" for extensions.`);
    }
  };
}
