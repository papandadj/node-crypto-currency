const WebSocket = require('ws');
const { addBlockToChain, getBlockchain, getLatestBlock, handleReceivedTransaction, isValidBlockStructure,
  replaceChain } = require('./blockchain');
const { getTransactionPool } = require('./transactionPool');

//所有的webSocket对象
const sockets = [];

//发送消息的结构体
function MessageTypeConstructor() {
  this.QUERY_LATEST = 0;
  this.QUERY_ALL = 1;
  this.RESPONSE_BLOCKCHAIN = 2;
  this.QUERY_TRANSACTION_POOL = 3;
  this.RESPONSE_TRANSACTION_POOL = 4;
}

const messageType = new MessageTypeConstructor();

function Message(type, data) {
  this.type = type;
  this.data = data;
}


function initP2PServer(p2pPort) {
  const server = new WebSocket.Server({ port: p2pPort });
  server.on('connection', (ws) => {
    initConnection(ws);
  });
  console.log('listening websocket p2p port on: ' + p2pPort);
}

const getSockets = () => sockets;


function initConnection(ws) {
  sockets.push(ws);
  initMessageHandler(ws);
  initErrorHandler(ws);
  write(ws, queryChainLengthMsg());

  // query transactions pool only some time after chain query
  setTimeout(() => {
    broadcast(queryTransactionPoolMsg());
  }, 500);
}


function jsonToObject(data) {
  try {
    return JSON.parse(data);
  } catch (e) {
    console.log(e);
    return null;
  }
}

function initMessageHandler(ws) {
  ws.on('message', (data) => {
    const message = jsonToObject(data);
    if (message === null) {
      console.log('could not parse received JSON message: ' + data);
      return;
    }
    console.log('Received message' + JSON.stringify(message));
    switch (message.type) {
      case messageType.QUERY_LATEST:
        write(ws, responseLatestMsg());
        break;
      case messageType.QUERY_ALL:
        write(ws, responseChainMsg());
        break;
      case messageType.RESPONSE_BLOCKCHAIN:
        const receivedBlocks = jsonToObject(message.data);
        if (receivedBlocks === null) {
          console.log('invalid blocks received:');
          console.log(message.data);
          break;
        }
        handleBlockchainResponse(receivedBlocks);
        break;
      case messageType.QUERY_TRANSACTION_POOL:
        write(ws, responseTransactionPoolMsg());
        break;
      case messageType.RESPONSE_TRANSACTION_POOL:
        const receivedTransactions = jsonToObject(message.data);
        if (receivedTransactions === null) {
          console.log('invalid transaction received: %s', JSON.stringify(message.data));
          break;
        }
        receivedTransactions.forEach((transaction) => {
          try {
            handleReceivedTransaction(transaction);
            // if no error is thrown, transaction was indeed added to the pool
            // let's broadcast transaction pool
            broadCastTransactionPool();
          } catch (e) {
            console.log(e.message);
          }
        });
        break;
    }
  });
}

function write(ws, message) {
  ws.send(JSON.stringify(message));
}

function broadcast(message) {
  sockets.forEach((socket) => write(socket, message));
}


function queryChainLengthMsg() {
  return new Message(messageType.QUERY_LATEST, null);
}

function queryAllMsg() {
  return new Message(messageType.QUERY_ALL, null);
}

function responseChainMsg() {
  return new Message(messageType.RESPONSE_BLOCKCHAIN, JSON.stringify(getBlockchain()));
}

function responseLatestMsg() {
  return {
    'type': messageType.RESPONSE_BLOCKCHAIN,
    'data': JSON.stringify([getLatestBlock()])
  };
}

function queryTransactionPoolMsg() {
  return {
    'type': messageType.QUERY_TRANSACTION_POOL,
    'data': null
  };
}

function responseTransactionPoolMsg() {
  return {
    'type': messageType.RESPONSE_TRANSACTION_POOL,
    'data': JSON.stringify(getTransactionPool())
  };
}

function initErrorHandler(ws) {
  function closeConnection(myWs) {
    console.log('connection failed to peer: ' + myWs.url);
    sockets.splice(sockets.indexOf(myWs), 1);
  }
  ws.on('close', () => closeConnection(ws));
  ws.on('error', () => closeConnection(ws));
}


function handleBlockchainResponse(receivedBlocks) {
  if (receivedBlocks.length === 0) {
    console.log('received block chain size of 0');
    return;
  }
  const latestBlockReceived = receivedBlocks[receivedBlocks.length - 1];
  if (!isValidBlockStructure(latestBlockReceived)) {
    console.log('block structure not valid');
    return;
  }
  const latestBlockHeld = getLatestBlock();
  if (latestBlockReceived.index > latestBlockHeld.index) {
    console.log('blockchain possibly behind. We got: ' +
      latestBlockHeld.index + ' Peer got: ' + latestBlockReceived.index);
    if (latestBlockHeld.hash === latestBlockReceived.previousHash) {
      if (addBlockToChain(latestBlockReceived)) {
        broadcast(responseLatestMsg());
      }
    } else if (receivedBlocks.length === 1) {
      console.log('We have to query the chain from our peer');
      broadcast(queryAllMsg());
    } else {
      console.log('Received blockchain is longer than current blockchain');
      replaceChain(receivedBlocks);
    }
  } else {
    console.log('received blockchain is not longer than received blockchain. Do nothing');
  }
}

function broadcastLatest() {
  broadcast(responseLatestMsg());
}

function connectToPeers(newPeer) {
  const ws = new WebSocket(newPeer);
  ws.on('open', () => {
    initConnection(ws);
  });
  ws.on('error', () => {
    console.log('connection failed');
  });
}

function broadCastTransactionPool() {
  broadcast(responseTransactionPoolMsg());
}

module.exports = { connectToPeers, broadcastLatest, broadCastTransactionPool, initP2PServer, getSockets };