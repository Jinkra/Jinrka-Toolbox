// Give the static loading page a frame before loading the tool interface.
requestAnimationFrame(() => requestAnimationFrame(() => {
  void import('./app.js').catch(() => {
    const message = document.querySelector('.initial-boot p');
    const progress = document.querySelector('.initial-boot .boot-progress');
    if (message) message.textContent = '启动失败，请关闭软件后重试。';
    if (progress) progress.hidden = true;
  });
}));
