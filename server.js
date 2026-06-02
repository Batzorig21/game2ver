const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();

const suits = ["♠", "♥", "♦", "♣"];
const ranks = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"];

const SMALL_BLIND = 10;
const BIG_BLIND = 20;
const STARTING_STACK = 1000;
const MAX_PLAYERS = 6;

io.on("connection", (socket) => {
  socket.on("joinRoom", ({ roomCode, playerName }) => {
    const cleanRoomCode = String(roomCode || "").trim().toUpperCase();
    const cleanName = String(playerName || "").trim().slice(0, 16);

    if (!cleanRoomCode || !cleanName) {
      socket.emit("errorMessage", "Өрөөний код болон нэрээ оруулна уу.");
      return;
    }

    let room = rooms.get(cleanRoomCode);

    if (!room) {
      room = createRoom(cleanRoomCode);
      rooms.set(cleanRoomCode, room);
    }

    if (room.players.length >= MAX_PLAYERS) {
      socket.emit("errorMessage", "Энэ өрөө дүүрсэн байна.");
      return;
    }

    const nameExists = room.players.some((player) => player.name === cleanName);

    if (nameExists) {
      socket.emit("errorMessage", "Энэ нэр аль хэдийн ашиглагдаж байна.");
      return;
    }

    const player = {
      id: socket.id,
      name: cleanName,
      stack: STARTING_STACK,
      bet: 0,
      folded: false,
      allIn: false,
      cards: [],
      connected: true
    };

    room.players.push(player);
    socket.join(cleanRoomCode);

    socket.data.roomCode = cleanRoomCode;
    socket.data.playerId = socket.id;

    addLog(room, `${cleanName} өрөөнд орлоо.`);
    emitRoomState(room);
  });

  socket.on("startHand", () => {
    const room = getSocketRoom(socket);
    if (!room) return;

    if (room.players.length < 2) {
      socket.emit("errorMessage", "Хамгийн багадаа 2 тоглогч хэрэгтэй.");
      return;
    }

    if (room.handStarted) {
      socket.emit("errorMessage", "Гар аль хэдийн эхэлсэн байна.");
      return;
    }

    startNewHand(room);
    emitRoomState(room);
  });

  socket.on("playerAction", ({ type, raiseTo }) => {
    const room = getSocketRoom(socket);
    if (!room) return;

    const player = room.players[room.currentPlayerIndex];

    if (!room.handStarted || !player || player.id !== socket.id) {
      socket.emit("errorMessage", "Одоо таны ээлж биш байна.");
      return;
    }

    if (player.folded || player.allIn) {
      socket.emit("errorMessage", "Та одоо action хийх боломжгүй.");
      return;
    }

    if (type === "check") {
      handleCheck(room, player);
    }

    if (type === "call") {
      handleCall(room, player);
    }

    if (type === "raise") {
      handleRaise(room, player, Number(raiseTo));
    }

    if (type === "fold") {
      handleFold(room, player);
    }

    if (type === "allin") {
      handleAllIn(room, player);
    }

    emitRoomState(room);
  });

  socket.on("disconnect", () => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return;

    const room = rooms.get(roomCode);
    if (!room) return;

    const player = room.players.find((item) => item.id === socket.id);

    if (player) {
      player.connected = false;
      addLog(room, `${player.name} холболтоос гарлаа.`);

      if (!room.handStarted) {
        room.players = room.players.filter((item) => item.id !== socket.id);
      } else {
        player.folded = true;
      }
    }

    if (room.players.length === 0) {
      rooms.delete(roomCode);
      return;
    }

    if (room.handStarted) {
      const activePlayers = getPlayersInHand(room);

      if (activePlayers.length === 1) {
        finishHand(room, activePlayers[0]);
      } else if (room.players[room.currentPlayerIndex]?.id === socket.id) {
        goToNextTurn(room);
      }
    }

    emitRoomState(room);
  });
});

server.listen(PORT, () => {
  console.log(`Poker server running on http://localhost:${PORT}`);
});

function createRoom(code) {
  return {
    code,
    players: [],
    deck: [],
    communityCards: [],
    pot: 0,
    dealerIndex: 0,
    currentPlayerIndex: 0,
    currentBet: 0,
    stage: "waiting",
    handStarted: false,
    logs: []
  };
}

function getSocketRoom(socket) {
  const roomCode = socket.data.roomCode;
  if (!roomCode) return null;

  return rooms.get(roomCode) || null;
}

function startNewHand(room) {
  room.deck = createDeck();
  shuffle(room.deck);
  room.communityCards = [];
  room.pot = 0;
  room.currentBet = 0;
  room.stage = "preflop";
  room.handStarted = true;

  room.players = room.players.filter((player) => player.connected && player.stack > 0);

  if (room.dealerIndex >= room.players.length) {
    room.dealerIndex = 0;
  }

  room.players.forEach((player) => {
    player.bet = 0;
    player.folded = false;
    player.allIn = false;
    player.cards = [room.deck.pop(), room.deck.pop()];
  });

  const smallBlindIndex = nextIndex(room, room.dealerIndex);
  const bigBlindIndex = nextIndex(room, smallBlindIndex);

  postBlind(room, smallBlindIndex, SMALL_BLIND);
  postBlind(room, bigBlindIndex, BIG_BLIND);

  room.currentBet = BIG_BLIND;
  room.currentPlayerIndex = nextActiveIndex(room, bigBlindIndex);

  addLog(room, "Шинэ гар эхэллээ.");
  addLog(room, `${room.players[smallBlindIndex].name} small blind ${SMALL_BLIND}`);
  addLog(room, `${room.players[bigBlindIndex].name} big blind ${BIG_BLIND}`);
}

function createDeck() {
  const deck = [];

  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({
        rank,
        suit,
        color: suit === "♥" || suit === "♦" ? "red" : "black"
      });
    }
  }

  return deck;
}

function shuffle(deck) {
  for (let index = deck.length - 1; index > 0; index--) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [deck[index], deck[randomIndex]] = [deck[randomIndex], deck[index]];
  }
}

function postBlind(room, playerIndex, amount) {
  const player = room.players[playerIndex];
  const blind = Math.min(player.stack, amount);

  player.stack -= blind;
  player.bet += blind;
  room.pot += blind;

  if (player.stack === 0) {
    player.allIn = true;
  }
}

function handleCheck(room, player) {
  if (player.bet < room.currentBet) {
    addLog(room, `${player.name} check хийх боломжгүй.`);
    return;
  }

  addLog(room, `${player.name} check.`);
  goToNextTurn(room);
}

function handleCall(room, player) {
  const needToCall = room.currentBet - player.bet;

  if (needToCall <= 0) {
    handleCheck(room, player);
    return;
  }

  const callAmount = Math.min(player.stack, needToCall);

  player.stack -= callAmount;
  player.bet += callAmount;
  room.pot += callAmount;

  if (player.stack === 0) {
    player.allIn = true;
    addLog(room, `${player.name} call ${callAmount} ба all in боллоо.`);
  } else {
    addLog(room, `${player.name} call ${callAmount}.`);
  }

  goToNextTurn(room);
}

function handleRaise(room, player, raiseTo) {
  if (!Number.isFinite(raiseTo) || raiseTo <= room.currentBet) {
    addLog(room, `${player.name} raise буруу дүн орууллаа.`);
    return;
  }

  const needTotal = raiseTo - player.bet;

  if (needTotal <= 0) {
    addLog(room, `${player.name} raise буруу байна.`);
    return;
  }

  if (needTotal >= player.stack) {
    handleAllIn(room, player);
    return;
  }

  player.stack -= needTotal;
  player.bet += needTotal;
  room.pot += needTotal;
  room.currentBet = player.bet;

  addLog(room, `${player.name} raise to ${room.currentBet}.`);
  goToNextTurn(room);
}

function handleFold(room, player) {
  player.folded = true;

  addLog(room, `${player.name} fold.`);

  const activePlayers = getPlayersInHand(room);

  if (activePlayers.length === 1) {
    finishHand(room, activePlayers[0]);
    return;
  }

  goToNextTurn(room);
}

function handleAllIn(room, player) {
  const amount = player.stack;

  if (amount <= 0) return;

  player.stack = 0;
  player.bet += amount;
  room.pot += amount;
  player.allIn = true;

  if (player.bet > room.currentBet) {
    room.currentBet = player.bet;
  }

  addLog(room, `${player.name} all in ${amount}.`);
  goToNextTurn(room);
}

function goToNextTurn(room) {
  if (!room.handStarted) return;

  const activePlayers = getPlayersInHand(room);

  if (activePlayers.length === 1) {
    finishHand(room, activePlayers[0]);
    return;
  }

  if (isBettingRoundComplete(room)) {
    nextStage(room);
    return;
  }

  room.currentPlayerIndex = nextActiveIndex(room, room.currentPlayerIndex);
}

function isBettingRoundComplete(room) {
  const activePlayers = getPlayersInHand(room);

  return activePlayers.every((player) => {
    return player.allIn || player.bet === room.currentBet;
  });
}

function nextStage(room) {
  resetBets(room);

  if (allRemainingPlayersAllIn(room)) {
    while (room.communityCards.length < 5) {
      room.communityCards.push(room.deck.pop());
    }

    showdown(room);
    return;
  }

  if (room.stage === "preflop") {
    room.stage = "flop";
    room.communityCards.push(room.deck.pop(), room.deck.pop(), room.deck.pop());
    addLog(room, "Flop гарлаа.");
  } else if (room.stage === "flop") {
    room.stage = "turn";
    room.communityCards.push(room.deck.pop());
    addLog(room, "Turn гарлаа.");
  } else if (room.stage === "turn") {
    room.stage = "river";
    room.communityCards.push(room.deck.pop());
    addLog(room, "River гарлаа.");
  } else {
    showdown(room);
    return;
  }

  room.currentPlayerIndex = firstActiveAfterDealer(room);
}

function resetBets(room) {
  room.players.forEach((player) => {
    player.bet = 0;
  });

  room.currentBet = 0;
}

function allRemainingPlayersAllIn(room) {
  return getPlayersInHand(room).every((player) => player.allIn);
}

function showdown(room) {
  const candidates = getPlayersInHand(room);
  const winner = candidates[Math.floor(Math.random() * candidates.length)];

  finishHand(room, winner);
}

function finishHand(room, winner) {
  winner.stack += room.pot;

  addLog(room, `${winner.name} pot ${room.pot} хожлоо.`);
  addLog(room, "Гар дууслаа.");

  room.pot = 0;
  room.handStarted = false;
  room.stage = "waiting";
  room.currentBet = 0;

  room.players.forEach((player) => {
    player.bet = 0;
    player.folded = false;
    player.allIn = false;
  });

  room.dealerIndex = nextIndex(room, room.dealerIndex);
}

function getPlayersInHand(room) {
  return room.players.filter((player) => !player.folded && player.connected);
}

function nextIndex(room, index) {
  if (room.players.length === 0) return 0;
  return (index + 1) % room.players.length;
}

function nextActiveIndex(room, fromIndex) {
  let index = nextIndex(room, fromIndex);

  for (let count = 0; count < room.players.length; count++) {
    const player = room.players[index];

    if (player && !player.folded && !player.allIn && player.connected && player.stack > 0) {
      return index;
    }

    index = nextIndex(room, index);
  }

  return fromIndex;
}

function firstActiveAfterDealer(room) {
  let index = nextIndex(room, room.dealerIndex);

  for (let count = 0; count < room.players.length; count++) {
    const player = room.players[index];

    if (player && !player.folded && !player.allIn && player.connected && player.stack > 0) {
      return index;
    }

    index = nextIndex(room, index);
  }

  return room.dealerIndex;
}

function addLog(room, message) {
  room.logs.unshift(message);

  if (room.logs.length > 80) {
    room.logs.pop();
  }
}

function emitRoomState(room) {
  for (const player of room.players) {
    const privateState = buildPrivateState(room, player.id);
    io.to(player.id).emit("roomState", privateState);
  }
}

function buildPrivateState(room, viewerId) {
  return {
    code: room.code,
    pot: room.pot,
    dealerIndex: room.dealerIndex,
    currentPlayerIndex: room.currentPlayerIndex,
    currentBet: room.currentBet,
    stage: room.stage,
    handStarted: room.handStarted,
    communityCards: room.communityCards,
    logs: room.logs,
    viewerId,
    players: room.players.map((player) => {
      const isViewer = player.id === viewerId;

      return {
        id: player.id,
        name: player.name,
        stack: player.stack,
        bet: player.bet,
        folded: player.folded,
        allIn: player.allIn,
        connected: player.connected,
        cards: isViewer ? player.cards : hideCards(player)
      };
    })
  };
}

function hideCards(player) {
  if (!player.cards || player.cards.length === 0) return [];

  return player.cards.map(() => ({
    hidden: true
  }));
}
