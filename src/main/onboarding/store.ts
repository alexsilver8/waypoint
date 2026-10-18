import type { OnboardingOutcome } from '../../shared/onboarding';
import { readJsonFile, writeJsonFile } from '../json-file';

type Status = 'pending' | OnboardingOutcome;

/**
 * Remembers in onboarding.json whether first-launch setup is still to do. A fresh install starts
 * it, quitting halfway brings it back next time, and finishing or skipping it ends it. Installs
 * from before setup existed already have settings and no record, so they never see it.
 */
export class OnboardingStore {
  private status: Status | undefined;

  constructor(
    private readonly path: string,
    firstRun: boolean,
  ) {
    this.status = this.read();
    if (this.status === undefined && firstRun) this.write('pending');
  }

  /** Whether setup should open when the app starts. */
  get pending(): boolean {
    return this.status === 'pending';
  }

  complete(outcome: OnboardingOutcome): void {
    this.write(outcome);
  }

  private read(): Status | undefined {
    try {
      const raw = readJsonFile(this.path);
      const status = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).status : undefined;
      return status === 'pending' || status === 'finished' || status === 'skipped' ? status : undefined;
    } catch (error) {
      console.warn(`[onboarding] Could not read ${this.path}: ${(error as Error).message}`);
      return undefined;
    }
  }

  private write(status: Status): void {
    this.status = status;
    try {
      writeJsonFile(this.path, { status, at: new Date().toISOString() });
    } catch (error) {
      console.warn(`[onboarding] Could not save ${this.path}: ${(error as Error).message}`);
    }
  }
}
