const path = require("node:path");
const fs = require("node:fs");

const root = __dirname;
const potServerScript = path.join(
  root,
  "vendor/bgutil-ytdlp-pot-provider/server/build/main.js"
);

const apps = [];

if (fs.existsSync(potServerScript)) {
  apps.push({
    name: "bgutil-pot-server",
    script: potServerScript,
    cwd: root,
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    watch: false,
    max_memory_restart: "256M",
    env: {
      NODE_ENV: "production",
    },
    error_file: path.join(root, "logs/pm2-pot-error.log"),
    out_file: path.join(root, "logs/pm2-pot-out.log"),
    merge_logs: true,
    log_date_format: "YYYY-MM-DD HH:mm:ss Z",
  });
}

apps.push({
  name: "media-downloader-bot",
  script: path.join(root, "dist/bot.js"),
  cwd: root,
  instances: 1,
  exec_mode: "fork",
  autorestart: true,
  watch: false,
  max_memory_restart: "512M",
  kill_timeout: 10000,
  env: {
    NODE_ENV: "production",
  },
  error_file: path.join(root, "logs/pm2-error.log"),
  out_file: path.join(root, "logs/pm2-out.log"),
  merge_logs: true,
  log_date_format: "YYYY-MM-DD HH:mm:ss Z",
});

module.exports = { apps };
