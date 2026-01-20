'use strict';
var purrcat = (() => {
  var p = Object.defineProperty;
  var H = Object.getOwnPropertyDescriptor;
  var A = Object.getOwnPropertyNames;
  var M = Object.prototype.hasOwnProperty;
  var N = (n, e) => {
      for (var t in e) p(n, t, { get: e[t], enumerable: !0 });
    },
    x = (n, e, t, s) => {
      if ((e && typeof e == 'object') || typeof e == 'function')
        for (let r of A(e))
          !M.call(n, r) &&
            r !== t &&
            p(n, r, { get: () => e[r], enumerable: !(s = H(e, r)) || s.enumerable });
      return n;
    };
  var B = n => x(p({}, '__esModule', { value: !0 }), n);
  var D = {};
  N(D, { createSocket: () => g, default: () => j });
  function o(n, e) {
    return { type: n, ts: Date.now(), meta: e };
  }
  function k(n, e, t, s) {
    let r;
    t === 'exponential' ? (r = e * Math.pow(2, n)) : (r = e * (n + 1));
    let c = r * 0.2 * (Math.random() * 2 - 1);
    return ((r = Math.min(r + c, s)), Math.max(0, Math.min(r, s)));
  }
  function y(n) {
    let e = n.reconnect,
      t = typeof e == 'boolean' ? { enabled: e } : (e ?? { enabled: !0 });
    return {
      reconnect: {
        enabled: t.enabled ?? !0,
        attempts: t.attempts ?? 1 / 0,
        interval: t.interval ?? 1e3,
        backoff: t.backoff ?? 'exponential',
        maxInterval: t.maxInterval ?? 3e4,
      },
      buffer: {
        receive: {
          size: n.buffer?.receive?.size ?? 100,
          overflow: n.buffer?.receive?.overflow ?? 'oldest',
        },
        send: { size: n.buffer?.send?.size ?? 100, overflow: n.buffer?.send?.overflow ?? 'oldest' },
      },
      url: n.url,
      protocols: n.protocols,
    };
  }
  function O() {
    return {
      ws: null,
      isManualClose: !1,
      reconnectCount: 0,
      reconnectTimer: null,
      messageBuffer: [],
      eventQueue: [],
      messageQueue: [],
      messageCallbacks: new Set(),
      eventCallbacks: new Set(),
      abortController: null,
      activeMessageIterators: 0,
      activeEventIterators: 0,
      messageResolvers: new Set(),
      eventResolvers: new Set(),
    };
  }
  function u(n) {
    try {
      return JSON.parse(n);
    } catch {
      return n;
    }
  }
  function R(n) {
    return typeof n == 'object' && !(n instanceof ArrayBuffer) && !(n instanceof Blob)
      ? JSON.stringify(n)
      : n;
  }
  function h(n, e, t, s, r) {
    return e.length < s
      ? { action: 'add' }
      : n === 'oldest'
        ? { action: 'drop_oldest', dropped: e.shift() }
        : n === 'newest'
          ? { action: 'drop_newest', dropped: t }
          : { action: 'error' };
  }
  function i(n, e, t, s, r) {
    return o('dropped', { reason: n, policy: e, droppedMessage: t, bufferSize: s, bufferType: r });
  }
  function b(n, e, t, s, r) {
    return new Promise(c => {
      let l = null,
        f = !1,
        _ = () => {
          f ||
            (n && n.removeEventListener('abort', I),
            r(a),
            l !== null && (clearTimeout(l), (l = null)));
        },
        a = () => {
          f || ((f = !0), _(), c());
        },
        I = () => a();
      if (n?.aborted) {
        a();
        return;
      }
      if ((n && n.addEventListener('abort', I), e())) {
        a();
        return;
      }
      if ((s(a), !n)) {
        let w = () => {
          if (!f) {
            if (e()) {
              a();
              return;
            }
            l = setTimeout(w, 100);
          }
        };
        w();
      }
    });
  }
  async function* C(n, e) {
    n.activeMessageIterators++;
    try {
      for (; !e?.aborted; ) {
        for (; n.messageBuffer.length > 0 && !e?.aborted; ) {
          let t = n.messageBuffer.shift();
          yield u(t);
        }
        await b(
          e,
          () => n.messageBuffer.length > 0,
          n.messageResolvers,
          t => n.messageResolvers.add(t),
          t => n.messageResolvers.delete(t)
        );
      }
    } finally {
      (n.activeMessageIterators--, n.activeMessageIterators === 0 && (n.messageBuffer = []));
    }
  }
  async function* T(n, e) {
    n.activeEventIterators++;
    try {
      for (; !e?.aborted; ) {
        for (; n.eventQueue.length > 0 && !e?.aborted; ) yield n.eventQueue.shift();
        await b(
          e,
          () => n.eventQueue.length > 0,
          n.eventResolvers,
          t => n.eventResolvers.add(t),
          t => n.eventResolvers.delete(t)
        );
      }
    } finally {
      (n.activeEventIterators--, n.activeEventIterators === 0 && (n.eventQueue = []));
    }
  }
  var d = class {
    constructor(e) {
      this.state = e;
    }
    emit(e) {
      if (
        (this.state.eventCallbacks.forEach(t => {
          try {
            t(e);
          } catch (s) {
            console.error('Error in event callback:', s);
          }
        }),
        this.state.activeEventIterators > 0)
      ) {
        this.state.eventQueue.push(e);
        let t = Array.from(this.state.eventResolvers);
        (this.state.eventResolvers.clear(), t.forEach(s => s()));
        return;
      }
      (this.state.eventQueue.push(e),
        this.state.eventQueue.length > 10 && this.state.eventQueue.shift());
    }
  };
  var v = class {
    constructor(e, t, s) {
      this.state = e;
      this.opts = t;
      this.eventHandler = s;
    }
    receive(e) {
      let t = u(e);
      (this.eventHandler.emit(o('received', { message: t })),
        this.handleCallbacks(t),
        this.bufferReceivedMessage(e));
    }
    async receiveMessages(e, t) {
      let s = t?.signal;
      try {
        for await (let r of e) {
          if (s?.aborted) break;
          this.receive(r);
        }
      } catch (r) {
        if (s?.aborted) return;
        throw r;
      }
    }
    send(e) {
      let t = R(e);
      if (this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
        this.handleSendImmediately(t, e);
        return;
      }
      let s = typeof t == 'string' ? t : String(t);
      this.queueSendMessage(s);
    }
    async sendMessages(e, t) {
      let s = t?.signal;
      try {
        for await (let r of e) {
          if (s?.aborted) break;
          this.send(r);
        }
      } catch (r) {
        if (s?.aborted) return;
        throw r;
      }
    }
    flushQueue() {
      if (!(!this.state.ws || this.state.ws.readyState !== WebSocket.OPEN))
        for (; this.state.messageQueue.length > 0; ) {
          let e = this.state.messageQueue.shift();
          e && (this.state.ws.send(e), this.eventHandler.emit(o('sent', { message: e })));
        }
    }
    handleCallbacks(e) {
      this.state.messageCallbacks.forEach(t => {
        try {
          t(e);
        } catch (s) {
          console.error('Error in message callback:', s);
        }
      });
    }
    bufferReceivedMessage(e) {
      if (this.state.activeMessageIterators === 0) return;
      let t = h(
        this.opts.buffer.receive.overflow,
        this.state.messageBuffer,
        e,
        this.opts.buffer.receive.size,
        'receive'
      );
      if (t.action === 'error')
        throw (
          this.eventHandler.emit(
            i(
              'buffer_overflow',
              this.opts.buffer.receive.overflow,
              void 0,
              this.opts.buffer.receive.size,
              'receive'
            )
          ),
          new Error('Message buffer overflow')
        );
      if (t.action === 'drop_newest') {
        this.eventHandler.emit(
          i(
            'buffer_full',
            this.opts.buffer.receive.overflow,
            t.dropped,
            this.opts.buffer.receive.size,
            'receive'
          )
        );
        return;
      }
      if (t.action === 'drop_oldest') {
        (this.eventHandler.emit(
          i(
            'buffer_full',
            this.opts.buffer.receive.overflow,
            t.dropped,
            this.opts.buffer.receive.size,
            'receive'
          )
        ),
          this.state.messageBuffer.push(e));
        let s = Array.from(this.state.messageResolvers);
        (this.state.messageResolvers.clear(), s.forEach(r => r()));
        return;
      }
      if (t.action === 'add') {
        this.state.messageBuffer.push(e);
        let s = Array.from(this.state.messageResolvers);
        (this.state.messageResolvers.clear(), s.forEach(r => r()));
      }
    }
    handleSendImmediately(e, t) {
      !this.state.ws ||
        this.state.ws.readyState !== WebSocket.OPEN ||
        (this.state.ws.send(e), this.eventHandler.emit(o('sent', { message: t })));
    }
    queueSendMessage(e) {
      let t = h(
        this.opts.buffer.send.overflow,
        this.state.messageQueue,
        e,
        this.opts.buffer.send.size,
        'send'
      );
      if (t.action === 'error')
        throw (
          this.eventHandler.emit(
            i(
              'send_queue_overflow',
              this.opts.buffer.send.overflow,
              void 0,
              this.opts.buffer.send.size,
              'send'
            )
          ),
          new Error('Send queue overflow')
        );
      if (t.action === 'drop_newest') {
        this.eventHandler.emit(
          i(
            'send_queue_full',
            this.opts.buffer.send.overflow,
            t.dropped,
            this.opts.buffer.send.size,
            'send'
          )
        );
        return;
      }
      if (t.action === 'drop_oldest') {
        (this.eventHandler.emit(
          i(
            'send_queue_full',
            this.opts.buffer.send.overflow,
            t.dropped,
            this.opts.buffer.send.size,
            'send'
          )
        ),
          this.state.messageQueue.push(e));
        return;
      }
      t.action === 'add' && this.state.messageQueue.push(e);
    }
  };
  var m = class {
    constructor(e, t, s, r) {
      this.state = e;
      this.opts = t;
      this.eventHandler = s;
      this.messageHandler = r;
    }
    scheduleReconnect() {
      if (
        (this.state.reconnectTimer && clearTimeout(this.state.reconnectTimer),
        this.state.reconnectCount >= this.opts.reconnect.attempts)
      )
        return;
      let e = k(
        this.state.reconnectCount,
        this.opts.reconnect.interval,
        this.opts.reconnect.backoff,
        this.opts.reconnect.maxInterval
      );
      (this.eventHandler.emit(
        o('reconnect', { attempt: this.state.reconnectCount + 1, interval: e })
      ),
        (this.state.reconnectTimer = setTimeout(() => {
          (this.state.reconnectCount++,
            this.eventHandler.emit(o('reconnect', { attempt: this.state.reconnectCount })),
            this.connect());
        }, e)));
    }
    connect() {
      if (!this.state.abortController?.signal.aborted)
        try {
          ((this.state.ws = this.opts.protocols
            ? new WebSocket(this.opts.url, this.opts.protocols)
            : new WebSocket(this.opts.url)),
            (this.state.ws.onopen = () => {
              ((this.state.reconnectCount = 0),
                this.eventHandler.emit(o('open')),
                this.messageHandler.flushQueue());
            }),
            (this.state.ws.onmessage = e => {
              let t = typeof e.data == 'string' ? e.data : String(e.data);
              this.messageHandler.receive(t);
            }),
            (this.state.ws.onerror = e => {
              this.eventHandler.emit(o('error', { error: e }));
            }),
            (this.state.ws.onclose = e => {
              (this.eventHandler.emit(
                o('close', { code: e.code, reason: e.reason, wasClean: e.wasClean })
              ),
                !this.state.isManualClose &&
                  this.opts.reconnect.enabled &&
                  this.state.reconnectCount < this.opts.reconnect.attempts &&
                  this.scheduleReconnect());
            }));
        } catch (e) {
          (this.eventHandler.emit(o('error', { error: e })),
            this.opts.reconnect.enabled &&
              !this.state.isManualClose &&
              this.state.reconnectCount < this.opts.reconnect.attempts &&
              (this.state.reconnectCount++, this.scheduleReconnect()));
        }
    }
    close(e, t) {
      ((this.state.isManualClose = !0),
        this.state.reconnectTimer &&
          (clearTimeout(this.state.reconnectTimer), (this.state.reconnectTimer = null)),
        this.state.ws && (this.state.ws.close(e, t), (this.state.ws = null)),
        this.state.abortController &&
          (this.state.abortController.abort(), (this.state.abortController = null)),
        (this.state.messageQueue = []));
    }
  };
  function g(n) {
    let e = y(n),
      t = O(),
      s = new S(t, e);
    return (s.connect(), s);
  }
  var S = class {
    constructor(e, t) {
      this.state = e;
      this.opts = t;
      ((this.eventHandler = new d(this.state)),
        (this.messageHandler = new v(this.state, this.opts, this.eventHandler)),
        (this.connectionHandler = new m(
          this.state,
          this.opts,
          this.eventHandler,
          this.messageHandler
        )));
    }
    messages(e) {
      let t = e?.signal;
      return C(this.state, t);
    }
    events(e) {
      let t = e?.signal;
      return T(this.state, t);
    }
    onMessage(e) {
      return (
        this.state.messageCallbacks.add(e),
        () => {
          this.state.messageCallbacks.delete(e);
        }
      );
    }
    onEvent(e) {
      return (
        this.state.eventCallbacks.add(e),
        () => {
          this.state.eventCallbacks.delete(e);
        }
      );
    }
    connect() {
      this.connectionHandler.connect();
    }
    close(e, t) {
      this.connectionHandler.close(e, t);
    }
    send(e) {
      this.messageHandler.send(e);
    }
    async sendMessages(e, t) {
      return this.messageHandler.sendMessages(e, t);
    }
  };
  var j = g;
  return B(D);
})();
