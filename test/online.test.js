import assert from 'node:assert/strict';
import { test } from 'node:test';
import { guestLogic, hostLogic, roomCode } from '../src/online.js';
import { mulberry32 } from '../src/random.js';

// Two ends of a fake connection: what one sends, the other receives as data.
function wire() {
  const end = () => {
    const handlers = {};
    return {
      handlers,
      on: (event, handler) => (handlers[event] = handler),
      emit: (event, value) => handlers[event]?.(value),
    };
  };
  const a = end();
  const b = end();
  a.send = (message) => b.emit('data', JSON.parse(JSON.stringify(message)));
  b.send = (message) => a.emit('data', JSON.parse(JSON.stringify(message)));
  return [a, b];
}

// A room with a host and some guests, recording what each one is told.
function room(guestNames) {
  const log = (who) => {
    const seen = { lobby: [], start: [], state: [], left: [], error: [] };
    const on = Object.fromEntries(Object.keys(seen).map((key) => [key, (...args) => seen[key].push(args)]));
    return { who, seen, on };
  };
  const hostLog = log('host');
  const host = hostLogic({ name: 'Ada', map: 'plaza', on: hostLog.on });
  const guests = guestNames.map((name) => {
    const [hostEnd, guestEnd] = wire();
    const guestLog = log(name);
    host.accept(hostEnd);
    const logic = guestLogic({ name, conn: guestEnd, on: guestLog.on });
    guestEnd.emit('open');
    return { logic, log: guestLog, hostEnd, guestEnd };
  });
  return { host, hostLog, guests };
}

test('room codes are four letters with no I or O', () => {
  const random = mulberry32(4);
  for (let i = 0; i < 200; i++) assert.match(roomCode(random), /^[A-HJ-NP-Z]{4}$/);
});

test('guests joining are announced to everyone, with the map', () => {
  const { host, hostLog, guests } = room(['Bo', 'Cy']);
  assert.deepEqual(host.names(), ['Ada', 'Bo', 'Cy']);
  assert.deepEqual(hostLog.seen.lobby.at(-1), [['Ada', 'Bo', 'Cy']]);
  assert.deepEqual(guests[0].log.seen.lobby.at(-1), [['Ada', 'Bo', 'Cy'], 'plaza']);
  assert.deepEqual(guests[1].log.seen.lobby.at(-1), [['Ada', 'Bo', 'Cy'], 'plaza']);
});

test('starting gives every device the same game and its own seat', () => {
  const { host, hostLog, guests } = room(['Bo', 'Cy']);
  const config = { names: host.names(), missions: ['cross'] };
  host.start(config);
  assert.deepEqual(hostLog.seen.start, [[config, 0]]);
  assert.deepEqual(guests[0].log.seen.start, [[config, 1]]);
  assert.deepEqual(guests[1].log.seen.start, [[config, 2]]);
});

test('a turn played anywhere reaches every other device, once', () => {
  const { host, hostLog, guests } = room(['Bo', 'Cy']);
  host.start({});
  host.sendState({ turn: 1 });
  assert.deepEqual(guests[0].log.seen.state, [[{ turn: 1 }]]);
  assert.deepEqual(guests[1].log.seen.state, [[{ turn: 1 }]]);
  assert.deepEqual(hostLog.seen.state, []);

  guests[0].logic.sendState({ turn: 2 }); // Bo plays: the host passes it on to Cy
  assert.deepEqual(hostLog.seen.state, [[{ turn: 2 }]]);
  assert.deepEqual(guests[1].log.seen.state.at(-1), [{ turn: 2 }]);
  assert.equal(guests[0].log.seen.state.length, 1, 'Bo is not sent their own turn back');
});

test('a fifth player, or anyone after the start, is turned away', () => {
  const { host, guests } = room(['B', 'C', 'D', 'E']);
  assert.deepEqual(host.names(), ['Ada', 'B', 'C', 'D']);
  assert.equal(guests[3].log.seen.error.length, 1);

  const second = room(['Bo']);
  second.host.start({});
  const [hostEnd, guestEnd] = wire();
  const errors = [];
  second.host.accept(hostEnd);
  guestLogic({ name: 'Late', conn: guestEnd, on: { error: (text) => errors.push(text) } });
  guestEnd.emit('open');
  assert.equal(errors.length, 1);
});

test('a guest leaving the lobby frees their place; leaving mid-game keeps the seats and tells the rest', () => {
  const lobby = room(['Bo', 'Cy']);
  lobby.guests[0].hostEnd.emit('close');
  assert.deepEqual(lobby.host.names(), ['Ada', 'Cy']);
  assert.deepEqual(lobby.guests[1].log.seen.lobby.at(-1), [['Ada', 'Cy'], 'plaza']);

  const game = room(['Bo', 'Cy']);
  game.host.start({});
  game.guests[0].hostEnd.emit('close');
  assert.deepEqual(game.host.names(), ['Ada', 'Bo', 'Cy'], 'seats do not shift mid-game');
  assert.deepEqual(game.hostLog.seen.left, [[1]]);
  assert.deepEqual(game.guests[1].log.seen.left, [[1]]);
  game.host.sendState({ turn: 9 }); // nothing is sent to the player who left
  assert.equal(game.guests[0].log.seen.state.length, 0);
});

test('guests are told when the host goes', () => {
  const { guests } = room(['Bo']);
  guests[0].guestEnd.emit('close');
  assert.match(guests[0].log.seen.error[0][0], /host has left/);
});

test('two players with the same name are told apart', () => {
  const { host } = room(['Ada', 'Ada', 'Bo']);
  assert.deepEqual(host.names(), ['Ada', 'Ada 2', 'Ada 3', 'Bo']);
});
