const { app, BrowserWindow, dialog, Notification, screen, shell } = require('electron');
const { mkdir } = require('node:fs/promises');
const path = require('node:path');
const { appId, portableExecutable } = require('./startup.cjs');

const toastClsid = '{FDD365C6-1AC9-4DA9-8512-5E06D6789004}';
const escape = (text) => text.replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]);

function createReminderNotifications(getWindow, openSchedule, icon) {
  const active = new Set();
  const corners = new Set();
  let prompts = Promise.resolve();
  let registered;

  async function registerToast() {
    const target = portableExecutable();
    if (!target) return true;
    const folder = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    const shortcut = path.join(folder, 'Jinkra 工具箱.lnk');
    await mkdir(folder, { recursive: true });
    let existing;
    try { existing = shell.readShortcutLink(shortcut); } catch {}
    if (existing?.target === target && existing.appUserModelId === appId && existing.toastActivatorClsid === toastClsid) return true;
    return shell.writeShortcutLink(shortcut, {
      target, cwd: path.dirname(target), appUserModelId: appId, toastActivatorClsid: toastClsid,
      description: '打开 Jinkra 工具箱',
    });
  }

  function corner(item, body) {
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const width = 392;
    const height = 186;
    const offset = Math.min(corners.size, 3) * 28;
    const notice = new BrowserWindow({
      title: 'Jinkra · 日程提醒', width, height, minWidth: 260, show: false,
      x: workArea.x + workArea.width - width - 12 - offset, y: workArea.y + workArea.height - height - 12 - offset,
      autoHideMenuBar: true, icon, skipTaskbar: true, resizable: false, alwaysOnTop: true,
      backgroundColor: '#f4f7fc', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false },
    });
    corners.add(notice);
    notice.once('closed', () => corners.delete(notice));
    const contents = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>
      body{margin:20px;font:14px 'Microsoft YaHei UI',sans-serif;background:#f4f7fc;color:#172c4c;overflow-wrap:anywhere}h1{font-size:17px;margin:0 0 8px}p{margin:0;white-space:pre-wrap;line-height:1.5}</style>
      <h1>${escape(item.title)}</h1><p>${escape(body)}</p></html>`;
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
          type: 'info', title: '日程提醒', message: item.title, detail: body, buttons: ['我知道了'], noLink: true,
        });
      }).catch(() => {});
      return;
    }
    try {
      if (!Notification.isSupported()) { corner(item, body); return; }
      registered ??= registerToast().catch(() => false);
      if (!await registered) { registered = undefined; corner(item, body); return; }
      const persistent = item.level === 'persistent';
      const notice = new Notification({
        title: item.title, body, icon, timeoutType: persistent ? 'never' : 'default',
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

module.exports = { toastClsid, createReminderNotifications };
