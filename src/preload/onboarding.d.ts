import type { OnboardingApi } from '../shared/onboarding';

declare global {
  interface Window {
    onboarding: OnboardingApi;
  }
}
