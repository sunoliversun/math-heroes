// Thin WebSocket wrapper. Emits typed events to listeners registered via on().

export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.queue = [];
    this.connected = false;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
    return this;
  }

  emit(type, payload) {
    const list = this.handlers.get(type);
    if (list) list.forEach(fn => fn(payload));
  }

  connect() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      this.ws = new WebSocket(`${proto}://${location.host}`);
      this.ws.onopen = () => {
        this.connected = true;
        this.queue.forEach(m => this.ws.send(m));
        this.queue = [];
        resolve();
      };
      this.ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        this.emit(msg.type, msg);
      };
      this.ws.onclose = () => { this.connected = false; this.emit('disconnect', {}); };
      this.ws.onerror = (e) => { reject(e); this.emit('neterror', e); };
    });
  }

  send(type, payload = {}) {
    const data = JSON.stringify({ type, ...payload });
    if (this.connected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else {
      this.queue.push(data);
    }
  }
}
