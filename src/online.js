// Online rooms, peer to peer. One player hosts a room named by a four-letter
// code; up to three more join it from their own devices. There is no game
// server: the browsers talk to each other directly over WebRTC (PeerJS, whose
// public broker only introduces them), and the host passes messages on, so
// every guest needs just one connection.
//
// The game is turn based, so nothing is simulated in two places at once.
// Whoever's turn it is plays it on their own device; when it ends they send
// the whole game as a snapshot ({ t: 'state' }), and every other device
// restores it. Messages:
//   guest -> host   { t: 'hello', name }
//   host  -> guest  { t: 'lobby', names, map }       who is in the room
//   host  -> guest  { t: 'start', config, seat }     the game begins; your seat
//   any   -> all    { t: 'state', data }             the game after a turn
//   host  -> guest  { t: 'left', seat }              a player dropped out
//   host  -> guest  { t: 'full' }                    no room, or already started
//
// hostLogic and guestLogic know nothing of PeerJS: they take connections with
// send(message) and on(event, handler), so they are tested with fake ones.

const PREFIX = 'vantage-room-';
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O, which read as 1 and 0
export const MAX_GUESTS = 3;

export const roomCode = (random = Math.random) =>
  Array.from({ length: 4 }, () => LETTERS[Math.floor(random() * LETTERS.length)]).join('');

// The host's side of a room. on: { lobby(names), start(config, seat),
// state(data), left(seat) }.
export function hostLogic({ name, map, on }) {
  const guests = []; // { conn, name, gone }, in seat order (the host is seat 0)
  let started = false;
  const names = () => [name, ...guests.map((guest) => guest.name)];
  const toAll = (message, except = null) => {
    for (const guest of guests) if (!guest.gone && guest.conn !== except) guest.conn.send(message);
  };

  return {
    names,
    accept(conn) {
      conn.on('data', (message) => {
        if (message.t === 'hello') {
          if (started || guests.length >= MAX_GUESTS) {
            conn.send({ t: 'full' });
            return;
          }
          // Two players with the same name would be told apart by a number.
          const wanted = String(message.name).slice(0, 16) || `Player ${guests.length + 2}`;
          let unique = wanted;
          for (let n = 2; names().includes(unique); n++) unique = `${wanted} ${n}`;
          guests.push({ conn, name: unique, gone: false });
          toAll({ t: 'lobby', names: names(), map });
          on.lobby(names());
        } else if (message.t === 'state') {
          toAll(message, conn);
          on.state(message.data);
        }
      });
      conn.on('close', () => {
        const seat = guests.findIndex((guest) => guest.conn === conn);
        if (seat < 0 || guests[seat].gone) return;
        if (started) {
          // Seats stay put once the game has begun; the others are told who left.
          guests[seat].gone = true;
          toAll({ t: 'left', seat: seat + 1 });
          on.left(seat + 1);
        } else {
          guests.splice(seat, 1);
          toAll({ t: 'lobby', names: names(), map });
          on.lobby(names());
        }
      });
    },
    start(config) {
      started = true;
      guests.forEach((guest, i) => guest.conn.send({ t: 'start', config, seat: i + 1 }));
      on.start(config, 0);
    },
    sendState(data) {
      toAll({ t: 'state', data });
    },
  };
}

// A guest's side. on: { lobby(names, map), start(config, seat), state(data),
// left(seat), error(text) }.
export function guestLogic({ name, conn, on }) {
  conn.on('open', () => conn.send({ t: 'hello', name }));
  conn.on('data', (message) => {
    if (message.t === 'lobby') on.lobby(message.names, message.map);
    else if (message.t === 'start') on.start(message.config, message.seat);
    else if (message.t === 'state') on.state(message.data);
    else if (message.t === 'left') on.left(message.seat);
    else if (message.t === 'full') on.error('That room is full, or its game has already started.');
  });
  conn.on('close', () => on.error('The host has left the room.'));
  return {
    sendState(data) {
      conn.send({ t: 'state', data });
    },
  };
}

const friendly = (error) =>
  ({
    'peer-unavailable': 'No room with that code. Check it and try again.',
    network: 'Could not reach the room service. Check your connection.',
    'server-error': 'The room service is not answering. Try again in a moment.',
    'browser-incompatible': 'This browser cannot make the connection online play needs.',
  })[error?.type] ?? 'The connection dropped. Try again.';

// Opens a room over PeerJS: hosts a new one, or joins the one with `code`.
// Resolves to { code, host, start(config), sendState(data), close() }.
export async function openRoom({ code = null, name, map, on }) {
  const { Peer } = await import('peerjs');
  const host = !code;

  if (host) {
    // A code already in use is refused by the broker, so try another.
    for (let attempt = 0; attempt < 5; attempt++) {
      const tryCode = roomCode();
      const peer = new Peer(PREFIX + tryCode);
      const opened = await new Promise((resolve) => {
        peer.on('open', () => resolve(true));
        peer.on('error', (error) => resolve(error.type === 'unavailable-id' ? false : error));
      });
      if (opened === false) {
        peer.destroy();
        continue;
      }
      if (opened !== true) {
        peer.destroy();
        throw new Error(friendly(opened));
      }
      const logic = hostLogic({ name, map, on });
      peer.on('connection', (conn) => logic.accept(conn));
      peer.on('error', (error) => on.error?.(friendly(error)));
      return { code: tryCode, host: true, start: logic.start, sendState: logic.sendState, close: () => peer.destroy() };
    }
    throw new Error('Could not open a room. Try again.');
  }

  const peer = new Peer();
  await new Promise((resolve, reject) => {
    peer.on('open', resolve);
    peer.on('error', (error) => reject(new Error(friendly(error))));
  });
  peer.on('error', (error) => on.error(friendly(error)));
  const conn = peer.connect(PREFIX + code.toUpperCase(), { reliable: true });
  const logic = guestLogic({ name, conn, on });
  return { code: code.toUpperCase(), host: false, sendState: logic.sendState, close: () => peer.destroy() };
}
