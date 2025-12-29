const webpush = require("web-push");

const vapidKeys = {
  publicKey: process.env.VAPID_PUBLIC_KEY,
  privateKey: process.env.VAPID_PRIVATE_KEY,
};

webpush.setVapidDetails(
  "mailto:your-email@example.com", // Replace with your email
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

module.exports = webpush;
