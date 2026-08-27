import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import { runTopDismiss } from './useBackDismiss';

// Capacitor's default BridgeActivity back-button handling has nothing to act
// on now that navigation lives in react-router — this listener is what makes
// the hardware back button step back through the app's actual route history
// (one press per navigate() call, same granularity as the in-app switchers)
// instead of just exiting. No-op on web/dev preview since the native
// 'backButton' event never fires there.
export function useAndroidBackButton() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const subPromise = CapApp.addListener('backButton', () => {
      // An overlay on top of the page gets first refusal — see useBackDismiss.
      // Without this, back closed nothing and changed the route underneath the
      // open sheet instead.
      if (runTopDismiss()) return;

      if (location.pathname === '/' || location.pathname === '/dashboard') {
        CapApp.exitApp();
      } else {
        navigate(-1);
      }
    });
    return () => { subPromise.then(sub => sub.remove()); };
  }, [location, navigate]);
}
