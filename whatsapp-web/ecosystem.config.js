// PM2 Ecosystem Configuration for WhatsApp Microservice
//
// Usage:
//   pm2 start ecosystem.config.js
//   pm2 stop whatsapp-microservice
//   pm2 restart whatsapp-microservice
//   pm2 logs whatsapp-microservice
//
// EC2 Reboot Persistence:
//   1. Start the application with PM2:
//      pm2 start ecosystem.config.js
//
//   2. Generate the PM2 startup script for your system:
//      pm2 startup
//      (Follow the instructions printed by the command — it will output a
//       sudo command you need to copy and run.)
//
//   3. Save the current PM2 process list so it restores after reboot:
//      pm2 save
//
//   After these steps, PM2 will automatically start the microservice
//   whenever the EC2 instance reboots.

module.exports = {
  apps: [
    {
      name: 'whatsapp-microservice',
      script: 'dist/main.js',
      autorestart: true,
      max_restarts: 10,
      env: {
        PORT: 3001,
        REDIS_URL: 'redis://127.0.0.1:6379',
        API_KEY: 'your-api-key-here',
      },
    },
  ],
};
