const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// 폴더 구분 없이 메인 경로의 index.html을 그대로 보여줌
app.use(express.static(__dirname));

const rooms = {}; 

io.on('connection', (socket) => {
    // 1. 방 만들기
    socket.on('createRoom', (data) => {
        const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
        rooms[roomId] = {
            id: roomId,
            hostId: socket.id,
            players: [{ id: socket.id, name: data.name, profit: 0, bet: 0, isFolded: false }],
            status: 'waiting',
            pot: 0, highestBet: 0, deadMoney: 0, turnIndex: 0, firstBettor: 0, isFirstAction: true, logs: []
        };
        socket.join(roomId);
        socket.roomId = roomId;
        addLog(roomId, `방 생성됨 (초대코드: ${roomId})`);
        io.to(roomId).emit('updateState', rooms[roomId]);
        socket.emit('joined', { roomId, myId: socket.id });
    });

    // 2. 방 참가하기
    socket.on('joinRoom', (data) => {
        const room = rooms[data.roomId];
        if (!room) return socket.emit('errorMsg', '방이 존재하지 않습니다.');
        if (room.status !== 'waiting') return socket.emit('errorMsg', '이미 게임이 진행중입니다.');
        if (room.players.length >= 6) return socket.emit('errorMsg', '인원이 가득 찼습니다.');

        room.players.push({ id: socket.id, name: data.name, profit: 0, bet: 0, isFolded: false });
        socket.join(data.roomId);
        socket.roomId = data.roomId;
        addLog(data.roomId, `${data.name} 님이 입장했습니다.`);
        io.to(data.roomId).emit('updateState', room);
        socket.emit('joined', { roomId: data.roomId, myId: socket.id });
    });

    // 3. 게임 시작
    socket.on('startGame', () => {
        const room = rooms[socket.roomId];
        if (!room || room.hostId !== socket.id) return;
        
        room.status = 'playing';
        room.pot = room.deadMoney;
        room.deadMoney = 0;
        room.highestBet = 0;
        room.turnIndex = room.firstBettor;
        room.isFirstAction = true;
        room.players.forEach(p => { p.bet = 0; p.isFolded = false; });
        
        addLog(room.id, `=== 게임 시작 ===`);
        io.to(room.id).emit('updateState', room);
    });

    // 4. 베팅 액션 (콜, 체크, 다이, 레이즈)
    socket.on('action', (actionData) => {
        const room = rooms[socket.roomId];
        if (!room || room.status !== 'playing') return;
        
        const pIndex = room.turnIndex;
        const p = room.players[pIndex];
        
        if (p.id !== socket.id) return;

        if (actionData.type === 'check') {
            addLog(room.id, `${p.name}: 체크`);
        } else if (actionData.type === 'call') {
            const addAmount = room.highestBet - p.bet;
            p.bet = room.highestBet;
            room.pot += addAmount;
            addLog(room.id, `${p.name}: 콜`);
        } else if (actionData.type === 'die') {
            p.isFolded = true;
            p.profit -= 100;
            room.deadMoney += 100;
            addLog(room.id, `${p.name}: 다이`);
        } else if (actionData.type === 'raise') {
            const amount = actionData.amount;
            const addAmount = amount - p.bet;
            p.bet = amount;
            room.pot += addAmount;
            room.highestBet = amount;
            room.isFirstAction = false;
            addLog(room.id, `${p.name}: ${amount}원으로 베팅/레이즈`);
        }

        const active = room.players.filter(x => !x.isFolded);
        const allMatched = active.every(x => x.bet === room.highestBet);
        
        if (active.length <= 1 || (!room.isFirstAction && allMatched)) {
            room.status = 'settle';
        } else {
            do {
                room.turnIndex = (room.turnIndex + 1) % room.players.length;
            } while (room.players[room.turnIndex].isFolded);
        }

        io.to(room.id).emit('updateState', room);
    });

    // 5. 정산
    socket.on('settle', (data) => {
        const room = rooms[socket.roomId];
        if (!room || room.hostId !== socket.id) return;

        if (data.isDraw) {
            room.players.forEach(p => p.profit -= p.bet);
            room.deadMoney += room.pot;
            addLog(room.id, `무승부! 판돈 전액 이월`);
        } else {
            const winners = data.winners;
            const share = Math.floor(room.pot / winners.length);
            const remainder = room.pot % winners.length;
            
            room.players.forEach((p, idx) => {
                if (winners.includes(idx)) p.profit += (share - p.bet);
                else p.profit -= p.bet;
            });
            room.deadMoney += remainder;
            addLog(room.id, `정산 완료`);
        }

        room.firstBettor = (room.firstBettor + 1) % room.players.length;
        room.status = 'waiting';
        io.to(room.id).emit('updateState', room);
    });

    socket.on('disconnect', () => {});
});

function addLog(roomId, msg) {
    if (rooms[roomId]) {
        rooms[roomId].logs.push(msg);
        if (rooms[roomId].logs.length > 20) rooms[roomId].logs.shift();
    }
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});