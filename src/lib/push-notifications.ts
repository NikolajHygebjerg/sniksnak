// Utility functions for Web Push Notifications

export interface PushSubscriptionData {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

/**
 * Request notification permission from the user
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) {
    console.warn('This browser does not support notifications');
    return 'denied';
  }

  if (Notification.permission === 'granted') {
    return 'granted';
  }

  if (Notification.permission === 'denied') {
    return 'denied';
  }

  // Request permission
  const permission = await Notification.requestPermission();
  return permission;
}

/**
 * Register service worker for push notifications
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) {
    console.warn('This browser does not support service workers');
    return null;
  }

  try {
    // Check if service worker is already registered
    let registration = await navigator.serviceWorker.getRegistration('/');
    
    if (!registration) {
      // Register new service worker
      registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
      });
      console.log('Service Worker registered:', registration);
      
      // Wait for service worker to be installed
      if (registration.installing) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Service worker installation timeout'));
          }, 10000); // 10 second timeout
          
          registration!.installing!.addEventListener('statechange', function() {
            if (this.state === 'installed' || this.state === 'activated') {
              clearTimeout(timeout);
              resolve();
            } else if (this.state === 'redundant') {
              clearTimeout(timeout);
              reject(new Error('Service worker installation failed'));
            }
          });
        });
      }
    } else {
      console.log('Service Worker already registered:', registration);
    }
    
    // Always wait for service worker to be ready (active)
    const readyRegistration = await navigator.serviceWorker.ready;
    
    // Double check that it's actually active
    if (!readyRegistration.active) {
      console.warn('Service worker registered but not active yet, waiting...');
      // Wait up to 5 seconds for it to become active
      await new Promise<void>((resolve) => {
        const checkActive = setInterval(() => {
          if (readyRegistration.active) {
            clearInterval(checkActive);
            resolve();
          }
        }, 100);
        
        setTimeout(() => {
          clearInterval(checkActive);
          resolve();
        }, 5000);
      });
    }
    
    if (!readyRegistration.active) {
      console.error('Service worker is not active after waiting');
      return null;
    }
    
    console.log('Service Worker is active and ready');
    return readyRegistration;
  } catch (error) {
    console.error('Service Worker registration failed:', error);
    return null;
  }
}

/**
 * Subscribe to push notifications
 */
export async function subscribeToPush(
  registration: ServiceWorkerRegistration
): Promise<PushSubscription | null> {
  try {
    // Ensure service worker is active
    if (!registration.active) {
      console.log('Waiting for Service Worker to be active...');
      const readyRegistration = await navigator.serviceWorker.ready;
      if (!readyRegistration.active) {
        console.error('Service worker is not active');
        return null;
      }
    }

    // Check if push manager is available
    if (!registration.pushManager) {
      console.error('Push Manager is not available');
      return null;
    }

    // Check if push is supported
    if (!('PushManager' in window)) {
      console.error('Push Manager is not supported in this browser');
      return null;
    }

    // Check if already subscribed
    let subscription = await registration.pushManager.getSubscription();
    
    if (subscription) {
      console.log('Already subscribed to push notifications');
      return subscription;
    }

    // Get VAPID public key from environment
    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidPublicKey || vapidPublicKey === 'your-public-key-here') {
      console.warn('NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set. Push notifications will not work. See docs/PUSH_NOTIFICATIONS_SETUP.md for setup instructions.');
      return null;
    }

    // Validate VAPID key format
    if (vapidPublicKey.length < 80 || vapidPublicKey.length > 90) {
      console.error('VAPID key length seems incorrect:', vapidPublicKey.length);
      console.error('Expected length: 87-88 characters');
    }

    // Convert VAPID key to Uint8Array
    let applicationServerKey: Uint8Array;
    try {
      applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
      console.log('VAPID key converted successfully, length:', applicationServerKey.length);
    } catch (keyError) {
      console.error('Failed to convert VAPID key:', keyError);
      return null;
    }

    // Wait a bit more to ensure everything is ready
    await new Promise(resolve => setTimeout(resolve, 500));

    // Subscribe to push notifications
    // Note: Some browsers may take longer, so we don't timeout here
    // If it fails, it's not critical - badge notifications still work
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey,
    });

    console.log('Subscribed to push notifications:', subscription);
    return subscription;
  } catch (error: any) {
    // Silently fail - push notifications are optional
    // Badge notifications will still work perfectly
    // AbortError is expected in some browsers/environments and is OK
    if (process.env.NODE_ENV === 'development' && error.name !== 'AbortError') {
      console.warn('Push subscription failed (this is OK - badge notifications still work):', error.name || error.message);
    }
    
    return null;
  }
}

/**
 * Convert VAPID public key from base64 URL to Uint8Array
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  // Remove any whitespace
  base64String = base64String.trim();
  
  // VAPID keys should be 65 bytes when decoded (uncompressed public key)
  // Base64 URL encoding: length should be around 87-88 characters
  if (base64String.length < 80 || base64String.length > 90) {
    console.warn('VAPID key length seems unusual:', base64String.length);
  }

  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  try {
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    
    // Verify the key length (should be 65 bytes for uncompressed public key)
    if (outputArray.length !== 65) {
      console.warn('VAPID key decoded length is', outputArray.length, 'expected 65');
    }
    
    return outputArray;
  } catch (error) {
    console.error('Failed to decode VAPID key:', error);
    throw new Error('Invalid VAPID key format');
  }
}

/**
 * Save push subscription to the backend
 */
export async function savePushSubscription(
  subscription: PushSubscription
): Promise<boolean> {
  try {
    // Import supabase client to get session token
    const { supabase } = await import('./supabase');
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session?.access_token) {
      console.error('No active session found');
      return false;
    }

    const subscriptionData: PushSubscriptionData = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: arrayBufferToBase64(subscription.getKey('p256dh')!),
        auth: arrayBufferToBase64(subscription.getKey('auth')!),
      },
    };

    const response = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(subscriptionData),
    });

    if (!response.ok) {
      let errorMessage = 'Unknown error';
      try {
        const error = await response.json();
        errorMessage = error.error || error.details || JSON.stringify(error);
        console.error('Failed to save push subscription:', error);
      } catch (e) {
        // If response is not JSON, get text
        const text = await response.text();
        errorMessage = text || `HTTP ${response.status}`;
        console.error('Failed to save push subscription (non-JSON response):', errorMessage);
      }
      return false;
    }

    console.log('Push subscription saved successfully');
    return true;
  } catch (error) {
    console.error('Error saving push subscription:', error);
    return false;
  }
}

/**
 * Convert ArrayBuffer to base64 string
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

/**
 * Initialize push notifications (request permission, register service worker, subscribe)
 * Returns true if successful, false otherwise. App will still work if this fails.
 * This runs silently in the background - failures don't affect the app.
 */
export async function initializePushNotifications(): Promise<boolean> {
  // Check if VAPID key is configured
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey || vapidPublicKey === 'your-public-key-here') {
    // Silent fail - push notifications are optional
    return false;
  }

  // Check browser support
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    // Silent fail - browser doesn't support it
    return false;
  }

  try {
    // Step 1: Request notification permission
    const permission = await requestNotificationPermission();
    if (permission !== 'granted') {
      // Silent fail - user didn't grant permission
      return false;
    }

    // Step 2: Register service worker
    const registration = await registerServiceWorker();
    if (!registration) {
      // Silent fail
      return false;
    }

    // Ensure service worker is fully active before subscribing
    if (!registration.active) {
      await navigator.serviceWorker.ready;
      // Wait a bit more to ensure everything is settled
      await new Promise(resolve => setTimeout(resolve, 1500));
    } else {
      // Still wait a bit to ensure everything is ready
      await new Promise(resolve => setTimeout(resolve, 800));
    }

    // Step 3: Subscribe to push notifications (with retry)
    let subscription = await subscribeToPush(registration);
    
    // Retry once if it fails
    if (!subscription) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      subscription = await subscribeToPush(registration);
    }
    
    if (!subscription) {
      // Silent fail - badge notifications will still work
      return false;
    }

    // Step 4: Save subscription to backend
    const saved = await savePushSubscription(subscription);
    if (!saved) {
      // Silent fail - badge notifications will still work
      return false;
    }

    if (process.env.NODE_ENV === 'development') {
      console.log('✅ Push notifications initialized successfully');
    }
    return true;
  } catch (error) {
    // Silent fail - app should still work without push notifications
    return false;
  }
}

/**
 * Unsubscribe from push notifications
 */
export async function unsubscribeFromPush(): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    
    if (subscription) {
      await subscription.unsubscribe();
      
      // Get session token
      const { supabase } = await import('./supabase');
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session?.access_token) {
        // Delete from backend
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
      }
      
      console.log('Unsubscribed from push notifications');
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('Error unsubscribing from push:', error);
    return false;
  }
}
