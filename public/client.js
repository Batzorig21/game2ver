const socket = io();

let state = null;

const joinScreen = document.getElementById("joinScreen");
const gameScreen = document.getElementById("gameScreen");

const playerNameInput = document.getElementById("playerName");
const roomCodeInput = document.getElementById("roomCode");
const joinBtn = document.getElementById("joinBtn");
const joinError = document.getElementById("joinError");

const roomCodeText = document.getElementById("roomCodeText");
const stageText = document.getElementById("stageText");
const startHandBtn = document.getElementById("startHandBtn");

const potAmountEl = document.getElementById("potAmount");
const communityCardsEl = document.getElementById("communityCards");
const tableMessageEl = document.getElementById("tableMessage");
const currentPlayerNameEl = document.getElementById("currentPlayerName");
const actionLogEl = document.getElementById("actionLog");
const dealerChipEl = document.getElementById("dealerChip");
const raiseAmountEl = document.getElementById("raiseAmount");

const checkBtn = document.getElementById("checkBtn");
const callBtn = document.getElementById("callBtn");
const raiseBtn = document.getElementById("raiseBtn");
const foldBtn = document.getElementById("foldBtn");
const allInBtn = document.getElementById("allInBtn");

joinBtn.addEventListener("click", joinRoom);
startHandBtn.addEventListener("click", () => socket.emit("startHand"));

checkBtn.addEventListener("click", () => sendAction("check"));
callBtn.addEventListener("click", () => sendAction("call"));
raiseBtn.addEventListener("click", () => {
  sendAction("raise", {
    raiseTo: Number(raiseAmountEl.value)
  });
});
foldBtn.addEventListener("click", () => sendAction("fold"));
allInBtn.addEventListener("click", () => sendAction("allin"));

roomCodeInput.addEventListener("input", () => {
  roomCodeInput.value = roomCodeInput.value.toUpperCase();
});

socket.on("roomState", (newState) => {
  state = newState;

  joinScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  joinError.textContent = "";

  render();
});

socket.on("errorMessage", (message) => {
  joinError.textContent = message;
  showTableMessage(message);
});

function joinRoom() {
  const playerName = playerNameInput.value.trim();
  const roomCode = roomCodeInput.value.trim().toUpperCase();

  if (!playerName || !roomCode) {
    joinError.textContent = "Нэр болон өрөөний кодоо оруулна уу.";
    return;
  }

  socket.emit("joinRoom", {
    playerName,
    roomCode
  });
}

function sendAction(type, payload = {}) {
  socket.emit("playerAction", {
    type,
    ...payload
  });
}

function render() {
  if (!state) return;

  renderTopInfo();
  renderSeats();
  renderCommunityCards();
  renderGameInfo();
  renderActionButtons();
  renderLogs();
  updateDealerChip();
}

function renderTopInfo() {
  roomCodeText.textContent = state.code;
  stageText.textContent = state.stage.toUpperCase();
  potAmountEl.textContent = state.pot;
}

function renderSeats() {
  for (let index = 0; index < 6; index++) {
    const seatEl = document.querySelector(`[data-seat="${index}"]`);
    const player = state.players[index];

    if (!player) {
      seatEl.innerHTML = `<div class="empty-seat">Empty</div>`;
      continue;
    }

    const isCurrent = state.handStarted && index === state.currentPlayerIndex;
    const isMe = player.id === state.viewerId;
    const statusText = getStatusText(player, isCurrent, isMe);
    const statusClass = getStatusClass(player, isCurrent, isMe);

    seatEl.innerHTML = `
      <div class="player ${isCurrent ? "current" : ""} ${player.folded ? "folded-player" : ""} ${!player.connected ? "disconnected" : ""}">
        <div class="avatar"></div>

        <div class="hole-cards">
          ${renderHoleCards(player)}
        </div>

        <div class="info">
          <div class="status ${statusClass}">${escapeHtml(statusText)}</div>
          <div class="name">${escapeHtml(player.name)}</div>
          <div class="stack">${player.stack}</div>
          <div class="player-bet">${player.bet > 0 ? "Bet: " + player.bet : ""}</div>
        </div>
      </div>
    `;
  }
}

function renderHoleCards(player) {
  if (!player.cards || player.cards.length === 0) {
    return `
      <div class="card back">?</div>
      <div class="card back">?</div>
    `;
  }

  return player.cards.map((card) => {
    if (card.hidden) {
      return `<div class="card back">?</div>`;
    }

    return renderCard(card);
  }).join("");
}

function renderCommunityCards() {
  communityCardsEl.innerHTML = state.communityCards.map((card) => renderCard(card)).join("");

  const hiddenCards = 5 - state.communityCards.length;

  for (let index = 0; index < hiddenCards; index++) {
    const cardBack = document.createElement("div");
    cardBack.className = "card back";
    cardBack.textContent = "?";
    communityCardsEl.appendChild(cardBack);
  }
}

function renderCard(card) {
  if (!card) return "";

  return `
    <div class="card ${card.color === "red" ? "red" : ""}">
      <span>${escapeHtml(card.rank)}</span>
      <span>${escapeHtml(card.suit)}</span>
    </div>
  `;
}

function renderGameInfo() {
  if (!state.handStarted) {
    currentPlayerNameEl.textContent = "-";
    tableMessageEl.textContent = "Шинэ гар эхлүүлэхэд бэлэн";
    return;
  }

  const currentPlayer = state.players[state.currentPlayerIndex];

  currentPlayerNameEl.textContent = currentPlayer ? currentPlayer.name : "-";

  if (currentPlayer?.id === state.viewerId) {
    tableMessageEl.textContent = "Таны ээлж";
  } else {
    tableMessageEl.textContent = `${currentPlayer?.name || "-"}-ийн ээлж`;
  }
}

function renderActionButtons() {
  const disabled = !state.handStarted || !isMyTurn();

  checkBtn.disabled = disabled;
  callBtn.disabled = disabled;
  raiseBtn.disabled = disabled;
  foldBtn.disabled = disabled;
 
