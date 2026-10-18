import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { setUpDocument } from '../document';
import { OnboardingApp } from './OnboardingApp';
import './onboarding.css';

setUpDocument(window.onboarding.platform);

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary>
      <OnboardingApp />
    </ErrorBoundary>
  </StrictMode>,
);
