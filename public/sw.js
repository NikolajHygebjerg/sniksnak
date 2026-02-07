// Service Worker for handling push notifications
// This file must be in the public directory to be accessible at /sw.js

self.addEventListener('push', function(event) {
  console.log('[Service Worker] Push notification received');
  
  let notificationData = {
    title: 'Ny besked',
    body: 'Du har modtaget en ny chatbesked',
    icon: '/icon-192x192.png',
    badge: '/icon-192x192.png',
    tag: 'chat-message',
    requireInteraction: false,
    data: {
      url: '/chats'
    }
  };

  // Try to parse the push payload if available
  if (event.data) {
    try {
      const payload = event.data.json();
      if (payload.title) notificationData.title = payload.title;
      if (payload.body) notificationData.body = payload.body;
      if (payload.icon) notificationData.icon = payload.icon;
      if (payload.url) notificationData.data.url = payload.url;
      if (payload.chatId) notificationData.data.chatId = payload.chatId;
      if (payload.tag) notificationData.tag = payload.tag;
    } catch (e) {
      console.error('[Service Worker] Error parsing push payload:', e);
    }
  }

  event.waitUntil(
    self.registration.showNotification(notificationData.title, notificationData)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', function(event) {
  console.log('[Service Worker] Notification clicked');
  
  event.notification.close();

  const urlToOpen = event.notification.data?.url || '/chats';
  const chatId = event.notification.data?.chatId;

  // Construct the full URL
  let url = urlToOpen;
  if (chatId && urlToOpen === '/chats') {
    url = `/chats/${chatId}`;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      // Check if there's already a window/tab open with the target URL
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      // If no window is open, open a new one
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});

// Handle notification close
self.addEventListener('notificationclose', function(event) {
  console.log('[Service Worker] Notification closed');
});
