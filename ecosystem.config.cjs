const path = require("node:path");

module.exports = {
  apps: [
    {
      name: "media-downloader-bot",
      script: path.join(__dirname, "dist/bot.js"),
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      kill_timeout: 10000,
      env: {
        NODE_ENV: "production",
      },
      error_file: path.join(__dirname, "logs/pm2-error.log"),
      out_file: path.join(__dirname, "logs/pm2-out.log"),
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
