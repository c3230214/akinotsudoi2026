import { EventEmitter } from 'node:events';

/** In-process pub/sub. Published only after the DB commit succeeded. */
export function createBus() {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(500);
  return {
    publish(topic, payload) { emitter.emit(topic, payload); },
    subscribe(topic, fn) {
      emitter.on(topic, fn);
      return () => emitter.off(topic, fn);
    },
  };
}
