const { BrowserWindow, dialog, nativeImage, Notification, screen, shell } = require('electron');
const { brandName: reminderTitle } = require('./windows-brand.cjs');

const escape = (text) => text.replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]);

function createReminderNotifications(getWindow, openSchedule, icon, registerBrand) {
  const active = new Set();
  const corners = new Set();
  let prompts = Promise.resolve();

  function corner(item, body) {
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const width = 392;
    const height = 186;
    const offset = Math.min(corners.size, 3) * 28;
    const notice = new BrowserWindow({
      title: reminderTitle, width, height, minWidth: 260, show: false,
      x: workArea.x + workArea.width - width - 12 - offset, y: workArea.y + workArea.height - height - 12 - offset,
      autoHideMenuBar: true, icon, skipTaskbar: true, resizable: false, alwaysOnTop: true,
      backgroundColor: '#f4f7fc', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false },
    });
    corners.add(notice);
    notice.once('closed', () => corners.delete(notice));
    const logo = nativeImage.createFromPath(icon).resize({ width: 48 }).toDataURL();
    const contents = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${reminderTitle}</title><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>
      body{display:flex;gap:12px;margin:20px;font:14px 'Microsoft YaHei UI',sans-serif;background:#f4f7fc;color:#172c4c;overflow-wrap:anywhere}h1{font-size:17px;margin:0 0 8px}p{margin:0;white-space:pre-wrap;line-height:1.5}</style>
      <img src="${logo}" width="48" height="48" alt=""><div><h1>${escape(item.title)}</h1><p>${escape(body)}</p></div></html>`;
    void notice.loadURL('data:text/html;base64,' + Buffer.from(contents).toString('base64')).then(() => {
      if (notice.isDestroyed()) return;
      notice.showInactive();
      if (item.level === 'normal') setTimeout(() => { if (!notice.isDestroyed()) notice.close(); }, 8500).unref();
    }).catch(() => { if (!notice.isDestroyed()) notice.destroy(); });
  }

  return async function notify(item) {
    const date = new Date(item.at).toLocaleString('zh-CN', { hour12: false });
    const body = [date, item.notes].filter(Boolean).join('\n');
    if (item.level === 'strong') {
      prompts = prompts.then(async () => {
        const window = getWindow();
        if (!window || window.isDestroyed()) return;
        openSchedule();
        shell.beep();
        await dialog.showMessageBox(window, {
          type: 'info', title: reminderTitle, message: item.title, detail: body, buttons: ['我知道了'], noLink: true,
        });
      }).catch(() => {});
      return;
    }
    try {
      if (!Notification.isSupported() || !await registerBrand()) { corner(item, body); return; }
      const persistent = item.level === 'persistent';
      const notice = new Notification({
        title: reminderTitle, body: [item.title, body].join('\n'), icon, timeoutType: persistent ? 'never' : 'default',
        urgency: persistent ? 'critical' : 'normal',
      });
      active.add(notice);
      notice.once('close', () => active.delete(notice));
      notice.once('failed', () => { active.delete(notice); corner(item, body); });
      notice.once('click', () => { active.delete(notice); notice.close(); openSchedule(); });
      notice.show();
      if (!persistent) setTimeout(() => active.delete(notice), 15_000).unref();
    } catch {
      corner(item, body);
    }
  };
}

module.exports = { createReminderNotifications };
